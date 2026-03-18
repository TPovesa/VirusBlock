const express = require('express');

const auth = require('../middleware/auth');
const {
    getNetworkProtectionState,
    updateNetworkProtectionState,
    recordNetworkProtectionEvent
} = require('../services/networkProtectionService');

const router = express.Router();

function sendError(res, error, fallbackMessage) {
    const status = Number(error?.status || 500);
    const body = { error: error?.message || fallbackMessage };
    if (error?.code) {
        body.code = error.code;
    }
    return res.status(status).json(body);
}

router.get('/state', auth, async (req, res) => {
    try {
        const state = await getNetworkProtectionState(req.userId, req.query.platform);
        return res.json({ success: true, state });
    } catch (error) {
        console.error('Network protection read error:', error);
        return sendError(res, error, 'Не удалось прочитать состояние сетевой защиты');
    }
});

router.put('/state', auth, async (req, res) => {
    try {
        const state = await updateNetworkProtectionState(req.userId, req.body || {});
        return res.json({ success: true, state });
    } catch (error) {
        console.error('Network protection update error:', error);
        return sendError(res, error, 'Не удалось обновить состояние сетевой защиты');
    }
});

router.post('/events', auth, async (req, res) => {
    try {
        const result = await recordNetworkProtectionEvent(req.userId, req.body || {});
        return res.json({ success: true, ...result });
    } catch (error) {
        console.error('Network protection event error:', error);
        return sendError(res, error, 'Не удалось обновить счётчики сетевой защиты');
    }
});

module.exports = router;
