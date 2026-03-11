const express = require('express');
const router  = express.Router();
const { v4: uuidv4 } = require('uuid');
const pool    = require('../db/pool');
const auth    = require('../middleware/auth');
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

async function createSession(user, req, deviceId) {
    const id = uuidv4();
    const refreshToken = createRefreshToken();
    const now = nowMs();
    const refreshExpiresAt = refreshTokenExpiresAt(now);

    await pool.query(
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

async function revokeSession(sessionId, userId, reason) {
    await pool.query(
        `UPDATE auth_sessions
         SET revoked_at = ?, revoke_reason = ?, updated_at = ?
         WHERE id = ? AND user_id = ? AND revoked_at IS NULL`,
        [nowMs(), reason, nowMs(), sessionId, userId]
    );
}

// POST /api/auth/register
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
        const now  = nowMs();

        await pool.query(
            `INSERT INTO users
             (id, name, email, password_hash, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [id, name.trim(), normalizedEmail, hash, now, now]
        );

        const user = { id, name: name.trim(), email: normalizedEmail, is_premium: false, premium_expires_at: null };
        const session = await createSession(user, req, deviceId);

        res.status(201).json(buildAuthResponse(user, session));
    } catch (e) {
        console.error('Register error:', e);
        res.status(500).json({ error: 'Server error' });
    }
});

// POST /api/auth/login
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

        const session = await createSession(user, req, deviceId);

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

// GET /api/auth/me  (protected)
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

// PUT /api/auth/me  (update profile)
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

// DELETE /api/auth/me (delete account)
router.delete('/me', auth, async (req, res) => {
    try {
        await pool.query('DELETE FROM users WHERE id = ?', [req.userId]);
        res.json({ success: true, message: 'Account deleted' });
    } catch (e) {
        res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
