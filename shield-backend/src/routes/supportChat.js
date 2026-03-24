const express = require('express');
const jwt = require('jsonwebtoken');
const auth = require('../middleware/auth');
const {
    getSupportChatState,
    createSupportChat,
    sendSupportChatMessage,
    receiveSupportWebhook,
    verifyWebhookSecret,
    getAvailabilityState,
    resolveAttachmentPath
} = require('../services/supportChatService');

const router = express.Router();

function sendError(res, error, fallbackMessage) {
    const status = Number(error?.status || 500);
    const body = {
        error: error?.message || fallbackMessage
    };
    if (error?.code) {
        body.code = error.code;
    }
    return res.status(status).json(body);
}

function authenticateSupportMediaRequest(req, res, next) {
    const header = req.headers['authorization'];
    const token = header && header.startsWith('Bearer ')
        ? header.slice(7)
        : (typeof req.query.access_token === 'string' ? req.query.access_token : '');
    if (!token) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.type !== 'access' || !payload.sessionId) {
            return res.status(401).json({ error: 'Token expired or invalid' });
        }
        req.userId = payload.userId;
        req.userEmail = payload.email;
        req.sessionId = payload.sessionId;
        return next();
    } catch {
        return res.status(401).json({ error: 'Token expired or invalid' });
    }
}

router.get('/profile/support-chat', auth, async (req, res) => {
    try {
        const state = await getSupportChatState(req.userId, {
            after: req.query.after,
            limit: req.query.limit,
            sync: req.query.sync
        });
        return res.json({ success: true, ...state });
    } catch (error) {
        console.error('Profile support chat state error:', error);
        return sendError(res, error, 'Не удалось открыть чат поддержки.');
    }
});

router.post('/profile/support-chat/open', auth, async (req, res) => {
    try {
        const state = await createSupportChat(req.userId);
        return res.status(state.availability ? 201 : 200).json({ success: true, ...state });
    } catch (error) {
        console.error('Profile support chat open error:', error);
        return sendError(res, error, 'Не удалось открыть чат поддержки.');
    }
});

router.post('/profile/support-chat/messages', auth, async (req, res) => {
    try {
        const state = await sendSupportChatMessage(req.userId, req.body || {});
        return res.json({ success: true, ...state });
    } catch (error) {
        console.error('Profile support chat message error:', error);
        return sendError(res, error, 'Не удалось отправить сообщение в поддержку.');
    }
});

router.get('/profile/support-chat/media/:messageId/:assetId', authenticateSupportMediaRequest, async (req, res) => {
    try {
        const asset = await resolveAttachmentPath(req.userId, req.params.messageId, req.params.assetId);
        res.setHeader('Cache-Control', 'private, max-age=60');
        res.setHeader('Content-Disposition', `inline; filename="${String(asset.fileName || 'attachment').replace(/"/g, '')}"`);
        res.type(asset.mimeType);
        return res.sendFile(asset.path);
    } catch (error) {
        console.error('Profile support chat media error:', error);
        return sendError(res, error, 'Не удалось открыть вложение.');
    }
});

router.post('/support/telegram/webhook', async (req, res) => {
    try {
        if (!verifyWebhookSecret(req.get('x-telegram-bot-api-secret-token'))) {
            return res.status(403).json({ ok: false, error: 'Invalid Telegram webhook secret' });
        }
        const state = getAvailabilityState();
        if (!state.availability) {
            return res.status(503).json({ ok: false, availability: false, message: state.message });
        }
        const result = await receiveSupportWebhook(req.body || {});
        return res.status(200).json({ ok: true, ...result });
    } catch (error) {
        console.error('Support Telegram webhook error:', error);
        return res.status(500).json({ ok: false, error: error?.message || 'Webhook processing failed' });
    }
});

module.exports = router;
