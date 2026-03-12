const express = require('express');
const path = require('path');
const fs = require('fs/promises');
const crypto = require('crypto');
const auth = require('../middleware/auth');

const router = express.Router();
const LOG_ROOT = process.env.CLIENT_LOGS_DIR || path.join(process.cwd(), 'logs');
const MAX_EVENTS_PER_BATCH = parseInt(process.env.CLIENT_LOGS_MAX_EVENTS || '5000', 10);
const MAX_CRASHES_PER_BATCH = parseInt(process.env.CLIENT_LOGS_MAX_CRASHES || '200', 10);

function sanitizeSegment(value, fallback) {
    const normalized = String(value || '')
        .trim()
        .replace(/[^a-zA-Z0-9._-]/g, '_')
        .slice(0, 80);
    return normalized || fallback;
}

function normalizeItems(value, limit) {
    if (!Array.isArray(value)) return [];
    return value.slice(0, limit).map((item) => {
        if (item && typeof item === 'object') {
            return item;
        }
        return { value: String(item || '') };
    });
}

router.post('/client', auth, async (req, res) => {
    try {
        const body = req.body || {};
        const events = normalizeItems(body.events, MAX_EVENTS_PER_BATCH);
        const crashes = normalizeItems(body.crashes, MAX_CRASHES_PER_BATCH);

        if (events.length === 0 && crashes.length === 0) {
            return res.status(400).json({ error: 'events or crashes required' });
        }

        const userId = sanitizeSegment(req.userId, 'unknown_user');
        const sessionId = sanitizeSegment(body.sessionId || req.sessionId, 'unknown_session');
        const dayKey = new Date().toISOString().slice(0, 10);
        const runDir = path.join(LOG_ROOT, userId, sessionId, dayKey);
        await fs.mkdir(runDir, { recursive: true });

        const batchId = `${Date.now()}-${crypto.randomUUID()}`;
        const filePath = path.join(runDir, `client-batch-${batchId}.json`);
        const payload = {
            received_at: Date.now(),
            user_id: req.userId,
            session_id: body.sessionId || req.sessionId || null,
            app_version: body.appVersion || null,
            device: body.device || null,
            events,
            crashes
        };
        await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');

        return res.json({
            success: true,
            accepted: {
                events: events.length,
                crashes: crashes.length
            },
            batch_id: batchId
        });
    } catch (error) {
        console.error('Client log ingest error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

module.exports = router;
