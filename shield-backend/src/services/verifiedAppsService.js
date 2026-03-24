const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { fetchUserById, sanitizeAccountUser } = require('./accountEntitlementsService');
const { isMailConfigured, sendMail, queueMailTask } = require('../utils/mail');

const GITHUB_API_BASE = String(process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '');
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
const VERIFIED_APPS_USER_AGENT = String(process.env.VERIFIED_APPS_USER_AGENT || 'NeuralV-VerifiedApps/1.0').trim();
const VERIFIED_APP_REQUEST_TIMEOUT_MS = parseInt(process.env.VERIFIED_APP_REQUEST_TIMEOUT_MS || '20000', 10);
const VERIFIED_APP_DOWNLOAD_TIMEOUT_MS = parseInt(process.env.VERIFIED_APP_DOWNLOAD_TIMEOUT_MS || '120000', 10);
const VERIFIED_APP_MAX_REPO_TREE_ENTRIES = parseInt(process.env.VERIFIED_APP_MAX_REPO_TREE_ENTRIES || '12000', 10);
const VERIFIED_APP_MAX_TEXT_FILES = parseInt(process.env.VERIFIED_APP_MAX_TEXT_FILES || '24', 10);
const VERIFIED_APP_MAX_TEXT_FILE_BYTES = parseInt(process.env.VERIFIED_APP_MAX_TEXT_FILE_BYTES || '262144', 10);
const VERIFIED_APP_MAX_ARTIFACT_BYTES = parseInt(process.env.VERIFIED_APP_MAX_ARTIFACT_BYTES || String(120 * 1024 * 1024), 10);
const VERIFIED_APP_MAX_ACTIVE_PER_USER = parseInt(process.env.VERIFIED_APP_MAX_ACTIVE_PER_USER || '3', 10);
const VERIFIED_APP_SUBMIT_COOLDOWN_MS = parseInt(process.env.VERIFIED_APP_SUBMIT_COOLDOWN_MS || String(2 * 60 * 1000), 10);
const DEVELOPER_APPLICATION_COOLDOWN_MS = parseInt(process.env.DEVELOPER_APPLICATION_COOLDOWN_MS || String(24 * 60 * 60 * 1000), 10);
const VERIFIED_APP_QUEUE_CONCURRENCY = Math.max(1, parseInt(process.env.VERIFIED_APP_QUEUE_CONCURRENCY || '1', 10));

const VERIFIED_APPS_PLATFORM_ENUM = "ENUM('android','windows','linux','plugins','heroku')";
const ALLOWED_PLATFORMS = new Set(['android', 'windows', 'linux', 'plugins', 'heroku']);
const TEXT_EXTENSIONS = new Set([
    '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.gradle', '.properties',
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.kts', '.go',
    '.rs', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.swift', '.sh', '.bat', '.cmd', '.ps1'
]);
const IMPORTANT_FILE_NAMES = new Set([
    'readme.md', 'package.json', 'app.json', 'cargo.toml', 'build.gradle', 'build.gradle.kts',
    'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'androidmanifest.xml', 'pom.xml',
    'requirements.txt', 'pyproject.toml', 'go.mod', 'pubspec.yaml', 'pubspec.yml'
]);
const HARD_BLOCK_KEYWORDS = [
    'keylogger',
    'clipper',
    'stealer',
    'credential dump',
    'mimikatz',
    'discord token',
    'browser password',
    'injector',
    'silent miner'
];

let queueDrainPromise = null;
const queuedIds = new Set();
let activeWorkers = 0;
let schemaReady = false;
let schemaReadyPromise = null;

function nowMs() {
    return Date.now();
}

async function ensureVerifiedAppsSchema(db = pool) {
    if (schemaReady) {
        return;
    }
    if (schemaReadyPromise) {
        return schemaReadyPromise;
    }

    schemaReadyPromise = (async () => {
        await db.query(`
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS is_verified_developer TINYINT(1) DEFAULT 0 AFTER developer_mode_activated_at
        `);
        await db.query(`
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS verified_developer_at BIGINT DEFAULT NULL AFTER is_verified_developer
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS developer_applications (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                applicant_name VARCHAR(100) NOT NULL,
                applicant_email VARCHAR(255) NOT NULL,
                message VARCHAR(700) DEFAULT NULL,
                status ENUM('PENDING_REVIEW','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING_REVIEW',
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                mailed_at BIGINT DEFAULT NULL,
                reviewed_at BIGINT DEFAULT NULL,
                review_note VARCHAR(255) DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_developer_applications_user_created (user_id, created_at),
                INDEX idx_developer_applications_status_created (status, created_at)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS verified_apps (
                id VARCHAR(36) PRIMARY KEY,
                owner_user_id VARCHAR(36) NOT NULL,
                repository_url VARCHAR(700) NOT NULL,
                repository_owner VARCHAR(120) NOT NULL,
                repository_name VARCHAR(120) NOT NULL,
                repository_default_branch VARCHAR(120) DEFAULT NULL,
                release_artifact_url VARCHAR(700) NOT NULL,
                official_site_url VARCHAR(700) DEFAULT NULL,
                platform ${VERIFIED_APPS_PLATFORM_ENUM} NOT NULL,
                app_name VARCHAR(120) NOT NULL,
                author_name VARCHAR(120) NOT NULL,
                avatar_url VARCHAR(700) DEFAULT NULL,
                status ENUM('QUEUED','RUNNING','SAFE','FAILED') NOT NULL DEFAULT 'QUEUED',
                sha256 VARCHAR(64) DEFAULT NULL,
                artifact_file_name VARCHAR(255) DEFAULT NULL,
                artifact_size_bytes BIGINT DEFAULT NULL,
                artifact_content_type VARCHAR(160) DEFAULT NULL,
                risk_score INT NOT NULL DEFAULT 0,
                summary_json LONGTEXT DEFAULT NULL,
                findings_json LONGTEXT DEFAULT NULL,
                public_summary VARCHAR(280) DEFAULT NULL,
                error_message VARCHAR(255) DEFAULT NULL,
                queued_at BIGINT DEFAULT NULL,
                started_at BIGINT DEFAULT NULL,
                completed_at BIGINT DEFAULT NULL,
                verified_at BIGINT DEFAULT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_verified_apps_owner_created (owner_user_id, created_at),
                INDEX idx_verified_apps_status_created (status, created_at),
                INDEX idx_verified_apps_platform_verified (platform, verified_at),
                INDEX idx_verified_apps_sha256 (sha256),
                UNIQUE KEY uniq_verified_apps_owner_artifact (owner_user_id, release_artifact_url)
            )
        `);
        await db.query(`
            ALTER TABLE verified_apps
                MODIFY COLUMN platform ${VERIFIED_APPS_PLATFORM_ENUM} NOT NULL
        `);
        schemaReady = true;
    })().finally(() => {
        schemaReadyPromise = null;
    });

    return schemaReadyPromise;
}

function adminDeveloperApplicationsEmail() {
    return String(
        process.env.DEVELOPER_APPLICATION_EMAIL
        || process.env.NEURALV_DEVELOPER_APPLICATION_EMAIL
        || process.env.ADMIN_EMAIL
        || ''
    ).trim();
}

function getDeveloperApplicationActionSecret() {
    return String(
        process.env.DEVELOPER_APPLICATION_ACTION_SECRET
        || process.env.NEURALV_DEVELOPER_APPLICATION_ACTION_SECRET
        || process.env.JWT_SECRET
        || process.env.REFRESH_TOKEN_SECRET
        || ''
    ).trim();
}

function developerApplicationActionBaseUrl() {
    return String(
        process.env.PUBLIC_API_BASE_URL
        || process.env.API_BASE_URL
        || process.env.SITE_API_BASE_URL
        || 'https://sosiskibot.ru/basedata/api'
    ).replace(/\/+$/, '');
}

function normalizePlatform(value) {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'plugin':
        case 'extension':
        case 'extensions':
        case 'telegram-plugin':
            return 'plugins';
        case 'heroku-app':
        case 'heroku-addon':
            return 'heroku';
        case 'apk':
            return 'android';
        case 'shell':
        case 'cli':
            return 'linux';
        case 'win':
            return 'windows';
        default:
            return normalized;
    }
}

function normalizeUrl(value) {
    return String(value || '').trim();
}

function normalizeAppName(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function normalizeOptionalMessage(value, maxLength = 700) {
    const normalized = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized ? normalized.slice(0, maxLength) : null;
}

function parseGithubRepo(input) {
    try {
        const url = new URL(normalizeUrl(input));
        if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
            return null;
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length < 2) {
            return null;
        }
        const owner = String(parts[0] || '').trim();
        let repo = String(parts[1] || '').trim();
        if (!owner || !repo) {
            return null;
        }
        repo = repo.replace(/\.git$/i, '');
        if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
            return null;
        }
        return {
            owner,
            repo,
            canonicalUrl: `https://github.com/${owner}/${repo}`
        };
    } catch (_) {
        return null;
    }
}

function parseGithubArtifactUrl(input) {
    try {
        const url = new URL(normalizeUrl(input));
        if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
            return null;
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length < 6) {
            return null;
        }
        const [owner, repo, kind, downloadKeyword] = parts;
        if (kind !== 'releases' || downloadKeyword !== 'download') {
            return null;
        }
        if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
            return null;
        }
        const tag = String(parts[4] || '').trim();
        const fileName = decodeURIComponent(parts.slice(5).join('/'));
        if (!tag || !fileName) {
            return null;
        }
        return {
            owner,
            repo,
            tag,
            fileName,
            canonicalUrl: `https://github.com/${owner}/${repo}/releases/download/${tag}/${encodeURIComponent(fileName).replace(/%2F/g, '/')}`
        };
    } catch (_) {
        return null;
    }
}

function validatePlatform(platform) {
    return ALLOWED_PLATFORMS.has(platform);
}

function githubHeaders() {
    const headers = {
        'accept': 'application/vnd.github+json',
        'user-agent': VERIFIED_APPS_USER_AGENT
    };
    if (GITHUB_TOKEN) {
        headers.authorization = `Bearer ${GITHUB_TOKEN}`;
    }
    return headers;
}

async function fetchJson(url, { timeoutMs = VERIFIED_APP_REQUEST_TIMEOUT_MS, headers = {} } = {}) {
    const response = await fetch(url, {
        headers: {
            ...headers
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
        const error = new Error(`Remote request failed: ${response.status}`);
        error.statusCode = response.status;
        throw error;
    }
    return response.json();
}

async function fetchText(url, { timeoutMs = VERIFIED_APP_REQUEST_TIMEOUT_MS, maxBytes = VERIFIED_APP_MAX_TEXT_FILE_BYTES } = {}) {
    const response = await fetch(url, {
        headers: {
            'user-agent': VERIFIED_APPS_USER_AGENT
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
        const error = new Error(`Remote request failed: ${response.status}`);
        error.statusCode = response.status;
        throw error;
    }
    const reader = response.body?.getReader();
    if (!reader) {
        return '';
    }
    const chunks = [];
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
            throw new Error(`Text file exceeds limit of ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function downloadArtifactAndHash(url) {
    const response = await fetch(url, {
        redirect: 'follow',
        headers: {
            'user-agent': VERIFIED_APPS_USER_AGENT
        },
        signal: AbortSignal.timeout(VERIFIED_APP_DOWNLOAD_TIMEOUT_MS)
    });
    if (!response.ok) {
        const error = new Error(`Artifact download failed: ${response.status}`);
        error.statusCode = response.status;
        throw error;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > VERIFIED_APP_MAX_ARTIFACT_BYTES) {
        throw new Error(`Artifact exceeds limit of ${VERIFIED_APP_MAX_ARTIFACT_BYTES} bytes`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Artifact response body is empty');
    }

    const hash = crypto.createHash('sha256');
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > VERIFIED_APP_MAX_ARTIFACT_BYTES) {
            throw new Error(`Artifact exceeds limit of ${VERIFIED_APP_MAX_ARTIFACT_BYTES} bytes`);
        }
        hash.update(value);
    }

    const finalUrl = response.url || url;
    const inferredName = decodeURIComponent(finalUrl.split('/').filter(Boolean).pop() || 'artifact.bin');
    return {
        sha256: hash.digest('hex'),
        sizeBytes: totalBytes,
        contentType: String(response.headers.get('content-type') || '').slice(0, 160) || null,
        fileName: inferredName.slice(0, 255)
    };
}

function inferRiskSignals(paths, sampleTexts) {
    const lowerPaths = paths.map((path) => String(path || '').toLowerCase());
    const lowerText = sampleTexts.join('\n').toLowerCase();
    const triggered = [];
    for (const keyword of HARD_BLOCK_KEYWORDS) {
        if (lowerText.includes(keyword) || lowerPaths.some((path) => path.includes(keyword.replace(/\s+/g, '')) || path.includes(keyword))) {
            triggered.push(keyword);
        }
    }
    return triggered.slice(0, 12);
}

function buildPublicSummary({ appName, repositoryRef, artifactFileName, hardSignals }) {
    if (hardSignals.length > 0) {
        return `${appName}: автоматическая проверка остановлена из-за подозрительных признаков.`;
    }
    return `${appName}: репозиторий ${repositoryRef} и релиз ${artifactFileName} прошли базовую серверную проверку.`;
}

function toPrivateRecord(row) {
    if (!row) return null;
    return {
        id: row.id,
        app_name: row.app_name,
        author_name: row.author_name,
        platform: row.platform,
        repository_url: row.repository_url,
        release_artifact_url: row.release_artifact_url,
        official_site_url: row.official_site_url,
        avatar_url: row.avatar_url,
        status: row.status,
        sha256: row.sha256,
        artifact_file_name: row.artifact_file_name,
        artifact_size_bytes: row.artifact_size_bytes,
        artifact_content_type: row.artifact_content_type,
        risk_score: Number(row.risk_score || 0),
        public_summary: row.public_summary,
        error_message: row.error_message,
        queued_at: row.queued_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
        verified_at: row.verified_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        findings: parseJson(row.findings_json),
        summary: parseJson(row.summary_json)
    };
}

function toPublicRecord(row) {
    if (!row) return null;
    return {
        id: row.id,
        app_name: row.app_name,
        author_name: row.author_name,
        platform: row.platform,
        avatar_url: row.avatar_url,
        public_summary: row.public_summary,
        verified_at: row.verified_at,
        repository_url: row.repository_url,
        official_site_url: row.official_site_url,
        artifact_file_name: row.artifact_file_name,
        status: row.status
    };
}

function parseJson(value) {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

async function getLastDeveloperApplication(userId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT id, user_id, applicant_name, applicant_email, message, status, created_at, updated_at, mailed_at, reviewed_at, review_note
         FROM developer_applications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
    );
    return rows[0] || null;
}

async function getDeveloperApplicationById(applicationId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT id, user_id, applicant_name, applicant_email, message, status, created_at, updated_at, mailed_at, reviewed_at, review_note
         FROM developer_applications
         WHERE id = ?
         LIMIT 1`,
        [applicationId]
    );
    return rows[0] || null;
}

async function getDeveloperApplicationStats(userId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT
            SUM(CASE WHEN status = 'SAFE' THEN 1 ELSE 0 END) AS safe_count,
            SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) AS running_count,
            SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) AS queued_count,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
            COUNT(*) AS total_count
         FROM verified_apps
         WHERE owner_user_id = ?`,
        [userId]
    );
    const row = rows[0] || {};
    return {
        total: Number(row.total_count || 0),
        safe: Number(row.safe_count || 0),
        running: Number(row.running_count || 0),
        queued: Number(row.queued_count || 0),
        failed: Number(row.failed_count || 0)
    };
}

async function getDeveloperStatus(userId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const user = await fetchUserById(userId, { db, includeCreatedAt: true });
    if (!user) {
        return null;
    }
    const lastApplication = await getLastDeveloperApplication(userId, db);
    const stats = await getDeveloperApplicationStats(userId, db);
    return {
        user: sanitizeAccountUser(user),
        developer: {
            is_verified_developer: Boolean(user.is_verified_developer),
            verified_developer_at: user.verified_developer_at ?? null,
            has_pending_application: Boolean(lastApplication && lastApplication.status === 'PENDING_REVIEW'),
            last_application: lastApplication
                ? {
                    id: lastApplication.id,
                    status: lastApplication.status,
                    message: lastApplication.message,
                    created_at: lastApplication.created_at,
                    updated_at: lastApplication.updated_at,
                    mailed_at: lastApplication.mailed_at,
                    reviewed_at: lastApplication.reviewed_at,
                    review_note: lastApplication.review_note
                }
                : null
        },
        stats
    };
}

function renderMailShell({ title, bodyHtml }) {
    return `
        <div style="background:#111315;padding:28px 16px;font-family:Segoe UI,Arial,sans-serif;color:#eef1ef;">
            <div style="max-width:640px;margin:0 auto;background:#181b1e;border-radius:22px;padding:28px;border:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8b9298;margin-bottom:10px;">NeuralV</div>
                <h1 style="margin:0 0 14px;font-size:26px;line-height:1.15;color:#f4f6f5;">${title}</h1>
                <div style="font-size:15px;line-height:1.7;color:#cfd5d1;">${bodyHtml}</div>
            </div>
        </div>
    `;
}

async function sendDeveloperApplicationEmail({ user, application, adminEmail }) {
    const approveUrl = buildDeveloperApplicationActionUrl(application, 'approve');
    const rejectUrl = buildDeveloperApplicationActionUrl(application, 'reject');
    const detailsHtml = [
        `<p style="margin:0 0 10px;"><strong>Пользователь:</strong> ${escapeHtml(user.name)}</p>`,
        `<p style="margin:0 0 10px;"><strong>E-mail:</strong> ${escapeHtml(user.email)}</p>`,
        `<p style="margin:0 0 10px;"><strong>User ID:</strong> ${escapeHtml(user.id)}</p>`,
        application.message
            ? `<p style="margin:16px 0 0;"><strong>Сообщение:</strong><br>${escapeHtml(application.message)}</p>`
            : '<p style="margin:16px 0 0;color:#98a19d;">Сообщение не указано.</p>',
        `<div style="margin:20px 0 0;display:flex;gap:12px;flex-wrap:wrap;">
            <a href="${escapeHtml(approveUrl)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1f8f52;color:#f7fffb;text-decoration:none;font-weight:700;">Принять</a>
            <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#b53434;color:#fff7f7;text-decoration:none;font-weight:700;">Отклонить</a>
        </div>`
    ].join('');

    await sendMail({
        to: adminEmail,
        replyTo: user.email,
        subject: `NeuralV: заявка разработчика от ${user.email}`,
        text: [
            'Новая заявка разработчика.',
            `Имя: ${user.name}`,
            `E-mail: ${user.email}`,
            `User ID: ${user.id}`,
            application.message ? `Сообщение: ${application.message}` : 'Сообщение не указано.',
            `Принять: ${approveUrl}`,
            `Отклонить: ${rejectUrl}`
        ].join('\n'),
        html: renderMailShell({
            title: 'Новая заявка разработчика',
            bodyHtml: detailsHtml
        })
    });
}

function buildDeveloperApplicationActionToken(application, action) {
    const secret = getDeveloperApplicationActionSecret();
    if (!secret) {
        const error = new Error('Developer application action secret is not configured');
        error.code = 'DEVELOPER_APPLICATION_ACTION_SECRET_NOT_CONFIGURED';
        throw error;
    }

    const payload = [
        String(application.id || ''),
        String(application.user_id || ''),
        String(application.created_at || ''),
        String(action || '').trim().toLowerCase()
    ].join(':');

    return crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}

function buildDeveloperApplicationActionUrl(application, action) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const token = buildDeveloperApplicationActionToken(application, normalizedAction);
    return `${developerApplicationActionBaseUrl()}/verified-apps/developer/applications/${encodeURIComponent(application.id)}/${encodeURIComponent(normalizedAction)}?token=${encodeURIComponent(token)}`;
}

async function reviewDeveloperApplicationAction(applicationId, action, token, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['approve', 'reject'].includes(normalizedAction)) {
        const error = new Error('Unsupported developer application action');
        error.code = 'DEVELOPER_APPLICATION_ACTION_INVALID';
        throw error;
    }

    const application = await getDeveloperApplicationById(applicationId, db);
    if (!application) {
        const error = new Error('Developer application not found');
        error.code = 'DEVELOPER_APPLICATION_NOT_FOUND';
        throw error;
    }

    const expectedToken = buildDeveloperApplicationActionToken(application, normalizedAction);
    const left = Buffer.from(String(token || ''), 'utf8');
    const right = Buffer.from(expectedToken, 'utf8');
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        const error = new Error('Developer application action token is invalid');
        error.code = 'DEVELOPER_APPLICATION_ACTION_INVALID_TOKEN';
        throw error;
    }

    if (application.status !== 'PENDING_REVIEW') {
        const error = new Error('Developer application already reviewed');
        error.code = 'DEVELOPER_APPLICATION_ALREADY_REVIEWED';
        error.application = application;
        throw error;
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const freshApplication = await getDeveloperApplicationById(applicationId, connection);
        if (!freshApplication) {
            const error = new Error('Developer application not found');
            error.code = 'DEVELOPER_APPLICATION_NOT_FOUND';
            throw error;
        }
        if (freshApplication.status !== 'PENDING_REVIEW') {
            const error = new Error('Developer application already reviewed');
            error.code = 'DEVELOPER_APPLICATION_ALREADY_REVIEWED';
            error.application = freshApplication;
            throw error;
        }

        const reviewedAt = nowMs();
        const nextStatus = normalizedAction === 'approve' ? 'APPROVED' : 'REJECTED';
        const reviewNote = normalizedAction === 'approve'
            ? 'Подтверждено из письма.'
            : 'Отклонено из письма.';

        await connection.query(
            `UPDATE developer_applications
             SET status = ?, reviewed_at = ?, review_note = ?, updated_at = ?
             WHERE id = ?`,
            [nextStatus, reviewedAt, reviewNote, reviewedAt, applicationId]
        );

        if (normalizedAction === 'approve') {
            await connection.query(
                `UPDATE users
                 SET is_verified_developer = 1,
                     verified_developer_at = ?,
                     updated_at = ?
                 WHERE id = ?`,
                [reviewedAt, reviewedAt, freshApplication.user_id]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }

    return getDeveloperApplicationById(applicationId, db);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function createDeveloperApplication(userId, { message }, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const adminEmail = adminDeveloperApplicationsEmail();
    if (!adminEmail) {
        const error = new Error('Developer application email is not configured');
        error.code = 'DEVELOPER_APPLICATION_EMAIL_NOT_CONFIGURED';
        throw error;
    }
    if (!isMailConfigured()) {
        const error = new Error('Mail service is not configured');
        error.code = 'MAIL_NOT_CONFIGURED';
        throw error;
    }

    const user = await fetchUserById(userId, { db, includeCreatedAt: true });
    if (!user) {
        const error = new Error('User not found');
        error.code = 'USER_NOT_FOUND';
        throw error;
    }
    if (user.is_verified_developer) {
        const error = new Error('Developer status already granted');
        error.code = 'ALREADY_VERIFIED_DEVELOPER';
        throw error;
    }

    const lastApplication = await getLastDeveloperApplication(userId, db);
    if (lastApplication && lastApplication.status === 'PENDING_REVIEW') {
        const error = new Error('Developer application already pending');
        error.code = 'DEVELOPER_APPLICATION_ALREADY_PENDING';
        throw error;
    }
    if (lastApplication && nowMs() - Number(lastApplication.created_at || 0) < DEVELOPER_APPLICATION_COOLDOWN_MS) {
        const error = new Error('Developer application cooldown active');
        error.code = 'DEVELOPER_APPLICATION_COOLDOWN';
        error.retryAfterMs = Math.max(0, DEVELOPER_APPLICATION_COOLDOWN_MS - (nowMs() - Number(lastApplication.created_at || 0)));
        throw error;
    }

    const application = {
        id: uuidv4(),
        user_id: user.id,
        applicant_name: user.name,
        applicant_email: user.email,
        message: normalizeOptionalMessage(message),
        status: 'PENDING_REVIEW',
        created_at: nowMs(),
        updated_at: nowMs()
    };

    await db.query(
        `INSERT INTO developer_applications
         (id, user_id, applicant_name, applicant_email, message, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            application.id,
            application.user_id,
            application.applicant_name,
            application.applicant_email,
            application.message,
            application.status,
            application.created_at,
            application.updated_at
        ]
    );

    queueMailTask(`developer-application:${application.id}`, async () => {
        try {
            await sendDeveloperApplicationEmail({ user, application, adminEmail });
            await db.query(
                'UPDATE developer_applications SET mailed_at = ?, updated_at = ? WHERE id = ?',
                [nowMs(), nowMs(), application.id]
            );
        } catch (error) {
            console.error('Developer application email failed:', error);
        }
    });

    return {
        id: application.id,
        status: application.status,
        message: application.message,
        created_at: application.created_at,
        updated_at: application.updated_at
    };
}

async function listMyVerifiedApps(userId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT *
         FROM verified_apps
         WHERE owner_user_id = ?
         ORDER BY created_at DESC`,
        [userId]
    );
    return rows.map(toPrivateRecord);
}

async function listPublicVerifiedApps({ platform = null, limit = 24, db = pool } = {}) {
    await ensureVerifiedAppsSchema(db);
    const normalizedLimit = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));
    const clauses = [`status = 'SAFE'`];
    const params = [];
    const normalizedPlatform = normalizePlatform(platform);
    if (normalizedPlatform && validatePlatform(normalizedPlatform)) {
        clauses.push('platform = ?');
        params.push(normalizedPlatform);
    }

    const [rows] = await db.query(
        `SELECT *
         FROM verified_apps
         WHERE ${clauses.join(' AND ')}
         ORDER BY verified_at DESC, created_at DESC
         LIMIT ?`,
        [...params, normalizedLimit]
    );
    return rows.map(toPublicRecord);
}

async function fetchVerifiedAppById(id, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        'SELECT * FROM verified_apps WHERE id = ? LIMIT 1',
        [id]
    );
    return rows[0] || null;
}

async function fetchPublicVerifiedAppById(id, db = pool) {
    const row = await fetchVerifiedAppById(id, db);
    if (!row || String(row.status || '').toUpperCase() !== 'SAFE') {
        return null;
    }
    return toPublicRecord(row);
}

async function createVerificationJob(userId, input, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const user = await fetchUserById(userId, { db });
    if (!user) {
        const error = new Error('User not found');
        error.code = 'USER_NOT_FOUND';
        throw error;
    }
    if (!user.is_verified_developer) {
        const error = new Error('Developer verification required');
        error.code = 'VERIFIED_DEVELOPER_REQUIRED';
        throw error;
    }

    const platform = normalizePlatform(input.platform);
    if (!validatePlatform(platform)) {
        const error = new Error('Unsupported platform');
        error.code = 'UNSUPPORTED_PLATFORM';
        throw error;
    }

    const appName = normalizeAppName(input.app_name);
    if (!appName || appName.length < 2) {
        const error = new Error('Application name is required');
        error.code = 'APP_NAME_REQUIRED';
        throw error;
    }

    const repo = parseGithubRepo(input.repository_url);
    if (!repo) {
        const error = new Error('Public GitHub repository URL required');
        error.code = 'INVALID_REPOSITORY_URL';
        throw error;
    }

    const artifact = parseGithubArtifactUrl(input.release_artifact_url);
    if (!artifact) {
        const error = new Error('GitHub release artifact URL required');
        error.code = 'INVALID_RELEASE_ARTIFACT_URL';
        throw error;
    }
    if (artifact.owner.toLowerCase() !== repo.owner.toLowerCase() || artifact.repo.toLowerCase() !== repo.repo.toLowerCase()) {
        const error = new Error('Artifact must belong to the same repository');
        error.code = 'ARTIFACT_REPOSITORY_MISMATCH';
        throw error;
    }

    const officialSiteUrl = normalizeUrl(input.official_site_url);
    if (officialSiteUrl) {
        try {
            const parsed = new URL(officialSiteUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                throw new Error('unsupported');
            }
        } catch (_) {
            const error = new Error('Invalid official site URL');
            error.code = 'INVALID_OFFICIAL_SITE_URL';
            throw error;
        }
    }

    const [activeRows] = await db.query(
        `SELECT COUNT(*) AS active_count
         FROM verified_apps
         WHERE owner_user_id = ?
           AND status IN ('QUEUED', 'RUNNING')`,
        [userId]
    );
    if (Number(activeRows[0]?.active_count || 0) >= VERIFIED_APP_MAX_ACTIVE_PER_USER) {
        const error = new Error('Too many active verification jobs');
        error.code = 'TOO_MANY_ACTIVE_VERIFICATION_JOBS';
        throw error;
    }

    const [recentRows] = await db.query(
        `SELECT id, created_at, status
         FROM verified_apps
         WHERE owner_user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
    );
    const recent = recentRows[0];
    if (recent && nowMs() - Number(recent.created_at || 0) < VERIFIED_APP_SUBMIT_COOLDOWN_MS) {
        const error = new Error('Verification submit cooldown active');
        error.code = 'VERIFICATION_SUBMIT_COOLDOWN';
        error.retryAfterMs = Math.max(0, VERIFIED_APP_SUBMIT_COOLDOWN_MS - (nowMs() - Number(recent.created_at || 0)));
        throw error;
    }

    const [existingRows] = await db.query(
        `SELECT id, status
         FROM verified_apps
         WHERE owner_user_id = ? AND release_artifact_url = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId, artifact.canonicalUrl]
    );
    const existing = existingRows[0];
    if (existing && ['QUEUED', 'RUNNING', 'SAFE'].includes(String(existing.status || ''))) {
        const error = new Error('Verification already exists for this artifact');
        error.code = 'VERIFICATION_ALREADY_EXISTS';
        error.jobId = existing.id;
        error.status = existing.status;
        throw error;
    }

    const now = nowMs();
    const id = existing ? existing.id : uuidv4();
    if (existing && String(existing.status || '') === 'FAILED') {
        await db.query(
            `UPDATE verified_apps
             SET repository_url = ?,
                 repository_owner = ?,
                 repository_name = ?,
                 release_artifact_url = ?,
                 official_site_url = ?,
                 platform = ?,
                 app_name = ?,
                 author_name = ?,
                 status = 'QUEUED',
                 sha256 = NULL,
                 artifact_file_name = NULL,
                 artifact_size_bytes = NULL,
                 artifact_content_type = NULL,
                 risk_score = 0,
                 summary_json = NULL,
                 findings_json = NULL,
                 public_summary = NULL,
                 error_message = NULL,
                 queued_at = ?,
                 started_at = NULL,
                 completed_at = NULL,
                 verified_at = NULL,
                 updated_at = ?
             WHERE id = ?`,
            [
                repo.canonicalUrl,
                repo.owner,
                repo.repo,
                artifact.canonicalUrl,
                officialSiteUrl || null,
                platform,
                appName,
                String(user.name || '').slice(0, 120) || 'Unknown',
                now,
                now,
                id
            ]
        );
    } else {
        await db.query(
            `INSERT INTO verified_apps
             (id, owner_user_id, repository_url, repository_owner, repository_name, release_artifact_url, official_site_url, platform, app_name, author_name, status, queued_at, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)`,
            [
                id,
                userId,
                repo.canonicalUrl,
                repo.owner,
                repo.repo,
                artifact.canonicalUrl,
                officialSiteUrl || null,
                platform,
                appName,
                String(user.name || '').slice(0, 120) || 'Unknown',
                now,
                now,
                now
            ]
        );
    }

    enqueueVerificationJob(id);
    return toPrivateRecord(await fetchVerifiedAppById(id, db));
}

async function updateJobStatus(id, values, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const assignments = [];
    const params = [];
    for (const [key, value] of Object.entries(values)) {
        assignments.push(`${key} = ?`);
        params.push(value);
    }
    assignments.push('updated_at = ?');
    params.push(nowMs());
    params.push(id);
    await db.query(
        `UPDATE verified_apps
         SET ${assignments.join(', ')}
         WHERE id = ?`,
        params
    );
}

function enqueueVerificationJob(id) {
    if (!id || queuedIds.has(id)) {
        return;
    }
    queuedIds.add(id);
    if (!queueDrainPromise) {
        queueDrainPromise = drainQueue().finally(() => {
            queueDrainPromise = null;
        });
    }
}

async function drainQueue() {
    while (queuedIds.size > 0 && activeWorkers < VERIFIED_APP_QUEUE_CONCURRENCY) {
        const nextId = queuedIds.values().next().value;
        queuedIds.delete(nextId);
        activeWorkers += 1;
        processVerificationJob(nextId)
            .catch((error) => {
                console.error(`Verified app job ${nextId} failed:`, error);
            })
            .finally(() => {
                activeWorkers = Math.max(0, activeWorkers - 1);
                if (queuedIds.size > 0) {
                    setImmediate(() => {
                        if (!queueDrainPromise) {
                            queueDrainPromise = drainQueue().finally(() => {
                                queueDrainPromise = null;
                            });
                        }
                    });
                }
            });
    }
}

async function processVerificationJob(id, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const job = await fetchVerifiedAppById(id, db);
    if (!job || !['QUEUED', 'RUNNING'].includes(String(job.status || ''))) {
        return;
    }

    const startedAt = nowMs();
    await updateJobStatus(id, {
        status: 'RUNNING',
        started_at: startedAt,
        completed_at: null,
        error_message: null
    }, db);

    try {
        const analysis = await analyzeVerificationCandidate(job);
        await updateJobStatus(id, {
            status: analysis.status,
            repository_default_branch: analysis.summary.repo.default_branch || null,
            avatar_url: analysis.avatarUrl,
            sha256: analysis.artifact.sha256,
            artifact_file_name: analysis.artifact.fileName,
            artifact_size_bytes: analysis.artifact.sizeBytes,
            artifact_content_type: analysis.artifact.contentType,
            risk_score: analysis.riskScore,
            public_summary: analysis.publicSummary,
            summary_json: JSON.stringify(analysis.summary),
            findings_json: JSON.stringify(analysis.findings),
            error_message: analysis.status === 'FAILED' ? analysis.errorMessage : null,
            completed_at: nowMs(),
            verified_at: analysis.status === 'SAFE' ? nowMs() : null
        }, db);
    } catch (error) {
        await updateJobStatus(id, {
            status: 'FAILED',
            error_message: String(error?.message || 'Verification failed').slice(0, 255),
            completed_at: nowMs(),
            verified_at: null
        }, db);
    }
}

async function analyzeVerificationCandidate(job) {
    const repoMeta = parseGithubRepo(job.repository_url);
    const artifactMeta = parseGithubArtifactUrl(job.release_artifact_url);
    if (!repoMeta || !artifactMeta) {
        throw new Error('Stored repository or artifact URL is invalid');
    }

    const repo = await fetchJson(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repoMeta.owner)}/${encodeURIComponent(repoMeta.repo)}`,
        { headers: githubHeaders() }
    );
    if (repo.private) {
        throw new Error('Private repositories are not supported');
    }
    if (!repo.default_branch) {
        throw new Error('Repository default branch is unavailable');
    }

    const tree = await fetchJson(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repoMeta.owner)}/${encodeURIComponent(repoMeta.repo)}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
        { headers: githubHeaders(), timeoutMs: VERIFIED_APP_DOWNLOAD_TIMEOUT_MS }
    );
    const treeEntries = Array.isArray(tree.tree) ? tree.tree : [];
    if (tree.truncated || treeEntries.length > VERIFIED_APP_MAX_REPO_TREE_ENTRIES) {
        throw new Error(`Repository is too large for automatic verification (${treeEntries.length} files)`);
    }

    const blobPaths = treeEntries
        .filter((entry) => entry && entry.type === 'blob' && typeof entry.path === 'string')
        .map((entry) => entry.path);

    const textCandidates = blobPaths
        .filter((path) => {
            const lowered = path.toLowerCase();
            const fileName = lowered.split('/').pop() || lowered;
            const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
            return IMPORTANT_FILE_NAMES.has(fileName) || TEXT_EXTENSIONS.has(extension);
        })
        .slice(0, VERIFIED_APP_MAX_TEXT_FILES);

    const sampledTexts = [];
    for (const path of textCandidates) {
        try {
            const segments = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
            const content = await fetchText(
                `https://raw.githubusercontent.com/${encodeURIComponent(repoMeta.owner)}/${encodeURIComponent(repoMeta.repo)}/${encodeURIComponent(repo.default_branch)}/${segments}`
            );
            sampledTexts.push(content);
        } catch (error) {
            sampledTexts.push('');
        }
    }

    const hardSignals = inferRiskSignals(blobPaths, sampledTexts);
    const artifact = await downloadArtifactAndHash(job.release_artifact_url);
    const findings = {
        repo: {
            full_name: repo.full_name,
            default_branch: repo.default_branch,
            description: String(repo.description || '').slice(0, 280),
            stargazers_count: Number(repo.stargazers_count || 0),
            forks_count: Number(repo.forks_count || 0),
            open_issues_count: Number(repo.open_issues_count || 0),
            archived: Boolean(repo.archived),
            tree_entries: treeEntries.length,
            text_files_sampled: textCandidates.length
        },
        hard_signals: hardSignals,
        warnings: hardSignals.length > 0
            ? ['Обнаружены сильные риск-маркеры в публичном репозитории']
            : []
    };

    const riskScore = hardSignals.length > 0 ? 85 : 8;
    const status = hardSignals.length > 0 ? 'FAILED' : 'SAFE';
    const publicSummary = buildPublicSummary({
        appName: job.app_name,
        platform: job.platform,
        repositoryRef: repo.full_name || `${repoMeta.owner}/${repoMeta.repo}`,
        artifactFileName: artifact.fileName,
        hardSignals
    });

    return {
        status,
        riskScore,
        errorMessage: status === 'FAILED' ? 'Автоматическая проверка остановлена: обнаружены подозрительные признаки в исходниках.' : null,
        avatarUrl: String(repo.owner?.avatar_url || '').trim() || null,
        artifact,
        findings,
        publicSummary,
        summary: {
            repo: {
                owner: repoMeta.owner,
                name: repoMeta.repo,
                full_name: repo.full_name,
                default_branch: repo.default_branch,
                html_url: repo.html_url,
                description: String(repo.description || '').slice(0, 280),
                stars: Number(repo.stargazers_count || 0),
                forks: Number(repo.forks_count || 0),
                archived: Boolean(repo.archived),
                tree_entries: treeEntries.length
            },
            artifact: {
                file_name: artifact.fileName,
                size_bytes: artifact.sizeBytes,
                content_type: artifact.contentType,
                sha256: artifact.sha256
            },
            limits: {
                max_repo_tree_entries: VERIFIED_APP_MAX_REPO_TREE_ENTRIES,
                max_text_files: VERIFIED_APP_MAX_TEXT_FILES,
                max_text_file_bytes: VERIFIED_APP_MAX_TEXT_FILE_BYTES,
                max_artifact_bytes: VERIFIED_APP_MAX_ARTIFACT_BYTES
            }
        }
    };
}

async function resumePendingVerifiedAppsJobs(db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT id
         FROM verified_apps
         WHERE status IN ('QUEUED', 'RUNNING')
         ORDER BY created_at ASC
         LIMIT 200`
    );
    for (const row of rows) {
        enqueueVerificationJob(row.id);
    }
}

async function findTrustedVerifiedAppMatch({ sha256, platform, appName }, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const normalizedHash = String(sha256 || '').trim().toLowerCase();
    const normalizedPlatform = normalizePlatform(platform);
    const normalizedAppName = normalizeAppName(appName).toLowerCase();

    if (!validatePlatform(normalizedPlatform)) {
        return { kind: 'none', app: null };
    }

    if (/^[a-f0-9]{64}$/.test(normalizedHash)) {
        const [exactRows] = await db.query(
            `SELECT *
             FROM verified_apps
             WHERE status = 'SAFE' AND platform = ? AND sha256 = ?
             ORDER BY verified_at DESC, created_at DESC
             LIMIT 1`,
            [normalizedPlatform, normalizedHash]
        );
        if (exactRows.length > 0) {
            return {
                kind: 'exact',
                app: toPublicRecord(exactRows[0])
            };
        }
    }

    if (!normalizedAppName) {
        return { kind: 'none', app: null };
    }

    const [candidateRows] = await db.query(
        `SELECT *
         FROM verified_apps
         WHERE status = 'SAFE' AND platform = ?
         ORDER BY verified_at DESC, created_at DESC
         LIMIT 100`,
        [normalizedPlatform]
    );

    const matched = candidateRows.find((row) => normalizeAppName(row.app_name).toLowerCase() === normalizedAppName);
    if (!matched) {
        return { kind: 'none', app: null };
    }

    if (normalizedHash && /^[a-f0-9]{64}$/.test(normalizedHash) && String(matched.sha256 || '').trim().toLowerCase() !== normalizedHash) {
        return {
            kind: 'mismatch',
            app: toPublicRecord(matched)
        };
    }

    return { kind: 'none', app: null };
}

module.exports = {
    adminDeveloperApplicationsEmail,
    getDeveloperStatus,
    createDeveloperApplication,
    reviewDeveloperApplicationAction,
    createVerificationJob,
    listMyVerifiedApps,
    listPublicVerifiedApps,
    fetchVerifiedAppById,
    fetchPublicVerifiedAppById,
    resumePendingVerifiedAppsJobs,
    findTrustedVerifiedAppMatch
};
