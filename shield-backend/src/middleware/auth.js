const jwt = require('jsonwebtoken');

function authMiddleware(req, res, next) {
    const header = req.headers['authorization'];
    if (!header || !header.startsWith('Bearer ')) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const token = header.slice(7);
    try {
        const payload = jwt.verify(token, process.env.JWT_SECRET);
        if (payload.type !== 'access' || !payload.sessionId) {
            return res.status(401).json({ error: 'Token expired or invalid' });
        }
        req.userId = payload.userId;
        req.userEmail = payload.email;
        req.sessionId = payload.sessionId;
        next();
    } catch (e) {
        return res.status(401).json({ error: 'Token expired or invalid' });
    }
}

module.exports = authMiddleware;
