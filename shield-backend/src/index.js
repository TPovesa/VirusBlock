require('dotenv').config();

const express    = require('express');
const cors       = require('cors');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');

const authRoutes      = require('./routes/auth');
const scansRoutes     = require('./routes/scans');
const purchasesRoutes = require('./routes/purchases');

const app  = express();
const PORT = process.env.PORT || 3001;
const allowedOrigins = new Set(
    (process.env.CORS_ORIGIN || 'https://sosiskibot.ru,https://www.sosiskibot.ru')
        .split(',')
        .map((origin) => origin.trim())
        .filter(Boolean)
);

if (process.env.TRUST_PROXY === '1') {
    app.set('trust proxy', 1);
}

// ---- Security middleware ----
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
    methods: ['GET','POST','PUT','DELETE'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Device-Id'],
    credentials: false
}));

// ---- Rate limiting ----
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000,  // 15 minutes
    max: 100,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later.' }
});
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 20,   // stricter for auth endpoints
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many auth requests.' }
});

app.use(limiter);
app.use(express.json({ limit: '1mb' }));
app.use(express.urlencoded({ extended: true }));

// ---- Routes ----
app.use('/api/auth',      authLimiter, authRoutes);
app.use('/api/scans',     scansRoutes);
app.use('/api/purchases', purchasesRoutes);

// ---- Health check ----
app.get('/health', (req, res) => {
    res.json({
        status: 'ok',
        service: 'Shield Antivirus API',
        version: '1.0.0',
        timestamp: Date.now()
    });
});

// ---- 404 ----
app.use((req, res) => {
    res.status(404).json({ error: 'Endpoint not found' });
});

// ---- Error handler ----
app.use((err, req, res, next) => {
    console.error('Unhandled error:', err);
    if (err?.message === 'Origin not allowed by CORS') {
        res.status(403).json({ error: 'Origin not allowed' });
        return;
    }
    res.status(500).json({ error: 'Internal server error' });
});

// ---- Start ----
app.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🛡️  Shield Antivirus API running on port ${PORT}`);
    console.log(`   Health: http://localhost:${PORT}/health`);
    console.log(`   Auth:   http://localhost:${PORT}/api/auth`);
});

module.exports = app;
