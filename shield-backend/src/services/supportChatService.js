const crypto = require('crypto');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { fetchUserById } = require('./accountEntitlementsService');

const SUPPORT_TELEGRAM_API_BASE = String(process.env.SUPPORT_TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const SUPPORT_TELEGRAM_BOT_USERNAME = String(process.env.SUPPORT_TELEGRAM_BOT_USERNAME || 'fatalerrorsupportbot').trim();
const SUPPORT_CHAT_MESSAGE_MAX_LENGTH = Math.max(400, Number(process.env.SUPPORT_CHAT_MESSAGE_MAX_LENGTH || 4000) || 4000);
const SUPPORT_CHAT_POLL_INTERVAL_MS = Math.max(1500, Number(process.env.SUPPORT_CHAT_POLL_INTERVAL_MS || 4000) || 4000);
const SUPPORT_TELEGRAM_CURL_MAX_TIME_SEC = Math.max(8, Math.min(25, Number(process.env.SUPPORT_TELEGRAM_CURL_MAX_TIME_SEC || 18) || 18));

let schemaReady = false;
let schemaReadyPromise = null;
let syncPromise = null;
let pollerStarted = false;
let pollerTimer = null;
const execFileAsync = promisify(execFile);

function createHttpError(status, message, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function nowMs() {
    return Date.now();
}

function getSupportConfig() {
    const token = String(process.env.SUPPORT_TELEGRAM_BOT_TOKEN || '').trim();
    const chatId = String(process.env.SUPPORT_TELEGRAM_CHAT_ID || '').trim();
    const webhookSecret = String(process.env.SUPPORT_TELEGRAM_WEBHOOK_SECRET || '').trim();
    const available = Boolean(token && chatId);

    return {
        available,
        token,
        chatId,
        botUsername: SUPPORT_TELEGRAM_BOT_USERNAME,
        webhookSecret,
        message: available
            ? 'Чат поддержки готов.'
            : 'Чат поддержки временно не настроен. Он заработает, когда администратор добавит SUPPORT_TELEGRAM_BOT_TOKEN и SUPPORT_TELEGRAM_CHAT_ID.'
    };
}

function getAvailabilityState() {
    const config = getSupportConfig();
    return {
        availability: config.available,
        message: config.message,
        support_bot_username: config.botUsername,
        configured_group_chat_id: config.chatId || null,
        forum_topics_required: true,
        delivery_mode: shouldUseSupportPolling() ? 'polling' : 'webhook',
        poll_after_ms: SUPPORT_CHAT_POLL_INTERVAL_MS
    };
}

function shouldUseSupportPolling() {
    const forced = String(process.env.SUPPORT_TELEGRAM_FORCE_POLLING || '').trim().toLowerCase();
    if (forced === '1' || forced === 'true') {
        return true;
    }
    if (forced === '0' || forced === 'false') {
        return false;
    }
    return !String(process.env.SUPPORT_TELEGRAM_WEBHOOK_SECRET || '').trim();
}

async function ensureSupportChatSchema(db = pool) {
    if (schemaReady) {
        return;
    }
    if (schemaReadyPromise) {
        return schemaReadyPromise;
    }

    schemaReadyPromise = (async () => {
        await db.query(`
            CREATE TABLE IF NOT EXISTS support_chats (
                id VARCHAR(36) PRIMARY KEY,
                ticket_number BIGINT NOT NULL AUTO_INCREMENT UNIQUE,
                user_id VARCHAR(36) NOT NULL,
                status ENUM('OPEN','CLOSED') NOT NULL DEFAULT 'OPEN',
                telegram_chat_id VARCHAR(64) DEFAULT NULL,
                telegram_thread_id BIGINT DEFAULT NULL,
                telegram_topic_name VARCHAR(255) DEFAULT NULL,
                last_message_from ENUM('client','support','system') NOT NULL DEFAULT 'client',
                last_message_at BIGINT DEFAULT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                closed_at BIGINT DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_support_chats_user_updated (user_id, updated_at),
                INDEX idx_support_chats_status_updated (status, updated_at),
                UNIQUE KEY uniq_support_telegram_thread (telegram_chat_id, telegram_thread_id)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS support_chat_messages (
                id VARCHAR(36) PRIMARY KEY,
                chat_id VARCHAR(36) NOT NULL,
                user_id VARCHAR(36) NOT NULL,
                sender_role ENUM('client','support','system') NOT NULL,
                sender_name VARCHAR(120) DEFAULT NULL,
                message_text LONGTEXT NOT NULL,
                source ENUM('web','telegram','system') NOT NULL DEFAULT 'web',
                telegram_chat_id VARCHAR(64) DEFAULT NULL,
                telegram_thread_id BIGINT DEFAULT NULL,
                telegram_message_id BIGINT DEFAULT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                FOREIGN KEY (chat_id) REFERENCES support_chats(id) ON DELETE CASCADE,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_support_chat_messages_chat_created (chat_id, created_at),
                UNIQUE KEY uniq_support_chat_telegram_message (telegram_chat_id, telegram_message_id)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS support_chat_meta (
                meta_key VARCHAR(120) PRIMARY KEY,
                meta_value LONGTEXT DEFAULT NULL,
                updated_at BIGINT NOT NULL
            )
        `);
        schemaReady = true;
    })().finally(() => {
        schemaReadyPromise = null;
    });

    return schemaReadyPromise;
}

async function getMeta(metaKey, db = pool) {
    await ensureSupportChatSchema(db);
    const [rows] = await db.query(
        'SELECT meta_value FROM support_chat_meta WHERE meta_key = ? LIMIT 1',
        [metaKey]
    );
    return rows[0] ? rows[0].meta_value : null;
}

async function setMeta(metaKey, metaValue, db = pool) {
    await ensureSupportChatSchema(db);
    const timestamp = nowMs();
    await db.query(
        `INSERT INTO support_chat_meta (meta_key, meta_value, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value), updated_at = VALUES(updated_at)`,
        [metaKey, metaValue, timestamp]
    );
}

function verifyWebhookSecret(receivedSecret) {
    const expected = String(process.env.SUPPORT_TELEGRAM_WEBHOOK_SECRET || '').trim();
    if (!expected) {
        return false;
    }
    const left = Buffer.from(String(receivedSecret || ''), 'utf8');
    const right = Buffer.from(expected, 'utf8');
    if (left.length !== right.length) {
        return false;
    }
    return crypto.timingSafeEqual(left, right);
}

async function callTelegram(method, payload) {
    const config = getSupportConfig();
    if (!config.available) {
        throw createHttpError(503, config.message, 'SUPPORT_TELEGRAM_UNAVAILABLE');
    }

    const url = `${SUPPORT_TELEGRAM_API_BASE}/bot${config.token}/${method}`;
    const requestBody = JSON.stringify(payload || {});

    try {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: requestBody,
            signal: AbortSignal.timeout(20000)
        });

        const json = await response.json().catch(() => null);
        if (!response.ok || !json || json.ok !== true) {
            const description = String(json?.description || `Telegram API ${response.status}`);
            throw createHttpError(502, description, 'SUPPORT_TELEGRAM_API_ERROR');
        }

        return json.result;
    } catch (error) {
        const { stdout } = await execFileAsync('curl', [
            '--ipv4',
            '-sS',
            '--retry', '1',
            '--retry-all-errors',
            '--retry-delay', '1',
            '--connect-timeout', '10',
            '--max-time', String(SUPPORT_TELEGRAM_CURL_MAX_TIME_SEC),
            '-X', 'POST',
            '-H', 'content-type: application/json',
            '--data', requestBody,
            url
        ], {
            maxBuffer: 4 * 1024 * 1024
        }).catch((curlError) => {
            throw createHttpError(502, curlError?.message || error?.message || 'Telegram API unavailable', 'SUPPORT_TELEGRAM_API_ERROR');
        });

        const json = JSON.parse(String(stdout || 'null'));
        if (!json || json.ok !== true) {
            const description = String(json?.description || 'Telegram API unavailable');
            throw createHttpError(502, description, 'SUPPORT_TELEGRAM_API_ERROR');
        }

        return json.result;
    }
}

function normalizeMessageText(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
    if (!normalized) {
        throw createHttpError(400, 'Сообщение пустое.', 'SUPPORT_MESSAGE_EMPTY');
    }
    return normalized.slice(0, SUPPORT_CHAT_MESSAGE_MAX_LENGTH);
}

function extractInboundText(message) {
    const value = typeof message?.text === 'string' && message.text.trim()
        ? message.text
        : typeof message?.caption === 'string' && message.caption.trim()
            ? message.caption
            : '';
    return String(value || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim().slice(0, SUPPORT_CHAT_MESSAGE_MAX_LENGTH);
}

function formatTopicName(ticketNumber, lastMessageFrom) {
    const prefix = lastMessageFrom === 'support' ? '🟩' : '🟦';
    return `${prefix} Заявка #${ticketNumber}`.slice(0, 120);
}

function buildSupportEnvelope(messageText, user, chat) {
    const lines = [
        `Заявка #${chat.ticket_number}`,
        `${user.name} <${user.email}>`,
        '',
        messageText
    ];
    return lines.join('\n').trim();
}

async function findOpenChatForUser(userId, db = pool) {
    await ensureSupportChatSchema(db);
    const [rows] = await db.query(
        `SELECT *
         FROM support_chats
         WHERE user_id = ? AND status = 'OPEN'
         ORDER BY updated_at DESC
         LIMIT 1`,
        [userId]
    );
    return rows[0] || null;
}

async function findChatById(userId, chatId, db = pool) {
    await ensureSupportChatSchema(db);
    const [rows] = await db.query(
        `SELECT *
         FROM support_chats
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [chatId, userId]
    );
    return rows[0] || null;
}

async function findChatByThread(chatId, threadId, db = pool) {
    await ensureSupportChatSchema(db);
    const [rows] = await db.query(
        `SELECT *
         FROM support_chats
         WHERE telegram_chat_id = ? AND telegram_thread_id = ?
         LIMIT 1`,
        [String(chatId), Number(threadId || 0)]
    );
    return rows[0] || null;
}

async function loadChatMessages(chatId, options = {}, db = pool) {
    await ensureSupportChatSchema(db);
    const after = Math.max(0, Number(options.after || 0) || 0);
    const limit = Math.min(120, Math.max(1, Number(options.limit || 80) || 80));
    const [rows] = await db.query(
        `SELECT id, sender_role, sender_name, message_text, source,
                telegram_message_id, created_at, updated_at
         FROM support_chat_messages
         WHERE chat_id = ?
           AND created_at > ?
         ORDER BY created_at ASC
         LIMIT ?`,
        [chatId, after, limit]
    );
    return rows.map((row) => ({
        id: row.id,
        sender_role: row.sender_role,
        sender_name: row.sender_name,
        message_text: row.message_text,
        source: row.source,
        telegram_message_id: row.telegram_message_id,
        created_at: row.created_at,
        updated_at: row.updated_at
    }));
}

function shapeChatRow(row) {
    if (!row) {
        return null;
    }
    return {
        id: row.id,
        ticket_number: Number(row.ticket_number || 0),
        status: row.status,
        telegram_thread_id: row.telegram_thread_id,
        telegram_topic_name: row.telegram_topic_name,
        last_message_from: row.last_message_from,
        last_message_at: row.last_message_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        closed_at: row.closed_at
    };
}

async function updateTopicIndicator(chatRow, db = pool) {
    const config = getSupportConfig();
    if (!config.available || !chatRow || !chatRow.telegram_thread_id) {
        return;
    }

    const topicName = formatTopicName(chatRow.ticket_number, chatRow.last_message_from);
    await callTelegram('editForumTopic', {
        chat_id: config.chatId,
        message_thread_id: Number(chatRow.telegram_thread_id),
        name: topicName
    }).catch(() => {});

    await db.query(
        'UPDATE support_chats SET telegram_topic_name = ?, updated_at = ? WHERE id = ?',
        [topicName, nowMs(), chatRow.id]
    );
}

async function ensureForumTopicForChat(chatRow, user, db = pool) {
    const config = getSupportConfig();
    if (!config.available || !chatRow) {
        return chatRow;
    }
    if (chatRow.telegram_thread_id) {
        return chatRow;
    }

    const topic = await callTelegram('createForumTopic', {
        chat_id: config.chatId,
        name: formatTopicName(chatRow.ticket_number, chatRow.last_message_from || 'client')
    });
    const threadId = Number(topic.message_thread_id || 0) || null;
    if (!threadId) {
        throw createHttpError(502, 'Telegram не вернул id темы форума.', 'SUPPORT_TELEGRAM_TOPIC_FAILED');
    }

    const topicName = String(topic.name || formatTopicName(chatRow.ticket_number, chatRow.last_message_from || 'client'));
    await db.query(
        `UPDATE support_chats
         SET telegram_chat_id = ?, telegram_thread_id = ?, telegram_topic_name = ?, updated_at = ?
         WHERE id = ?`,
        [config.chatId, threadId, topicName, nowMs(), chatRow.id]
    );

    if (user) {
        await callTelegram('sendMessage', {
            chat_id: config.chatId,
            message_thread_id: threadId,
            text: `Новая заявка с сайта\nЗаявка #${chatRow.ticket_number}\n${user.name} <${user.email}>`
        }).catch(() => {});
    }

    const [rows] = await db.query('SELECT * FROM support_chats WHERE id = ? LIMIT 1', [chatRow.id]);
    return rows[0] || {
        ...chatRow,
        telegram_chat_id: config.chatId,
        telegram_thread_id: threadId,
        telegram_topic_name: topicName
    };
}

async function createSupportChat(userId, db = pool) {
    await ensureSupportChatSchema(db);
    const availability = getAvailabilityState();
    if (!availability.availability) {
        return {
            ...availability,
            chat: null,
            messages: []
        };
    }

    const user = await fetchUserById(userId, { db, includeCreatedAt: true });
    if (!user) {
        throw createHttpError(404, 'User not found', 'USER_NOT_FOUND');
    }

    const lockName = `support-chat:${userId}`;
    const [lockRows] = await db.query('SELECT GET_LOCK(?, 10) AS is_locked', [lockName]);
    const isLocked = Number(lockRows?.[0]?.is_locked || 0) === 1;
    if (!isLocked) {
        throw createHttpError(503, 'Не удалось подготовить чат поддержки.', 'SUPPORT_CHAT_LOCK_TIMEOUT');
    }

    let created = null;
    let chatId = null;
    try {
        const existing = await findOpenChatForUser(userId, db);
        if (existing) {
            let existingChat = existing;
            if (!existingChat.telegram_thread_id) {
                try {
                    existingChat = await ensureForumTopicForChat(existingChat, user, db);
                } catch (error) {
                    return {
                        ...availability,
                        availability: false,
                        message: 'Не удалось восстановить тему поддержки. Проверьте forum chat, права бота и SUPPORT_TELEGRAM_CHAT_ID.',
                        chat: shapeChatRow(existingChat),
                        messages: await loadChatMessages(existingChat.id, {}, db)
                    };
                }
            }
            return {
                ...availability,
                message: 'Диалог уже открыт.',
                chat: shapeChatRow(existingChat),
                messages: await loadChatMessages(existingChat.id, {}, db)
            };
        }

        chatId = uuidv4();
        const timestamp = nowMs();
        await db.query(
            `INSERT INTO support_chats (id, user_id, status, last_message_from, created_at, updated_at)
             VALUES (?, ?, 'OPEN', 'client', ?, ?)`,
            [chatId, userId, timestamp, timestamp]
        );

        const [rows] = await db.query('SELECT * FROM support_chats WHERE id = ? LIMIT 1', [chatId]);
        created = rows[0] || null;
        if (!created) {
            throw createHttpError(500, 'Не удалось открыть чат поддержки.', 'SUPPORT_CHAT_CREATE_FAILED');
        }
    } finally {
        await db.query('SELECT RELEASE_LOCK(?) AS released', [lockName]).catch(() => {});
    }

    try {
        await ensureForumTopicForChat(created, user, db);
    } catch (error) {
        await db.query('DELETE FROM support_chats WHERE id = ?', [chatId]).catch(() => {});
        return {
            ...availability,
            availability: false,
            message: 'Не удалось открыть диалог поддержки. Проверьте forum chat, права бота и SUPPORT_TELEGRAM_CHAT_ID.',
            chat: null,
            messages: []
        };
    }

    const [finalRows] = await db.query('SELECT * FROM support_chats WHERE id = ? LIMIT 1', [chatId]);
    const finalChat = finalRows[0];
    return {
        ...availability,
        message: 'Диалог поддержки открыт.',
        chat: shapeChatRow(finalChat),
        messages: []
    };
}

async function ingestTelegramUpdate(update, db = pool) {
    const config = getSupportConfig();
    if (!config.available) {
        return { accepted: false, reason: 'unavailable' };
    }

    await ensureSupportChatSchema(db);
    const message = update?.message || update?.edited_message;
    if (!message || String(message.chat?.id || '') !== String(config.chatId)) {
        return { accepted: false, reason: 'wrong-chat' };
    }

    const threadId = Number(message.message_thread_id || 0) || null;
    if (!threadId) {
        return { accepted: false, reason: 'no-thread' };
    }

    if (message.from?.is_bot === true) {
        return { accepted: false, reason: 'bot-message' };
    }

    const chat = await findChatByThread(config.chatId, threadId, db);
    if (!chat) {
        return { accepted: false, reason: 'unknown-thread' };
    }

    const text = extractInboundText(message);
    if (!text) {
        return { accepted: false, reason: 'empty' };
    }

    const telegramMessageId = Number(message.message_id || 0) || null;
    if (!telegramMessageId) {
        return { accepted: false, reason: 'missing-message-id' };
    }

    const [existingRows] = await db.query(
        `SELECT id, message_text
         FROM support_chat_messages
         WHERE telegram_chat_id = ? AND telegram_message_id = ?
         LIMIT 1`,
        [String(config.chatId), telegramMessageId]
    );

    const senderName = [message.from?.first_name, message.from?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || message.from?.username || 'Поддержка';
    const createdAt = Number(message.date || 0) > 0 ? Number(message.date) * 1000 : nowMs();

    if (existingRows.length > 0) {
        await db.query(
            `UPDATE support_chat_messages
             SET message_text = ?, sender_name = ?, updated_at = ?
             WHERE id = ?`,
            [text, String(senderName).slice(0, 120), nowMs(), existingRows[0].id]
        );
    } else {
        await db.query(
            `INSERT INTO support_chat_messages
             (id, chat_id, user_id, sender_role, sender_name, message_text, source,
              telegram_chat_id, telegram_thread_id, telegram_message_id, created_at, updated_at)
             VALUES (?, ?, ?, 'support', ?, ?, 'telegram', ?, ?, ?, ?, ?)`,
            [
                uuidv4(),
                chat.id,
                chat.user_id,
                String(senderName).slice(0, 120),
                text,
                String(config.chatId),
                threadId,
                telegramMessageId,
                createdAt,
                createdAt
            ]
        );
    }

    await db.query(
        `UPDATE support_chats
         SET last_message_from = 'support', last_message_at = ?, updated_at = ?
         WHERE id = ?`,
        [createdAt, nowMs(), chat.id]
    );

    await updateTopicIndicator({
        ...chat,
        last_message_from: 'support',
        last_message_at: createdAt
    }, db);

    return { accepted: true, chat_id: chat.id, thread_id: threadId };
}

async function syncSupportUpdates(db = pool) {
    if (syncPromise) {
        return syncPromise;
    }

    syncPromise = (async () => {
        const availability = getAvailabilityState();
        if (!availability.availability) {
            return availability;
        }
        if (!shouldUseSupportPolling()) {
            return {
                ...availability,
                synced: false,
                message: 'Чат работает через webhook.'
            };
        }

        await ensureSupportChatSchema(db);
        const offsetRaw = await getMeta('telegram_update_offset', db);
        const offset = Math.max(0, Number(offsetRaw || 0) || 0);
        const updates = await callTelegram('getUpdates', {
            offset,
            limit: 100,
            timeout: 0,
            allowed_updates: ['message', 'edited_message']
        });

        if (!Array.isArray(updates) || updates.length === 0) {
            return {
                ...availability,
                message: 'Новых сообщений нет.'
            };
        }

        let nextOffset = offset;
        for (const update of updates) {
            await ingestTelegramUpdate(update, db);
            nextOffset = Math.max(nextOffset, Number(update.update_id || 0) + 1);
            await setMeta('telegram_update_offset', String(nextOffset), db);
        }

        return {
            ...availability,
            message: 'Сообщения синхронизированы.'
        };
    })().finally(() => {
        syncPromise = null;
    });

    return syncPromise;
}

async function receiveSupportWebhook(update, db = pool) {
    const availability = getAvailabilityState();
    if (!availability.availability) {
        return {
            ...availability,
            accepted: false,
            ignored: true
        };
    }

    await ensureSupportChatSchema(db);
    const result = await ingestTelegramUpdate(update, db);
    return {
        ...availability,
        accepted: Boolean(result.accepted),
        ignored: !result.accepted,
        reason: result.reason || null
    };
}

async function getSupportChatState(userId, options = {}, db = pool) {
    const availability = getAvailabilityState();
    if (!availability.availability) {
        return {
            ...availability,
            chat: null,
            messages: []
        };
    }

    await ensureSupportChatSchema(db);
    if (options.sync === 'poll' && shouldUseSupportPolling()) {
        syncSupportUpdates(db).catch(() => null);
    }

    let chat = await findOpenChatForUser(userId, db);
    if (!chat) {
        return {
            ...availability,
            message: 'Поддержка готова. Откройте чат, чтобы начать диалог.',
            chat: null,
            messages: []
        };
    }

    if (!chat.telegram_thread_id) {
        const user = await fetchUserById(userId, { db, includeCreatedAt: true }).catch(() => null);
        chat = await ensureForumTopicForChat(chat, user, db).catch(() => chat);
    }

    const messages = await loadChatMessages(chat.id, {
        after: options.after,
        limit: options.limit || 80
    }, db);

    return {
        ...availability,
        message: 'Диалог поддержки готов.',
        chat: shapeChatRow(chat),
        messages
    };
}

async function sendSupportChatMessage(userId, payload = {}, db = pool) {
    const availability = getAvailabilityState();
    if (!availability.availability) {
        return {
            ...availability,
            chat: null,
            messages: []
        };
    }

    await ensureSupportChatSchema(db);
    const user = await fetchUserById(userId, { db, includeCreatedAt: true });
    if (!user) {
        throw createHttpError(404, 'User not found', 'USER_NOT_FOUND');
    }

    let chat = null;
    if (payload.chat_id) {
        chat = await findChatById(userId, String(payload.chat_id), db);
    }
    if (!chat) {
        const opened = await createSupportChat(userId, db);
        if (!opened.availability || !opened.chat) {
            return opened;
        }
        chat = await findChatById(userId, opened.chat.id, db);
    }
    if (!chat) {
        throw createHttpError(500, 'Не удалось подготовить чат поддержки.', 'SUPPORT_CHAT_UNAVAILABLE');
    }
    if (!chat.telegram_thread_id) {
        try {
            chat = await ensureForumTopicForChat(chat, user, db);
        } catch (error) {
            return {
                ...availability,
                availability: false,
                message: 'Не удалось открыть тему поддержки. Проверьте forum chat, права бота и SUPPORT_TELEGRAM_CHAT_ID.',
                chat: shapeChatRow(chat),
                messages: await loadChatMessages(chat.id, {}, db)
            };
        }
    }

    const config = getSupportConfig();
    const text = normalizeMessageText(payload.text);
    const telegramResult = await callTelegram('sendMessage', {
        chat_id: config.chatId,
        message_thread_id: Number(chat.telegram_thread_id),
        text: buildSupportEnvelope(text, user, chat),
        disable_web_page_preview: true
    });

    const timestamp = nowMs();
    await db.query(
        `INSERT INTO support_chat_messages
         (id, chat_id, user_id, sender_role, sender_name, message_text, source,
          telegram_chat_id, telegram_thread_id, telegram_message_id, created_at, updated_at)
         VALUES (?, ?, ?, 'client', ?, ?, 'web', ?, ?, ?, ?, ?)`,
        [
            uuidv4(),
            chat.id,
            userId,
            String(user.name || 'Клиент').slice(0, 120),
            text,
            String(config.chatId),
            Number(chat.telegram_thread_id),
            Number(telegramResult?.message_id || 0) || null,
            timestamp,
            timestamp
        ]
    );

    await db.query(
        `UPDATE support_chats
         SET last_message_from = 'client', last_message_at = ?, updated_at = ?
         WHERE id = ?`,
        [timestamp, timestamp, chat.id]
    );

    await updateTopicIndicator({
        ...chat,
        last_message_from: 'client',
        last_message_at: timestamp
    }, db);

    return getSupportChatState(userId, { sync: false }, db);
}

function startSupportChatPolling() {
    if (pollerStarted) {
        return;
    }
    if (!shouldUseSupportPolling()) {
        return;
    }
    pollerStarted = true;

    const run = () => {
        syncSupportUpdates().catch((error) => {
            if (String(error?.message || '').includes('getUpdates')) {
                return;
            }
            console.error('Support chat background sync failed:', error);
        });
    };

    pollerTimer = setInterval(run, SUPPORT_CHAT_POLL_INTERVAL_MS);
    if (typeof pollerTimer?.unref === 'function') {
        pollerTimer.unref();
    }
    setTimeout(run, 250);
}

module.exports = {
    getSupportConfig,
    getAvailabilityState,
    getSupportChatState,
    createSupportChat,
    sendSupportChatMessage,
    syncSupportUpdates,
    startSupportChatPolling,
    receiveSupportWebhook,
    verifyWebhookSecret,
    ensureSupportChatSchema
};
