const express = require('express');
const rateLimit = require('express-rate-limit');
const router = express.Router();
const auth = require('../middleware/auth');
const { explainScan } = require('../services/aiExplainService');
const {
    reviewPluginAnalysisSummary,
    PLUGIN_AI_REVIEW_RATE_LIMIT_WINDOW_MS,
    PLUGIN_AI_REVIEW_RATE_LIMIT_MAX,
    PLUGIN_AI_REVIEW_BODY_LIMIT_BYTES
} = require('../services/pluginAiReviewService');

const FORBIDDEN_PLUGIN_REVIEW_FIELDS = new Set([
    'api_key',
    'apiKey',
    'authorization',
    'base_url',
    'baseUrl',
    'headers',
    'messages',
    'model',
    'temperature',
    'max_tokens'
]);

const pluginReviewLimiter = rateLimit({
    windowMs: PLUGIN_AI_REVIEW_RATE_LIMIT_WINDOW_MS,
    max: PLUGIN_AI_REVIEW_RATE_LIMIT_MAX,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator(req) {
        return `${String(req.userId || 'anonymous')}:${String(req.ip || 'ip')}`;
    },
    message: {
        error: 'Слишком много запросов на AI-сводку. Попробуйте позже.'
    }
});

function rejectUnsupportedPluginReviewOptions(req, res, next) {
    const payload = req.body;
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return res.status(400).json({ error: 'Нужен JSON-объект с summary/analysis/findings.' });
    }

    for (const field of FORBIDDEN_PLUGIN_REVIEW_FIELDS) {
        if (Object.prototype.hasOwnProperty.call(payload, field)) {
            return res.status(400).json({
                error: `Поле ${field} задаётся только на сервере.`
            });
        }
    }

    return next();
}

function requireJsonRequest(req, res, next) {
    if (!req.is('application/json')) {
        return res.status(415).json({ error: 'Нужен JSON body.' });
    }
    return next();
}

function enforcePluginReviewRequestSize(req, res, next) {
    const contentLength = Number(req.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > PLUGIN_AI_REVIEW_BODY_LIMIT_BYTES) {
        return res.status(413).json({
            error: 'Данные анализа слишком большие. Сократите summary/findings и попробуйте снова.'
        });
    }
    return next();
}

function mapPluginReviewError(error) {
    const code = String(error?.code || '').trim().toUpperCase();
    switch (code) {
        case 'PLUGIN_AI_REVIEW_BAD_INPUT':
        case 'PLUGIN_AI_REVIEW_INPUT_REQUIRED':
            return { status: 400, error: 'Нужны локальный summary, analysis или findings.' };
        case 'PLUGIN_AI_REVIEW_PAYLOAD_TOO_LARGE':
            return {
                status: 413,
                error: 'Данные анализа слишком большие. Сократите summary/findings и попробуйте снова.'
            };
        case 'PLUGIN_AI_REVIEW_NOT_CONFIGURED':
            return { status: 503, error: 'AI review для плагинов временно недоступен.' };
        case 'PLUGIN_AI_REVIEW_EMPTY':
        case 'PLUGIN_AI_REVIEW_UPSTREAM_UNAVAILABLE':
            return { status: 502, error: 'Не удалось получить AI-сводку. Попробуйте ещё раз позже.' };
        default:
            return { status: Number(error?.statusCode || 500) || 500, error: 'Не удалось обработать AI review.' };
    }
}

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

router.post(
    '/plugin-review/summary',
    pluginReviewLimiter,
    requireJsonRequest,
    enforcePluginReviewRequestSize,
    rejectUnsupportedPluginReviewOptions,
    async (req, res) => {
        try {
            const result = await reviewPluginAnalysisSummary(req.body || {});
            return res.json({
                success: true,
                summary: result.summary,
                verdict_suggestion: result.verdictSuggestion,
                bullets: result.bullets,
                full_report: result.fullReport || null,
                model: result.model
            });
        } catch (error) {
            console.error('Plugin AI review error:', error);
            const payload = mapPluginReviewError(error);
            return res.status(payload.status).json({ error: payload.error });
        }
    }
);

module.exports = router;
