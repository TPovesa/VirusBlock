const express = require('express');
const router = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const auth = require('../middleware/auth');
const {
    nowMs,
    hashPassword,
    verifyPassword,
    createRefreshToken,
    hashToken,
    signAccessToken,
    refreshTokenExpiresAt,
    sanitizeUser
} = require('../utils/security');
const {
    getThrottleState,
    registerFailure,
    clearFailures
} = require('../utils/loginAttempts');
const { sendMail, isMailConfigured, queueMailTask } = require('../utils/mail');
const { getUserDeepScanLimits } = require('../services/deepScanService');
const {
    fetchUserById,
    fetchUserByEmail,
    fetchSessionAccount,
    activateDeveloperMode,
    deactivateDeveloperMode,
    hasConfiguredDeveloperKeys
} = require('../services/accountEntitlementsService');

const AUTH_CODE_TTL_MINUTES = parseInt(process.env.AUTH_CODE_TTL_MINUTES || '15', 10);
const PASSWORD_RESET_TTL_MINUTES = parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '30', 10);
const PASSWORD_MIN_LENGTH = 8;
const SITE_RESET_WEB_URL = String(process.env.APP_RESET_WEB_URL || 'https://neuralvv.org/reset-password').trim();
const SITE_ACCOUNT_ACTION_WEB_URL = String(process.env.APP_ACCOUNT_ACTION_WEB_URL || 'https://neuralvv.org/account-action').trim();

const SITE_ACTION_PURPOSES = {
    'profile-name': 'PROFILE_NAME_CHANGE',
    'profile-email': 'PROFILE_EMAIL_CHANGE',
    'profile-password': 'PROFILE_PASSWORD_CHANGE'
};
const PROFILE_LINK_TTL_MINUTES = parseInt(process.env.PROFILE_LINK_TTL_MINUTES || '30', 10);

const CHALLENGE_SCOPE_LOGIN = 'auth-login';
const CHALLENGE_SCOPE_REGISTER = 'auth-register';
const WEBSITE_PROFILE_ACTION_KIND = 'WEBSITE_PROFILE_ACTION';
const PROFILE_ACTION_NAME_CHANGE = 'profile_name_change';
const PROFILE_ACTION_EMAIL_CHANGE = 'profile_email_change';
const PROFILE_ACTION_PASSWORD_CHANGE = 'profile_password_change';

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
}

function normalizeDisplayName(name) {
    return String(name || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 100);
}

function isValidEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(email || '').trim());
}

function getClientIp(req) {
    const forwarded = String(req.headers['x-forwarded-for'] || '')
        .split(',')[0]
        .trim();
    return forwarded || req.ip || req.socket?.remoteAddress || 'unknown';
}

function getDeviceId(req) {
    const raw = String(req.body.device_id || req.headers['x-device-id'] || '').trim();
    return raw ? raw.slice(0, 120) : `device-${uuidv4()}`;
}

function getUserAgent(req) {
    return String(req.headers['user-agent'] || '').slice(0, 255);
}

function createNumericCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
}

function authCodeExpiresAt(now = nowMs()) {
    return now + AUTH_CODE_TTL_MINUTES * 60 * 1000;
}

function passwordResetExpiresAt(now = nowMs()) {
    return now + PASSWORD_RESET_TTL_MINUTES * 60 * 1000;
}

function validatePasswordPolicy(password) {
    const value = String(password || '');
    if (value.length < PASSWORD_MIN_LENGTH) {
        return `Пароль должен быть не короче ${PASSWORD_MIN_LENGTH} символов`;
    }
    if (!/[A-ZА-ЯЁ]/.test(value)) {
        return 'Пароль должен содержать заглавную букву';
    }
    if (!/\d/.test(value)) {
        return 'Пароль должен содержать цифру';
    }
    if (!/[^A-Za-zА-Яа-яЁё\d]/.test(value)) {
        return 'Пароль должен содержать спецсимвол';
    }
    return null;
}

function profileLinkExpiresAt(now = nowMs()) {
    return now + PROFILE_LINK_TTL_MINUTES * 60 * 1000;
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

function appendQuery(baseUrl, params) {
    const separator = baseUrl.includes('?') ? '&' : '?';
    const query = Object.entries(params)
        .filter(([, value]) => value !== undefined && value !== null && value !== '')
        .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
        .join('&');
    return query ? `${baseUrl}${separator}${query}` : baseUrl;
}

function maskEmail(email) {
    const normalized = normalizeEmail(email);
    const [localPart, domainPart] = normalized.split('@');
    if (!localPart || !domainPart) {
        return normalized;
    }

    const visibleLocal = localPart.length <= 2
        ? `${localPart[0] || '*'}*`
        : `${localPart.slice(0, 2)}***`;
    const domainChunks = domainPart.split('.');
    const host = domainChunks.shift() || '';
    const maskedHost = host.length <= 2
        ? `${host[0] || '*'}*`
        : `${host.slice(0, 2)}***`;
    return `${visibleLocal}@${[maskedHost, ...domainChunks].filter(Boolean).join('.')}`;
}

function getResetLinks(token, email) {
    return {
        web: SITE_RESET_WEB_URL ? appendQuery(SITE_RESET_WEB_URL, { token, email, action: 'reset-password' }) : '',
        primary: '',
        alternates: []
    };
}

function getSiteActionLink(action, token, email) {
    const baseUrl = action === 'reset-password' ? SITE_RESET_WEB_URL : SITE_ACCOUNT_ACTION_WEB_URL;
    return baseUrl
        ? appendQuery(baseUrl, { action, token, email })
        : '';
}

function getProfileActionWebBaseUrl(action) {
    const map = {
        [PROFILE_ACTION_NAME_CHANGE]: process.env.APP_PROFILE_NAME_CHANGE_WEB_URL || SITE_ACCOUNT_ACTION_WEB_URL,
        [PROFILE_ACTION_EMAIL_CHANGE]: process.env.APP_PROFILE_EMAIL_CHANGE_WEB_URL || SITE_ACCOUNT_ACTION_WEB_URL,
        [PROFILE_ACTION_PASSWORD_CHANGE]: process.env.APP_PROFILE_PASSWORD_CHANGE_WEB_URL || SITE_ACCOUNT_ACTION_WEB_URL
    };
    return String(map[action] || process.env.APP_PROFILE_ACTION_WEB_URL || SITE_ACCOUNT_ACTION_WEB_URL || 'https://neuralvv.org/account-action').trim();
}

function getProfileActionLink(action, token) {
    const baseUrl = getProfileActionWebBaseUrl(action);
    return baseUrl ? appendQuery(baseUrl, { token, action }) : '';
}

function getProfileActionDescriptor(action) {
    switch (action) {
        case PROFILE_ACTION_NAME_CHANGE:
            return {
                title: 'Подтвердить новое имя',
                buttonLabel: 'Открыть изменение имени',
                subject: 'NeuralV: подтвердите изменение имени',
                successMessage: 'Имя профиля обновлено'
            };
        case PROFILE_ACTION_EMAIL_CHANGE:
            return {
                title: 'Подтвердить новый e-mail',
                buttonLabel: 'Открыть подтверждение e-mail',
                subject: 'NeuralV: подтвердите новый e-mail',
                successMessage: 'E-mail обновлён'
            };
        case PROFILE_ACTION_PASSWORD_CHANGE:
            return {
                title: 'Подтвердить смену пароля',
                buttonLabel: 'Открыть смену пароля',
                subject: 'NeuralV: подтвердите смену пароля',
                successMessage: 'Пароль обновлён'
            };
        default:
            return {
                title: 'Подтвердить действие',
                buttonLabel: 'Открыть подтверждение',
                subject: 'NeuralV: подтвердите действие',
                successMessage: 'Действие подтверждено'
            };
    }
}

function renderMailShell({ eyebrow, title, bodyHtml, ctaLabel, ctaHref, footerHtml }) {
    const buttonHtml = ctaLabel && ctaHref
        ? `<p style="margin:24px 0 20px;"><a href="${escapeHtml(ctaHref)}" style="display:inline-block;padding:14px 22px;border-radius:999px;background:#214f3a;color:#f4fff8;text-decoration:none;font-weight:700;">${escapeHtml(ctaLabel)}</a></p>`
        : '';

    return `
        <div style="background:#f4f7f6;padding:28px 16px;font-family:Segoe UI,Arial,sans-serif;color:#1c1f1d;">
            <div style="max-width:560px;margin:0 auto;background:#ffffff;border-radius:24px;padding:28px;border:1px solid rgba(33,79,58,0.08);box-shadow:0 12px 32px rgba(18,38,29,0.08);">
                ${eyebrow ? `<div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#5e6b63;margin-bottom:10px;">${escapeHtml(eyebrow)}</div>` : ''}
                <h1 style="margin:0 0 14px;font-size:28px;line-height:1.15;color:#112018;">${escapeHtml(title)}</h1>
                <div style="font-size:15px;line-height:1.7;color:#314039;">${bodyHtml}</div>
                ${buttonHtml}
                ${footerHtml ? `<div style="margin-top:22px;font-size:13px;line-height:1.6;color:#68756d;">${footerHtml}</div>` : ''}
            </div>
        </div>
    `;
}

function queueAuthCodeEmail(email, code, purpose) {
    queueMailTask(`auth-code:${purpose.toLowerCase()}:${email}`, () =>
        sendAuthCodeEmail(email, code, purpose)
    );
}

function queuePasswordResetEmail(email, resetLinks) {
    queueMailTask(`password-reset:${email}`, () => sendPasswordResetEmail(email, resetLinks));
}

function queuePasswordResetCodeEmail(email, code) {
    queueMailTask(`password-reset-code:${email}`, () => sendPasswordResetCodeEmail(email, code));
}

function queueProfileActionEmail(email, action, actionLink, detailsHtml = '', footerHtml = '') {
    queueMailTask(`profile-action:${action}:${email}`, () =>
        sendProfileActionEmail(email, action, actionLink, detailsHtml, footerHtml)
    );
}

function parsePayload(jsonValue) {
    if (!jsonValue) return {};
    try {
        return JSON.parse(jsonValue);
    } catch (_) {
        return {};
    }
}

function challengeScopeFromRow(challenge, fallbackPurpose = '') {
    const payload = parsePayload(challenge?.payload_json);
    const payloadScope = String(payload?._scope || '').trim();
    if (payloadScope) {
        return payloadScope;
    }
    if (String(fallbackPurpose).toUpperCase() === 'REGISTER') {
        return CHALLENGE_SCOPE_REGISTER;
    }
    if (String(fallbackPurpose).toUpperCase() === 'LOGIN') {
        return CHALLENGE_SCOPE_LOGIN;
    }
    return '';
}

async function deletePendingChallengesByScope(email, purpose, replaceScope, userId = null) {
    if (!replaceScope) {
        await pool.query(
            `DELETE FROM email_auth_challenges
             WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
            [email, purpose]
        );
        return;
    }

    const scopedSql = userId
        ? `SELECT id, payload_json, purpose
           FROM email_auth_challenges
           WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`
        : `SELECT id, payload_json, purpose
           FROM email_auth_challenges
           WHERE email = ? AND purpose = ? AND consumed_at IS NULL`;
    const [rows] = await pool.query(scopedSql, userId ? [userId, purpose] : [email, purpose]);
    const ids = rows
        .filter((row) => challengeScopeFromRow(row, row.purpose) === replaceScope)
        .map((row) => row.id);
    if (ids.length === 0) {
        return;
    }

    await pool.query(
        `DELETE FROM email_auth_challenges
         WHERE id IN (${ids.map(() => '?').join(', ')})`,
        ids
    );
}

async function selectUserByEmail(db, email, { withPassword = false } = {}) {
    return fetchUserByEmail(email, {
        db,
        includePasswordHash: withPassword
    });
}

async function selectUserById(db, userId, { includeCreatedAt = false } = {}) {
    return fetchUserById(userId, {
        db,
        includeCreatedAt
    });
}

async function selectRefreshSession(db, sessionId) {
    const session = await fetchSessionAccount(sessionId, db);
    if (!session) {
        return null;
    }
    return {
        ...session.user,
        id: session.id,
        user_id: session.user_id,
        device_id: session.device_id,
        refresh_token_hash: session.refresh_token_hash,
        refresh_expires_at: session.refresh_expires_at,
        revoked_at: session.revoked_at
    };
}

async function createSession(db, user, req, deviceId) {
    const id = uuidv4();
    const refreshToken = createRefreshToken();
    const now = nowMs();
    const refreshExpiresAt = refreshTokenExpiresAt(now);

    await db.query(
        `INSERT INTO auth_sessions
         (id, user_id, device_id, refresh_token_hash, created_at, updated_at, last_seen_at, refresh_expires_at, user_agent, ip_address)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            user.id,
            deviceId,
            hashToken(refreshToken),
            now,
            now,
            now,
            refreshExpiresAt,
            getUserAgent(req),
            getClientIp(req)
        ]
    );

    return { id, refreshToken, refreshExpiresAt };
}

function buildAuthResponse(user, session) {
    const access = signAccessToken(user, session.id);
    return {
        success: true,
        token: access.token,
        refresh_token: session.refreshToken,
        session_id: session.id,
        access_token_expires_at: access.expiresAt,
        refresh_token_expires_at: session.refreshExpiresAt,
        user: sanitizeUser(user)
    };
}

async function buildDeveloperModePayload(userId, user = null) {
    const resolvedUser = user || await fetchUserById(userId);
    if (!resolvedUser) {
        return null;
    }

    let limits = null;
    try {
        const deepScanLimits = await getUserDeepScanLimits(userId);
        limits = deepScanLimits?.error ? null : deepScanLimits;
    } catch (error) {
        console.error('Developer mode limits fetch error:', error);
    }

    return {
        user: sanitizeUser(resolvedUser),
        developer_mode: {
            enabled: !!resolvedUser.is_developer_mode,
            source: resolvedUser.developer_mode_source || 'none',
            activated_at: resolvedUser.developer_mode_activated_at,
            scope: 'account'
        },
        activation_available: hasConfiguredDeveloperKeys(),
        limits
    };
}

async function revokeSession(sessionId, userId, reason, db = pool) {
    await db.query(
        `UPDATE auth_sessions
         SET revoked_at = ?, revoke_reason = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        [nowMs(), reason, nowMs(), sessionId, userId]
    );
}

async function createEmailChallenge({ email, userId = null, purpose, code, payloadJson = null, expiresAt = authCodeExpiresAt(nowMs()), replaceScope = null }) {
    const id = uuidv4();
    const now = nowMs();

    await deletePendingChallengesByScope(email, purpose, replaceScope, userId);

    await pool.query(
        `INSERT INTO email_auth_challenges
         (id, email, user_id, purpose, code_hash, payload_json, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [id, email, userId, purpose, hashToken(code), payloadJson, now, expiresAt]
    );

    return { id, expiresAt };
}

async function markChallengeFailed(challengeId, currentAttempts, maxAttempts) {
    const nextAttempts = currentAttempts + 1;
    await pool.query(
        `UPDATE email_auth_challenges
         SET attempts = ?, consumed_at = IF(? >= ?, ?, consumed_at)
         WHERE id = ?`,
        [nextAttempts, nextAttempts, maxAttempts, nowMs(), challengeId]
    );
}

async function markChallengeConsumed(challengeId, db = pool) {
    await db.query(
        `UPDATE email_auth_challenges
         SET consumed_at = ?
         WHERE id = ? AND consumed_at IS NULL`,
        [nowMs(), challengeId]
    );
}

async function refreshChallengeCode(challenge) {
    const code = createNumericCode();
    const now = nowMs();
    const expiresAt = authCodeExpiresAt(now);
    await pool.query(
        `UPDATE email_auth_challenges
         SET code_hash = ?, attempts = 0, created_at = ?, expires_at = ?, consumed_at = NULL
         WHERE id = ?`,
        [hashToken(code), now, expiresAt, challenge.id]
    );
    queueAuthCodeEmail(challenge.email, code, challenge.purpose);
    return { id: challenge.id, expiresAt };
}

async function sendAuthCodeEmail(email, code, purpose) {
    const actionLabel = purpose === 'REGISTER'
        ? 'регистрации'
        : purpose === 'LOGIN'
            ? 'входа'
            : 'подтверждения';
    await sendMail({
        to: email,
        subject: `NeuralV: код ${actionLabel}`,
        text: `Ваш код ${actionLabel}: ${code}. Код действует ${AUTH_CODE_TTL_MINUTES} минут.`,
        html: renderMailShell({
            eyebrow: 'NeuralV',
            title: `Код ${actionLabel}`,
            bodyHtml: `<p style="margin:0 0 12px;">Введите этот код в приложении NeuralV.</p><div style="display:inline-block;padding:14px 18px;border-radius:18px;background:#eff7f2;border:1px solid rgba(33,79,58,0.14);font-size:30px;font-weight:800;letter-spacing:0.24em;color:#214f3a;">${escapeHtml(code)}</div>`,
            footerHtml: `Код действует ${AUTH_CODE_TTL_MINUTES} минут. Если письмо пришло с задержкой, просто введите этот код в приложение.`
        })
    });
}

async function sendPasswordResetCodeEmail(email, code) {
    await sendMail({
        to: email,
        subject: 'NeuralV: код сброса пароля',
        text: `Ваш код сброса пароля: ${code}. Код действует ${PASSWORD_RESET_TTL_MINUTES} минут.`,
        html: renderMailShell({
            eyebrow: 'NeuralV',
            title: 'Код сброса пароля',
            bodyHtml: `<p style="margin:0 0 12px;">Введите этот код в CLI или desktop-версии NeuralV, чтобы задать новый пароль.</p><div style="display:inline-block;padding:14px 18px;border-radius:18px;background:#eff7f2;border:1px solid rgba(33,79,58,0.14);font-size:30px;font-weight:800;letter-spacing:0.24em;color:#214f3a;">${escapeHtml(code)}</div>`,
            footerHtml: `Код действует ${PASSWORD_RESET_TTL_MINUTES} минут. Если вы не запрашивали сброс пароля, просто проигнорируйте это письмо.`
        })
    });
}

async function createPasswordResetToken(user, rawToken) {
    const now = nowMs();
    const expiresAt = passwordResetExpiresAt(now);

    await pool.query(
        'DELETE FROM password_reset_tokens WHERE user_id = ? AND consumed_at IS NULL',
        [user.id]
    );
    await pool.query(
        `INSERT INTO password_reset_tokens
         (id, user_id, email, token_hash, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [uuidv4(), user.id, user.email, hashToken(rawToken), now, expiresAt]
    );

    return { expiresAt };
}

async function createSiteLinkChallenge({ email, userId, purpose, payloadJson = null }) {
    const token = createRefreshToken();
    const challenge = await createEmailChallenge({
        email,
        userId,
        purpose,
        code: token,
        payloadJson
    });
    return {
        ...challenge,
        token
    };
}

async function clearUserSiteActionChallenges(userId, purpose) {
    await pool.query(
        `DELETE FROM email_auth_challenges
         WHERE user_id = ? AND purpose = ? AND consumed_at IS NULL`,
        [userId, purpose]
    );
}

async function fetchLinkChallenge(email, purpose, token) {
    const [rows] = await pool.query(
        `SELECT id, email, user_id, purpose, code_hash, payload_json, attempts, max_attempts, expires_at, consumed_at
         FROM email_auth_challenges
         WHERE email = ? AND purpose = ? AND code_hash = ?`,
        [email, purpose, hashToken(token)]
    );
    return rows[0] || null;
}

function validateLinkChallengeFreshness(challenge, res) {
    if (!challenge) {
        res.status(404).json({ error: 'Ссылка не найдена' });
        return false;
    }
    if (challenge.consumed_at) {
        res.status(410).json({ error: 'Ссылка уже использована' });
        return false;
    }
    if (challenge.expires_at <= nowMs()) {
        res.status(410).json({ error: 'Срок действия ссылки истёк' });
        return false;
    }
    return true;
}

async function sendPasswordResetEmail(email, resetLinks) {
    await sendMail({
        to: email,
        subject: 'NeuralV: сброс пароля',
        text: [
            'Откройте страницу NeuralV по ссылке ниже, чтобы перейти к сбросу пароля на сайте.',
            resetLinks.web,
            `Ссылка действует ${PASSWORD_RESET_TTL_MINUTES} минут.`
        ].filter(Boolean).join('\n'),
        html: renderMailShell({
            eyebrow: 'NeuralV',
            title: 'Сброс пароля',
            bodyHtml: '<p style="margin:0 0 12px;">Нажмите кнопку ниже. Откроется страница NeuralV, где вы зададите новый пароль прямо на сайте.</p>',
            ctaLabel: 'Открыть страницу сброса',
            ctaHref: resetLinks.web || resetLinks.primary,
            footerHtml: `Ссылка действует ${PASSWORD_RESET_TTL_MINUTES} минут.`
        })
    });
}

async function sendProfileActionEmail(email, action, actionLink, detailsHtml = '', footerHtml = '') {
    const descriptor = getProfileActionDescriptor(action);
    await sendMail({
        to: email,
        subject: descriptor.subject,
        text: [
            descriptor.title,
            actionLink,
            `Ссылка действует ${PROFILE_LINK_TTL_MINUTES} минут.`
        ].filter(Boolean).join('\n'),
        html: renderMailShell({
            eyebrow: 'NeuralV',
            title: descriptor.title,
            bodyHtml: [
                '<p style="margin:0 0 12px;">Подтвердите действие по кнопке ниже. Откроется страница NeuralV на сайте.</p>',
                detailsHtml
            ].filter(Boolean).join(''),
            ctaLabel: descriptor.buttonLabel,
            ctaHref: actionLink,
            footerHtml: footerHtml || `Ссылка действует ${PROFILE_LINK_TTL_MINUTES} минут. Если это были не вы, просто проигнорируйте письмо.`
        })
    });
}

async function createWebsiteProfileActionChallenge({ user, action, confirmationEmail, payload }) {
    const token = createRefreshToken();
    const expiresAt = profileLinkExpiresAt();
    const scope = `website:${action}`;
    const challengePayload = JSON.stringify({
        _kind: WEBSITE_PROFILE_ACTION_KIND,
        _scope: scope,
        action,
        requested_by_user_id: user.id,
        requested_at: nowMs(),
        ...(payload || {})
    });
    const challenge = await createEmailChallenge({
        email: confirmationEmail,
        userId: user.id,
        purpose: 'LOGIN',
        code: token,
        payloadJson: challengePayload,
        expiresAt,
        replaceScope: scope
    });
    return {
        challenge_id: challenge.id,
        token,
        expires_at: expiresAt,
        open_url: getProfileActionLink(action, token)
    };
}

async function fetchWebsiteProfileActionChallenge(token, expectedAction = '') {
    const normalizedToken = String(token || '').trim();
    if (!normalizedToken) {
        return null;
    }

    const [rows] = await pool.query(
        `SELECT id, email, user_id, purpose, code_hash, payload_json, attempts, max_attempts, expires_at, consumed_at
         FROM email_auth_challenges
         WHERE purpose = ? AND code_hash = ?`,
        ['LOGIN', hashToken(normalizedToken)]
    );

    for (const row of rows) {
        const payload = parsePayload(row.payload_json);
        if (payload?._kind !== WEBSITE_PROFILE_ACTION_KIND) {
            continue;
        }
        if (expectedAction && payload.action !== expectedAction) {
            continue;
        }
        return {
            ...row,
            payload
        };
    }

    return null;
}

function buildWebsiteActionInspectPayload(challenge) {
    const action = String(challenge?.payload?.action || '').trim();
    const payload = challenge?.payload || {};
    const base = {
        kind: action,
        expires_at: challenge.expires_at,
        email: challenge.email
    };

    switch (action) {
        case PROFILE_ACTION_NAME_CHANGE:
            return {
                ...base,
                title: 'Подтверждение нового имени',
                pending_name: String(payload.next_name || payload.name || '').trim()
            };
        case PROFILE_ACTION_EMAIL_CHANGE:
            return {
                ...base,
                title: 'Подтверждение нового e-mail',
                current_email: String(payload.current_email || '').trim(),
                next_email: String(payload.next_email || '').trim()
            };
        case PROFILE_ACTION_PASSWORD_CHANGE:
            return {
                ...base,
                title: 'Подтверждение смены пароля',
                masked_email: maskEmail(challenge.email),
                requires_password: true
            };
        default:
            return {
                ...base,
                title: 'Подтверждение действия'
            };
    }
}

function respondInvalidWebsiteAction(res, challenge) {
    if (!challenge) {
        return res.status(404).json({ error: 'Ссылка не найдена или уже недействительна.' });
    }
    if (challenge.consumed_at) {
        return res.status(410).json({ error: 'Эта ссылка уже была использована.' });
    }
    if (challenge.expires_at <= nowMs()) {
        return res.status(410).json({ error: 'Срок действия ссылки истёк.' });
    }
    return null;
}

async function fetchPasswordResetRecord(token, email) {
    const normalizedToken = String(token || '').trim();
    const normalizedEmail = normalizeEmail(email);
    if (!normalizedToken || !normalizedEmail) {
        return null;
    }

    const [rows] = await pool.query(
        `SELECT id, user_id, email, expires_at, consumed_at
         FROM password_reset_tokens
         WHERE token_hash = ? AND email = ?`,
        [hashToken(normalizedToken), normalizedEmail]
    );
    return rows[0] || null;
}

function respondInvalidPasswordResetLink(res, resetToken) {
    if (!resetToken) {
        return res.status(404).json({ error: 'Ссылка для сброса пароля не найдена.' });
    }
    if (resetToken.consumed_at) {
        return res.status(410).json({ error: 'Ссылка для сброса пароля уже использована.' });
    }
    if (resetToken.expires_at <= nowMs()) {
        return res.status(410).json({ error: 'Срок действия ссылки для сброса пароля истёк.' });
    }
    return null;
}

function ensureMailConfigured(res) {
    if (!isMailConfigured()) {
        res.status(503).json({ error: 'Mail service is not configured' });
        return false;
    }
    return true;
}

async function fetchChallenge(id, purpose) {
    const [rows] = await pool.query(
        `SELECT id, email, user_id, purpose, code_hash, payload_json, attempts, max_attempts, expires_at, consumed_at
         FROM email_auth_challenges
         WHERE id = ? AND purpose = ?`,
        [id, purpose]
    );
    return rows[0] || null;
}

function validateChallengeFreshness(challenge, res) {
    if (!challenge) {
        res.status(404).json({ error: 'Challenge not found' });
        return false;
    }
    if (challenge.consumed_at) {
        res.status(410).json({ error: 'Challenge already used' });
        return false;
    }
    if (challenge.expires_at <= nowMs()) {
        res.status(410).json({ error: 'Code expired' });
        return false;
    }
    return true;
}

async function handleCodeMismatch(challenge, res) {
    await markChallengeFailed(challenge.id, challenge.attempts || 0, challenge.max_attempts || 5);
    res.status(401).json({ error: 'Invalid code' });
}

async function startRegisterChallenge(name, normalizedEmail, password) {
    const passwordHash = await hashPassword(password);
    const code = createNumericCode();
    const challenge = await createEmailChallenge({
        email: normalizedEmail,
        purpose: 'REGISTER',
        code,
        payloadJson: JSON.stringify({
            _scope: CHALLENGE_SCOPE_REGISTER,
            name: name.trim(),
            password_hash: passwordHash
        }),
        replaceScope: CHALLENGE_SCOPE_REGISTER
    });
    queueAuthCodeEmail(normalizedEmail, code, 'REGISTER');
    return challenge;
}

async function startLoginChallenge(user) {
    const code = createNumericCode();
    const challenge = await createEmailChallenge({
        email: user.email,
        userId: user.id,
        purpose: 'LOGIN',
        code,
        payloadJson: JSON.stringify({
            _scope: CHALLENGE_SCOPE_LOGIN
        }),
        replaceScope: CHALLENGE_SCOPE_LOGIN
    });
    queueAuthCodeEmail(user.email, code, 'LOGIN');
    return challenge;
}

// POST /api/auth/register/start
router.post('/register/start', async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    try {
        const { name, email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);

        if (!name || !email || !password)
            return res.status(400).json({ error: 'All fields are required' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
            return res.status(400).json({ error: 'Invalid email address' });
        const passwordPolicyError = validatePasswordPolicy(password);
        if (passwordPolicyError)
            return res.status(400).json({ error: passwordPolicyError });

        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing.length > 0)
            return res.status(409).json({ error: 'Email already registered' });

        const challenge = await startRegisterChallenge(name, normalizedEmail, password);
        res.status(202).json({
            success: true,
            challenge_id: challenge.id,
            expires_at: challenge.expiresAt,
            email: normalizedEmail,
            delivery: 'queued',
            message: 'Verification code sent to email'
        });
    } catch (e) {
        console.error('Register start error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/register/resend
router.post('/register/resend', async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    const { challenge_id } = req.body;
    if (!challenge_id) {
        return res.status(400).json({ error: 'challenge_id required' });
    }
    try {
        const challenge = await fetchChallenge(challenge_id, 'REGISTER');
        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }
        if (challenge.consumed_at) {
            return res.status(410).json({ error: 'Challenge already used' });
        }
        const refreshed = await refreshChallengeCode(challenge);
        res.status(202).json({
            success: true,
            challenge_id: refreshed.id,
            expires_at: refreshed.expiresAt,
            email: challenge.email,
            delivery: 'queued',
            message: 'Verification code sent to email'
        });
    } catch (e) {
        console.error('Register resend error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/register/verify
router.post('/register/verify', async (req, res) => {
    const { challenge_id, code } = req.body;
    if (!challenge_id || !code) {
        return res.status(400).json({ error: 'challenge_id and code required' });
    }

    const challenge = await fetchChallenge(challenge_id, 'REGISTER');
    if (!validateChallengeFreshness(challenge, res)) return;
    if (hashToken(String(code).trim()) !== challenge.code_hash) {
        await handleCodeMismatch(challenge, res);
        return;
    }

    const payload = parsePayload(challenge.payload_json);
    if (!payload.name || !payload.password_hash) {
        return res.status(400).json({ error: 'Challenge payload is invalid' });
    }

    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();

        const [existing] = await connection.query('SELECT id FROM users WHERE email = ?', [challenge.email]);
        if (existing.length > 0) {
            await connection.rollback();
            return res.status(409).json({ error: 'Email already registered' });
        }

        const user = {
            id: uuidv4(),
            name: String(payload.name).trim(),
            email: challenge.email,
            is_premium: false,
            premium_expires_at: null,
            is_developer_mode: false
        };
        const now = nowMs();
        await connection.query(
            `INSERT INTO users
             (id, name, email, password_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [user.id, user.name, user.email, payload.password_hash, now, now]
        );

        const session = await createSession(connection, user, req, getDeviceId(req));
        await markChallengeConsumed(challenge.id, connection);

        await connection.commit();
        res.status(201).json(buildAuthResponse(user, session));
    } catch (e) {
        await connection.rollback();
        console.error('Register verify error:', e);
        res.status(500).json({ error: 'Server error' });
    } finally {
        connection.release();
    }
});

// POST /api/auth/login/start
router.post('/login/start', async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);
        const ipAddress = getClientIp(req);

        if (!email || !password)
            return res.status(400).json({ error: 'Email and password required' });

        const throttleState = await getThrottleState(normalizedEmail, ipAddress);
        if (throttleState.isLocked) {
            return res.status(429).json({
                error: 'Too many login attempts. Try again later.',
                retry_after_ms: throttleState.retryAfterMs
            });
        }

        const user = await selectUserByEmail(pool, normalizedEmail, { withPassword: true });

        if (!user) {
            await registerFailure(normalizedEmail, ipAddress);
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const valid = await verifyPassword(user.password_hash, password);
        if (!valid) {
            await registerFailure(normalizedEmail, ipAddress);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        await clearFailures(normalizedEmail, ipAddress);
        const challenge = await startLoginChallenge(user);
        res.status(202).json({
            success: true,
            challenge_id: challenge.id,
            expires_at: challenge.expiresAt,
            email: normalizedEmail,
            delivery: 'queued',
            message: 'Verification code sent to email'
        });
    } catch (e) {
        console.error('Login start error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/login/resend
router.post('/login/resend', async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    const { challenge_id } = req.body;
    if (!challenge_id) {
        return res.status(400).json({ error: 'challenge_id required' });
    }
    try {
        const challenge = await fetchChallenge(challenge_id, 'LOGIN');
        if (!challenge) {
            return res.status(404).json({ error: 'Challenge not found' });
        }
        if (challenge.consumed_at) {
            return res.status(410).json({ error: 'Challenge already used' });
        }
        const refreshed = await refreshChallengeCode(challenge);
        res.status(202).json({
            success: true,
            challenge_id: refreshed.id,
            expires_at: refreshed.expiresAt,
            email: challenge.email,
            delivery: 'queued',
            message: 'Verification code sent to email'
        });
    } catch (e) {
        console.error('Login resend error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/login/verify
router.post('/login/verify', async (req, res) => {
    const { challenge_id, code } = req.body;
    const deviceId = getDeviceId(req);
    if (!challenge_id || !code) {
        return res.status(400).json({ error: 'challenge_id and code required' });
    }

    const challenge = await fetchChallenge(challenge_id, 'LOGIN');
    if (!validateChallengeFreshness(challenge, res)) return;
    if (hashToken(String(code).trim()) !== challenge.code_hash) {
        await handleCodeMismatch(challenge, res);
        return;
    }

    const user = await selectUserById(pool, challenge.user_id);
    if (!user) {
        return res.status(404).json({ error: 'User not found' });
    }
    const connection = await pool.getConnection();
    try {
        await connection.beginTransaction();
        await connection.query(
            'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?',
            [nowMs(), nowMs(), user.id]
        );
        await connection.query(
            `UPDATE auth_sessions
             SET revoked_at = ?, revoke_reason = ?, updated_at = ?
             WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`,
            [nowMs(), 'rotated_login', nowMs(), user.id, deviceId]
        );
        const session = await createSession(connection, user, req, deviceId);
        await markChallengeConsumed(challenge.id, connection);
        await connection.commit();
        res.json(buildAuthResponse(user, session));
    } catch (e) {
        await connection.rollback();
        console.error('Login verify error:', e);
        res.status(500).json({ error: 'Server error' });
    } finally {
        connection.release();
    }
});

// POST /api/auth/password-reset/request
router.post('/password-reset/request', async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    try {
        const normalizedEmail = normalizeEmail(req.body.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        const [rows] = await pool.query(
            'SELECT id, email FROM users WHERE email = ?',
            [normalizedEmail]
        );

        if (rows.length === 0) {
            return res.json({
                success: true,
                delivery: 'queued',
                message: 'If the email exists, a reset link has been sent'
            });
        }

        const user = rows[0];
        const token = createRefreshToken();
        await createPasswordResetToken(user, token);

        const resetLinks = getResetLinks(token, user.email);
        queuePasswordResetEmail(user.email, resetLinks);
        res.json({
            success: true,
            message: 'Reset link sent to email',
            delivery: 'queued',
            open_url: resetLinks.web || resetLinks.primary,
            deeplink: {
                primary: resetLinks.primary,
                alternates: resetLinks.alternates,
                query: ['token', 'email']
            }
        });
    } catch (e) {
        console.error('Password reset request error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/auth/password-reset/inspect
router.get('/password-reset/inspect', async (req, res) => {
    try {
        const token = String(req.query.token || '').trim();
        const normalizedEmail = normalizeEmail(req.query.email);
        if (!token || !normalizedEmail) {
            return res.status(400).json({ error: 'token and email required' });
        }

        const resetToken = await fetchPasswordResetRecord(token, normalizedEmail);
        const invalidResponse = respondInvalidPasswordResetLink(res, resetToken);
        if (invalidResponse) {
            return invalidResponse;
        }

        return res.json({
            success: true,
            action: 'password_reset',
            title: 'Сброс пароля',
            email: normalizedEmail,
            expires_at: resetToken.expires_at
        });
    } catch (e) {
        console.error('Password reset inspect error:', e);
        return res.status(500).json({ error: 'Не удалось проверить ссылку для сброса пароля.' });
    }
});

// POST /api/auth/password-reset/code/request
router.post('/password-reset/code/request', async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    try {
        const normalizedEmail = normalizeEmail(req.body.email);
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }

        const [rows] = await pool.query(
            'SELECT id, email FROM users WHERE email = ?',
            [normalizedEmail]
        );

        if (rows.length === 0) {
            return res.status(404).json({ error: 'Email not found' });
        }

        const user = rows[0];
        const code = createNumericCode();
        const resetToken = await createPasswordResetToken(user, code);
        queuePasswordResetCodeEmail(user.email, code);

        res.status(202).json({
            success: true,
            delivery: 'queued',
            email: normalizedEmail,
            expires_at: resetToken.expiresAt,
            message: 'Reset code sent to email'
        });
    } catch (e) {
        console.error('Password reset code request error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/password-reset/code/confirm
router.post('/password-reset/code/confirm', async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body.email);
        const code = String(req.body.code || '').trim();
        const password = String(req.body.password || '');

        if (!normalizedEmail || !code || !password) {
            return res.status(400).json({ error: 'code, email and password required' });
        }
        const passwordPolicyError = validatePasswordPolicy(password);
        if (passwordPolicyError) {
            return res.status(400).json({ error: passwordPolicyError });
        }

        const [rows] = await pool.query(
            `SELECT id, user_id, email, expires_at, consumed_at
             FROM password_reset_tokens
             WHERE token_hash = ? AND email = ?`,
            [hashToken(code), normalizedEmail]
        );

        if (rows.length === 0) {
            return res.status(400).json({ error: 'Reset code is invalid' });
        }

        const resetToken = rows[0];
        if (resetToken.consumed_at) {
            return res.status(410).json({ error: 'Reset code already used' });
        }
        if (resetToken.expires_at <= nowMs()) {
            return res.status(410).json({ error: 'Reset code expired' });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
                [await hashPassword(password), nowMs(), resetToken.user_id]
            );
            await connection.query(
                'UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?',
                [nowMs(), resetToken.id]
            );
            await connection.query(
                `UPDATE auth_sessions
                 SET revoked_at = ?, revoke_reason = ?, updated_at = ?
                 WHERE user_id = ? AND revoked_at IS NULL`,
                [nowMs(), 'password_reset', nowMs(), resetToken.user_id]
            );
            await connection.commit();
            res.json({ success: true, message: 'Password updated successfully' });
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    } catch (e) {
        console.error('Password reset code confirm error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/password-reset/confirm
router.post('/password-reset/confirm', async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body.email);
        const { token, password } = req.body;

        if (!token || !normalizedEmail || !password) {
            return res.status(400).json({ error: 'token, email and password required' });
        }
        const passwordPolicyError = validatePasswordPolicy(password);
        if (passwordPolicyError) {
            return res.status(400).json({ error: passwordPolicyError });
        }

        const [rows] = await pool.query(
            `SELECT id, user_id, email, expires_at, consumed_at
             FROM password_reset_tokens
             WHERE token_hash = ? AND email = ?`,
            [hashToken(token), normalizedEmail]
        );
        if (rows.length === 0) {
            return res.status(400).json({ error: 'Reset token is invalid' });
        }

        const resetToken = rows[0];
        if (resetToken.consumed_at) {
            return res.status(410).json({ error: 'Reset token already used' });
        }
        if (resetToken.expires_at <= nowMs()) {
            return res.status(410).json({ error: 'Reset token expired' });
        }

        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            await connection.query(
                'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
                [await hashPassword(password), nowMs(), resetToken.user_id]
            );
            await connection.query(
                'UPDATE password_reset_tokens SET consumed_at = ? WHERE id = ?',
                [nowMs(), resetToken.id]
            );
            await connection.query(
                `UPDATE auth_sessions
                 SET revoked_at = ?, revoke_reason = ?, updated_at = ?
                 WHERE user_id = ? AND revoked_at IS NULL`,
                [nowMs(), 'password_reset', nowMs(), resetToken.user_id]
            );
            await connection.commit();
            res.json({ success: true, message: 'Password updated successfully' });
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    } catch (e) {
        console.error('Password reset confirm error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/profile/name-change/request
router.post('/profile/name-change/request', auth, async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    try {
        const user = await fetchUserById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const nextName = normalizeDisplayName(req.body?.name || req.body?.username);
        if (!nextName) {
            return res.status(400).json({ error: 'Name required' });
        }
        if (nextName === String(user.name || '').trim()) {
            return res.status(400).json({ error: 'Укажите новое имя профиля.' });
        }

        const request = await createWebsiteProfileActionChallenge({
            user,
            action: PROFILE_ACTION_NAME_CHANGE,
            confirmationEmail: user.email,
            payload: {
                next_name: nextName
            }
        });

        queueProfileActionEmail(
            user.email,
            PROFILE_ACTION_NAME_CHANGE,
            request.open_url,
            `<p style="margin:0;">Новое имя: <strong>${escapeHtml(nextName)}</strong></p>`
        );

        return res.status(202).json({
            success: true,
            delivery: 'queued',
            action: PROFILE_ACTION_NAME_CHANGE,
            challenge_id: request.challenge_id,
            expires_at: request.expires_at,
            open_url: request.open_url,
            message: 'Письмо для подтверждения изменения имени отправлено.'
        });
    } catch (e) {
        console.error('Profile name change request error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        return res.status(500).json({ error: 'Не удалось подготовить изменение имени.' });
    }
});

// POST /api/auth/profile/email-change/request
router.post('/profile/email-change/request', auth, async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    try {
        const user = await fetchUserById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const nextEmail = normalizeEmail(req.body?.email);
        if (!isValidEmail(nextEmail)) {
            return res.status(400).json({ error: 'Invalid email address' });
        }
        if (nextEmail === normalizeEmail(user.email)) {
            return res.status(400).json({ error: 'Укажите новый e-mail.' });
        }

        const existingUser = await fetchUserByEmail(nextEmail);
        if (existingUser && existingUser.id !== user.id) {
            return res.status(409).json({ error: 'Email already registered' });
        }

        const request = await createWebsiteProfileActionChallenge({
            user,
            action: PROFILE_ACTION_EMAIL_CHANGE,
            confirmationEmail: nextEmail,
            payload: {
                current_email: user.email,
                next_email: nextEmail
            }
        });

        queueProfileActionEmail(
            nextEmail,
            PROFILE_ACTION_EMAIL_CHANGE,
            request.open_url,
            [
                `<p style="margin:0 0 12px;">Старый адрес: <strong>${escapeHtml(maskEmail(user.email))}</strong></p>`,
                `<p style="margin:0;">Новый адрес: <strong>${escapeHtml(nextEmail)}</strong></p>`
            ].join('')
        );

        return res.status(202).json({
            success: true,
            delivery: 'queued',
            action: PROFILE_ACTION_EMAIL_CHANGE,
            challenge_id: request.challenge_id,
            expires_at: request.expires_at,
            open_url: request.open_url,
            message: 'Письмо для подтверждения нового e-mail отправлено.'
        });
    } catch (e) {
        console.error('Profile email change request error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        return res.status(500).json({ error: 'Не удалось подготовить изменение e-mail.' });
    }
});

// POST /api/auth/profile/password-change/request
router.post('/profile/password-change/request', auth, async (req, res) => {
    if (!ensureMailConfigured(res)) return;
    try {
        const user = await fetchUserById(req.userId);
        if (!user) {
            return res.status(404).json({ error: 'User not found' });
        }

        const request = await createWebsiteProfileActionChallenge({
            user,
            action: PROFILE_ACTION_PASSWORD_CHANGE,
            confirmationEmail: user.email,
            payload: {}
        });

        queueProfileActionEmail(
            user.email,
            PROFILE_ACTION_PASSWORD_CHANGE,
            request.open_url,
            `<p style="margin:0;">Подтвердите смену пароля для аккаунта <strong>${escapeHtml(maskEmail(user.email))}</strong>.</p>`
        );

        return res.status(202).json({
            success: true,
            delivery: 'queued',
            action: PROFILE_ACTION_PASSWORD_CHANGE,
            challenge_id: request.challenge_id,
            expires_at: request.expires_at,
            open_url: request.open_url,
            message: 'Письмо для подтверждения смены пароля отправлено.'
        });
    } catch (e) {
        console.error('Profile password change request error:', e);
        if (e.code === 'MAIL_NOT_CONFIGURED') {
            return res.status(503).json({ error: 'Mail service is not configured' });
        }
        return res.status(500).json({ error: 'Не удалось подготовить смену пароля.' });
    }
});

// GET /api/auth/profile/action/inspect
router.get('/profile/action/inspect', async (req, res) => {
    try {
        const token = String(req.query.token || '').trim();
        if (!token) {
            return res.status(400).json({ error: 'token required' });
        }

        const challenge = await fetchWebsiteProfileActionChallenge(token);
        const invalidResponse = respondInvalidWebsiteAction(res, challenge);
        if (invalidResponse) {
            return invalidResponse;
        }

        return res.json({
            success: true,
            action: buildWebsiteActionInspectPayload(challenge)
        });
    } catch (e) {
        console.error('Profile action inspect error:', e);
        return res.status(500).json({ error: 'Не удалось проверить ссылку действия.' });
    }
});

// POST /api/auth/profile/action/confirm
router.post('/profile/action/confirm', async (req, res) => {
    try {
        const token = String(req.body?.token || req.query?.token || '').trim();
        if (!token) {
            return res.status(400).json({ error: 'token required' });
        }

        const challenge = await fetchWebsiteProfileActionChallenge(token);
        const invalidResponse = respondInvalidWebsiteAction(res, challenge);
        if (invalidResponse) {
            return invalidResponse;
        }

        const action = String(challenge.payload?.action || '').trim();
        const connection = await pool.getConnection();
        try {
            await connection.beginTransaction();
            const user = await fetchUserById(challenge.user_id, { db: connection, includeCreatedAt: true, forUpdate: true });
            if (!user) {
                await connection.rollback();
                return res.status(404).json({ error: 'User not found' });
            }

            let message = getProfileActionDescriptor(action).successMessage;
            let requiresRelogin = false;

            if (action === PROFILE_ACTION_NAME_CHANGE) {
                const nextName = normalizeDisplayName(challenge.payload?.next_name || challenge.payload?.name);
                if (!nextName) {
                    await connection.rollback();
                    return res.status(400).json({ error: 'Новое имя не найдено в ссылке.' });
                }
                await connection.query(
                    'UPDATE users SET name = ?, updated_at = ? WHERE id = ?',
                    [nextName, nowMs(), user.id]
                );
            } else if (action === PROFILE_ACTION_EMAIL_CHANGE) {
                const nextEmail = normalizeEmail(challenge.payload?.next_email);
                if (!isValidEmail(nextEmail)) {
                    await connection.rollback();
                    return res.status(400).json({ error: 'Новый e-mail в ссылке недействителен.' });
                }
                const existingUser = await fetchUserByEmail(nextEmail, { db: connection, forUpdate: true });
                if (existingUser && existingUser.id !== user.id) {
                    await connection.rollback();
                    return res.status(409).json({ error: 'Email already registered' });
                }
                await connection.query(
                    'UPDATE users SET email = ?, updated_at = ? WHERE id = ?',
                    [nextEmail, nowMs(), user.id]
                );
                await connection.query(
                    `UPDATE auth_sessions
                     SET revoked_at = ?, revoke_reason = ?, updated_at = ?
                     WHERE user_id = ? AND revoked_at IS NULL`,
                    [nowMs(), 'profile_email_change', nowMs(), user.id]
                );
                requiresRelogin = true;
            } else if (action === PROFILE_ACTION_PASSWORD_CHANGE) {
                const nextPassword = String(req.body?.new_password || req.body?.password || '');
                const passwordPolicyError = validatePasswordPolicy(nextPassword);
                if (passwordPolicyError) {
                    await connection.rollback();
                    return res.status(400).json({ error: passwordPolicyError });
                }
                await connection.query(
                    'UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?',
                    [await hashPassword(nextPassword), nowMs(), user.id]
                );
                await connection.query(
                    `UPDATE auth_sessions
                     SET revoked_at = ?, revoke_reason = ?, updated_at = ?
                     WHERE user_id = ? AND revoked_at IS NULL`,
                    [nowMs(), 'profile_password_change', nowMs(), user.id]
                );
                requiresRelogin = true;
            } else {
                await connection.rollback();
                return res.status(400).json({ error: 'Неизвестный тип действия в ссылке.' });
            }

            await markChallengeConsumed(challenge.id, connection);
            await connection.commit();

            const updatedUser = await fetchUserById(challenge.user_id, { includeCreatedAt: true });
            return res.json({
                success: true,
                message,
                requires_relogin: requiresRelogin,
                user: updatedUser ? sanitizeUser(updatedUser) : null
            });
        } catch (e) {
            await connection.rollback();
            throw e;
        } finally {
            connection.release();
        }
    } catch (e) {
        console.error('Profile action confirm error:', e);
        return res.status(500).json({ error: 'Не удалось подтвердить действие профиля.' });
    }
});

// POST /api/auth/register (legacy direct register)
router.post('/register', async (req, res) => {
    try {
        const { name, email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);
        const deviceId = getDeviceId(req);

        if (!name || !email || !password)
            return res.status(400).json({ error: 'All fields are required' });
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail))
            return res.status(400).json({ error: 'Invalid email address' });
        const passwordPolicyError = validatePasswordPolicy(password);
        if (passwordPolicyError)
            return res.status(400).json({ error: passwordPolicyError });

        const [existing] = await pool.query('SELECT id FROM users WHERE email = ?', [normalizedEmail]);
        if (existing.length > 0)
            return res.status(409).json({ error: 'Email already registered' });

        const id = uuidv4();
        const hash = await hashPassword(password);
        const now = nowMs();

        await pool.query(
            `INSERT INTO users
             (id, name, email, password_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, name.trim(), normalizedEmail, hash, now, now]
        );

        const user = {
            id,
            name: name.trim(),
            email: normalizedEmail,
            is_premium: false,
            premium_expires_at: null,
            is_developer_mode: false
        };
        const session = await createSession(pool, user, req, deviceId);

        res.status(201).json(buildAuthResponse(user, session));
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/login (legacy direct login)
router.post('/login', async (req, res) => {
    try {
        const { email, password } = req.body;
        const normalizedEmail = normalizeEmail(email);
        const ipAddress = getClientIp(req);
        const deviceId = getDeviceId(req);

        if (!email || !password)
            return res.status(400).json({ error: 'Email and password required' });

        const throttleState = await getThrottleState(normalizedEmail, ipAddress);
        if (throttleState.isLocked) {
            return res.status(429).json({
                error: 'Too many login attempts. Try again later.',
                retry_after_ms: throttleState.retryAfterMs
            });
        }

        const user = await selectUserByEmail(pool, normalizedEmail, { withPassword: true });

        if (!user) {
            await registerFailure(normalizedEmail, ipAddress);
            return res.status(401).json({ error: 'Invalid email or password' });
        }
        const valid = await verifyPassword(user.password_hash, password);
        if (!valid) {
            await registerFailure(normalizedEmail, ipAddress);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        await clearFailures(normalizedEmail, ipAddress);
        await pool.query(
            'UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?',
            [nowMs(), nowMs(), user.id]
        );

        await pool.query(
            `UPDATE auth_sessions
             SET revoked_at = ?, revoke_reason = ?, updated_at = ?
             WHERE user_id = ? AND device_id = ? AND revoked_at IS NULL`,
            [nowMs(), 'rotated_login', nowMs(), user.id, deviceId]
        );

        const session = await createSession(pool, user, req, deviceId);

        res.json(buildAuthResponse(user, session));
    } catch (e) {
        console.error('Login error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/refresh
router.post('/refresh', async (req, res) => {
    try {
        const { refresh_token, session_id, device_id } = req.body;

        if (!refresh_token || !session_id) {
            return res.status(400).json({ error: 'refresh_token and session_id required' });
        }

        const session = await selectRefreshSession(pool, session_id);

        if (!session) {
            return res.status(401).json({ error: 'Session not found' });
        }
        if (session.revoked_at) {
            return res.status(401).json({ error: 'Session revoked' });
        }

        if (device_id && session.device_id !== String(device_id).trim()) {
            return res.status(401).json({ error: 'Device mismatch' });
        }

        if (session.refresh_expires_at <= nowMs()) {
            await revokeSession(session.id, session.user_id, 'refresh_expired');
            return res.status(401).json({ error: 'Refresh token expired' });
        }

        if (hashToken(refresh_token) !== session.refresh_token_hash) {
            await revokeSession(session.id, session.user_id, 'refresh_mismatch');
            return res.status(401).json({ error: 'Refresh token invalid' });
        }

        const nextRefreshToken = createRefreshToken();
        const nextRefreshExpiresAt = refreshTokenExpiresAt();

        await pool.query(
            `UPDATE auth_sessions
             SET refresh_token_hash = ?, refresh_expires_at = ?, updated_at = ?, last_seen_at = ?, ip_address = ?, user_agent = ?
             WHERE id = ?`,
            [
                hashToken(nextRefreshToken),
                nextRefreshExpiresAt,
                nowMs(),
                nowMs(),
                getClientIp(req),
                getUserAgent(req),
                session.id
            ]
        );

        res.json(buildAuthResponse({
            id: session.user_id,
            name: session.name,
            email: session.email,
            is_premium: session.is_premium,
            premium_expires_at: session.premium_expires_at,
            is_developer_mode: session.is_developer_mode
        }, {
            id: session.id,
            refreshToken: nextRefreshToken,
            refreshExpiresAt: nextRefreshExpiresAt
        }));
    } catch (e) {
        console.error('Refresh error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/logout
router.post('/logout', auth, async (req, res) => {
    try {
        await revokeSession(req.sessionId, req.userId, 'logout');
        res.json({ success: true });
    } catch (e) {
        console.error('Logout error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// GET /api/auth/me
router.get('/me', auth, async (req, res) => {
    try {
        const user = await selectUserById(pool, req.userId, { includeCreatedAt: true });
        if (!user)
            return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, user: sanitizeUser(user) });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

// PUT /api/auth/me
router.put('/me', auth, async (req, res) => {
    try {
        const { name } = req.body;
        if (!name) return res.status(400).json({ error: 'Name required' });
        await pool.query(
            'UPDATE users SET name = ?, updated_at = ? WHERE id = ?',
            [name.trim(), nowMs(), req.userId]
        );
        res.json({ success: true });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

async function handleDeveloperModeState(req, res) {
    try {
        const payload = await buildDeveloperModePayload(req.userId);
        if (!payload) {
            return res.status(404).json({ error: 'User not found' });
        }
        return res.json({ success: true, ...payload });
    } catch (e) {
        console.error('Developer state error:', e);
        return res.status(500).json({ error: 'Server error' });
    }
}

async function handleDeveloperModeActivate(req, res) {
    try {
        const key = String(req.body?.key || '').trim();
        if (!key) {
            return res.status(400).json({ error: 'Developer key required' });
        }

        const activation = await activateDeveloperMode(req.userId, key, pool);
        if (!activation.success) {
            if (activation.code === 'DEVELOPER_KEY_NOT_CONFIGURED') {
                return res.status(503).json({ error: 'Developer mode is not configured', code: activation.code });
            }
            if (activation.code === 'INVALID_DEVELOPER_KEY') {
                return res.status(403).json({ error: 'Invalid developer key', code: activation.code });
            }
            if (activation.code === 'USER_NOT_FOUND') {
                return res.status(404).json({ error: 'User not found', code: activation.code });
            }
            return res.status(503).json({ error: 'Developer mode is not configured' });
        }

        const payload = await buildDeveloperModePayload(req.userId, activation.user);
        if (!payload) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({
            success: true,
            message: 'Developer mode enabled',
            ...payload
        });
    } catch (e) {
        console.error('Developer activate error:', e);
        return res.status(500).json({ error: 'Server error' });
    }
}

async function handleDeveloperModeDeactivate(req, res) {
    try {
        const deactivation = await deactivateDeveloperMode(req.userId, pool);
        if (!deactivation.success) {
            return res.status(404).json({ error: 'User not found' });
        }

        const payload = await buildDeveloperModePayload(req.userId, deactivation.user);
        if (!payload) {
            return res.status(404).json({ error: 'User not found' });
        }

        return res.json({
            success: true,
            message: 'Developer mode disabled',
            ...payload
        });
    } catch (e) {
        console.error('Developer deactivate error:', e);
        return res.status(500).json({ error: 'Server error' });
    }
}

// GET /api/auth/developer-mode
router.get('/developer-mode', auth, handleDeveloperModeState);
// Legacy alias
router.get('/developer/state', auth, handleDeveloperModeState);

// POST /api/auth/developer-mode/activate
router.post('/developer-mode/activate', auth, handleDeveloperModeActivate);
// Legacy alias
router.post('/developer/activate', auth, handleDeveloperModeActivate);

// POST /api/auth/developer-mode/deactivate
router.post('/developer-mode/deactivate', auth, handleDeveloperModeDeactivate);
// Legacy alias
router.post('/developer/deactivate', auth, handleDeveloperModeDeactivate);

// DELETE /api/auth/me
router.delete('/me', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = ?', [req.userId]);
        res.json({ success: true, message: 'Account deleted' });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
