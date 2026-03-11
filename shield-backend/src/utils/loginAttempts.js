const pool = require('../db/pool');
const { nowMs } = require('./security');

const MAX_LOGIN_ATTEMPTS = parseInt(process.env.MAX_LOGIN_ATTEMPTS || '5', 10);
const LOGIN_LOCK_MINUTES = parseInt(process.env.LOGIN_LOCK_MINUTES || '15', 10);

async function getThrottleState(email, ipAddress) {
    const [rows] = await pool.query(
        'SELECT failed_count, locked_until FROM login_attempts WHERE email = ? AND ip_address = ?',
        [email, ipAddress]
    );

    if (rows.length === 0) {
        return { isLocked: false, retryAfterMs: 0, failedCount: 0 };
    }

    const row = rows[0];
    const now = nowMs();
    const lockedUntil = row.locked_until || 0;

    return {
        isLocked: lockedUntil > now,
        retryAfterMs: Math.max(lockedUntil - now, 0),
        failedCount: row.failed_count || 0
    };
}

async function registerFailure(email, ipAddress) {
    const now = nowMs();
    const [rows] = await pool.query(
        'SELECT failed_count FROM login_attempts WHERE email = ? AND ip_address = ?',
        [email, ipAddress]
    );

    const failedCount = (rows[0]?.failed_count || 0) + 1;
    const lockedUntil = failedCount >= MAX_LOGIN_ATTEMPTS
        ? now + LOGIN_LOCK_MINUTES * 60 * 1000
        : null;

    await pool.query(
        `INSERT INTO login_attempts
         (email, ip_address, failed_count, first_failed_at, last_failed_at, locked_until)
         VALUES (?, ?, ?, ?, ?, ?)
         ON DUPLICATE KEY UPDATE
            failed_count = VALUES(failed_count),
            last_failed_at = VALUES(last_failed_at),
            locked_until = VALUES(locked_until)`,
        [email, ipAddress, failedCount, now, now, lockedUntil]
    );

    return {
        failedCount,
        lockedUntil
    };
}

async function clearFailures(email, ipAddress) {
    await pool.query(
        'DELETE FROM login_attempts WHERE email = ? AND ip_address = ?',
        [email, ipAddress]
    );
}

module.exports = {
    getThrottleState,
    registerFailure,
    clearFailures
};
