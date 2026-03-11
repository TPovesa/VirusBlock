const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const argon2 = require('argon2');

const ACCESS_TOKEN_TTL_MINUTES = parseInt(process.env.ACCESS_TOKEN_TTL_MINUTES || '15', 10);
const REFRESH_TOKEN_TTL_DAYS = parseInt(process.env.REFRESH_TOKEN_TTL_DAYS || '30', 10);

function nowMs() {
    return Date.now();
}

function accessTokenExpiresAt(now = nowMs()) {
    return now + ACCESS_TOKEN_TTL_MINUTES * 60 * 1000;
}

function refreshTokenExpiresAt(now = nowMs()) {
    return now + REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000;
}

async function hashPassword(password) {
    return argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 65536,
        timeCost: 3,
        parallelism: 1
    });
}

async function verifyPassword(hash, password) {
    return argon2.verify(hash, password);
}

function createRefreshToken() {
    return crypto.randomBytes(48).toString('base64url');
}

function hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
}

function signAccessToken(user, sessionId, now = nowMs()) {
    return {
        token: jwt.sign(
            {
                type: 'access',
                userId: user.id,
                email: user.email,
                sessionId
            },
            process.env.JWT_SECRET,
            { expiresIn: `${ACCESS_TOKEN_TTL_MINUTES}m` }
        ),
        expiresAt: accessTokenExpiresAt(now)
    };
}

function sanitizeUser(user) {
    return {
        id: user.id,
        name: user.name,
        email: user.email,
        is_premium: !!user.is_premium,
        premium_expires_at: user.premium_expires_at
    };
}

module.exports = {
    nowMs,
    accessTokenExpiresAt,
    refreshTokenExpiresAt,
    hashPassword,
    verifyPassword,
    createRefreshToken,
    hashToken,
    signAccessToken,
    sanitizeUser
};
