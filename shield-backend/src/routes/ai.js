const express = require('express');
const router = express.Router();
const { explainScan, isAiConfigured } = require('../services/aiExplainService');

router.post('/explain-scan', async (req, res) => {
    if (!isAiConfigured()) {
        return res.status(503).json({ error: 'AI service is not configured' });
    }

    const { summary = null, result = null } = req.body || {};
    if (!summary && !result) {
        return res.status(400).json({ error: 'summary or result is required' });
    }

    try {
        const response = await explainScan({ summary, result });
        return res.json({
            success: true,
            explanation: response.explanation,
            advice: response.advice,
            model: response.model
        });
    } catch (error) {
        console.error('AI explain error:', error);
        const statusCode = Number(error.statusCode || 502);
        return res.status(statusCode).json({ error: statusCode === 503 ? 'AI service is not configured' : 'AI upstream unavailable' });
    }
});

module.exports = router;
