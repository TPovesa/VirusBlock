require('dotenv').config();

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');

const authRoutes = require('./routes/auth');
const aiRoutes = require('./routes/ai');
const deepScansRoutes = require('./routes/deepScans');
const scansRoutes = require('./routes/scans');
const purchasesRoutes = require('./routes/purchases');
const logsRoutes = require('./routes/logs');
const { resumePendingDeepScans } = require('./services/deepScanService');

const app = express();
const PORT = process.env.PORT || 5001;
const allowedOrigins = new Set(
    (process.env.CORS_ORIGIN || 'https://sosiskibot.ru,https://www.sosiskibot.ru')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}

app.disable('x-powered-by');
app.use(helmet({
    crossOriginResourcePolicy: { policy: 'cross-origin' }
}));
app.use(cors({
    origin(origin, callback) {
        if (!origin || allowedOrigins.has(origin)) {
            callback(null, true);
            return;
        }
        callback(new Error('Origin not allowed by CORS'));
    },
    methods: ['GET', 'POST', 'PUT', 'DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    credentials: false
}));

const skipGlobalLimiterForDeepRoutes = (req) => {
    return /^\/api\/scans\/deep(?:\/|$)/.test(String(req.path || ''));
};

const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    skip: skipGlobalLimiterForDeepRoutes,
    message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth requests.' }
});
const aiLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 240,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many AI requests.' }
});

app.use(limiter);
app.use(express.json({ limit: '12mb' }));
app.use(express.urlencoded({ extended: true }));

app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/ai', aiLimiter, aiRoutes);
app.use('/api/scans/deep', deepScansRoutes);
app.use('/api/scans', scansRoutes);
app.use('/api/purchases', purchasesRoutes);
app.use('/api/logs', logsRoutes);

function buildHealthPayload() {
    return {
        status: 'ok',
        service: 'Shield Antivirus API',
        version: '1.0.0',
        timestamp: Date.now()
    };
}

app.get('/health', (req, res) => {
    res.json(buildHealthPayload());
});

app.get('/healths', (req, res) => {
    res.json(buildHealthPayload());
});

app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (err?.message === 'Origin not allowed by CORS') {
        res.status(403).json({ error: 'Origin not allowed' });
        return;
    }
    res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, '0.0.0.0', () => {
    console.log(`\nShield Antivirus API running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/healths`);
    console.log(`   Auth:   http://localhost:${PORT}/api/auth`);
    console.log(`   Deep:   http://localhost:${PORT}/api/scans/deep/start`);
    resumePendingDeepScans();
});

module.exports = app;
