const express = require('express');
const {
    getReleaseNotifierConfig,
    getReleaseNotifierState,
    verifyReleaseNotifierWebhookSecret,
    verifyReleaseNotifierAnnounceSecret,
    receiveReleaseNotifierWebhook,
    sendReleaseAnnouncement
} = require('../services/releaseNotifierService');

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

function readAnnounceSecret(req) {
    const headerValue = String(req.get('x-release-notifier-secret') || '').trim();
    if (headerValue) {
        return headerValue;
    }

    const authHeader = String(req.get('authorization') || '').trim();
    const bearerMatch = authHeader.match(/^Bearer\s+(.+)$/i);
    return bearerMatch ? String(bearerMatch[1] || '').trim() : '';
}

function authorizeAnnounceRequest(req, res) {
    const config = getReleaseNotifierConfig();
    if (!config.announceSecret) {
        res.status(503).json({
            error: 'Release notifier announce secret is not configured'
        });
        return false;
    }

    if (!verifyReleaseNotifierAnnounceSecret(readAnnounceSecret(req))) {
        res.status(403).json({
            error: 'Invalid release notifier secret'
        });
        return false;
    }

    return true;
}

router.post('/releases/telegram/notifier/webhook', async (req, res) => {
    try {
        if (!verifyReleaseNotifierWebhookSecret(req.get('x-telegram-bot-api-secret-token'))) {
            return res.status(403).json({ ok: false, error: 'Invalid Telegram webhook secret' });
        }

        const result = await receiveReleaseNotifierWebhook(req.body || {});
        return res.status(200).json({ ok: true, ...result });
    } catch (error) {
        console.error('Release notifier webhook error:', error);
        return res.status(500).json({ ok: false, error: error?.message || 'Webhook processing failed' });
    }
});

router.get('/releases/telegram/notifier/state', async (req, res) => {
    try {
        if (!authorizeAnnounceRequest(req, res)) {
            return;
        }
        const state = await getReleaseNotifierState();
        return res.json({ success: true, ...state });
    } catch (error) {
        console.error('Release notifier state error:', error);
        return sendError(res, error, 'Не удалось получить состояние release notifier.');
    }
});

router.post('/releases/telegram/notifier/announce', async (req, res) => {
    try {
        if (!authorizeAnnounceRequest(req, res)) {
            return;
        }
        const result = await sendReleaseAnnouncement(req.body || {});
        return res.status(201).json({ success: true, ...result });
    } catch (error) {
        console.error('Release notifier announce error:', error);
        return sendError(res, error, 'Не удалось отправить анонс релиза.');
    }
});

module.exports = router;
