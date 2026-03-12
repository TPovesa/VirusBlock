const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const { explainScan } = require('../services/aiExplainService');

router.post('/explain-scan', auth, async (req, res) => {
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
            structured_v1: response.structured_v1 || null,
            model: response.model
        });
    } catch (error) {
        console.error('AI explain error:', error);
        const statusCode = Number(error.statusCode || 502);
        return res.status(statusCode).json({ error: 'AI upstream unavailable' });
    }
});

module.exports = router;
