const crypto = require('crypto');
const pool = require('../db/pool');

const RELEASE_NOTIFIER_TELEGRAM_API_BASE = String(process.env.RELEASE_NOTIFIER_TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const RELEASE_NOTIFIER_BOT_USERNAME = String(process.env.RELEASE_NOTIFIER_TELEGRAM_BOT_USERNAME || '').trim();
const RELEASE_NOTIFIER_ALLOWED_USER_IDS = parseCsvSet(process.env.RELEASE_NOTIFIER_TELEGRAM_ALLOWED_USER_IDS);

let schemaReady = false;
let schemaReadyPromise = null;
let cachedBotIdentity = null;

function nowMs() {
    return Date.now();
}

function createHttpError(status, message, code) {
    const error = new Error(message);
    error.status = status;
    error.code = code;
    return error;
}

function parseCsvSet(value) {
    return new Set(
        String(value || '')
            .split(',')
            .map((entry) => String(entry || '').trim())
            .filter(Boolean)
    );
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function normalizeOptionalText(value, maxLength = 255) {
    const normalized = String(value || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
    if (!normalized) {
        return null;
    }
    return normalized.slice(0, maxLength);
}

function normalizeVersion(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 64) : null;
}

function normalizeChangelogItems(value) {
    if (Array.isArray(value)) {
        return value
            .map((entry) => normalizeOptionalText(entry, 500))
            .filter(Boolean)
            .slice(0, 32);
    }

    const raw = String(value || '').replace(/\r\n/g, '\n').trim();
    if (!raw) {
        return [];
    }

    return raw
        .split('\n')
        .map((entry) => entry.replace(/^[-*•\s]+/, ''))
        .map((entry) => normalizeOptionalText(entry, 500))
        .filter(Boolean)
        .slice(0, 32);
}

function getReleaseNotifierConfig() {
    const token = String(process.env.RELEASE_NOTIFIER_TELEGRAM_BOT_TOKEN || '').trim();
    const webhookSecret = String(process.env.RELEASE_NOTIFIER_TELEGRAM_WEBHOOK_SECRET || '').trim();
    const announceSecret = String(process.env.RELEASE_NOTIFIER_ANNOUNCE_SECRET || '').trim();
    const available = Boolean(token);

    return {
        available,
        token,
        botUsername: RELEASE_NOTIFIER_BOT_USERNAME,
        webhookSecret,
        announceSecret,
        allowedUserIds: RELEASE_NOTIFIER_ALLOWED_USER_IDS,
        message: available
            ? 'Бот анонсов релизов готов.'
            : 'Бот анонсов релизов временно не настроен. Нужен RELEASE_NOTIFIER_TELEGRAM_BOT_TOKEN.'
    };
}

async function ensureReleaseNotifierSchema(db = pool) {
    if (schemaReady) {
        return;
    }
    if (schemaReadyPromise) {
        return schemaReadyPromise;
    }

    schemaReadyPromise = (async () => {
        await db.query(`
            CREATE TABLE IF NOT EXISTS release_notifier_meta (
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
    await ensureReleaseNotifierSchema(db);
    const [rows] = await db.query(
        'SELECT meta_value FROM release_notifier_meta WHERE meta_key = ? LIMIT 1',
        [metaKey]
    );
    return rows[0] ? rows[0].meta_value : null;
}

async function setMeta(metaKey, metaValue, db = pool) {
    await ensureReleaseNotifierSchema(db);
    await db.query(
        `INSERT INTO release_notifier_meta (meta_key, meta_value, updated_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE meta_value = VALUES(meta_value), updated_at = VALUES(updated_at)`,
        [metaKey, metaValue, nowMs()]
    );
}

function verifyReleaseNotifierWebhookSecret(receivedSecret) {
    const expected = String(process.env.RELEASE_NOTIFIER_TELEGRAM_WEBHOOK_SECRET || '').trim();
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

function verifyReleaseNotifierAnnounceSecret(receivedSecret) {
    const expected = String(process.env.RELEASE_NOTIFIER_ANNOUNCE_SECRET || '').trim();
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

async function callReleaseNotifierTelegram(method, payload) {
    const config = getReleaseNotifierConfig();
    if (!config.available) {
        throw createHttpError(503, config.message, 'RELEASE_NOTIFIER_UNAVAILABLE');
    }

    const response = await fetch(`${RELEASE_NOTIFIER_TELEGRAM_API_BASE}/bot${config.token}/${method}`, {
        method: 'POST',
        headers: {
            'content-type': 'application/json'
        },
        body: JSON.stringify(payload || {}),
        signal: AbortSignal.timeout(20000)
    });

    const json = await response.json().catch(() => null);
    if (!response.ok || !json || json.ok !== true) {
        const description = String(json?.description || `Telegram API ${response.status}`);
        throw createHttpError(502, description, 'RELEASE_NOTIFIER_TELEGRAM_API_ERROR');
    }

    return json.result;
}

async function getBotIdentity() {
    if (cachedBotIdentity) {
        return cachedBotIdentity;
    }
    const me = await callReleaseNotifierTelegram('getMe', {});
    cachedBotIdentity = {
        id: Number(me.id || 0) || null,
        username: String(me.username || RELEASE_NOTIFIER_BOT_USERNAME || '').trim() || null
    };
    return cachedBotIdentity;
}

function extractCommandText(message) {
    if (typeof message?.text === 'string' && message.text.trim()) {
        return message.text.trim();
    }
    return '';
}

function isSetChatCommand(text, botUsername) {
    const normalized = String(text || '').trim();
    if (!normalized.startsWith('/setchat')) {
        return false;
    }

    const match = normalized.match(/^\/setchat(?:@([A-Za-z0-9_]+))?(?:\s|$)/i);
    if (!match) {
        return false;
    }

    const mentionedBot = String(match[1] || '').trim().toLowerCase();
    if (!mentionedBot) {
        return true;
    }

    return Boolean(botUsername) && mentionedBot === String(botUsername || '').trim().toLowerCase();
}

async function loadReleaseNotifierTarget(db = pool) {
    await ensureReleaseNotifierSchema(db);
    const [rows] = await db.query(
        `SELECT meta_key, meta_value, updated_at
         FROM release_notifier_meta
         WHERE meta_key IN (
             'target_chat_id',
             'target_thread_id',
             'target_chat_title',
             'target_set_by_user_id',
             'target_set_by_username',
             'target_updated_at'
         )`
    );

    const meta = new Map(rows.map((row) => [row.meta_key, row.meta_value]));
    const chatId = normalizeOptionalText(meta.get('target_chat_id'), 64);
    const threadId = Number(meta.get('target_thread_id') || 0) || null;
    const updatedAt = Number(meta.get('target_updated_at') || 0) || null;

    return {
        configured: Boolean(chatId),
        chat_id: chatId,
        thread_id: threadId,
        chat_title: normalizeOptionalText(meta.get('target_chat_title'), 255),
        set_by_user_id: normalizeOptionalText(meta.get('target_set_by_user_id'), 64),
        set_by_username: normalizeOptionalText(meta.get('target_set_by_username'), 120),
        updated_at: updatedAt
    };
}

async function saveReleaseNotifierTarget(target, db = pool) {
    const updatedAt = nowMs();
    await Promise.all([
        setMeta('target_chat_id', String(target.chatId), db),
        setMeta('target_thread_id', target.threadId ? String(target.threadId) : '', db),
        setMeta('target_chat_title', String(target.chatTitle || ''), db),
        setMeta('target_set_by_user_id', String(target.setByUserId || ''), db),
        setMeta('target_set_by_username', String(target.setByUsername || ''), db),
        setMeta('target_updated_at', String(updatedAt), db)
    ]);
    return loadReleaseNotifierTarget(db);
}

async function getReleaseNotifierState(db = pool) {
    const config = getReleaseNotifierConfig();
    const target = await loadReleaseNotifierTarget(db);
    return {
        availability: config.available,
        message: config.message,
        bot_username: config.botUsername || null,
        target
    };
}

function buildReleaseAnnouncementMessage(payload) {
    const platformName = normalizeOptionalText(payload.platform_name || payload.platform || 'платформы', 80) || 'платформы';
    const oldVersion = normalizeVersion(payload.old_version || payload.previous_version || payload.from_version);
    const newVersion = normalizeVersion(payload.new_version || payload.version || payload.to_version);
    const changelogItems = normalizeChangelogItems(payload.changelog || payload.items || payload.notes);

    if (!newVersion) {
        throw createHttpError(400, 'Нужна новая версия для анонса.', 'RELEASE_NOTIFIER_VERSION_REQUIRED');
    }

    const lines = [`<b>Обновилась ${escapeHtml(platformName)} версия</b>`];
    if (oldVersion) {
        lines.push(`с <s>${escapeHtml(oldVersion)}</s> на <b>${escapeHtml(newVersion)}</b>`);
    } else {
        lines.push(`Новая версия: <b>${escapeHtml(newVersion)}</b>`);
    }
    if (changelogItems.length > 0) {
        lines.push('');
        lines.push('<b>Что поменялось:</b>');
        for (const item of changelogItems) {
            lines.push(`• ${escapeHtml(item)}`);
        }
    }

    return lines.join('\n');
}

async function sendReleaseAnnouncement(payload = {}, db = pool) {
    await ensureReleaseNotifierSchema(db);
    const config = getReleaseNotifierConfig();
    if (!config.available) {
        throw createHttpError(503, config.message, 'RELEASE_NOTIFIER_UNAVAILABLE');
    }

    const target = await loadReleaseNotifierTarget(db);
    if (!target.configured || !target.chat_id) {
        throw createHttpError(400, 'Сначала выполните /setchat в нужной группе или теме.', 'RELEASE_NOTIFIER_TARGET_MISSING');
    }

    const text = buildReleaseAnnouncementMessage(payload);
    const telegramPayload = {
        chat_id: target.chat_id,
        text,
        parse_mode: 'HTML',
        disable_web_page_preview: true
    };
    if (target.thread_id) {
        telegramPayload.message_thread_id = Number(target.thread_id);
    }

    const result = await callReleaseNotifierTelegram('sendMessage', telegramPayload);
    return {
        sent: true,
        target,
        message_id: Number(result?.message_id || 0) || null
    };
}

function isAuthorizedSetChatUser(userId) {
    if (RELEASE_NOTIFIER_ALLOWED_USER_IDS.size === 0) {
        return true;
    }
    return RELEASE_NOTIFIER_ALLOWED_USER_IDS.has(String(userId || '').trim());
}

async function handleSetChatCommand(message, updateId, db = pool) {
    const fromId = String(message?.from?.id || '').trim();
    const chatId = String(message?.chat?.id || '').trim();
    const chatType = String(message?.chat?.type || '').trim();
    const threadId = Number(message?.message_thread_id || 0) || null;
    const chatTitle = normalizeOptionalText(message?.chat?.title || message?.chat?.username || '', 255);
    const username = normalizeOptionalText(message?.from?.username || '', 120);

    if (!isAuthorizedSetChatUser(fromId)) {
        await callReleaseNotifierTelegram('sendMessage', {
            chat_id: chatId,
            text: 'Эта команда недоступна для вашего аккаунта.',
            message_thread_id: threadId || undefined
        }).catch(() => {});
        return {
            accepted: false,
            ignored: false,
            reason: 'forbidden'
        };
    }

    if (!chatId || !['group', 'supergroup'].includes(chatType)) {
        if (chatId) {
            await callReleaseNotifierTelegram('sendMessage', {
                chat_id: chatId,
                text: 'Выполните /setchat в нужной группе или в нужной теме форума.',
                message_thread_id: threadId || undefined
            }).catch(() => {});
        }
        return {
            accepted: false,
            ignored: false,
            reason: 'wrong-chat-type'
        };
    }

    const target = await saveReleaseNotifierTarget({
        chatId,
        threadId,
        chatTitle,
        setByUserId: fromId,
        setByUsername: username
    }, db);

    await setMeta('last_update_id', String(Number(updateId || 0) || 0), db);

    const targetLabel = target.thread_id
        ? `тема ${target.thread_id} в ${target.chat_title || target.chat_id}`
        : `${target.chat_title || target.chat_id}`;

    await callReleaseNotifierTelegram('sendMessage', {
        chat_id: chatId,
        message_thread_id: threadId || undefined,
        text: `Чат для анонсов сохранён: ${targetLabel}.`
    }).catch(() => {});

    return {
        accepted: true,
        ignored: false,
        reason: null,
        target
    };
}

async function receiveReleaseNotifierWebhook(update, db = pool) {
    const config = getReleaseNotifierConfig();
    if (!config.available) {
        return {
            availability: false,
            accepted: false,
            ignored: true,
            reason: 'unavailable'
        };
    }

    await ensureReleaseNotifierSchema(db);
    const message = update?.message || update?.edited_message;
    if (!message) {
        return {
            availability: true,
            accepted: false,
            ignored: true,
            reason: 'no-message'
        };
    }

    const botIdentity = await getBotIdentity().catch(() => ({ id: null, username: config.botUsername || null }));
    if (botIdentity.id && Number(message.from?.id || 0) === Number(botIdentity.id)) {
        return {
            availability: true,
            accepted: false,
            ignored: true,
            reason: 'bot-message'
        };
    }

    const text = extractCommandText(message);
    if (!isSetChatCommand(text, botIdentity.username || config.botUsername)) {
        return {
            availability: true,
            accepted: false,
            ignored: true,
            reason: 'unsupported-command'
        };
    }

    const result = await handleSetChatCommand(message, update?.update_id, db);
    return {
        availability: true,
        ...result
    };
}

async function syncReleaseNotifierCommands() {
    const config = getReleaseNotifierConfig();
    if (!config.available) {
        return {
            availability: false,
            synced: false,
            message: config.message
        };
    }

    await callReleaseNotifierTelegram('setMyCommands', {
        commands: [
            {
                command: 'setchat',
                description: 'Сохранить текущую группу или тему для анонсов'
            }
        ]
    });

    return {
        availability: true,
        synced: true
    };
}

module.exports = {
    getReleaseNotifierConfig,
    getReleaseNotifierState,
    ensureReleaseNotifierSchema,
    verifyReleaseNotifierWebhookSecret,
    verifyReleaseNotifierAnnounceSecret,
    receiveReleaseNotifierWebhook,
    sendReleaseAnnouncement,
    syncReleaseNotifierCommands
};
