const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const jwt = require('jsonwebtoken');
const { getPackageRegistry, compareSemver } = require('./packageRegistryService');

const HUB_STORE_PATH = path.resolve(__dirname, '../data/nv-hub.json');
const HUB_COOKIE_NAME = String(process.env.NV_WEB_SESSION_COOKIE || 'nv_session').trim() || 'nv_session';
const HUB_SESSION_TTL_MS = parseInt(process.env.NV_WEB_SESSION_TTL_MS || String(30 * 24 * 60 * 60 * 1000), 10);
const HUB_SESSION_SECRET = String(process.env.NV_WEB_SESSION_SECRET || process.env.JWT_SECRET || '').trim();
const TELEGRAM_BOT_USERNAME = String(process.env.NV_TELEGRAM_BOT_USERNAME || process.env.TELEGRAM_WIDGET_BOT_USERNAME || '').trim();
const TELEGRAM_BOT_TOKEN = String(process.env.NV_TELEGRAM_BOT_TOKEN || process.env.TELEGRAM_WIDGET_BOT_TOKEN || '').trim();
const TELEGRAM_WIDGET_MAX_AGE_SEC = parseInt(process.env.NV_TELEGRAM_WIDGET_MAX_AGE_SEC || '86400', 10);

function nowIso() {
    return new Date().toISOString();
}

function clone(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeCreatorSlug(value) {
    return normalizeText(value)
        .replace(/^@+/, '')
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 64);
}

function normalizePackageSlug(value) {
    return normalizeText(value)
        .replace(/[^a-z0-9._-]+/g, '-')
        .replace(/^-+|-+$/g, '')
        .slice(0, 96);
}

function packageNameFromParts(creatorSlug, packageSlug) {
    const creator = normalizeCreatorSlug(creatorSlug);
    const pkg = normalizePackageSlug(packageSlug);
    if (!creator || !pkg) return '';
    return `@${creator}/${pkg}`;
}

function ensureStoreFile() {
    if (fs.existsSync(HUB_STORE_PATH)) {
        return;
    }
    fs.mkdirSync(path.dirname(HUB_STORE_PATH), { recursive: true });
    fs.writeFileSync(HUB_STORE_PATH, JSON.stringify({
        creators: [],
        packages: [],
        sessions: []
    }, null, 2) + '\n', 'utf8');
}

function parseCanonicalPackageName(rawValue) {
    const raw = String(rawValue || '').trim();
    if (!raw) {
        return { creatorSlug: '', packageSlug: '', canonicalName: '' };
    }

    const normalized = raw.toLowerCase();
    let matched = normalized.match(/^@([a-z0-9._-]+)\/([a-z0-9._-]+)$/);
    if (!matched) {
        matched = normalized.match(/^([a-z0-9._-]+)\/([a-z0-9._-]+)$/);
    }
    if (matched) {
        const creatorSlug = normalizeCreatorSlug(matched[1]);
        const packageSlug = normalizePackageSlug(matched[2]);
        return {
            creatorSlug,
            packageSlug,
            canonicalName: packageNameFromParts(creatorSlug, packageSlug)
        };
    }

    const bare = normalizePackageSlug(normalized);
    return {
        creatorSlug: '',
        packageSlug: bare,
        canonicalName: bare
    };
}

function readStore() {
    ensureStoreFile();
    const parsed = JSON.parse(fs.readFileSync(HUB_STORE_PATH, 'utf8'));
    return {
        creators: ensureArray(parsed.creators),
        packages: ensureArray(parsed.packages),
        sessions: ensureArray(parsed.sessions)
    };
}

function writeStore(store) {
    fs.writeFileSync(HUB_STORE_PATH, JSON.stringify(store, null, 2) + '\n', 'utf8');
}

function pruneSessions(store) {
    const now = Date.now();
    store.sessions = ensureArray(store.sessions).filter((session) => Number(session.expires_at || 0) > now);
    return store;
}

function buildSessionCookie(token) {
    const maxAge = Math.max(0, Math.floor(HUB_SESSION_TTL_MS / 1000));
    return `${HUB_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

function clearSessionCookie() {
    return `${HUB_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

function getHubAuthConfig() {
    return {
        enabled: Boolean(TELEGRAM_BOT_USERNAME && TELEGRAM_BOT_TOKEN && HUB_SESSION_SECRET),
        bot_username: TELEGRAM_BOT_USERNAME
    };
}

function sessionCookieOptions() {
    return {
        httpOnly: true,
        secure: true,
        sameSite: 'lax',
        path: '/',
        maxAge: HUB_SESSION_TTL_MS
    };
}

function ensureTelegramConfigured() {
    if (!TELEGRAM_BOT_USERNAME || !TELEGRAM_BOT_TOKEN || !HUB_SESSION_SECRET) {
        const error = new Error('Telegram login is not configured');
        error.code = 'NV_TELEGRAM_NOT_CONFIGURED';
        throw error;
    }
}

function parseCookieHeader(rawCookie) {
    return String(rawCookie || '')
        .split(';')
        .map((entry) => entry.trim())
        .filter(Boolean)
        .reduce((acc, entry) => {
            const index = entry.indexOf('=');
            if (index <= 0) return acc;
            const key = entry.slice(0, index).trim();
            const value = entry.slice(index + 1).trim();
            acc[key] = decodeURIComponent(value);
            return acc;
        }, {});
}

function signHubSessionToken(session) {
    if (!HUB_SESSION_SECRET) {
        throw new Error('NV_WEB_SESSION_SECRET is not configured');
    }
    return jwt.sign(
        {
            type: 'nv-web',
            sessionId: session.id,
            creatorSlug: session.creator_slug,
            telegramId: session.telegram_id,
            username: session.username || ''
        },
        HUB_SESSION_SECRET,
        { expiresIn: Math.max(60, Math.floor(HUB_SESSION_TTL_MS / 1000)) }
    );
}

function verifyHubSessionToken(token) {
    if (!HUB_SESSION_SECRET) {
        throw new Error('NV_WEB_SESSION_SECRET is not configured');
    }
    const payload = jwt.verify(token, HUB_SESSION_SECRET);
    if (payload.type !== 'nv-web' || !payload.sessionId) {
        throw new Error('Invalid NV web session');
    }
    return payload;
}

function verifyTelegramAuthPayload(payload) {
    if (!TELEGRAM_BOT_TOKEN) {
        throw new Error('NV_TELEGRAM_BOT_TOKEN is not configured');
    }

    const authPayload = {};
    for (const [key, value] of Object.entries(payload || {})) {
        if (value == null) continue;
        const text = String(value).trim();
        if (!text) continue;
        authPayload[key] = text;
    }

    const receivedHash = authPayload.hash;
    if (!receivedHash) {
        throw new Error('Telegram hash is required');
    }

    const authDate = Number(authPayload.auth_date || 0);
    if (!Number.isFinite(authDate) || authDate <= 0) {
        throw new Error('Telegram auth_date is invalid');
    }
    if (Math.abs(Math.floor(Date.now() / 1000) - authDate) > TELEGRAM_WIDGET_MAX_AGE_SEC) {
        throw new Error('Telegram widget payload expired');
    }

    const checkString = Object.keys(authPayload)
        .filter((key) => key !== 'hash')
        .sort()
        .map((key) => `${key}=${authPayload[key]}`)
        .join('\n');

    const secret = crypto.createHash('sha256').update(TELEGRAM_BOT_TOKEN).digest();
    const expectedHash = crypto.createHmac('sha256', secret).update(checkString).digest('hex');
    const left = Buffer.from(expectedHash, 'utf8');
    const right = Buffer.from(receivedHash, 'utf8');
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        throw new Error('Telegram widget hash mismatch');
    }

    return {
        telegram_id: authPayload.id,
        username: authPayload.username || '',
        first_name: authPayload.first_name || '',
        last_name: authPayload.last_name || '',
        photo_url: authPayload.photo_url || '',
        auth_date: authDate
    };
}

function actorDisplayName(telegramUser) {
    const first = String(telegramUser.first_name || '').trim();
    const last = String(telegramUser.last_name || '').trim();
    const username = String(telegramUser.username || '').trim();
    return [first, last].filter(Boolean).join(' ').trim() || username || `Telegram ${telegramUser.telegram_id}`;
}

function findCreatorRecord(store, creatorSlug) {
    const slug = normalizeCreatorSlug(creatorSlug);
    return ensureArray(store.creators).find((entry) => normalizeCreatorSlug(entry.slug) === slug) || null;
}

function buildCreatorPayload(creator) {
    if (!creator) return null;
    return {
        slug: normalizeCreatorSlug(creator.slug),
        display_name: String(creator.display_name || creator.slug || '').trim(),
        bio: String(creator.bio || '').trim(),
        avatar_url: String(creator.avatar_url || '').trim(),
        telegram_username: String(creator.telegram_username || '').replace(/^@+/, '').trim(),
        links: ensureArray(creator.links).map((link) => ({
            label: String(link.label || '').trim(),
            href: String(link.href || '').trim()
        })).filter((link) => link.label && link.href)
    };
}

function buildUserPayload(session) {
    if (!session) return null;
    return {
        id: String(session.telegram_id || '').trim(),
        username: String(session.username || '').trim(),
        first_name: String(session.first_name || '').trim(),
        last_name: String(session.last_name || '').trim(),
        display_name: String(session.display_name || '').trim(),
        photo_url: String(session.avatar_url || '').trim()
    };
}

function builtinPackageToHubPackage(pkg) {
    const parsed = parseCanonicalPackageName(pkg.name);
    const variants = ensureArray(pkg.variants).map((variant) => ({
        id: String(variant.id || '').trim(),
        os: String(variant.os || '').trim(),
        version: String(variant.version || '').trim(),
        channel: String(variant.channel || '').trim(),
        file_name: String(variant.file_name || '').trim(),
        download_url: String(variant.download_url || '').trim(),
        install_command: String(variant.install_command || '').trim(),
        update_command: String(variant.update_command || '').trim(),
        install_strategy: String(variant.install_strategy || '').trim(),
        metadata: clone(variant.metadata || {})
    }));
    const releases = variants
        .filter((variant) => variant.version)
        .map((variant) => ({
            version: variant.version,
            os: variant.os,
            channel: variant.channel,
            file_name: variant.file_name,
            download_url: variant.download_url,
            install_command: variant.install_command,
            update_command: variant.update_command,
            install_strategy: variant.install_strategy,
            metadata: clone(variant.metadata || {}),
            source: 'builtin'
        }));

    return {
        name: pkg.name,
        creator_slug: parsed.creatorSlug,
        package_slug: parsed.packageSlug,
        title: String(pkg.title || parsed.packageSlug || pkg.name).trim(),
        description: String(pkg.description || '').trim(),
        homepage: String(pkg.homepage || '').trim(),
        latest_version: String(pkg.latest_version || releases[0]?.version || '').trim(),
        install_command: String(pkg.install_command || variants.find((variant) => variant.install_command)?.install_command || '').trim(),
        update_command: String(pkg.update_command || variants.find((variant) => variant.update_command)?.update_command || '').trim(),
        platforms: Array.from(new Set(variants.map((variant) => variant.os).filter(Boolean))),
        tags: ensureArray(pkg.tags).map((entry) => String(entry || '').trim()).filter(Boolean),
        visibility: 'public',
        source: 'builtin',
        variants,
        releases,
        owner: null,
        created_at: null,
        updated_at: null
    };
}

async function loadBuiltInPackages() {
    const registry = await getPackageRegistry();
    return ensureArray(registry.packages).map(builtinPackageToHubPackage);
}

function mergeCreators(store, packages) {
    const creators = new Map();
    for (const creator of ensureArray(store.creators)) {
        const slug = normalizeCreatorSlug(creator.slug || creator.username);
        if (!slug) continue;
        creators.set(slug, {
            slug,
            display_name: String(creator.display_name || slug).trim() || slug,
            bio: String(creator.bio || '').trim(),
            avatar_url: String(creator.avatar_url || '').trim(),
            telegram_username: String(creator.telegram_username || '').replace(/^@+/, '').trim(),
            links: ensureArray(creator.links).map((link) => ({
                label: String(link.label || '').trim(),
                href: String(link.href || '').trim()
            })).filter((link) => link.label && link.href),
            owner: creator.owner || null,
            source: creator.source || 'stored'
        });
    }
    for (const pkg of packages) {
        const slug = normalizeCreatorSlug(pkg.creator_slug);
        if (!slug || creators.has(slug)) continue;
        creators.set(slug, {
            slug,
            display_name: slug,
            bio: '',
            avatar_url: '',
            telegram_username: '',
            links: [],
            owner: pkg.owner || null,
            source: pkg.source || 'derived'
        });
    }
    return Array.from(creators.values()).sort((a, b) => a.slug.localeCompare(b.slug));
}

async function loadHubState() {
    const store = pruneSessions(readStore());
    const builtInPackages = await loadBuiltInPackages();
    const storedPackages = ensureArray(store.packages).map((entry) => ({
        name: packageNameFromParts(entry.creator_slug, entry.package_slug) || String(entry.name || '').trim().toLowerCase(),
        creator_slug: normalizeCreatorSlug(entry.creator_slug || parseCanonicalPackageName(entry.name).creatorSlug),
        package_slug: normalizePackageSlug(entry.package_slug || parseCanonicalPackageName(entry.name).packageSlug),
        title: String(entry.title || '').trim(),
        description: String(entry.description || '').trim(),
        homepage: String(entry.homepage || '').trim(),
        latest_version: String(entry.latest_version || '').trim(),
        install_command: String(entry.install_command || '').trim(),
        update_command: String(entry.update_command || '').trim(),
        platforms: ensureArray(entry.platforms).map((item) => String(item || '').trim()).filter(Boolean),
        tags: ensureArray(entry.tags).map((item) => String(item || '').trim()).filter(Boolean),
        visibility: String(entry.visibility || 'public').trim() || 'public',
        source: entry.source || 'user',
        variants: ensureArray(entry.variants).map((variant) => clone(variant)),
        releases: ensureArray(entry.releases).map((release) => clone(release)),
        owner: entry.owner || null,
        created_at: entry.created_at || null,
        updated_at: entry.updated_at || null
    }));

    const mergedPackages = new Map();
    for (const pkg of builtInPackages) {
        mergedPackages.set(pkg.name, pkg);
    }
    for (const pkg of storedPackages) {
        mergedPackages.set(pkg.name, pkg);
    }

    const packages = Array.from(mergedPackages.values())
        .filter((pkg) => pkg.name && pkg.creator_slug && pkg.package_slug)
        .sort((a, b) => a.name.localeCompare(b.name));
    const creators = mergeCreators(store, packages);
    return { store, creators, packages };
}

function packageMatchesFilters(pkg, { creator = '', os = '', q = '' } = {}) {
    if (creator && normalizeCreatorSlug(pkg.creator_slug) !== normalizeCreatorSlug(creator)) {
        return false;
    }
    if (os) {
        const normalizedOs = normalizeText(os);
        if (!ensureArray(pkg.platforms).some((platform) => normalizeText(platform) === normalizedOs)) {
            return false;
        }
    }
    if (q) {
        const haystack = [pkg.name, pkg.title, pkg.description, ...(pkg.tags || [])]
            .join(' ')
            .toLowerCase();
        if (!haystack.includes(normalizeText(q))) {
            return false;
        }
    }
    return String(pkg.visibility || 'public') === 'public';
}

function summarizePackage(pkg) {
    return {
        name: pkg.name,
        creator_slug: pkg.creator_slug,
        package_slug: pkg.package_slug,
        title: pkg.title,
        description: pkg.description,
        homepage: pkg.homepage,
        latest_version: pkg.latest_version,
        install_command: pkg.install_command,
        update_command: pkg.update_command,
        platforms: clone(pkg.platforms || []),
        tags: clone(pkg.tags || []),
        visibility: pkg.visibility,
        source: pkg.source,
        created_at: pkg.created_at,
        updated_at: pkg.updated_at
    };
}

function detailPackage(pkg) {
    return {
        ...summarizePackage(pkg),
        variants: clone(pkg.variants || []),
        releases: clone(pkg.releases || []),
        owner: clone(pkg.owner || null)
    };
}

async function listHubCatalog(filters = {}) {
    const state = await loadHubState();
    const packages = state.packages.filter((pkg) => packageMatchesFilters(pkg, filters)).map(summarizePackage);
    return {
        success: true,
        fetched_at: nowIso(),
        filters: {
            creator: normalizeCreatorSlug(filters.creator || ''),
            os: normalizeText(filters.os || ''),
            q: String(filters.q || '').trim()
        },
        creators: state.creators.map((creator) => ({
            slug: creator.slug,
            display_name: creator.display_name,
            avatar_url: creator.avatar_url,
            package_count: state.packages.filter((pkg) => pkg.creator_slug === creator.slug && pkg.visibility === 'public').length
        })),
        packages
    };
}

async function getCreatorProfile(creatorSlug) {
    const state = await loadHubState();
    const slug = normalizeCreatorSlug(creatorSlug);
    const creator = state.creators.find((entry) => entry.slug === slug);
    if (!creator) {
        return null;
    }
    const packages = state.packages.filter((pkg) => pkg.creator_slug === slug && pkg.visibility === 'public').map(summarizePackage);
    return {
        success: true,
        fetched_at: nowIso(),
        creator: {
            slug: creator.slug,
            display_name: creator.display_name,
            bio: creator.bio,
            avatar_url: creator.avatar_url,
            telegram_username: creator.telegram_username,
            links: clone(creator.links || [])
        },
        packages
    };
}

async function getHubPackageDetails(packageRef) {
    const state = await loadHubState();
    const parsed = parseCanonicalPackageName(packageRef);
    const pkg = state.packages.find((entry) => entry.name === parsed.canonicalName);
    if (!pkg || pkg.visibility !== 'public') {
        return null;
    }
    return {
        success: true,
        fetched_at: nowIso(),
        package: detailPackage(pkg)
    };
}

async function createTelegramHubSession(payload) {
    ensureTelegramConfigured();
    const telegramUser = verifyTelegramAuthPayload(payload);
    const store = pruneSessions(readStore());
    const creatorSlug = normalizeCreatorSlug(telegramUser.username || `telegram-${telegramUser.telegram_id}`);
    const session = {
        id: crypto.randomUUID(),
        provider: 'telegram',
        creator_slug: creatorSlug,
        telegram_id: String(telegramUser.telegram_id),
        username: telegramUser.username || '',
        first_name: telegramUser.first_name || '',
        last_name: telegramUser.last_name || '',
        display_name: actorDisplayName(telegramUser),
        avatar_url: telegramUser.photo_url || '',
        auth_date: telegramUser.auth_date,
        issued_at: Date.now(),
        expires_at: Date.now() + HUB_SESSION_TTL_MS
    };

    store.sessions = ensureArray(store.sessions).filter((entry) => String(entry.telegram_id || '') !== session.telegram_id);
    store.sessions.push(session);

    const creators = ensureArray(store.creators);
    if (!creators.some((entry) => normalizeCreatorSlug(entry.slug) === creatorSlug)) {
        creators.push({
            slug: creatorSlug,
            display_name: session.display_name,
            bio: '',
            avatar_url: session.avatar_url,
            telegram_username: session.username,
            links: [],
            owner: { provider: 'telegram', telegram_id: session.telegram_id },
            source: 'telegram'
        });
        store.creators = creators;
    }

    writeStore(store);
    const token = signHubSessionToken(session);
    const creator = findCreatorRecord(store, creatorSlug);
    return {
        user: buildUserPayload(session),
        creator: buildCreatorPayload(creator),
        session: {
            creator_slug: session.creator_slug,
            username: session.username,
            display_name: session.display_name,
            avatar_url: session.avatar_url,
            provider: session.provider
        },
        cookie: buildSessionCookie(token),
        cookieValue: token
    };
}

async function getHubSessionFromRequest(req) {
    const cookies = parseCookieHeader(req.headers.cookie || '');
    const token = cookies[HUB_COOKIE_NAME];
    if (!token) {
        return null;
    }

    const payload = verifyHubSessionToken(token);
    const store = pruneSessions(readStore());
    const session = ensureArray(store.sessions).find((entry) => entry.id === payload.sessionId);
    if (!session || Number(session.expires_at || 0) <= Date.now()) {
        return null;
    }

    return {
        creator_slug: session.creator_slug,
        username: session.username,
        first_name: session.first_name || '',
        last_name: session.last_name || '',
        display_name: session.display_name,
        avatar_url: session.avatar_url,
        provider: session.provider,
        telegram_id: session.telegram_id,
        session_id: session.id
    };
}

async function createTelegramSession(payload, requestMeta = {}) {
    const result = await createTelegramHubSession(payload);
    return {
        ...result,
        session: {
            ...result.session,
            ip_address: String(requestMeta.ip_address || '').trim(),
            user_agent: String(requestMeta.user_agent || '').trim()
        }
    };
}

async function resolveSessionFromRequest(req) {
    const session = await getHubSessionFromRequest(req);
    if (!session) {
        return null;
    }
    const store = pruneSessions(readStore());
    const creator = findCreatorRecord(store, session.creator_slug);
    return {
        user: buildUserPayload(session),
        creator: buildCreatorPayload(creator),
        session: {
            creator_slug: session.creator_slug,
            provider: session.provider,
            username: session.username,
            display_name: session.display_name,
            avatar_url: session.avatar_url
        }
    };
}

async function clearHubSessionFromRequest(req) {
    try {
        const session = await getHubSessionFromRequest(req);
        if (session) {
            const store = pruneSessions(readStore());
            store.sessions = ensureArray(store.sessions).filter((entry) => entry.id !== session.session_id);
            writeStore(store);
        }
    } catch (_) {
        // no-op
    }
    return clearSessionCookie();
}

async function revokeSessionByRequest(req) {
    await clearHubSessionFromRequest(req);
}

function ensureHubActor(session) {
    if (!session || !session.creator_slug) {
        const error = new Error('Hub session required');
        error.status = 401;
        throw error;
    }
    return session;
}

async function publishHubPackage(actor, payload) {
    ensureHubActor(actor);
    const store = pruneSessions(readStore());
    const creatorSlug = normalizeCreatorSlug(payload.creator_slug || actor.creator_slug);
    if (creatorSlug !== actor.creator_slug) {
        const error = new Error('Creator slug mismatch');
        error.status = 403;
        throw error;
    }

    const packageSlug = normalizePackageSlug(payload.package_slug || parseCanonicalPackageName(payload.name).packageSlug);
    if (!packageSlug) {
        const error = new Error('package_slug is required');
        error.status = 400;
        throw error;
    }

    const canonicalName = packageNameFromParts(creatorSlug, packageSlug);
    const now = nowIso();
    const platforms = Array.from(new Set(ensureArray(payload.platforms).map((entry) => normalizeText(entry)).filter(Boolean)));
    const tags = Array.from(new Set(ensureArray(payload.tags).map((entry) => String(entry || '').trim()).filter(Boolean)));

    let pkg = ensureArray(store.packages).find((entry) => packageNameFromParts(entry.creator_slug, entry.package_slug) === canonicalName);
    if (pkg && pkg.owner && pkg.owner.provider === 'telegram' && String(pkg.owner.telegram_id || '') !== String(actor.telegram_id || '')) {
        const error = new Error('Package owner mismatch');
        error.status = 403;
        throw error;
    }

    if (!pkg) {
        pkg = {
            name: canonicalName,
            creator_slug: creatorSlug,
            package_slug: packageSlug,
            releases: [],
            variants: [],
            created_at: now,
            source: 'user',
            owner: { provider: 'telegram', telegram_id: actor.telegram_id }
        };
        store.packages.push(pkg);
    }

    pkg.title = String(payload.title || pkg.title || packageSlug).trim();
    pkg.description = String(payload.description || pkg.description || '').trim();
    pkg.homepage = String(payload.homepage || pkg.homepage || '').trim();
    pkg.install_command = String(payload.install_command || pkg.install_command || `nv install ${canonicalName}`).trim();
    pkg.update_command = String(payload.update_command || pkg.update_command || pkg.install_command).trim();
    pkg.platforms = platforms.length ? platforms : ensureArray(pkg.platforms);
    pkg.tags = tags;
    pkg.visibility = String(payload.visibility || pkg.visibility || 'public').trim() || 'public';
    pkg.updated_at = now;

    const creator = ensureArray(store.creators).find((entry) => normalizeCreatorSlug(entry.slug) === creatorSlug);
    if (creator) {
        creator.display_name = String(payload.creator_display_name || creator.display_name || creatorSlug).trim() || creatorSlug;
        creator.bio = String(payload.creator_bio || creator.bio || '').trim();
        creator.avatar_url = String(payload.creator_avatar_url || creator.avatar_url || actor.avatar_url || '').trim();
        creator.telegram_username = String(payload.creator_telegram_username || creator.telegram_username || actor.username || '').replace(/^@+/, '').trim();
        creator.links = ensureArray(payload.creator_links).length
            ? ensureArray(payload.creator_links)
                .map((link) => ({ label: String(link.label || '').trim(), href: String(link.href || '').trim() }))
                .filter((link) => link.label && link.href)
            : ensureArray(creator.links);
        creator.owner = { provider: 'telegram', telegram_id: actor.telegram_id };
    }

    writeStore(store);
    return detailPackage(pkg);
}

async function publishHubRelease(actor, packageRef, payload) {
    ensureHubActor(actor);
    const store = pruneSessions(readStore());
    const parsed = parseCanonicalPackageName(packageRef);
    const pkg = ensureArray(store.packages).find((entry) => packageNameFromParts(entry.creator_slug, entry.package_slug) === parsed.canonicalName);
    if (!pkg) {
        const error = new Error('Package not found');
        error.status = 404;
        throw error;
    }
    if (!pkg.owner || pkg.owner.provider !== 'telegram' || String(pkg.owner.telegram_id || '') !== String(actor.telegram_id || '')) {
        const error = new Error('Package owner mismatch');
        error.status = 403;
        throw error;
    }

    const version = String(payload.version || '').trim();
    const os = normalizeText(payload.os || payload.platform || '');
    if (!version || !os) {
        const error = new Error('version and os are required');
        error.status = 400;
        throw error;
    }

    const release = {
        version,
        os,
        channel: String(payload.channel || 'community').trim() || 'community',
        file_name: String(payload.file_name || '').trim(),
        download_url: String(payload.download_url || '').trim(),
        install_command: String(payload.install_command || pkg.install_command || '').trim(),
        update_command: String(payload.update_command || pkg.update_command || '').trim(),
        install_strategy: String(payload.install_strategy || '').trim(),
        sha256: String(payload.sha256 || '').trim(),
        notes: ensureArray(payload.notes).map((entry) => String(entry || '').trim()).filter(Boolean),
        metadata: clone(payload.metadata || {}),
        source: 'user',
        published_at: nowIso()
    };

    pkg.releases = ensureArray(pkg.releases).filter((entry) => !(entry.version === release.version && normalizeText(entry.os) === release.os));
    pkg.releases.push(release);
    pkg.releases.sort((left, right) => compareSemver(String(right.version || ''), String(left.version || '')));
    pkg.latest_version = pkg.releases[0]?.version || pkg.latest_version || version;
    pkg.platforms = Array.from(new Set([...ensureArray(pkg.platforms), os]));
    pkg.updated_at = nowIso();

    writeStore(store);
    return detailPackage(pkg);
}

module.exports = {
    COOKIE_NAME: HUB_COOKIE_NAME,
    HUB_COOKIE_NAME,
    getHubAuthConfig,
    getTelegramConfig: getHubAuthConfig,
    clearHubSessionFromRequest,
    createTelegramSession,
    createTelegramHubSession,
    ensureTelegramConfigured,
    getCreatorProfile,
    getHubPackageDetails,
    getHubSessionFromRequest,
    listHubCatalog,
    parseCanonicalPackageName,
    publishHubPackage,
    publishHubRelease,
    resolveSessionFromRequest,
    revokeSessionByRequest,
    sessionCookieOptions
};
