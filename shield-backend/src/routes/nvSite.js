const express = require('express');
const router = express.Router();
const {
    getHubAuthConfig,
    createTelegramHubSession,
    getHubSessionFromRequest,
    clearHubSessionFromRequest
} = require('../services/nvHubService');

function noStore(res) {
    res.set('Cache-Control', 'no-store, max-age=0');
}

function shapeSession(session) {
    if (!session) {
        return { authenticated: false, user: null, creator: null, session: null };
    }
    return {
        authenticated: true,
        user: {
            id: session.telegram_id || '',
            username: session.username || '',
            first_name: session.display_name || '',
            last_name: '',
            photo_url: session.avatar_url || '',
            display_name: session.display_name || session.username || session.creator_slug || 'creator'
        },
        creator: {
            slug: session.creator_slug || '',
            display_name: session.display_name || session.creator_slug || 'creator',
            avatar_url: session.avatar_url || '',
            telegram_username: session.username || ''
        },
        session: {
            provider: session.provider || 'telegram',
            session_id: session.session_id || null
        }
    };
}

router.get('/auth/config', (req, res) => {
    noStore(res);
    res.json(getHubAuthConfig());
});

router.get('/auth/me', async (req, res) => {
    try {
        noStore(res);
        const session = await getHubSessionFromRequest(req);
        return res.json({
            ...shapeSession(session),
            auth: getHubAuthConfig()
        });
    } catch (error) {
        console.error('NV auth me error:', error);
        return res.status(500).json({
            error: 'Не удалось прочитать сессию сайта',
            code: 'NV_AUTH_ME_FAILED',
            auth: getHubAuthConfig()
        });
    }
});

router.post('/auth/telegram', async (req, res) => {
    try {
        const payload = req.body?.telegram_auth && typeof req.body.telegram_auth === 'object'
            ? req.body.telegram_auth
            : req.body;
        const result = await createTelegramHubSession(payload);
        noStore(res);
        res.setHeader('Set-Cookie', result.cookie);
        return res.json(shapeSession({
            ...result.session,
            session_id: null
        }));
    } catch (error) {
        console.error('NV telegram auth error:', error);
        const message = String(error?.message || '');
        if (message.includes('not configured')) {
            return res.status(503).json({
                error: 'Telegram login для NV ещё не настроен',
                code: error.code || 'NV_TELEGRAM_NOT_CONFIGURED',
                auth: getHubAuthConfig(),
                details: error.details || null
            });
        }
        if (message.toLowerCase().includes('telegram')) {
            return res.status(400).json({
                error: 'Telegram login отклонил вход. Проверь домен бота и настройки виджета.',
                code: error.code || 'NV_TELEGRAM_AUTH_INVALID'
            });
        }
        return res.status(500).json({
            error: 'Не удалось создать сессию сайта',
            code: error.code || 'NV_TELEGRAM_SESSION_CREATE_FAILED'
        });
    }
});

router.post('/auth/logout', async (req, res) => {
    try {
        const cookie = await clearHubSessionFromRequest(req);
        noStore(res);
        res.setHeader('Set-Cookie', cookie);
        return res.json({ success: true });
    } catch (error) {
        console.error('NV logout error:', error);
        return res.status(500).json({ error: 'Не удалось завершить сессию сайта', code: 'NV_LOGOUT_FAILED' });
    }
});

module.exports = router;
