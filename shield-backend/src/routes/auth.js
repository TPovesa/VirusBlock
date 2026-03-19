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

const AUTH_CODE_TTL_MINUTES = parseInt(process.env.AUTH_CODE_TTL_MINUTES || '15', 10);
const PASSWORD_RESET_TTL_MINUTES = parseInt(process.env.PASSWORD_RESET_TTL_MINUTES || '30', 10);

function normalizeEmail(email) {
    return String(email || '').trim().toLowerCase();
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

function getResetLinks(token, email) {
    const configuredBases = [
        process.env.APP_RESET_URL || 'shieldsecurity://auth/reset-password',
        process.env.APP_RESET_ALT_URL || 'neuralv://auth/reset-password',
        process.env.APP_RESET_WEB_URL || ''
    ]
        .map((value) => String(value || '').trim())
        .filter(Boolean)
        .filter((value, index, list) => list.indexOf(value) === index);

    const links = configuredBases.map((baseUrl) =>
        appendQuery(baseUrl, {
            token,
            email
        })
    );

    return {
        primary: links[0],
        alternates: links.slice(1)
    };
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

function parsePayload(jsonValue) {
    if (!jsonValue) return {};
    try {
        return JSON.parse(jsonValue);
    } catch (_) {
        return {};
    }
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

async function revokeSession(sessionId, userId, reason, db = pool) {
    await db.query(
        `UPDATE auth_sessions
         SET revoked_at = ?, revoke_reason = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        [nowMs(), reason, nowMs(), sessionId, userId]
    );
}

async function createEmailChallenge({ email, userId = null, purpose, code, payloadJson = null }) {
    const id = uuidv4();
    const now = nowMs();
    const expiresAt = authCodeExpiresAt(now);

    await pool.query(
        `DELETE FROM email_auth_challenges
         WHERE email = ? AND purpose = ? AND consumed_at IS NULL`,
        [email, purpose]
    );

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
    const actionLabel = purpose === 'REGISTER' ? 'регистрации' : 'входа';
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

async function sendPasswordResetEmail(email, resetLinks) {
    const fallbackLinks = [resetLinks.primary, ...resetLinks.alternates].filter(Boolean);
    const fallbackLinksHtml = fallbackLinks
        .map((link, index) => `<div style="margin-top:${index === 0 ? '0' : '10px'};"><a href="${escapeHtml(link)}" style="color:#214f3a;text-decoration:none;word-break:break-all;">${escapeHtml(link)}</a></div>`)
        .join('');

    await sendMail({
        to: email,
        subject: 'NeuralV: сброс пароля',
        text: [
            'Откройте NeuralV по ссылке ниже, чтобы сбросить пароль.',
            resetLinks.primary,
            ...resetLinks.alternates,
            `Ссылка действует ${PASSWORD_RESET_TTL_MINUTES} минут.`
        ].filter(Boolean).join('\n'),
        html: renderMailShell({
            eyebrow: 'NeuralV',
            title: 'Сброс пароля',
            bodyHtml: '<p style="margin:0 0 12px;">Откройте письмо на устройстве с NeuralV и нажмите кнопку ниже. Приложение откроет экран сброса пароля сразу с готовым deep link.</p>',
            ctaLabel: 'Открыть сброс пароля в NeuralV',
            ctaHref: resetLinks.primary,
            footerHtml: [
                `<div>Если кнопка не открылась, используйте одну из ссылок вручную:</div>`,
                `<div style="margin-top:10px;">${fallbackLinksHtml}</div>`,
                `<div style="margin-top:12px;">Ссылка действует ${PASSWORD_RESET_TTL_MINUTES} минут.</div>`
            ].join('')
        })
    });
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
            name: name.trim(),
            password_hash: passwordHash
        })
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
        code
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
        if (password.length < 6)
            return res.status(400).json({ error: 'Password must be at least 6 characters' });

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
            premium_expires_at: null
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

        const [rows] = await pool.query(
            'SELECT id, name, email, password_hash, is_premium, premium_expires_at FROM users WHERE email = ?',
            [normalizedEmail]
        );

        if (rows.length === 0) {
            await registerFailure(normalizedEmail, ipAddress);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = rows[0];
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

    const [rows] = await pool.query(
        'SELECT id, name, email, is_premium, premium_expires_at FROM users WHERE id = ?',
        [challenge.user_id]
    );
    if (rows.length === 0) {
        return res.status(404).json({ error: 'User not found' });
    }

    const user = rows[0];
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
        const tokenHash = hashToken(token);
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
            [uuidv4(), user.id, user.email, tokenHash, now, expiresAt]
        );

        const resetLinks = getResetLinks(token, user.email);
        queuePasswordResetEmail(user.email, resetLinks);
        res.json({
            success: true,
            message: 'Reset link sent to email',
            delivery: 'queued',
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

// POST /api/auth/password-reset/confirm
router.post('/password-reset/confirm', async (req, res) => {
    try {
        const normalizedEmail = normalizeEmail(req.body.email);
        const { token, password } = req.body;

        if (!token || !normalizedEmail || !password) {
            return res.status(400).json({ error: 'token, email and password required' });
        }
        if (password.length < 6) {
            return res.status(400).json({ error: 'Password must be at least 6 characters' });
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
        if (password.length < 6)
            return res.status(400).json({ error: 'Password must be at least 6 characters' });

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

        const user = { id, name: name.trim(), email: normalizedEmail, is_premium: false, premium_expires_at: null };
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

        const [rows] = await pool.query(
            'SELECT id, name, email, password_hash, is_premium, premium_expires_at FROM users WHERE email = ?',
            [normalizedEmail]
        );

        if (rows.length === 0) {
            await registerFailure(normalizedEmail, ipAddress);
            return res.status(401).json({ error: 'Invalid email or password' });
        }

        const user = rows[0];
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

        const [rows] = await pool.query(
            `SELECT
                s.id,
                s.user_id,
                s.device_id,
                s.refresh_token_hash,
                s.refresh_expires_at,
                s.revoked_at,
                u.name,
                u.email,
                u.is_premium,
                u.premium_expires_at
             FROM auth_sessions s
             JOIN users u ON u.id = s.user_id
             WHERE s.id = ?`,
            [session_id]
        );

        if (rows.length === 0) {
            return res.status(401).json({ error: 'Session not found' });
        }

        const session = rows[0];
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
            premium_expires_at: session.premium_expires_at
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
        const [rows] = await pool.query(
            'SELECT id, name, email, is_premium, premium_expires_at, created_at FROM users WHERE id = ?',
            [req.userId]
        );
        if (rows.length === 0)
            return res.status(404).json({ error: 'User not found' });
        res.json({ success: true, user: sanitizeUser(rows[0]) });
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
