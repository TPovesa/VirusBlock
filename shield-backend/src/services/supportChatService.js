const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { fetchUserById } = require('./accountEntitlementsService');

const SUPPORT_TELEGRAM_API_BASE = String(process.env.SUPPORT_TELEGRAM_API_BASE || 'https://api.telegram.org').replace(/\/+$/, '');
const SUPPORT_TELEGRAM_BOT_USERNAME = String(process.env.SUPPORT_TELEGRAM_BOT_USERNAME || 'fatalerrorsupportbot').trim();
const SUPPORT_CHAT_MESSAGE_MAX_LENGTH = Math.max(400, Number(process.env.SUPPORT_CHAT_MESSAGE_MAX_LENGTH || 4000) || 4000);
const SUPPORT_CHAT_POLL_INTERVAL_MS = Math.max(1500, Number(process.env.SUPPORT_CHAT_POLL_INTERVAL_MS || 3000) || 3000);
const SUPPORT_TELEGRAM_CURL_MAX_TIME_SEC = Math.max(8, Math.min(25, Number(process.env.SUPPORT_TELEGRAM_CURL_MAX_TIME_SEC || 18) || 18));
const SUPPORT_CHAT_STORAGE_DIR = path.resolve(__dirname, '../../storage/support-chat');
const SUPPORT_CHAT_ATTACHMENT_LIMIT = Math.max(1, Math.min(4, Number(process.env.SUPPORT_CHAT_ATTACHMENT_LIMIT || 1) || 1));
const SUPPORT_CHAT_ATTACHMENT_MAX_BYTES = Math.max(512 * 1024, Number(process.env.SUPPORT_CHAT_ATTACHMENT_MAX_BYTES || 8 * 1024 * 1024) || (8 * 1024 * 1024));
const SUPPORT_CHAT_ALLOWED_ATTACHMENT_TYPES = new Set(['photo', 'video']);
const SUPPORT_TELEGRAM_FETCH_TIMEOUT_MS = Math.max(4000, Number(process.env.SUPPORT_TELEGRAM_FETCH_TIMEOUT_MS || 7000) || 7000);

let schemaReady = false;
let schemaReadyPromise = null;
let syncPromise = null;
let pollerStarted = false;
let pollerTimer = null;
let resumeQueuedDeliveriesStarted = false;
const deliveryJobs = new Map();
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

function ensureStorageDir() {
    fs.mkdirSync(SUPPORT_CHAT_STORAGE_DIR, { recursive: true });
}

function sanitizeFileName(fileName, fallbackBaseName = 'attachment') {
    const original = String(fileName || '').trim();
    const ext = path.extname(original).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12);
    const base = (path.basename(original, ext) || fallbackBaseName)
        .replace(/[^A-Za-z0-9._-]+/g, '-')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 80) || fallbackBaseName;
    return `${base}${ext}`;
}

function coerceAttachmentType(value, mimeType) {
    const normalized = String(value || '').trim().toLowerCase();
    if (normalized === 'photo' || normalized === 'image' || String(mimeType || '').startsWith('image/')) {
        return 'photo';
    }
    if (normalized === 'video' || String(mimeType || '').startsWith('video/')) {
        return 'video';
    }
    return null;
}

function publicAttachmentUrl(messageId, assetId) {
    return `/basedata/api/profile/support-chat/media/${encodeURIComponent(messageId)}/${encodeURIComponent(assetId)}`;
}

function parseAttachmentsJson(value) {
    if (!value) {
        return [];
    }
    try {
        const parsed = JSON.parse(String(value));
        return Array.isArray(parsed) ? parsed : [];
    } catch {
        return [];
    }
}

function getAttachmentExtension(type, mimeType, fileName) {
    const existingExt = path.extname(String(fileName || '')).replace(/[^A-Za-z0-9.]/g, '').slice(0, 12);
    if (existingExt) {
        return existingExt;
    }
    const normalizedMime = String(mimeType || '').trim().toLowerCase();
    if (normalizedMime === 'image/jpeg') return '.jpg';
    if (normalizedMime === 'image/png') return '.png';
    if (normalizedMime === 'image/webp') return '.webp';
    if (normalizedMime === 'image/gif') return '.gif';
    if (normalizedMime === 'video/mp4') return '.mp4';
    if (normalizedMime === 'video/webm') return '.webm';
    return type === 'video' ? '.mp4' : '.jpg';
}

function resolveStoredPath(relativePath) {
    const targetPath = path.resolve(SUPPORT_CHAT_STORAGE_DIR, String(relativePath || ''));
    if (!targetPath.startsWith(`${SUPPORT_CHAT_STORAGE_DIR}${path.sep}`) && targetPath !== SUPPORT_CHAT_STORAGE_DIR) {
        throw createHttpError(400, 'Некорректный путь вложения.', 'SUPPORT_ATTACHMENT_PATH_INVALID');
    }
    return targetPath;
}

function shapeAttachmentForApi(messageId, raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const attachmentId = String(raw.id || '').trim();
    const type = coerceAttachmentType(raw.type, raw.mimeType || raw.mime_type);
    const relativePath = String(raw.relativePath || raw.relative_path || '').trim();
    if (!attachmentId || !type || !relativePath) {
        return null;
    }
    return {
        id: attachmentId,
        type,
        file_name: typeof raw.fileName === 'string' ? raw.fileName : (typeof raw.file_name === 'string' ? raw.file_name : null),
        mime_type: typeof raw.mimeType === 'string' ? raw.mimeType : (typeof raw.mime_type === 'string' ? raw.mime_type : null),
        size_bytes: Number(raw.sizeBytes || raw.size_bytes || 0) || 0,
        width: Number(raw.width || 0) || null,
        height: Number(raw.height || 0) || null,
        duration_seconds: Number(raw.durationSeconds || raw.duration_seconds || 0) || null,
        media_url: publicAttachmentUrl(messageId, attachmentId)
    };
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
    return true;
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
            ALTER TABLE support_chat_messages
            ADD COLUMN IF NOT EXISTS message_kind ENUM('TEXT','PHOTO','VIDEO') NOT NULL DEFAULT 'TEXT' AFTER source,
            ADD COLUMN IF NOT EXISTS attachments_json LONGTEXT DEFAULT NULL AFTER message_kind,
            ADD COLUMN IF NOT EXISTS delivery_status ENUM('QUEUED','SENT','FAILED') NOT NULL DEFAULT 'SENT' AFTER attachments_json,
            ADD COLUMN IF NOT EXISTS delivery_error VARCHAR(255) DEFAULT NULL AFTER delivery_status
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
        const { stdout } = await execFileAsync('curl', [
            '--noproxy', '*',
            '--ipv4',
            '-sS',
            '--retry', '1',
            '--retry-all-errors',
            '--retry-delay', '1',
            '--connect-timeout', '6',
            '--max-time', String(SUPPORT_TELEGRAM_CURL_MAX_TIME_SEC),
            '-X', 'POST',
            '-H', 'content-type: application/json',
            '--data', requestBody,
            url
        ], {
            maxBuffer: 4 * 1024 * 1024
        });

        const json = JSON.parse(String(stdout || 'null'));
        if (!json || json.ok !== true) {
            const description = String(json?.description || 'Telegram API unavailable');
            throw createHttpError(502, description, 'SUPPORT_TELEGRAM_API_ERROR');
        }

        return json.result;
    } catch (error) {
        const response = await fetch(url, {
            method: 'POST',
            headers: {
                'content-type': 'application/json'
            },
            body: requestBody,
            signal: AbortSignal.timeout(SUPPORT_TELEGRAM_FETCH_TIMEOUT_MS)
        });

        const json = await response.json().catch(() => null);
        if (!response.ok || !json || json.ok !== true) {
            const description = String(json?.description || `Telegram API ${response.status}`);
            throw createHttpError(502, description, 'SUPPORT_TELEGRAM_API_ERROR');
        }

        return json.result;
    }
}

async function callTelegramMultipart(method, fields, fileField) {
    const config = getSupportConfig();
    if (!config.available) {
        throw createHttpError(503, config.message, 'SUPPORT_TELEGRAM_UNAVAILABLE');
    }

    const url = `${SUPPORT_TELEGRAM_API_BASE}/bot${config.token}/${method}`;
    const args = [
        '--noproxy', '*',
        '--ipv4',
        '-sS',
        '--retry', '1',
        '--retry-all-errors',
        '--retry-delay', '1',
        '--connect-timeout', '6',
        '--max-time', String(SUPPORT_TELEGRAM_CURL_MAX_TIME_SEC),
        '-X', 'POST'
    ];

    Object.entries(fields || {}).forEach(([key, value]) => {
        if (value === undefined || value === null || value === '') {
            return;
        }
        args.push('-F', `${key}=${String(value)}`);
    });

    if (!fileField?.name || !fileField?.path) {
        throw createHttpError(400, 'Файл для отправки не подготовлен.', 'SUPPORT_ATTACHMENT_MISSING');
    }

    args.push('-F', `${fileField.name}=@${fileField.path};type=${fileField.mimeType || 'application/octet-stream'}`, url);

    const { stdout } = await execFileAsync('curl', args, {
        maxBuffer: 8 * 1024 * 1024
    }).catch((error) => {
        throw createHttpError(502, error?.message || 'Telegram upload failed', 'SUPPORT_TELEGRAM_API_ERROR');
    });

    const json = JSON.parse(String(stdout || 'null'));
    if (!json || json.ok !== true) {
        throw createHttpError(502, String(json?.description || 'Telegram upload failed'), 'SUPPORT_TELEGRAM_API_ERROR');
    }
    return json.result;
}

async function downloadTelegramFile(filePath, targetPath) {
    const config = getSupportConfig();
    const url = `${SUPPORT_TELEGRAM_API_BASE}/file/bot${config.token}/${String(filePath || '').replace(/^\/+/, '')}`;
    ensureStorageDir();
    const directory = path.dirname(targetPath);
    fs.mkdirSync(directory, { recursive: true });

    try {
        await execFileAsync('curl', [
            '--noproxy', '*',
            '--ipv4',
            '-sS',
            '--retry', '1',
            '--retry-all-errors',
            '--retry-delay', '1',
            '--connect-timeout', '6',
            '--max-time', String(SUPPORT_TELEGRAM_CURL_MAX_TIME_SEC),
            '-o', targetPath,
            url
        ], {
            maxBuffer: 8 * 1024 * 1024
        });
        return;
    } catch (error) {
        const response = await fetch(url, {
            method: 'GET',
            signal: AbortSignal.timeout(SUPPORT_TELEGRAM_FETCH_TIMEOUT_MS)
        });
        if (!response.ok) {
            throw new Error(`Telegram file ${response.status}`);
        }
        const buffer = Buffer.from(await response.arrayBuffer());
        fs.writeFileSync(targetPath, buffer);
        return;
    }
}

function normalizeMessageText(text) {
    const normalized = String(text || '').replace(/\r\n/g, '\n').replace(/\u0000/g, '').trim();
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

function buildAttachmentRecord({ assetId, messageId, type, fileName, mimeType, sizeBytes, relativePath, width, height, durationSeconds }) {
    return {
        id: assetId,
        type,
        fileName,
        mimeType: mimeType || null,
        sizeBytes: Number(sizeBytes || 0) || null,
        width: Number(width || 0) || null,
        height: Number(height || 0) || null,
        durationSeconds: Number(durationSeconds || 0) || null,
        relativePath,
        url: publicAttachmentUrl(messageId, assetId)
    };
}

function normalizeOutgoingAttachment(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const type = coerceAttachmentType(raw.type, raw.mimeType || raw.mime_type);
    if (!type || !SUPPORT_CHAT_ALLOWED_ATTACHMENT_TYPES.has(type)) {
        throw createHttpError(400, 'Поддерживаются только фото и видео.', 'SUPPORT_ATTACHMENT_UNSUPPORTED');
    }

    const base64 = String(raw.contentBase64 || raw.content_base64 || '').trim();
    if (!base64) {
        throw createHttpError(400, 'Файл не подготовлен.', 'SUPPORT_ATTACHMENT_MISSING');
    }

    const mimeType = String(raw.mimeType || raw.mime_type || '').trim();
    const buffer = Buffer.from(base64, 'base64');
    if (!buffer.length) {
        throw createHttpError(400, 'Файл не удалось прочитать.', 'SUPPORT_ATTACHMENT_INVALID');
    }
    if (buffer.length > SUPPORT_CHAT_ATTACHMENT_MAX_BYTES) {
        throw createHttpError(413, 'Файл слишком большой для поддержки.', 'SUPPORT_ATTACHMENT_TOO_LARGE');
    }

    return {
        type,
        buffer,
        mimeType,
        fileName: sanitizeFileName(raw.fileName || raw.file_name || `${type}-${Date.now()}`),
        width: Number(raw.width || 0) || null,
        height: Number(raw.height || 0) || null,
        durationSeconds: Number(raw.durationSeconds || raw.duration_seconds || 0) || null
    };
}

function normalizeOutgoingPayload(payload) {
    const text = normalizeMessageText(payload?.text);
    const attachments = [];
    if (payload?.attachment) {
        attachments.push(normalizeOutgoingAttachment(payload.attachment));
    }
    if (Array.isArray(payload?.attachments)) {
        payload.attachments.forEach((entry) => {
            if (entry) {
                attachments.push(normalizeOutgoingAttachment(entry));
            }
        });
    }

    if (attachments.length > SUPPORT_CHAT_ATTACHMENT_LIMIT) {
        throw createHttpError(400, 'Слишком много вложений для одного сообщения.', 'SUPPORT_ATTACHMENT_LIMIT');
    }
    if (!text && attachments.length === 0) {
        throw createHttpError(400, 'Сообщение пустое.', 'SUPPORT_MESSAGE_EMPTY');
    }

    return {
        text,
        attachments
    };
}

function formatTopicName(ticketNumber, lastMessageFrom) {
    const prefix = lastMessageFrom === 'support' ? '🟩' : '🟦';
    return `${prefix} Заявка #${ticketNumber}`.slice(0, 120);
}

function buildSupportEnvelope(messageText, user, chat) {
    const lines = [`Заявка #${chat.ticket_number}`, `${user.name} <${user.email}>`];
    if (String(messageText || '').trim()) {
        lines.push('', String(messageText).trim());
    }
    return lines.join('\n').trim();
}


async function extractTelegramAttachments(message) {
    const attachments = [];
    const photo = Array.isArray(message?.photo) ? message.photo[message.photo.length - 1] : null;
    if (photo?.file_id) {
        const file = await callTelegram('getFile', { file_id: photo.file_id });
        if (file?.file_path) {
            attachments.push({
                type: 'photo',
                telegramFilePath: file.file_path,
                fileName: path.basename(String(file.file_path || 'photo.jpg')) || 'photo.jpg',
                mimeType: 'image/jpeg',
                width: Number(photo.width || 0) || null,
                height: Number(photo.height || 0) || null,
                durationSeconds: null
            });
        }
    }

    const video = message?.video;
    if (video?.file_id) {
        const file = await callTelegram('getFile', { file_id: video.file_id });
        if (file?.file_path) {
            attachments.push({
                type: 'video',
                telegramFilePath: file.file_path,
                fileName: path.basename(String(file.file_path || video.file_name || 'video.mp4')) || 'video.mp4',
                mimeType: String(video.mime_type || 'video/mp4'),
                width: Number(video.width || 0) || null,
                height: Number(video.height || 0) || null,
                durationSeconds: Number(video.duration || 0) || null
            });
        }
    }

    const document = message?.document;
    const documentType = coerceAttachmentType(document?.mime_type, document?.mime_type);
    if (document?.file_id && documentType && SUPPORT_CHAT_ALLOWED_ATTACHMENT_TYPES.has(documentType)) {
        const file = await callTelegram('getFile', { file_id: document.file_id });
        if (file?.file_path) {
            attachments.push({
                type: documentType,
                telegramFilePath: file.file_path,
                fileName: sanitizeFileName(document.file_name || path.basename(String(file.file_path || 'attachment')) || `${documentType}${getAttachmentExtension(documentType, document.mime_type, document.file_name)}`),
                mimeType: String(document.mime_type || (documentType === 'video' ? 'video/mp4' : 'image/jpeg')),
                width: Number(document.thumb?.width || 0) || null,
                height: Number(document.thumb?.height || 0) || null,
                durationSeconds: documentType === 'video' ? (Number(message?.video?.duration || 0) || null) : null
            });
        }
    }

    return attachments.slice(0, SUPPORT_CHAT_ATTACHMENT_LIMIT);
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
                message_kind, attachments_json, delivery_status, delivery_error,
                telegram_message_id, created_at, updated_at
         FROM support_chat_messages
         WHERE chat_id = ?
           AND GREATEST(created_at, updated_at) > ?
         ORDER BY GREATEST(created_at, updated_at) ASC, created_at ASC, id ASC
         LIMIT ?`,
        [chatId, after, limit]
    );
    return rows.map((row) => ({
        id: row.id,
        sender_role: row.sender_role,
        sender_name: row.sender_name,
        message_text: row.message_text,
        source: row.source,
        message_kind: row.message_kind,
        attachments: parseAttachmentsJson(row.attachments_json)
            .map((entry) => shapeAttachmentForApi(row.id, entry))
            .filter(Boolean),
        delivery_status: row.delivery_status,
        delivery_error: row.delivery_error,
        telegram_message_id: row.telegram_message_id,
        created_at: row.created_at,
        updated_at: row.updated_at
    }));
}

async function persistOutgoingAttachments(messageId, chatId, attachments) {
    if (!Array.isArray(attachments) || attachments.length === 0) {
        return [];
    }
    ensureStorageDir();
    const assetDirectory = path.join(SUPPORT_CHAT_STORAGE_DIR, chatId, messageId);
    fs.mkdirSync(assetDirectory, { recursive: true });

    return attachments.map((attachment) => {
        const assetId = uuidv4();
        const fileName = sanitizeFileName(attachment.fileName, attachment.type);
        const relativePath = path.join(chatId, messageId, `${assetId}-${fileName}`).replace(/\\/g, '/');
        const absolutePath = path.join(SUPPORT_CHAT_STORAGE_DIR, relativePath);
        fs.writeFileSync(absolutePath, attachment.buffer);
        return buildAttachmentRecord({
            assetId,
            messageId,
            type: attachment.type,
            fileName,
            mimeType: attachment.mimeType,
            sizeBytes: attachment.buffer.length,
            relativePath,
            width: attachment.width,
            height: attachment.height,
            durationSeconds: attachment.durationSeconds
        });
    });
}

async function persistTelegramAttachment(messageId, chatId, attachment) {
    ensureStorageDir();
    const assetId = uuidv4();
    const directory = path.join(SUPPORT_CHAT_STORAGE_DIR, chatId, messageId);
    fs.mkdirSync(directory, { recursive: true });
    const fileName = sanitizeFileName(attachment.fileName, attachment.type);
    const relativePath = path.join(chatId, messageId, `${assetId}-${fileName}`).replace(/\\/g, '/');
    const absolutePath = path.join(SUPPORT_CHAT_STORAGE_DIR, relativePath);
    await downloadTelegramFile(attachment.telegramFilePath, absolutePath);
    const stats = fs.statSync(absolutePath);
    return buildAttachmentRecord({
        assetId,
        messageId,
        type: attachment.type,
        fileName,
        mimeType: attachment.mimeType,
        sizeBytes: stats.size,
        relativePath,
        width: attachment.width,
        height: attachment.height,
        durationSeconds: attachment.durationSeconds
    });
}

async function resolveAttachmentPath(userId, messageId, assetId, db = pool) {
    await ensureSupportChatSchema(db);
    const [rows] = await db.query(
        `SELECT scm.chat_id, scm.attachments_json
         FROM support_chat_messages scm
         JOIN support_chats sc ON sc.id = scm.chat_id
         WHERE scm.id = ? AND sc.user_id = ?
         LIMIT 1`,
        [messageId, userId]
    );
    const row = rows[0];
    if (!row) {
        throw createHttpError(404, 'Вложение не найдено.', 'SUPPORT_ATTACHMENT_NOT_FOUND');
    }

    const asset = parseAttachmentsJson(row.attachments_json).find((entry) => String(entry?.id || '') === String(assetId));
    if (!asset?.relativePath) {
        throw createHttpError(404, 'Вложение не найдено.', 'SUPPORT_ATTACHMENT_NOT_FOUND');
    }

    const absolutePath = resolveStoredPath(String(asset.relativePath || ''));
    if (!fs.existsSync(absolutePath)) {
        throw createHttpError(404, 'Файл вложения не найден.', 'SUPPORT_ATTACHMENT_MISSING');
    }

    return {
        path: absolutePath,
        mimeType: typeof asset.mimeType === 'string' ? asset.mimeType : 'application/octet-stream',
        fileName: typeof asset.fileName === 'string' ? asset.fileName : path.basename(absolutePath)
    };
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

function queueTopicIndicatorUpdate(chatRow, db = pool) {
    const task = setTimeout(() => {
        updateTopicIndicator(chatRow, db).catch((error) => {
            console.error('Failed to refresh support topic indicator:', error);
        });
    }, 0);
    if (typeof task?.unref === 'function') {
        task.unref();
    }
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
    const message = update?.message || update?.edited_message || update?.channel_post || update?.edited_channel_post;
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
    const inboundAttachments = await extractTelegramAttachments(message).catch(() => []);
    if (!text && inboundAttachments.length === 0) {
        return { accepted: false, reason: 'empty' };
    }

    const telegramMessageId = Number(message.message_id || 0) || null;
    if (!telegramMessageId) {
        return { accepted: false, reason: 'missing-message-id' };
    }

    const [existingRows] = await db.query(
        `SELECT id, message_text, message_kind, attachments_json
         FROM support_chat_messages
         WHERE telegram_chat_id = ? AND telegram_message_id = ?
         LIMIT 1`,
        [String(config.chatId), telegramMessageId]
    );

    const senderName = [message.from?.first_name, message.from?.last_name]
        .filter(Boolean)
        .join(' ')
        .trim() || message.from?.username || message.sender_chat?.title || 'Поддержка';
    const createdAt = Number(message.date || 0) > 0 ? Number(message.date) * 1000 : nowMs();
    let attachments = [];
    let messageKind = 'TEXT';
    if (inboundAttachments.length > 0) {
        messageKind = inboundAttachments.some((attachment) => attachment.type === 'video') ? 'VIDEO' : 'PHOTO';
    }

    if (existingRows.length > 0) {
        if (inboundAttachments.length > 0) {
            attachments = await Promise.all(inboundAttachments.map((attachment) => persistTelegramAttachment(existingRows[0].id, chat.id, attachment)));
        } else {
            attachments = parseAttachmentsJson(existingRows[0]?.attachments_json);
            if (attachments.length > 0) {
                messageKind = String(existingRows[0]?.message_kind || '').toUpperCase() || messageKind;
            }
        }
        await db.query(
            `UPDATE support_chat_messages
             SET message_text = ?, sender_name = ?, message_kind = ?, attachments_json = ?, delivery_status = 'SENT', delivery_error = NULL, updated_at = ?
             WHERE id = ?`,
            [text, String(senderName).slice(0, 120), messageKind, JSON.stringify(attachments), nowMs(), existingRows[0].id]
        );
    } else {
        const messageId = uuidv4();
        if (inboundAttachments.length > 0) {
            attachments = await Promise.all(inboundAttachments.map((attachment) => persistTelegramAttachment(messageId, chat.id, attachment)));
        }
        await db.query(
            `INSERT INTO support_chat_messages
             (id, chat_id, user_id, sender_role, sender_name, message_text, source, message_kind, attachments_json,
              delivery_status, telegram_chat_id, telegram_thread_id, telegram_message_id, created_at, updated_at)
             VALUES (?, ?, ?, 'support', ?, ?, 'telegram', ?, ?, 'SENT', ?, ?, ?, ?, ?)`,
            [
                messageId,
                chat.id,
                chat.user_id,
                String(senderName).slice(0, 120),
                text,
                messageKind,
                JSON.stringify(attachments),
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

    queueTopicIndicatorUpdate({
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
            allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post']
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
    if (options.sync === 'force') {
        await syncSupportUpdates(db).catch(() => null);
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

async function loadQueuedMessage(messageId, db = pool) {
    const [rows] = await db.query(
        `SELECT scm.*, sc.ticket_number, sc.telegram_thread_id, sc.user_id AS chat_user_id
         FROM support_chat_messages scm
         JOIN support_chats sc ON sc.id = scm.chat_id
         WHERE scm.id = ?
         LIMIT 1`,
        [messageId]
    );
    return rows[0] || null;
}

async function deliverSupportMessage(messageId, db = pool) {
    const queued = await loadQueuedMessage(messageId, db);
    if (!queued || queued.delivery_status !== 'QUEUED') {
        return;
    }

    const user = await fetchUserById(queued.user_id, { db, includeCreatedAt: true });
    if (!user) {
        await db.query(
            `UPDATE support_chat_messages SET delivery_status = 'FAILED', delivery_error = ? WHERE id = ?`,
            ['Пользователь не найден.', messageId]
        );
        return;
    }

    const attachments = parseAttachmentsJson(queued.attachments_json);
    const text = String(queued.message_text || '');
    const chat = await findChatById(queued.user_id, queued.chat_id, db);
    let telegramResult = null;
    let firstTelegramMessageId = Number(queued.telegram_message_id || 0) || null;

    try {
        if (!chat || !chat.telegram_thread_id) {
            throw createHttpError(500, 'Тема поддержки не найдена.', 'SUPPORT_CHAT_UNAVAILABLE');
        }
        const fields = {
            chat_id: getSupportConfig().chatId,
            message_thread_id: Number(chat.telegram_thread_id),
            disable_web_page_preview: true
        };
        if (attachments[0]?.relativePath) {
            for (let index = 0; index < attachments.length; index += 1) {
                const attachment = attachments[index];
                const absolutePath = resolveStoredPath(String(attachment.relativePath || attachment.relative_path || ''));
                const isFirst = index === 0;
                const caption = isFirst
                    ? buildSupportEnvelope(text || (attachment.type === 'video' ? 'Видео' : 'Фото'), user, chat).slice(0, 1024)
                    : '';
                if (attachment.type === 'video') {
                    telegramResult = await callTelegramMultipart('sendVideo', {
                        ...fields,
                        caption
                    }, {
                        name: 'video',
                        path: absolutePath,
                        mimeType: attachment.mimeType || 'video/mp4'
                    });
                } else {
                    telegramResult = await callTelegramMultipart('sendPhoto', {
                        ...fields,
                        caption
                    }, {
                        name: 'photo',
                        path: absolutePath,
                        mimeType: attachment.mimeType || 'image/jpeg'
                    });
                }
                if (!firstTelegramMessageId) {
                    firstTelegramMessageId = Number(telegramResult?.message_id || 0) || null;
                }
            }
        } else {
            telegramResult = await callTelegram('sendMessage', {
                ...fields,
                text: buildSupportEnvelope(text, user, chat)
            });
            firstTelegramMessageId = Number(telegramResult?.message_id || 0) || firstTelegramMessageId;
        }

        await db.query(
            `UPDATE support_chat_messages
             SET delivery_status = 'SENT', delivery_error = NULL, telegram_chat_id = ?, telegram_thread_id = ?, telegram_message_id = ?, updated_at = ?
             WHERE id = ?`,
            [
                String(getSupportConfig().chatId),
                Number(chat.telegram_thread_id),
                firstTelegramMessageId,
                nowMs(),
                messageId
            ]
        );
    } catch (error) {
        await db.query(
            `UPDATE support_chat_messages
             SET delivery_status = 'FAILED', delivery_error = ?, updated_at = ?
             WHERE id = ?`,
            [String(error?.message || 'Не удалось отправить сообщение в Telegram.').slice(0, 255), nowMs(), messageId]
        );
    }
}

function queueSupportMessageDelivery(messageId, db = pool) {
    if (deliveryJobs.has(messageId)) {
        return deliveryJobs.get(messageId);
    }
    const job = Promise.resolve()
        .then(() => deliverSupportMessage(messageId, db))
        .finally(() => {
            deliveryJobs.delete(messageId);
        });
    deliveryJobs.set(messageId, job);
    return job;
}

function startQueuedSupportMessageDelivery(db = pool) {
    if (resumeQueuedDeliveriesStarted) {
        return;
    }
    resumeQueuedDeliveriesStarted = true;
    setTimeout(async () => {
        try {
            await ensureSupportChatSchema(db);
            const [rows] = await db.query(
                `SELECT id
                 FROM support_chat_messages
                 WHERE delivery_status = 'QUEUED'
                 ORDER BY created_at ASC
                 LIMIT 40`
            );
            rows.forEach((row) => {
                queueSupportMessageDelivery(row.id, db).catch(() => null);
            });
        } catch (error) {
            console.error('Failed to resume queued support messages:', error);
        }
    }, 500);
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

    const normalized = normalizeOutgoingPayload(payload);
    const timestamp = nowMs();
    const messageId = uuidv4();
    const persistedAttachments = await persistOutgoingAttachments(messageId, chat.id, normalized.attachments);
    const messageKind = persistedAttachments[0]?.type === 'video'
        ? 'VIDEO'
        : persistedAttachments[0]?.type === 'photo'
            ? 'PHOTO'
            : 'TEXT';

    await db.query(
        `INSERT INTO support_chat_messages
         (id, chat_id, user_id, sender_role, sender_name, message_text, source, message_kind, attachments_json,
          delivery_status, created_at, updated_at)
         VALUES (?, ?, ?, 'client', ?, ?, 'web', ?, ?, 'QUEUED', ?, ?)`,
        [
            messageId,
            chat.id,
            userId,
            String(user.name || 'Клиент').slice(0, 120),
            normalized.text,
            messageKind,
            JSON.stringify(persistedAttachments),
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

    queueTopicIndicatorUpdate({
        ...chat,
        last_message_from: 'client',
        last_message_at: timestamp
    }, db);

    queueSupportMessageDelivery(messageId, db).catch(() => null);

    return getSupportChatState(userId, { sync: false }, db);
}

function startSupportChatPolling() {
    startQueuedSupportMessageDelivery();
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

    callTelegram('deleteWebhook', {
        drop_pending_updates: false
    }).catch((error) => {
        console.error('Failed to switch support bot to polling mode:', error);
    });

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
    startQueuedSupportMessageDelivery,
    receiveSupportWebhook,
    verifyWebhookSecret,
    ensureSupportChatSchema,
    resolveAttachmentPath
};
