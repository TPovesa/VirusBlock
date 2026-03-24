const crypto = require('crypto');
const pool = require('../db/pool');

const DEVELOPER_KEY_ENV_NAMES = Object.freeze([
    'DEVELOPER_MODE_KEYS',
    'DEVELOPER_MODE_KEY',
    'NEURALV_DEVELOPER_KEYS',
    'NEURALV_DEVELOPER_KEY',
    'SHIELD_DEVELOPER_KEYS',
    'SHIELD_DEVELOPER_KEY'
]);

let usersColumnState = null;
let usersColumnStatePromise = null;

function nowMs() {
    return Date.now();
}

function normalizeBoolean(value) {
    return Number(value || 0) === 1 || value === true;
}

function normalizeNullableNumber(value) {
    if (value === undefined || value === null || value === '') {
        return null;
    }
    const numeric = Number(value);
    return Number.isFinite(numeric) ? numeric : null;
}

function parseCsvSet(value, normalizer = (entry) => entry) {
    return new Set(
        String(value || '')
            .split(',')
            .map((entry) => normalizer(String(entry || '').trim()))
            .filter(Boolean)
    );
}

function getConfiguredDeveloperKeys() {
    const seen = new Set();
    const keys = [];
    for (const envName of DEVELOPER_KEY_ENV_NAMES) {
        const raw = String(process.env[envName] || '');
        if (!raw.trim()) {
            continue;
        }
        for (const part of raw.split(/[\r\n,]+/)) {
            const normalized = String(part || '').trim();
            if (!normalized || seen.has(normalized)) {
                continue;
            }
            seen.add(normalized);
            keys.push(normalized);
        }
    }
    return keys;
}

function hasConfiguredDeveloperKeys() {
    return getConfiguredDeveloperKeys().length > 0;
}

function matchesDeveloperKey(candidate) {
    const provided = String(candidate || '').trim();
    if (!provided) {
        return false;
    }

    const providedBuffer = Buffer.from(provided, 'utf8');
    return getConfiguredDeveloperKeys().some((expected) => {
        const expectedBuffer = Buffer.from(expected, 'utf8');
        if (expectedBuffer.length !== providedBuffer.length) {
            return false;
        }
        return crypto.timingSafeEqual(expectedBuffer, providedBuffer);
    });
}

function resolveDeveloperModeSource(user) {
    if (!user) {
        return 'none';
    }
    if (String(process.env.DEEP_SCAN_DEV_MODE || '').trim() === '1') {
        return 'env-global';
    }

    const forcedIds = parseCsvSet(process.env.DEEP_SCAN_DEV_USER_IDS);
    const forcedEmails = parseCsvSet(process.env.DEEP_SCAN_DEV_USER_EMAILS, (entry) => entry.toLowerCase());
    if (forcedIds.has(String(user.id || '').trim())) {
        return 'env-user';
    }
    if (forcedEmails.has(String(user.email || '').trim().toLowerCase())) {
        return 'env-user';
    }
    if (normalizeBoolean(user.is_developer_mode)) {
        return 'account';
    }
    if (normalizeBoolean(user.is_dev_mode)) {
        return 'legacy-account';
    }
    return 'none';
}

function isDeveloperModeEnabled(user) {
    return resolveDeveloperModeSource(user) !== 'none';
}

function normalizeAccountUser(user) {
    if (!user || typeof user !== 'object') {
        return null;
    }
    const normalized = {
        ...user,
        is_premium: normalizeBoolean(user.is_premium),
        premium_expires_at: normalizeNullableNumber(user.premium_expires_at),
        is_dev_mode: normalizeBoolean(user.is_dev_mode),
        developer_mode_activated_at: normalizeNullableNumber(user.developer_mode_activated_at),
        is_verified_developer: normalizeBoolean(user.is_verified_developer),
        verified_developer_at: normalizeNullableNumber(user.verified_developer_at)
    };
    normalized.is_developer_mode = isDeveloperModeEnabled(normalized);
    normalized.developer_mode_source = resolveDeveloperModeSource(normalized);
    return normalized;
}

function sanitizeAccountUser(user) {
    const normalized = normalizeAccountUser(user);
    if (!normalized) {
        return null;
    }
    return {
        id: normalized.id,
        name: normalized.name,
        email: normalized.email,
        is_premium: normalized.is_premium,
        premium_expires_at: normalized.premium_expires_at,
        is_developer_mode: normalized.is_developer_mode,
        developer_mode_source: normalized.developer_mode_source,
        developer_mode_activated_at: normalized.developer_mode_activated_at,
        is_verified_developer: normalized.is_verified_developer,
        verified_developer_at: normalized.verified_developer_at
    };
}

async function getUsersColumnState(db = pool) {
    if (usersColumnState) {
        return usersColumnState;
    }
    if (usersColumnStatePromise) {
        return usersColumnStatePromise;
    }

    usersColumnStatePromise = (async () => {
        const [rows] = await db.query('SHOW COLUMNS FROM users');
        const names = new Set(rows.map((row) => String(row.Field || '').trim().toLowerCase()).filter(Boolean));
        usersColumnState = {
            hasIsPremium: names.has('is_premium'),
            hasPremiumExpiresAt: names.has('premium_expires_at'),
            hasIsDevMode: names.has('is_dev_mode'),
            hasIsDeveloperMode: names.has('is_developer_mode'),
            hasDeveloperModeActivatedAt: names.has('developer_mode_activated_at'),
            hasIsVerifiedDeveloper: names.has('is_verified_developer'),
            hasVerifiedDeveloperAt: names.has('verified_developer_at'),
            hasCreatedAt: names.has('created_at'),
            hasUpdatedAt: names.has('updated_at')
        };
        return usersColumnState;
    })().finally(() => {
        usersColumnStatePromise = null;
    });

    return usersColumnStatePromise;
}

function buildUserSelect(columns, options = {}) {
    const {
        tableAlias = '',
        includePasswordHash = false,
        includeCreatedAt = false
    } = options;
    const prefix = tableAlias ? `${tableAlias}.` : '';
    const fields = [
        `${prefix}id AS id`,
        `${prefix}name AS name`,
        `${prefix}email AS email`,
        columns.hasIsPremium ? `${prefix}is_premium AS is_premium` : '0 AS is_premium',
        columns.hasPremiumExpiresAt ? `${prefix}premium_expires_at AS premium_expires_at` : 'NULL AS premium_expires_at',
        columns.hasIsDevMode ? `${prefix}is_dev_mode AS is_dev_mode` : '0 AS is_dev_mode',
        columns.hasIsDeveloperMode ? `${prefix}is_developer_mode AS is_developer_mode` : 'NULL AS is_developer_mode',
        columns.hasDeveloperModeActivatedAt ? `${prefix}developer_mode_activated_at AS developer_mode_activated_at` : 'NULL AS developer_mode_activated_at',
        columns.hasIsVerifiedDeveloper ? `${prefix}is_verified_developer AS is_verified_developer` : '0 AS is_verified_developer',
        columns.hasVerifiedDeveloperAt ? `${prefix}verified_developer_at AS verified_developer_at` : 'NULL AS verified_developer_at'
    ];
    if (includePasswordHash) {
        fields.push(`${prefix}password_hash AS password_hash`);
    }
    if (includeCreatedAt) {
        fields.push(columns.hasCreatedAt ? `${prefix}created_at AS created_at` : 'NULL AS created_at');
    }
    return fields.join(', ');
}

async function fetchUserById(userId, options = {}) {
    const { db = pool, includePasswordHash = false, includeCreatedAt = false, forUpdate = false } = options;
    const columns = await getUsersColumnState(db);
    const [rows] = await db.query(
        `SELECT ${buildUserSelect(columns, { includePasswordHash, includeCreatedAt })}
         FROM users
         WHERE id = ?
         LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        [userId]
    );
    return rows.length > 0 ? normalizeAccountUser(rows[0]) : null;
}

async function fetchUserByEmail(email, options = {}) {
    const { db = pool, includePasswordHash = false, includeCreatedAt = false, forUpdate = false } = options;
    const columns = await getUsersColumnState(db);
    const [rows] = await db.query(
        `SELECT ${buildUserSelect(columns, { includePasswordHash, includeCreatedAt })}
         FROM users
         WHERE email = ?
         LIMIT 1${forUpdate ? ' FOR UPDATE' : ''}`,
        [email]
    );
    return rows.length > 0 ? normalizeAccountUser(rows[0]) : null;
}

async function fetchSessionAccount(sessionId, db = pool) {
    const columns = await getUsersColumnState(db);
    const [rows] = await db.query(
        `SELECT
            s.id AS session_id,
            s.user_id AS session_user_id,
            s.device_id,
            s.refresh_token_hash,
            s.refresh_expires_at,
            s.revoked_at,
            ${buildUserSelect(columns, { tableAlias: 'u' })}
         FROM auth_sessions s
         JOIN users u ON u.id = s.user_id
         WHERE s.id = ?
         LIMIT 1`,
        [sessionId]
    );

    if (rows.length === 0) {
        return null;
    }

    const row = rows[0];
    return {
        id: row.session_id,
        user_id: row.session_user_id,
        device_id: row.device_id,
        refresh_token_hash: row.refresh_token_hash,
        refresh_expires_at: row.refresh_expires_at,
        revoked_at: row.revoked_at,
        user: normalizeAccountUser(row)
    };
}

async function getUserDeveloperModeState(userId, db = pool) {
    const user = await fetchUserById(userId, { db });
    if (!user) {
        return {
            exists: false,
            developerMode: false,
            source: 'none',
            user: null
        };
    }
    return {
        exists: true,
        developerMode: user.is_developer_mode,
        source: user.developer_mode_source,
        user
    };
}

async function setDeveloperMode(userId, enabled, db = pool) {
    const columns = await getUsersColumnState(db);
    const now = nowMs();
    const assignments = [];
    const values = [];

    if (columns.hasUpdatedAt) {
        assignments.push('updated_at = ?');
        values.push(now);
    }
    if (columns.hasIsDevMode) {
        assignments.push('is_dev_mode = ?');
        values.push(enabled ? 1 : 0);
    }
    if (columns.hasIsDeveloperMode) {
        assignments.push('is_developer_mode = ?');
        values.push(enabled ? 1 : 0);
    }
    if (columns.hasDeveloperModeActivatedAt) {
        assignments.push('developer_mode_activated_at = ?');
        values.push(enabled ? now : null);
    }

    if (assignments.length === 0) {
        return null;
    }

    await db.query(
        `UPDATE users
         SET ${assignments.join(', ')}
         WHERE id = ?`,
        [...values, userId]
    );

    return fetchUserById(userId, { db });
}

async function activateDeveloperMode(userId, developerKey, db = pool) {
    if (!matchesDeveloperKey(developerKey)) {
        return {
            success: false,
            code: hasConfiguredDeveloperKeys() ? 'INVALID_DEVELOPER_KEY' : 'DEVELOPER_KEY_NOT_CONFIGURED'
        };
    }

    const user = await fetchUserById(userId, { db, forUpdate: false });
    if (!user) {
        return {
            success: false,
            code: 'USER_NOT_FOUND'
        };
    }

    return {
        success: true,
        user: await setDeveloperMode(userId, true, db)
    };
}

async function deactivateDeveloperMode(userId, db = pool) {
    const user = await fetchUserById(userId, { db, forUpdate: false });
    if (!user) {
        return {
            success: false,
            code: 'USER_NOT_FOUND'
        };
    }

    return {
        success: true,
        user: await setDeveloperMode(userId, false, db)
    };
}

module.exports = {
    sanitizeAccountUser,
    normalizeAccountUser,
    isDeveloperModeEnabled,
    resolveDeveloperModeSource,
    hasConfiguredDeveloperKeys,
    getConfiguredDeveloperKeys,
    matchesDeveloperKey,
    getUsersColumnState,
    fetchUserById,
    fetchUserByEmail,
    fetchSessionAccount,
    getUserDeveloperModeState,
    activateDeveloperMode,
    deactivateDeveloperMode,
    setDeveloperMode
};
