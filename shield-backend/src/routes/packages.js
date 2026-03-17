const express = require('express');
const router = express.Router();
const {
    getPackageRegistry,
    getPackageDetails,
    resolvePackage
} = require('../services/packageRegistryService');
const {
    clearHubSessionFromRequest,
    createTelegramHubSession,
    getCreatorProfile,
    getHubPackageDetails,
    getHubSessionFromRequest,
    listHubCatalog,
    publishHubPackage,
    publishHubRelease
} = require('../services/nvHubService');

function packageRefFromRequest(req) {
    const fromQuery = [req.query.name, req.query.package, req.query.ref].find((value) => typeof value === 'string' && value.trim());
    if (fromQuery) {
        return String(fromQuery).trim();
    }
    if (req.params.scope && req.params.name) {
        const scope = String(req.params.scope).trim();
        const packageName = String(req.params.name).trim();
        if (scope && packageName) {
            return `${scope.startsWith('@') ? scope : `@${scope}`}/${packageName}`;
        }
    }
    return String(req.params.name || '').trim();
}

function requestedOs(req) {
    return req.query.os || req.query.host_os || '';
}

router.get('/', async (req, res) => {
    try {
        const payload = await getPackageRegistry({ os: requestedOs(req) });
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json(payload);
    } catch (error) {
        console.error('Package registry error:', error);
        return res.status(500).json({ error: 'Не удалось загрузить registry пакетов' });
    }
});

router.get('/registry', async (req, res) => {
    try {
        const payload = await getPackageRegistry({ os: requestedOs(req) });
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json(payload);
    } catch (error) {
        console.error('Package registry alias error:', error);
        return res.status(500).json({ error: 'Не удалось загрузить registry пакетов' });
    }
});

router.get('/catalog', async (req, res) => {
    try {
        const payload = await listHubCatalog({
            creator: req.query.creator || '',
            os: requestedOs(req),
            q: req.query.q || req.query.search || ''
        });
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json(payload);
    } catch (error) {
        console.error('Package catalog error:', error);
        return res.status(500).json({ error: 'Не удалось загрузить каталог пакетов' });
    }
});

router.get('/creators', async (req, res) => {
    try {
        const payload = await listHubCatalog({
            creator: req.query.creator || '',
            os: requestedOs(req),
            q: req.query.q || req.query.search || ''
        });
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json({
            success: true,
            fetched_at: payload.fetched_at,
            creators: payload.creators
        });
    } catch (error) {
        console.error('Creators catalog error:', error);
        return res.status(500).json({ error: 'Не удалось загрузить список creators' });
    }
});

router.get('/creators/:creator', async (req, res) => {
    try {
        const payload = await getCreatorProfile(req.params.creator);
        if (!payload) {
            return res.status(404).json({ error: 'Creator not found' });
        }
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json(payload);
    } catch (error) {
        console.error('Creator profile error:', error);
        return res.status(500).json({ error: 'Не удалось загрузить профиль creator' });
    }
});

router.get('/creators/:creator/packages', async (req, res) => {
    try {
        const payload = await listHubCatalog({
            creator: req.params.creator,
            os: requestedOs(req),
            q: req.query.q || req.query.search || ''
        });
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json({
            success: true,
            fetched_at: payload.fetched_at,
            creator: req.params.creator,
            packages: payload.packages
        });
    } catch (error) {
        console.error('Creator packages error:', error);
        return res.status(500).json({ error: 'Не удалось загрузить пакеты creator' });
    }
});

router.get('/hub/:scope/:name', async (req, res) => {
    try {
        const payload = await getHubPackageDetails(`@${req.params.scope}/${req.params.name}`);
        if (!payload) {
            return res.status(404).json({ error: 'Package not found' });
        }
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json(payload);
    } catch (error) {
        console.error('Hub package details error:', error);
        return res.status(500).json({ error: 'Не удалось загрузить страницу пакета' });
    }
});

router.post('/auth/telegram', async (req, res) => {
    try {
        const result = await createTelegramHubSession(req.body || {});
        res.setHeader('Set-Cookie', result.cookie);
        return res.json({
            success: true,
            session: result.session
        });
    } catch (error) {
        console.error('Telegram hub auth error:', error);
        return res.status(401).json({ error: error.message || 'Не удалось авторизоваться через Telegram' });
    }
});

router.get('/auth/session', async (req, res) => {
    try {
        const session = await getHubSessionFromRequest(req);
        if (!session) {
            return res.status(401).json({ error: 'Hub session not found' });
        }
        return res.json({
            success: true,
            session
        });
    } catch (error) {
        console.error('Hub session read error:', error);
        return res.status(401).json({ error: 'Hub session invalid' });
    }
});

router.post('/auth/logout', async (req, res) => {
    try {
        const cookie = await clearHubSessionFromRequest(req);
        res.setHeader('Set-Cookie', cookie);
        return res.json({ success: true });
    } catch (error) {
        console.error('Hub logout error:', error);
        return res.status(500).json({ error: 'Не удалось завершить web session' });
    }
});

router.post('/publish', async (req, res) => {
    try {
        const session = await getHubSessionFromRequest(req);
        const pkg = await publishHubPackage(session, req.body || {});
        return res.status(201).json({
            success: true,
            package: pkg
        });
    } catch (error) {
        console.error('Hub publish package error:', error);
        return res.status(error.status || 500).json({ error: error.message || 'Не удалось опубликовать пакет' });
    }
});

router.post('/:scope/:name/releases', async (req, res) => {
    try {
        const session = await getHubSessionFromRequest(req);
        const pkg = await publishHubRelease(session, `@${req.params.scope}/${req.params.name}`, req.body || {});
        return res.status(201).json({
            success: true,
            package: pkg
        });
    } catch (error) {
        console.error('Hub publish release error:', error);
        return res.status(error.status || 500).json({ error: error.message || 'Не удалось опубликовать релиз' });
    }
});

router.get('/resolve', async (req, res) => {
    try {
        const packageRef = packageRefFromRequest(req);
        const result = await resolvePackage(packageRef, {
            os: requestedOs(req),
            version: req.query.version || 'latest',
            variant: req.query.variant || ''
        });
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.status(result.status).json(result.payload);
    } catch (error) {
        console.error('Package resolve query error:', error);
        return res.status(500).json({ error: 'Не удалось разрешить пакет' });
    }
});

router.get('/details', async (req, res) => {
    try {
        const packageRef = packageRefFromRequest(req);
        const payload = await getPackageDetails(packageRef, { os: requestedOs(req) });
        if (!payload) {
            return res.status(404).json({ error: 'Пакет не найден' });
        }
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json(payload);
    } catch (error) {
        console.error('Package details query error:', error);
        return res.status(500).json({ error: 'Не удалось прочитать пакет' });
    }
});

router.get('/:scope/:name/resolve', async (req, res) => {
    try {
        const result = await resolvePackage(packageRefFromRequest(req), {
            os: requestedOs(req),
            version: req.query.version || 'latest',
            variant: req.query.variant || ''
        });
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.status(result.status).json(result.payload);
    } catch (error) {
        console.error('Package scoped resolve error:', error);
        return res.status(500).json({ error: 'Не удалось разрешить пакет' });
    }
});

router.get('/:name/resolve', async (req, res) => {
    try {
        const result = await resolvePackage(packageRefFromRequest(req), {
            os: requestedOs(req),
            version: req.query.version || 'latest',
            variant: req.query.variant || ''
        });
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.status(result.status).json(result.payload);
    } catch (error) {
        console.error('Package resolve error:', error);
        return res.status(500).json({ error: 'Не удалось разрешить пакет' });
    }
});

router.get('/:scope/:name', async (req, res) => {
    try {
        const payload = await getPackageDetails(packageRefFromRequest(req), { os: requestedOs(req) });
        if (!payload) {
            return res.status(404).json({ error: 'Пакет не найден' });
        }
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json(payload);
    } catch (error) {
        console.error('Package scoped details error:', error);
        return res.status(500).json({ error: 'Не удалось прочитать пакет' });
    }
});

router.get('/:name', async (req, res) => {
    try {
        const payload = await getPackageDetails(packageRefFromRequest(req), { os: requestedOs(req) });
        if (!payload) {
            return res.status(404).json({ error: 'Пакет не найден' });
        }
        res.set('Cache-Control', 'no-store, max-age=0');
        return res.json(payload);
    } catch (error) {
        console.error('Package details error:', error);
        return res.status(500).json({ error: 'Не удалось прочитать пакет' });
    }
});

module.exports = router;
