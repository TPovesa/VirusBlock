const crypto = require('crypto');
const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { fetchUserById, sanitizeAccountUser } = require('./accountEntitlementsService');
const { isMailConfigured, sendMail, queueMailTask } = require('../utils/mail');
const { isVerifiedAppsAiConfigured, reviewVerifiedRepositoryWithAi } = require('./verifiedAppsAiReviewService');

const GITHUB_API_BASE = String(process.env.GITHUB_API_BASE || 'https://api.github.com').replace(/\/$/, '');
const GITHUB_TOKEN = String(process.env.GITHUB_TOKEN || process.env.GH_TOKEN || '').trim();
const VERIFIED_APPS_USER_AGENT = String(process.env.VERIFIED_APPS_USER_AGENT || 'NeuralV-VerifiedApps/1.0').trim();
const VERIFIED_APP_REQUEST_TIMEOUT_MS = parseInt(process.env.VERIFIED_APP_REQUEST_TIMEOUT_MS || '20000', 10);
const VERIFIED_APP_DOWNLOAD_TIMEOUT_MS = parseInt(process.env.VERIFIED_APP_DOWNLOAD_TIMEOUT_MS || '120000', 10);
const VERIFIED_APP_MAX_REPO_TREE_ENTRIES = parseInt(process.env.VERIFIED_APP_MAX_REPO_TREE_ENTRIES || '12000', 10);
const VERIFIED_APP_MAX_TEXT_FILES = parseInt(process.env.VERIFIED_APP_MAX_TEXT_FILES || '24', 10);
const VERIFIED_APP_MAX_TEXT_FILE_BYTES = parseInt(process.env.VERIFIED_APP_MAX_TEXT_FILE_BYTES || '262144', 10);
const VERIFIED_APP_MAX_TOTAL_TEXT_BYTES = parseInt(process.env.VERIFIED_APP_MAX_TOTAL_TEXT_BYTES || String(1024 * 1024), 10);
const VERIFIED_APP_MAX_ARTIFACT_BYTES = parseInt(process.env.VERIFIED_APP_MAX_ARTIFACT_BYTES || String(120 * 1024 * 1024), 10);
const VERIFIED_APP_MAX_RELEASES = parseInt(process.env.VERIFIED_APP_MAX_RELEASES || '25', 10);
const VERIFIED_APP_MAX_RELEASE_ASSETS = parseInt(process.env.VERIFIED_APP_MAX_RELEASE_ASSETS || '80', 10);
const VERIFIED_APP_MAX_ACTIVE_PER_USER = parseInt(process.env.VERIFIED_APP_MAX_ACTIVE_PER_USER || '3', 10);
const VERIFIED_APP_SUBMIT_COOLDOWN_MS = parseInt(process.env.VERIFIED_APP_SUBMIT_COOLDOWN_MS || String(2 * 60 * 1000), 10);
const DEVELOPER_APPLICATION_COOLDOWN_MS = parseInt(process.env.DEVELOPER_APPLICATION_COOLDOWN_MS || String(24 * 60 * 60 * 1000), 10);
const VERIFIED_APP_QUEUE_CONCURRENCY = Math.max(1, parseInt(process.env.VERIFIED_APP_QUEUE_CONCURRENCY || '1', 10));
const VERIFIED_APP_AI_BASE_URL = String(process.env.VERIFIED_APP_AI_BASE_URL || 'https://sosiskibot.ru/api/v1').replace(/\/+$/, '');
const VERIFIED_APP_AI_API_KEY = String(process.env.VERIFIED_APP_AI_API_KEY || process.env.SOSISKIBOT_API_KEY || '').trim();
const VERIFIED_APP_AI_MODEL = String(process.env.VERIFIED_APP_AI_MODEL || 'gpt-4.1-mini').trim();
const VERIFIED_APP_AI_TIMEOUT_MS = parseInt(process.env.VERIFIED_APP_AI_TIMEOUT_MS || '90000', 10);

const VERIFIED_APPS_PLATFORM_ENUM = "ENUM('android','windows','linux','plugins','heroku')";
const ALLOWED_PLATFORMS = new Set(['android', 'windows', 'linux', 'plugins', 'heroku']);
const TEXT_EXTENSIONS = new Set([
    '.md', '.txt', '.json', '.yaml', '.yml', '.toml', '.xml', '.gradle', '.properties',
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.kts', '.go',
    '.rs', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.swift', '.sh', '.bat', '.cmd', '.ps1'
]);
const CODE_EXTENSIONS = new Set([
    '.js', '.ts', '.jsx', '.tsx', '.mjs', '.cjs', '.py', '.java', '.kt', '.kts', '.go',
    '.rs', '.cs', '.cpp', '.cc', '.c', '.h', '.hpp', '.swift', '.sh', '.bat', '.cmd', '.ps1'
]);
const IMPORTANT_FILE_NAMES = new Set([
    'readme.md', 'package.json', 'app.json', 'cargo.toml', 'build.gradle', 'build.gradle.kts',
    'settings.gradle', 'settings.gradle.kts', 'gradle.properties', 'androidmanifest.xml', 'pom.xml',
    'requirements.txt', 'pyproject.toml', 'go.mod', 'pubspec.yaml', 'pubspec.yml'
]);
const HARD_BLOCK_KEYWORDS = [
    'keylogger',
    'clipper',
    'stealer',
    'credential dump',
    'mimikatz',
    'discord token',
    'browser password',
    'injector',
    'silent miner'
];
const NON_BEHAVIORAL_PATH_RE = /(^|\/)(readme|docs?|test|tests|spec|specs|__tests__|fixtures|samples|examples|yara|rules?|signatures?|ioc|blocklist|denylist|analy[sz]er|scanner|detection)(\/|$)|(^|\/)(mock|fixture|sample|example|demo)[._-]/i;

let queueDrainPromise = null;
const queuedIds = new Set();
let activeWorkers = 0;
let schemaReady = false;
let schemaReadyPromise = null;

function nowMs() {
    return Date.now();
}

async function ensureVerifiedAppsSchema(db = pool) {
    if (schemaReady) {
        return;
    }
    if (schemaReadyPromise) {
        return schemaReadyPromise;
    }

    schemaReadyPromise = (async () => {
        await db.query(`
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS is_verified_developer TINYINT(1) DEFAULT 0 AFTER developer_mode_activated_at
        `);
        await db.query(`
            ALTER TABLE users
                ADD COLUMN IF NOT EXISTS verified_developer_at BIGINT DEFAULT NULL AFTER is_verified_developer
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS developer_applications (
                id VARCHAR(36) PRIMARY KEY,
                user_id VARCHAR(36) NOT NULL,
                applicant_name VARCHAR(100) NOT NULL,
                applicant_email VARCHAR(255) NOT NULL,
                message VARCHAR(700) DEFAULT NULL,
                status ENUM('PENDING_REVIEW','APPROVED','REJECTED') NOT NULL DEFAULT 'PENDING_REVIEW',
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                mailed_at BIGINT DEFAULT NULL,
                reviewed_at BIGINT DEFAULT NULL,
                review_note VARCHAR(255) DEFAULT NULL,
                FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_developer_applications_user_created (user_id, created_at),
                INDEX idx_developer_applications_status_created (status, created_at)
            )
        `);
        await db.query(`
            CREATE TABLE IF NOT EXISTS verified_apps (
                id VARCHAR(36) PRIMARY KEY,
                owner_user_id VARCHAR(36) NOT NULL,
                repository_url VARCHAR(700) NOT NULL,
                repository_owner VARCHAR(120) NOT NULL,
                repository_name VARCHAR(120) NOT NULL,
                repository_default_branch VARCHAR(120) DEFAULT NULL,
                release_artifact_url VARCHAR(700) NOT NULL,
                release_tag VARCHAR(120) DEFAULT NULL,
                release_name VARCHAR(255) DEFAULT NULL,
                release_asset_name VARCHAR(255) DEFAULT NULL,
                release_published_at BIGINT DEFAULT NULL,
                official_site_url VARCHAR(700) DEFAULT NULL,
                project_description VARCHAR(1200) DEFAULT NULL,
                platform ${VERIFIED_APPS_PLATFORM_ENUM} NOT NULL,
                platform_compatibility_json LONGTEXT DEFAULT NULL,
                app_name VARCHAR(120) NOT NULL,
                author_name VARCHAR(120) NOT NULL,
                avatar_url VARCHAR(700) DEFAULT NULL,
                status ENUM('QUEUED','RUNNING','SAFE','FAILED') NOT NULL DEFAULT 'QUEUED',
                sha256 VARCHAR(64) DEFAULT NULL,
                artifact_file_name VARCHAR(255) DEFAULT NULL,
                artifact_size_bytes BIGINT DEFAULT NULL,
                artifact_content_type VARCHAR(160) DEFAULT NULL,
                risk_score INT NOT NULL DEFAULT 0,
                summary_json LONGTEXT DEFAULT NULL,
                findings_json LONGTEXT DEFAULT NULL,
                public_summary VARCHAR(280) DEFAULT NULL,
                error_message VARCHAR(255) DEFAULT NULL,
                queued_at BIGINT DEFAULT NULL,
                started_at BIGINT DEFAULT NULL,
                completed_at BIGINT DEFAULT NULL,
                verified_at BIGINT DEFAULT NULL,
                created_at BIGINT NOT NULL,
                updated_at BIGINT NOT NULL,
                FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE CASCADE,
                INDEX idx_verified_apps_owner_created (owner_user_id, created_at),
                INDEX idx_verified_apps_status_created (status, created_at),
                INDEX idx_verified_apps_platform_verified (platform, verified_at),
                INDEX idx_verified_apps_sha256 (sha256),
                UNIQUE KEY uniq_verified_apps_owner_artifact (owner_user_id, release_artifact_url)
            )
        `);
        await db.query(`
            ALTER TABLE verified_apps
                ADD COLUMN IF NOT EXISTS repository_default_branch VARCHAR(120) DEFAULT NULL AFTER repository_name
        `);
        await db.query(`
            ALTER TABLE verified_apps
                ADD COLUMN IF NOT EXISTS release_tag VARCHAR(120) DEFAULT NULL AFTER release_artifact_url
        `);
        await db.query(`
            ALTER TABLE verified_apps
                ADD COLUMN IF NOT EXISTS release_name VARCHAR(255) DEFAULT NULL AFTER release_tag
        `);
        await db.query(`
            ALTER TABLE verified_apps
                ADD COLUMN IF NOT EXISTS release_asset_name VARCHAR(255) DEFAULT NULL AFTER release_name
        `);
        await db.query(`
            ALTER TABLE verified_apps
                ADD COLUMN IF NOT EXISTS release_published_at BIGINT DEFAULT NULL AFTER release_asset_name
        `);
        await db.query(`
            ALTER TABLE verified_apps
                ADD COLUMN IF NOT EXISTS project_description VARCHAR(1200) DEFAULT NULL AFTER official_site_url
        `);
        await db.query(`
            ALTER TABLE verified_apps
                ADD COLUMN IF NOT EXISTS platform_compatibility_json LONGTEXT DEFAULT NULL AFTER platform
        `);
        await db.query(`
            ALTER TABLE verified_apps
                MODIFY COLUMN platform ${VERIFIED_APPS_PLATFORM_ENUM} NOT NULL
        `);
        schemaReady = true;
    })().finally(() => {
        schemaReadyPromise = null;
    });

    return schemaReadyPromise;
}

function adminDeveloperApplicationsEmail() {
    return String(
        process.env.DEVELOPER_APPLICATION_EMAIL
        || process.env.NEURALV_DEVELOPER_APPLICATION_EMAIL
        || process.env.ADMIN_EMAIL
        || ''
    ).trim();
}

function getDeveloperApplicationActionSecret() {
    return String(
        process.env.DEVELOPER_APPLICATION_ACTION_SECRET
        || process.env.NEURALV_DEVELOPER_APPLICATION_ACTION_SECRET
        || process.env.JWT_SECRET
        || process.env.REFRESH_TOKEN_SECRET
        || ''
    ).trim();
}

function developerApplicationActionBaseUrl() {
    return String(
        process.env.PUBLIC_API_BASE_URL
        || process.env.API_BASE_URL
        || process.env.SITE_API_BASE_URL
        || 'https://sosiskibot.ru/basedata/api'
    ).replace(/\/+$/, '');
}

function normalizePlatform(value) {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'plugin':
        case 'extension':
        case 'extensions':
        case 'telegram-plugin':
            return 'plugins';
        case 'heroku-app':
        case 'heroku-addon':
            return 'heroku';
        case 'apk':
            return 'android';
        case 'shell':
        case 'cli':
            return 'linux';
        case 'win':
            return 'windows';
        default:
            return normalized;
    }
}

function collectPlatformTokens(value) {
    if (Array.isArray(value)) {
        return value
            .flatMap((item) => collectPlatformTokens(item))
            .filter((item) => String(item || '').trim());
    }
    if (typeof value === 'string') {
        return value
            .split(/[,\n]/)
            .map((item) => item.trim())
            .filter(Boolean);
    }
    if (value === null || value === undefined) {
        return [];
    }
    const normalized = String(value || '').trim();
    return normalized ? [normalized] : [];
}

function parseCompatiblePlatformsInput(value) {
    const tokens = collectPlatformTokens(value);
    const platforms = [];
    const invalid = [];
    for (const token of tokens) {
        const normalized = normalizePlatform(token);
        if (!normalized || !validatePlatform(normalized)) {
            invalid.push(token);
            continue;
        }
        if (!platforms.includes(normalized)) {
            platforms.push(normalized);
        }
    }
    return {
        provided: tokens.length > 0,
        platforms,
        invalid
    };
}

function ensureCompatiblePlatforms(primaryPlatform, compatiblePlatforms = []) {
    const normalizedPrimary = normalizePlatform(primaryPlatform);
    const list = Array.isArray(compatiblePlatforms) ? compatiblePlatforms : [];
    const merged = [];
    if (normalizedPrimary && validatePlatform(normalizedPrimary)) {
        merged.push(normalizedPrimary);
    }
    for (const item of list) {
        const normalized = normalizePlatform(item);
        if (normalized && validatePlatform(normalized) && !merged.includes(normalized)) {
            merged.push(normalized);
        }
    }
    return merged;
}

function serializeCompatiblePlatforms(primaryPlatform, compatiblePlatforms = []) {
    const merged = ensureCompatiblePlatforms(primaryPlatform, compatiblePlatforms);
    return merged.length > 0 ? JSON.stringify(merged) : null;
}

function parseCompatiblePlatformsFromRow(row) {
    const parsed = parseJson(row?.platform_compatibility_json);
    return ensureCompatiblePlatforms(
        row?.platform,
        Array.isArray(parsed) ? parsed : []
    );
}

function normalizeUrl(value) {
    return String(value || '').trim();
}

function normalizeAppName(value) {
    return String(value || '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 120);
}

function normalizeOptionalMessage(value, maxLength = 700) {
    const normalized = String(value || '')
        .replace(/\s+/g, ' ')
        .trim();
    return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeProjectDescription(value) {
    return normalizeOptionalMessage(value, 1200);
}

function normalizeReleaseTag(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 120) : null;
}

function normalizeReleaseAssetName(value) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, 255) : null;
}

function parseGithubRepo(input) {
    try {
        const url = new URL(normalizeUrl(input));
        if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
            return null;
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length < 2) {
            return null;
        }
        const owner = String(parts[0] || '').trim();
        let repo = String(parts[1] || '').trim();
        if (!owner || !repo) {
            return null;
        }
        repo = repo.replace(/\.git$/i, '');
        if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
            return null;
        }
        return {
            owner,
            repo,
            canonicalUrl: `https://github.com/${owner}/${repo}`
        };
    } catch (_) {
        return null;
    }
}

function parseGithubArtifactUrl(input) {
    try {
        const url = new URL(normalizeUrl(input));
        if (url.protocol !== 'https:' || url.hostname !== 'github.com') {
            return null;
        }
        const parts = url.pathname.split('/').filter(Boolean);
        if (parts.length < 6) {
            return null;
        }
        const [owner, repo, kind, downloadKeyword] = parts;
        if (kind !== 'releases' || downloadKeyword !== 'download') {
            return null;
        }
        if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo)) {
            return null;
        }
        const tag = String(parts[4] || '').trim();
        const fileName = decodeURIComponent(parts.slice(5).join('/'));
        if (!tag || !fileName) {
            return null;
        }
        return {
            owner,
            repo,
            tag,
            fileName,
            canonicalUrl: `https://github.com/${owner}/${repo}/releases/download/${tag}/${encodeURIComponent(fileName).replace(/%2F/g, '/')}`
        };
    } catch (_) {
        return null;
    }
}

function isLikelySourceArchive(name) {
    const lowered = String(name || '').toLowerCase();
    return (
        lowered === 'source code (zip)' ||
        lowered === 'source code (tar.gz)' ||
        lowered.endsWith('.zip') && lowered.includes('source') ||
        lowered.endsWith('.tar.gz') && lowered.includes('source')
    );
}

function parseGithubReleaseList(payload) {
    if (!Array.isArray(payload)) {
        return [];
    }
    return payload.slice(0, VERIFIED_APP_MAX_RELEASES).map((release) => ({
        id: release.id,
        tagName: String(release.tag_name || '').trim(),
        name: String(release.name || '').trim() || null,
        draft: Boolean(release.draft),
        prerelease: Boolean(release.prerelease),
        publishedAt: release.published_at ? Date.parse(release.published_at) || null : null,
        htmlUrl: String(release.html_url || '').trim() || null,
        assets: Array.isArray(release.assets)
            ? release.assets.slice(0, VERIFIED_APP_MAX_RELEASE_ASSETS).map((asset) => ({
                id: asset.id,
                name: String(asset.name || '').trim(),
                size: Number(asset.size || 0),
                contentType: String(asset.content_type || '').trim() || null,
                downloadCount: Number(asset.download_count || 0),
                browserDownloadUrl: String(asset.browser_download_url || '').trim() || null
            }))
            : []
    })).filter((release) => release.tagName);
}

function inferPlatformFromRepo({ paths, releases, description, ownerRepo }) {
    const score = {
        android: 0,
        windows: 0,
        linux: 0,
        plugins: 0,
        heroku: 0
    };
    const loweredPaths = paths.map((path) => String(path || '').toLowerCase());
    const releaseNames = releases.flatMap((release) => release.assets.map((asset) => asset.name.toLowerCase()));
    const corpus = [description, ownerRepo, ...loweredPaths.slice(0, 3000), ...releaseNames].join('\n');

    const apply = (platform, terms, weight = 1) => {
        for (const term of terms) {
            if (corpus.includes(term)) {
                score[platform] += weight;
            }
        }
    };

    apply('android', ['androidmanifest.xml', '.apk', 'gradle', 'build.gradle', 'app/src/main', 'android'], 2);
    apply('windows', ['.sln', '.csproj', '.msi', '.exe', 'winui', 'wpf', 'windows'], 2);
    apply('linux', ['appimage', '.deb', '.rpm', 'systemd', 'linux', 'snapcraft', 'pkgbuild'], 2);
    apply('plugins', ['exteragram', 'ayugram', '.plugin', 'telegram plugin'], 3);
    apply('heroku', ['heroku', 'hikka', 'loader.module', '@loader.tds', 'telethon'], 3);

    const ranked = Object.entries(score).sort((left, right) => right[1] - left[1]);
    const [platform, value] = ranked[0];
    if (!value) {
        return { platform: 'windows', confidence: 'low', score };
    }
    return {
        platform,
        confidence: value >= 6 ? 'high' : value >= 3 ? 'medium' : 'low',
        score
    };
}

function scoreReleaseAsset(asset, normalizedPlatform) {
    const loweredName = String(asset?.name || '').toLowerCase();
    if (!asset?.browserDownloadUrl || !asset?.name || isLikelySourceArchive(loweredName)) {
        return -999;
    }

    let score = 0;
    if (normalizedPlatform === 'android') {
        if (loweredName.endsWith('.apk')) score += 8;
        if (loweredName.includes('android')) score += 3;
    } else if (normalizedPlatform === 'windows') {
        if (loweredName.endsWith('.exe') || loweredName.endsWith('.msi') || loweredName.endsWith('.zip')) score += 7;
        if (loweredName.includes('windows') || loweredName.includes('win')) score += 3;
        if (loweredName.includes('portable') || loweredName.includes('setup')) score += 2;
    } else if (normalizedPlatform === 'linux') {
        if (loweredName.endsWith('.deb') || loweredName.endsWith('.rpm') || loweredName.endsWith('.appimage') || loweredName.endsWith('.tar.gz')) score += 7;
        if (loweredName.includes('linux')) score += 3;
    } else if (normalizedPlatform === 'plugins') {
        if (loweredName.endsWith('.plugin')) score += 8;
        if (loweredName.includes('extera') || loweredName.includes('ayu')) score += 3;
    } else if (normalizedPlatform === 'heroku') {
        if (loweredName.endsWith('.py')) score += 7;
        if (loweredName.includes('heroku') || loweredName.includes('hikka')) score += 3;
    }

    if (!loweredName.includes('debug')) score += 1;
    if (!loweredName.includes('source')) score += 1;
    return score;
}

function chooseReleaseAsset(releases, {
    platform,
    releaseTag = null,
    releaseAssetName = null
} = {}) {
    const normalizedReleaseTag = normalizeReleaseTag(releaseTag);
    const normalizedAssetName = normalizeReleaseAssetName(releaseAssetName)?.toLowerCase() || null;
    const stableReleases = releases.filter((release) => !release.draft);
    const releasePool = normalizedReleaseTag
        ? stableReleases.filter((release) => release.tagName.toLowerCase() === normalizedReleaseTag.toLowerCase())
        : stableReleases;

    const rankedReleases = releasePool
        .slice()
        .sort((left, right) => Number(right.publishedAt || 0) - Number(left.publishedAt || 0));

    for (const release of rankedReleases) {
        const assets = release.assets
            .filter((asset) => asset.browserDownloadUrl && !isLikelySourceArchive(asset.name))
            .map((asset) => ({
                ...asset,
                score: normalizedAssetName
                    ? (asset.name.toLowerCase() === normalizedAssetName ? 1000 : -1000)
                    : scoreReleaseAsset(asset, platform)
            }))
            .sort((left, right) => right.score - left.score || right.downloadCount - left.downloadCount || right.size - left.size);
        const best = assets.find((asset) => asset.score > -500);
        if (best) {
            return {
                release,
                asset: best
            };
        }
    }

    return null;
}

async function fetchGithubRepoMeta(repoMeta) {
    return fetchJson(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repoMeta.owner)}/${encodeURIComponent(repoMeta.repo)}`,
        { headers: githubHeaders() }
    );
}

async function fetchGithubReleaseCatalog(repoMeta) {
    const payload = await fetchJson(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repoMeta.owner)}/${encodeURIComponent(repoMeta.repo)}/releases?per_page=${VERIFIED_APP_MAX_RELEASES}`,
        { headers: githubHeaders(), timeoutMs: VERIFIED_APP_DOWNLOAD_TIMEOUT_MS }
    );
    return parseGithubReleaseList(payload);
}

function resolvePlatformOverride(value) {
    const normalized = normalizePlatform(value);
    return validatePlatform(normalized) ? normalized : null;
}

function pickDetectedAppName(inputName, repo) {
    const normalized = normalizeAppName(inputName);
    if (normalized) {
        return normalized;
    }
    return normalizeAppName(repo?.name || repo?.full_name || repo?.repo || 'NeuralV App') || 'NeuralV App';
}

async function discoverVerificationSubmission({
    repositoryUrl,
    appName,
    platform,
    releaseTag,
    releaseAssetName
}) {
    const repoMeta = parseGithubRepo(repositoryUrl);
    if (!repoMeta) {
        const error = new Error('Public GitHub repository URL required');
        error.code = 'INVALID_REPOSITORY_URL';
        throw error;
    }

    const repo = await fetchGithubRepoMeta(repoMeta);
    if (repo.private) {
        const error = new Error('Private repositories are not supported');
        error.code = 'PRIVATE_REPOSITORY_NOT_SUPPORTED';
        throw error;
    }

    const releases = await fetchGithubReleaseCatalog(repoMeta);
    if (!releases.length) {
        const error = new Error('Repository has no public releases');
        error.code = 'REPOSITORY_RELEASES_NOT_FOUND';
        throw error;
    }

    const assetNames = releases.flatMap((release) => release.assets.map((asset) => asset.name));
    const platformOverride = resolvePlatformOverride(platform);
    const inferredPlatform = platformOverride || inferPlatformFromRepo({
        paths: assetNames,
        releases,
        description: `${repo.description || ''}\n${repo.homepage || ''}`,
        ownerRepo: `${repoMeta.owner}/${repoMeta.repo}`
    }).platform;

    let selection = chooseReleaseAsset(releases, {
        platform: inferredPlatform,
        releaseTag,
        releaseAssetName
    });

    if (!selection?.release || !selection?.asset?.browserDownloadUrl) {
        selection = chooseReleaseAsset(releases, {
            platform: null,
            releaseTag,
            releaseAssetName
        });
    }

    if (!selection?.release || !selection?.asset?.browserDownloadUrl) {
        const error = new Error('No matching release asset found');
        error.code = 'REPOSITORY_RELEASE_ASSET_NOT_FOUND';
        throw error;
    }

    return {
        repoMeta,
        repo,
        releases,
        platform: inferredPlatform,
        appName: pickDetectedAppName(appName, repo),
        release: selection.release,
        asset: selection.asset
    };
}

function truncateText(value, maxLength = 900) {
    const normalized = String(value || '').replace(/\s+/g, ' ').trim();
    return normalized.length > maxLength ? `${normalized.slice(0, maxLength - 1)}…` : normalized;
}

function validatePlatform(platform) {
    return ALLOWED_PLATFORMS.has(platform);
}

function githubHeaders() {
    const headers = {
        'accept': 'application/vnd.github+json',
        'user-agent': VERIFIED_APPS_USER_AGENT
    };
    if (GITHUB_TOKEN) {
        headers.authorization = `Bearer ${GITHUB_TOKEN}`;
    }
    return headers;
}

async function fetchJson(url, { timeoutMs = VERIFIED_APP_REQUEST_TIMEOUT_MS, headers = {} } = {}) {
    const response = await fetch(url, {
        headers: {
            ...headers
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
        const error = new Error(`Remote request failed: ${response.status}`);
        error.statusCode = response.status;
        throw error;
    }
    return response.json();
}

async function fetchText(url, { timeoutMs = VERIFIED_APP_REQUEST_TIMEOUT_MS, maxBytes = VERIFIED_APP_MAX_TEXT_FILE_BYTES } = {}) {
    const response = await fetch(url, {
        headers: {
            'user-agent': VERIFIED_APPS_USER_AGENT
        },
        signal: AbortSignal.timeout(timeoutMs)
    });
    if (!response.ok) {
        const error = new Error(`Remote request failed: ${response.status}`);
        error.statusCode = response.status;
        throw error;
    }
    const reader = response.body?.getReader();
    if (!reader) {
        return '';
    }
    const chunks = [];
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > maxBytes) {
            throw new Error(`Text file exceeds limit of ${maxBytes} bytes`);
        }
        chunks.push(Buffer.from(value));
    }
    return Buffer.concat(chunks).toString('utf8');
}

async function downloadArtifactAndHash(url) {
    const response = await fetch(url, {
        redirect: 'follow',
        headers: {
            'user-agent': VERIFIED_APPS_USER_AGENT
        },
        signal: AbortSignal.timeout(VERIFIED_APP_DOWNLOAD_TIMEOUT_MS)
    });
    if (!response.ok) {
        const error = new Error(`Artifact download failed: ${response.status}`);
        error.statusCode = response.status;
        throw error;
    }

    const contentLength = Number(response.headers.get('content-length') || 0);
    if (contentLength > VERIFIED_APP_MAX_ARTIFACT_BYTES) {
        throw new Error(`Artifact exceeds limit of ${VERIFIED_APP_MAX_ARTIFACT_BYTES} bytes`);
    }

    const reader = response.body?.getReader();
    if (!reader) {
        throw new Error('Artifact response body is empty');
    }

    const hash = crypto.createHash('sha256');
    let totalBytes = 0;
    while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        totalBytes += value.byteLength;
        if (totalBytes > VERIFIED_APP_MAX_ARTIFACT_BYTES) {
            throw new Error(`Artifact exceeds limit of ${VERIFIED_APP_MAX_ARTIFACT_BYTES} bytes`);
        }
        hash.update(value);
    }

    const finalUrl = response.url || url;
    const inferredName = decodeURIComponent(finalUrl.split('/').filter(Boolean).pop() || 'artifact.bin');
    return {
        sha256: hash.digest('hex'),
        sizeBytes: totalBytes,
        contentType: String(response.headers.get('content-type') || '').slice(0, 160) || null,
        fileName: inferredName.slice(0, 255)
    };
}

function buildCandidateTextPaths(blobPaths) {
    const scored = blobPaths.map((path, index) => {
        const lowered = String(path || '').toLowerCase();
        const fileName = lowered.split('/').pop() || lowered;
        const extension = fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
        let priority = 0;
        if (IMPORTANT_FILE_NAMES.has(fileName)) priority += 10;
        if (['.py', '.kt', '.kts', '.java', '.js', '.ts', '.tsx', '.jsx', '.cs', '.go', '.rs'].includes(extension)) priority += 6;
        if (lowered.includes('/src/')) priority += 3;
        if (lowered.includes('/app/')) priority += 2;
        if (/(security|crypto|token|auth|network|scan|hook|plugin|module|heroku|telegram)/.test(lowered)) priority += 4;
        if (NON_BEHAVIORAL_PATH_RE.test(lowered)) priority -= 8;
        return { path, priority, index };
    });
    return scored
        .filter((entry) => entry.priority > 0)
        .sort((left, right) => right.priority - left.priority || left.index - right.index)
        .slice(0, VERIFIED_APP_MAX_TEXT_FILES)
        .map((entry) => entry.path);
}

function buildRepoLanguageHints(paths) {
    const hints = new Set();
    for (const path of paths) {
        const lowered = String(path || '').toLowerCase();
        if (lowered.endsWith('.kt') || lowered.endsWith('.kts') || lowered.includes('androidmanifest.xml')) hints.add('kotlin/android');
        if (lowered.endsWith('.cs') || lowered.endsWith('.csproj') || lowered.endsWith('.sln')) hints.add('csharp/windows');
        if (lowered.endsWith('.go')) hints.add('go');
        if (lowered.endsWith('.rs')) hints.add('rust');
        if (lowered.endsWith('.py')) hints.add('python');
        if (lowered.endsWith('.js') || lowered.endsWith('.ts') || lowered.endsWith('.tsx') || lowered.endsWith('.jsx')) hints.add('javascript/typescript');
    }
    return Array.from(hints).slice(0, 8);
}

function getPathExtension(filePath) {
    const lowered = String(filePath || '').toLowerCase();
    const fileName = lowered.split('/').pop() || lowered;
    return fileName.includes('.') ? `.${fileName.split('.').pop()}` : '';
}

function isCodeLikePath(filePath) {
    return CODE_EXTENSIONS.has(getPathExtension(filePath));
}

function findMatchingPaths(sampledFiles, regexes, { codeOnly = true } = {}) {
    const pool = codeOnly ? sampledFiles.filter((file) => isCodeLikePath(file.path)) : sampledFiles;
    return pool
        .filter((file) => regexes.some((regex) => regex.test(file.content)))
        .slice(0, 6)
        .map((file) => file.path);
}

function analyzeSampledFiles(sampledFiles, paths) {
    const findings = [];
    const addFinding = (key, severity, title, detail, regexes, options = {}) => {
        const matches = findMatchingPaths(sampledFiles, regexes, options);
        if (matches.length === 0) {
            return;
        }
        findings.push({ key, severity, title, detail, paths: matches });
    };

    const dynamicExecRegexes = [
        /(?<!["'`])\bexec\s*\(/i,
        /(?<!["'`])\beval\s*\(/i,
        /(?<!["'`])\bcompile\s*\(/i,
        /(?<!["'`])\bsubprocess\.Popen\s*\(/i
    ];
    const remoteFetchRegexes = [
        /(?<!["'`])\brequests\.(?:get|post|put|delete|patch|request)\s*\(/i,
        /(?<!["'`])\bhttpx\.(?:get|post|put|delete|patch|request)\s*\(/i,
        /(?<!["'`])\burllib\.request\.urlopen\s*\(/i,
        /(?<!["'`])\burlopen\s*\(/i
    ];
    const remoteExecutionBridgeRegexes = [
        /(?<!["'`])\bexec\s*\(/i,
        /(?<!["'`])\beval\s*\(/i,
        /(?<!["'`])\bcompile\s*\(/i,
        /(?<!["'`])\bimportlib\.(?:import_module|reload)\s*\(/i,
        /(?<!["'`])\brunpy\.(?:run_module|run_path)\s*\(/i,
        /(?<!["'`])\bmarshal\.loads\s*\(/i,
        /(?<!["'`])\bbase64\.b64decode\s*\(/i,
        /(?<!["'`])\bzlib\.decompress\s*\(/i,
        /(?<!["'`])\bcodecs\.decode\s*\(/i
    ];
    const remoteFetchMatches = findMatchingPaths(sampledFiles, remoteFetchRegexes);
    const remoteExecBridgeMatches = findMatchingPaths(sampledFiles, remoteExecutionBridgeRegexes);

    addFinding(
        'dynamic_exec',
        'critical',
        'Динамическое выполнение кода',
        'Найдены конструкции, которые действительно выполняют код во время работы программы.',
        dynamicExecRegexes
    );

    if (remoteFetchMatches.length > 0 && remoteExecBridgeMatches.length > 0) {
        findings.push({
            key: 'download_exec',
            severity: 'critical',
            title: 'Загрузка и запуск кода снаружи',
            detail: 'Есть сочетание сетевой загрузки и последующего выполнения или динамической подгрузки кода.',
            paths: Array.from(new Set([...remoteFetchMatches, ...remoteExecBridgeMatches])).slice(0, 6)
        });
    }

    addFinding(
        'destructive_fs',
        'high',
        'Агрессивные файловые операции',
        'Есть реальные вызовы удаления файлов или каталогов без явного безопасного контура.',
        [
            /(?<!["'`])\bshutil\.rmtree\s*\(/i,
            /(?<!["'`])\bos\.(?:remove|unlink|rmdir)\s*\(/i,
            /(?<!["'`])\.[A-Za-z_][A-Za-z0-9_]*\.unlink\s*\(/i,
            /(?<!["'`])\.[A-Za-z_][A-Za-z0-9_]*\.rmdir\s*\(/i,
            /(?<!["'`])\bpathlib\.[A-Za-z_][A-Za-z0-9_]*\.unlink\s*\(/i
        ]
    );

    addFinding(
        'persistence',
        'medium',
        'Закрепление в системе',
        'Есть реальные обращения к механизмам автозапуска или постоянного закрепления в системе.',
        [
            /(?<!["'`])\bimport\s+winreg\b/i,
            /(?<!["'`])\bwinreg\./i,
            /(?<!["'`])\bcrontab\b/i,
            /(?<!["'`])\bschtasks\b/i
        ]
    );

    addFinding(
        'privilege',
        'medium',
        'Повышение привилегий',
        'Есть признаки запуска с повышенными правами или обращения к системным API.',
        [
            /(?<!["'`])\bctypes\.windll\b/i,
            /(?<!["'`])\bShellExecuteW\s*\(/i,
            /(?<!["'`])\bpkexec\b/i,
            /(?<!["'`])\bsudo\b/i
        ]
    );

    addFinding(
        'obfuscation',
        'medium',
        'Сокрытие логики',
        'Есть признаки декодирования или распаковки полезной нагрузки во время работы.',
        [
            /[A-Za-z0-9+/]{180,}={0,2}/,
            /(?<!["'`])\bbase64\.b64decode\s*\(/i,
            /(?<!["'`])\bmarshal\.loads\s*\(/i,
            /(?<!["'`])\bzlib\.decompress\s*\(/i,
            /(?<!["'`])\bbinascii\.(?:a2b_|unhexlify)\w*\s*\(/i,
            /(?<!["'`])\bcodecs\.decode\s*\(/i
        ],
        { codeOnly: false }
    );

    const secretAccessRegexes = [
        /(?<!["'`])\bos\.getenv\s*\(/i,
        /(?<!["'`])\bos\.environ\b/i,
        /(?<!["'`])\bprocess\.env\b/i
    ];
    const outboundRegexes = [
        /(?<!["'`])\brequests\.(?:post|put|patch|request)\s*\(/i,
        /(?<!["'`])\bhttpx\.(?:post|put|patch|request)\s*\(/i,
        /(?<!["'`])\bfetch\s*\(/i
    ];
    const secretMatches = findMatchingPaths(sampledFiles, secretAccessRegexes);
    const outboundMatches = findMatchingPaths(sampledFiles, outboundRegexes);
    if (secretMatches.length > 0 && outboundMatches.length > 0) {
        findings.push({
            key: 'token_access',
            severity: 'medium',
            title: 'Передача секретов наружу',
            detail: 'Есть сочетание доступа к переменным окружения или токенам и сетевой отправки данных.',
            paths: Array.from(new Set([...secretMatches, ...outboundMatches])).slice(0, 6)
        });
    }

    const hardSignals = inferRiskSignals(paths, sampledFiles);
    const criticalFindings = findings.filter((finding) => finding.severity === 'critical');
    const highFindings = findings.filter((finding) => finding.severity === 'high');
    const riskScore = Math.min(98, hardSignals.length * 18 + criticalFindings.length * 18 + highFindings.length * 10 + findings.length * 4);
    return {
        findings,
        hardSignals,
        riskScore,
        criticalCount: criticalFindings.length,
        highCount: highFindings.length
    };
}

function tryParseJsonBlock(content) {
    const raw = String(content || '').trim();
    if (!raw) {
        return null;
    }
    const fenced = raw.match(/```(?:json)?\s*([\s\S]+?)```/i);
    const source = fenced ? fenced[1] : raw;
    const firstBrace = source.indexOf('{');
    const lastBrace = source.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }
    try {
        return JSON.parse(source.slice(firstBrace, lastBrace + 1));
    } catch (_) {
        return null;
    }
}

async function callVerificationAi(payload) {
    try {
        return await reviewVerifiedRepositoryWithAi(payload);
    } catch (error) {
        if (error?.code === 'AI_REVIEW_NOT_CONFIGURED') {
            error.code = 'VERIFICATION_AI_NOT_CONFIGURED';
        } else if (error?.code === 'AI_REVIEW_INVALID' || error?.code === 'AI_REVIEW_EMPTY') {
            error.code = 'VERIFICATION_AI_INVALID_RESPONSE';
        } else if (!error?.code) {
            error.code = 'VERIFICATION_AI_REQUEST_FAILED';
        }
        throw error;
    }
}

function inferRiskSignals(paths, sampledFiles) {
    const lowerPaths = paths.map((path) => String(path || '').toLowerCase());
    const codeTexts = sampledFiles
        .filter((file) => isCodeLikePath(file.path) && !NON_BEHAVIORAL_PATH_RE.test(String(file.path || '').toLowerCase()))
        .map((file) => file.content)
        .join('\n')
        .toLowerCase();
    const triggered = [];
    for (const keyword of HARD_BLOCK_KEYWORDS) {
        const compact = keyword.replace(/\s+/g, '');
        const pattern = new RegExp(`(?<!["'\`])\\b${compact.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}\\b`, 'i');
        if (
            pattern.test(codeTexts)
            || lowerPaths.some((path) => isCodeLikePath(path) && !NON_BEHAVIORAL_PATH_RE.test(path) && (path.includes(compact) || path.includes(keyword)))
        ) {
            triggered.push(keyword);
        }
    }
    return triggered.slice(0, 12);
}

function buildPublicSummary({ appName, repositoryRef, artifactFileName, hardSignals }) {
    if (hardSignals.length > 0) {
        return `${appName}: автоматическая проверка остановлена из-за подозрительных признаков.`;
    }
    return `${appName}: репозиторий ${repositoryRef} и релиз ${artifactFileName} прошли базовую серверную проверку.`;
}

function toPrivateRecord(row) {
    if (!row) return null;
    return {
        id: row.id,
        app_name: row.app_name,
        author_name: row.author_name,
        platform: row.platform,
        compatible_platforms: parseCompatiblePlatformsFromRow(row),
        repository_url: row.repository_url,
        release_artifact_url: row.release_artifact_url,
        release_tag: row.release_tag,
        release_name: row.release_name,
        release_asset_name: row.release_asset_name,
        release_published_at: row.release_published_at,
        official_site_url: row.official_site_url,
        project_description: row.project_description,
        avatar_url: row.avatar_url,
        status: row.status,
        sha256: row.sha256,
        artifact_file_name: row.artifact_file_name,
        artifact_size_bytes: row.artifact_size_bytes,
        artifact_content_type: row.artifact_content_type,
        risk_score: Number(row.risk_score || 0),
        public_summary: row.public_summary,
        error_message: row.error_message,
        queued_at: row.queued_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
        verified_at: row.verified_at,
        created_at: row.created_at,
        updated_at: row.updated_at,
        findings: parseJson(row.findings_json),
        summary: parseJson(row.summary_json)
    };
}

function toPublicRecord(row) {
    if (!row) return null;
    return {
        id: row.id,
        app_name: row.app_name,
        author_name: row.author_name,
        platform: row.platform,
        compatible_platforms: parseCompatiblePlatformsFromRow(row),
        avatar_url: row.avatar_url,
        public_summary: row.public_summary,
        verified_at: row.verified_at,
        repository_url: row.repository_url,
        official_site_url: row.official_site_url,
        release_artifact_url: row.release_artifact_url,
        release_name: row.release_name,
        release_asset_name: row.release_asset_name,
        project_description: row.project_description,
        artifact_file_name: row.artifact_file_name,
        artifact_size_bytes: row.artifact_size_bytes,
        release_tag: row.release_tag,
        status: row.status
    };
}

function parseJson(value) {
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch (_) {
        return null;
    }
}

async function getLastDeveloperApplication(userId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT id, user_id, applicant_name, applicant_email, message, status, created_at, updated_at, mailed_at, reviewed_at, review_note
         FROM developer_applications
         WHERE user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
    );
    return rows[0] || null;
}

async function getDeveloperApplicationById(applicationId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT id, user_id, applicant_name, applicant_email, message, status, created_at, updated_at, mailed_at, reviewed_at, review_note
         FROM developer_applications
         WHERE id = ?
         LIMIT 1`,
        [applicationId]
    );
    return rows[0] || null;
}

async function getDeveloperApplicationStats(userId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT
            SUM(CASE WHEN status = 'SAFE' THEN 1 ELSE 0 END) AS safe_count,
            SUM(CASE WHEN status = 'RUNNING' THEN 1 ELSE 0 END) AS running_count,
            SUM(CASE WHEN status = 'QUEUED' THEN 1 ELSE 0 END) AS queued_count,
            SUM(CASE WHEN status = 'FAILED' THEN 1 ELSE 0 END) AS failed_count,
            COUNT(*) AS total_count
         FROM verified_apps
         WHERE owner_user_id = ?`,
        [userId]
    );
    const row = rows[0] || {};
    return {
        total: Number(row.total_count || 0),
        safe: Number(row.safe_count || 0),
        running: Number(row.running_count || 0),
        queued: Number(row.queued_count || 0),
        failed: Number(row.failed_count || 0)
    };
}

async function getDeveloperStatus(userId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const user = await fetchUserById(userId, { db, includeCreatedAt: true });
    if (!user) {
        return null;
    }
    const lastApplication = await getLastDeveloperApplication(userId, db);
    const stats = await getDeveloperApplicationStats(userId, db);
    return {
        user: sanitizeAccountUser(user),
        developer: {
            is_verified_developer: Boolean(user.is_verified_developer),
            verified_developer_at: user.verified_developer_at ?? null,
            has_pending_application: Boolean(lastApplication && lastApplication.status === 'PENDING_REVIEW'),
            last_application: lastApplication
                ? {
                    id: lastApplication.id,
                    status: lastApplication.status,
                    message: lastApplication.message,
                    created_at: lastApplication.created_at,
                    updated_at: lastApplication.updated_at,
                    mailed_at: lastApplication.mailed_at,
                    reviewed_at: lastApplication.reviewed_at,
                    review_note: lastApplication.review_note
                }
                : null
        },
        stats
    };
}

function renderMailShell({ title, bodyHtml }) {
    return `
        <div style="background:#111315;padding:28px 16px;font-family:Segoe UI,Arial,sans-serif;color:#eef1ef;">
            <div style="max-width:640px;margin:0 auto;background:#181b1e;border-radius:22px;padding:28px;border:1px solid rgba(255,255,255,0.08);">
                <div style="font-size:12px;letter-spacing:0.08em;text-transform:uppercase;color:#8b9298;margin-bottom:10px;">NeuralV</div>
                <h1 style="margin:0 0 14px;font-size:26px;line-height:1.15;color:#f4f6f5;">${title}</h1>
                <div style="font-size:15px;line-height:1.7;color:#cfd5d1;">${bodyHtml}</div>
            </div>
        </div>
    `;
}

async function sendDeveloperApplicationEmail({ user, application, adminEmail }) {
    const approveUrl = buildDeveloperApplicationActionUrl(application, 'approve');
    const rejectUrl = buildDeveloperApplicationActionUrl(application, 'reject');
    const detailsHtml = [
        `<p style="margin:0 0 10px;"><strong>Пользователь:</strong> ${escapeHtml(user.name)}</p>`,
        `<p style="margin:0 0 10px;"><strong>E-mail:</strong> ${escapeHtml(user.email)}</p>`,
        `<p style="margin:0 0 10px;"><strong>User ID:</strong> ${escapeHtml(user.id)}</p>`,
        application.message
            ? `<p style="margin:16px 0 0;"><strong>Сообщение:</strong><br>${escapeHtml(application.message)}</p>`
            : '<p style="margin:16px 0 0;color:#98a19d;">Сообщение не указано.</p>',
        `<div style="margin:20px 0 0;display:flex;gap:12px;flex-wrap:wrap;">
            <a href="${escapeHtml(approveUrl)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#1f8f52;color:#f7fffb;text-decoration:none;font-weight:700;">Принять</a>
            <a href="${escapeHtml(rejectUrl)}" style="display:inline-block;padding:12px 18px;border-radius:999px;background:#b53434;color:#fff7f7;text-decoration:none;font-weight:700;">Отклонить</a>
        </div>`
    ].join('');

    await sendMail({
        to: adminEmail,
        replyTo: user.email,
        subject: `NeuralV: заявка разработчика от ${user.email}`,
        text: [
            'Новая заявка разработчика.',
            `Имя: ${user.name}`,
            `E-mail: ${user.email}`,
            `User ID: ${user.id}`,
            application.message ? `Сообщение: ${application.message}` : 'Сообщение не указано.',
            `Принять: ${approveUrl}`,
            `Отклонить: ${rejectUrl}`
        ].join('\n'),
        html: renderMailShell({
            title: 'Новая заявка разработчика',
            bodyHtml: detailsHtml
        })
    });
}

function buildDeveloperApplicationActionToken(application, action) {
    const secret = getDeveloperApplicationActionSecret();
    if (!secret) {
        const error = new Error('Developer application action secret is not configured');
        error.code = 'DEVELOPER_APPLICATION_ACTION_SECRET_NOT_CONFIGURED';
        throw error;
    }

    const payload = [
        String(application.id || ''),
        String(application.user_id || ''),
        String(application.created_at || ''),
        String(action || '').trim().toLowerCase()
    ].join(':');

    return crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');
}

function buildDeveloperApplicationActionUrl(application, action) {
    const normalizedAction = String(action || '').trim().toLowerCase();
    const token = buildDeveloperApplicationActionToken(application, normalizedAction);
    return `${developerApplicationActionBaseUrl()}/verified-apps/developer/applications/${encodeURIComponent(application.id)}/${encodeURIComponent(normalizedAction)}?token=${encodeURIComponent(token)}`;
}

async function reviewDeveloperApplicationAction(applicationId, action, token, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const normalizedAction = String(action || '').trim().toLowerCase();
    if (!['approve', 'reject'].includes(normalizedAction)) {
        const error = new Error('Unsupported developer application action');
        error.code = 'DEVELOPER_APPLICATION_ACTION_INVALID';
        throw error;
    }

    const application = await getDeveloperApplicationById(applicationId, db);
    if (!application) {
        const error = new Error('Developer application not found');
        error.code = 'DEVELOPER_APPLICATION_NOT_FOUND';
        throw error;
    }

    const expectedToken = buildDeveloperApplicationActionToken(application, normalizedAction);
    const left = Buffer.from(String(token || ''), 'utf8');
    const right = Buffer.from(expectedToken, 'utf8');
    if (left.length !== right.length || !crypto.timingSafeEqual(left, right)) {
        const error = new Error('Developer application action token is invalid');
        error.code = 'DEVELOPER_APPLICATION_ACTION_INVALID_TOKEN';
        throw error;
    }

    if (application.status !== 'PENDING_REVIEW') {
        const error = new Error('Developer application already reviewed');
        error.code = 'DEVELOPER_APPLICATION_ALREADY_REVIEWED';
        error.application = application;
        throw error;
    }

    const connection = await db.getConnection();
    try {
        await connection.beginTransaction();

        const freshApplication = await getDeveloperApplicationById(applicationId, connection);
        if (!freshApplication) {
            const error = new Error('Developer application not found');
            error.code = 'DEVELOPER_APPLICATION_NOT_FOUND';
            throw error;
        }
        if (freshApplication.status !== 'PENDING_REVIEW') {
            const error = new Error('Developer application already reviewed');
            error.code = 'DEVELOPER_APPLICATION_ALREADY_REVIEWED';
            error.application = freshApplication;
            throw error;
        }

        const reviewedAt = nowMs();
        const nextStatus = normalizedAction === 'approve' ? 'APPROVED' : 'REJECTED';
        const reviewNote = normalizedAction === 'approve'
            ? 'Подтверждено из письма.'
            : 'Отклонено из письма.';

        await connection.query(
            `UPDATE developer_applications
             SET status = ?, reviewed_at = ?, review_note = ?, updated_at = ?
             WHERE id = ?`,
            [nextStatus, reviewedAt, reviewNote, reviewedAt, applicationId]
        );

        if (normalizedAction === 'approve') {
            await connection.query(
                `UPDATE users
                 SET is_verified_developer = 1,
                     verified_developer_at = ?,
                     updated_at = ?
                 WHERE id = ?`,
                [reviewedAt, reviewedAt, freshApplication.user_id]
            );
        }

        await connection.commit();
    } catch (error) {
        await connection.rollback().catch(() => {});
        throw error;
    } finally {
        connection.release();
    }

    return getDeveloperApplicationById(applicationId, db);
}

function escapeHtml(value) {
    return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

async function createDeveloperApplication(userId, { message }, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const adminEmail = adminDeveloperApplicationsEmail();
    if (!adminEmail) {
        const error = new Error('Developer application email is not configured');
        error.code = 'DEVELOPER_APPLICATION_EMAIL_NOT_CONFIGURED';
        throw error;
    }
    if (!isMailConfigured()) {
        const error = new Error('Mail service is not configured');
        error.code = 'MAIL_NOT_CONFIGURED';
        throw error;
    }

    const user = await fetchUserById(userId, { db, includeCreatedAt: true });
    if (!user) {
        const error = new Error('User not found');
        error.code = 'USER_NOT_FOUND';
        throw error;
    }
    if (user.is_verified_developer) {
        const error = new Error('Developer status already granted');
        error.code = 'ALREADY_VERIFIED_DEVELOPER';
        throw error;
    }

    const lastApplication = await getLastDeveloperApplication(userId, db);
    if (lastApplication && lastApplication.status === 'PENDING_REVIEW') {
        const error = new Error('Developer application already pending');
        error.code = 'DEVELOPER_APPLICATION_ALREADY_PENDING';
        throw error;
    }
    if (lastApplication && nowMs() - Number(lastApplication.created_at || 0) < DEVELOPER_APPLICATION_COOLDOWN_MS) {
        const error = new Error('Developer application cooldown active');
        error.code = 'DEVELOPER_APPLICATION_COOLDOWN';
        error.retryAfterMs = Math.max(0, DEVELOPER_APPLICATION_COOLDOWN_MS - (nowMs() - Number(lastApplication.created_at || 0)));
        throw error;
    }

    const application = {
        id: uuidv4(),
        user_id: user.id,
        applicant_name: user.name,
        applicant_email: user.email,
        message: normalizeOptionalMessage(message),
        status: 'PENDING_REVIEW',
        created_at: nowMs(),
        updated_at: nowMs()
    };

    await db.query(
        `INSERT INTO developer_applications
         (id, user_id, applicant_name, applicant_email, message, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            application.id,
            application.user_id,
            application.applicant_name,
            application.applicant_email,
            application.message,
            application.status,
            application.created_at,
            application.updated_at
        ]
    );

    queueMailTask(`developer-application:${application.id}`, async () => {
        try {
            await sendDeveloperApplicationEmail({ user, application, adminEmail });
            await db.query(
                'UPDATE developer_applications SET mailed_at = ?, updated_at = ? WHERE id = ?',
                [nowMs(), nowMs(), application.id]
            );
        } catch (error) {
            console.error('Developer application email failed:', error);
        }
    });

    return {
        id: application.id,
        status: application.status,
        message: application.message,
        created_at: application.created_at,
        updated_at: application.updated_at
    };
}

async function listMyVerifiedApps(userId, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT *
         FROM verified_apps
         WHERE owner_user_id = ?
         ORDER BY created_at DESC`,
        [userId]
    );
    return rows.map(toPrivateRecord);
}

async function listPublicVerifiedApps({ platform = null, limit = 24, db = pool } = {}) {
    await ensureVerifiedAppsSchema(db);
    const normalizedLimit = Math.min(60, Math.max(1, parseInt(limit, 10) || 24));
    const clauses = [`status = 'SAFE'`];
    const params = [];
    const normalizedPlatform = normalizePlatform(platform);
    if (normalizedPlatform && validatePlatform(normalizedPlatform)) {
        clauses.push('(platform = ? OR platform_compatibility_json LIKE ?)');
        params.push(normalizedPlatform, `%"${normalizedPlatform}"%`);
    }

    const [rows] = await db.query(
        `SELECT *
         FROM verified_apps
         WHERE ${clauses.join(' AND ')}
         ORDER BY verified_at DESC, created_at DESC
         LIMIT ?`,
        [...params, normalizedLimit]
    );
    return rows.map(toPublicRecord);
}

async function fetchVerifiedAppById(id, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        'SELECT * FROM verified_apps WHERE id = ? LIMIT 1',
        [id]
    );
    return rows[0] || null;
}

async function fetchPublicVerifiedAppById(id, db = pool) {
    const row = await fetchVerifiedAppById(id, db);
    if (!row || String(row.status || '').toUpperCase() !== 'SAFE') {
        return null;
    }
    return toPublicRecord(row);
}

async function fetchLatestVerifiedAppByRepository(userId, repositoryUrl, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT *
         FROM verified_apps
         WHERE owner_user_id = ? AND repository_url = ?
         ORDER BY updated_at DESC, created_at DESC
         LIMIT 1`,
        [userId, repositoryUrl]
    );
    return rows[0] || null;
}

function sameReleaseSelection(existing, release, asset) {
    const existingArtifactUrl = normalizeUrl(existing?.release_artifact_url);
    const nextArtifactUrl = normalizeUrl(asset?.browserDownloadUrl);
    const existingArtifactSize = Number(existing?.artifact_size_bytes || 0);
    const nextArtifactSize = Number(asset?.size || 0);
    const existingPublishedAt = Number(existing?.release_published_at || 0);
    const nextPublishedAt = Number(release?.publishedAt || 0);
    if (existingArtifactUrl && nextArtifactUrl && existingArtifactUrl === nextArtifactUrl) {
        if (existingArtifactSize > 0 && nextArtifactSize > 0 && existingArtifactSize !== nextArtifactSize) {
            return false;
        }
        if (existingPublishedAt > 0 && nextPublishedAt > 0 && existingPublishedAt !== nextPublishedAt) {
            return false;
        }
        return true;
    }

    const existingTag = normalizeReleaseTag(existing?.release_tag);
    const nextTag = normalizeReleaseTag(release?.tagName);
    const existingAssetName = normalizeReleaseAssetName(existing?.release_asset_name);
    const nextAssetName = normalizeReleaseAssetName(asset?.name);
    if (!(existingTag && nextTag && existingAssetName && nextAssetName && existingTag === nextTag && existingAssetName === nextAssetName)) {
        return false;
    }
    if (existingArtifactSize > 0 && nextArtifactSize > 0 && existingArtifactSize !== nextArtifactSize) {
        return false;
    }
    if (existingPublishedAt > 0 && nextPublishedAt > 0 && existingPublishedAt !== nextPublishedAt) {
        return false;
    }
    return true;
}

function requireAppName(value) {
    const normalized = normalizeAppName(value);
    if (!normalized) {
        const error = new Error('Application name is required');
        error.code = 'APP_NAME_REQUIRED';
        throw error;
    }
    return normalized;
}

async function queueExistingVerificationUpdate(existing, {
    repo,
    selectedRelease,
    selectedAsset,
    selectedPlatform,
    compatiblePlatforms,
    appName,
    officialSiteUrl,
    projectDescription,
    user
}, db = pool) {
    const compatibilityJson = serializeCompatiblePlatforms(selectedPlatform, compatiblePlatforms);
    const now = nowMs();
    await db.query(
        `UPDATE verified_apps
         SET repository_url = ?,
             repository_owner = ?,
             repository_name = ?,
             repository_default_branch = NULL,
             release_artifact_url = ?,
             release_tag = ?,
             release_name = ?,
             release_asset_name = ?,
             release_published_at = ?,
             official_site_url = ?,
             project_description = ?,
             platform = ?,
             platform_compatibility_json = ?,
             app_name = ?,
             author_name = ?,
             status = 'QUEUED',
             sha256 = NULL,
             artifact_file_name = NULL,
             artifact_size_bytes = NULL,
             artifact_content_type = NULL,
             risk_score = 0,
             summary_json = NULL,
             findings_json = NULL,
             public_summary = NULL,
             error_message = NULL,
             queued_at = ?,
             started_at = NULL,
             completed_at = NULL,
             verified_at = NULL,
             updated_at = ?
         WHERE id = ?`,
        [
            repo.canonicalUrl,
            repo.owner,
            repo.repo,
            selectedAsset.browserDownloadUrl,
            selectedRelease.tagName,
            selectedRelease.name,
            selectedAsset.name,
            selectedRelease.publishedAt,
            officialSiteUrl || null,
            projectDescription,
            selectedPlatform,
            compatibilityJson,
            appName,
            String(user.name || '').slice(0, 120) || 'Unknown',
            now,
            now,
            existing.id
        ]
    );

    enqueueVerificationJob(existing.id);
    return toPrivateRecord(await fetchVerifiedAppById(existing.id, db));
}

async function createVerificationJob(userId, input, db = pool) {
    await ensureVerifiedAppsSchema(db);
    if (!isVerifiedAppsAiConfigured()) {
        const error = new Error('AI review is not configured');
        error.code = 'VERIFICATION_AI_NOT_CONFIGURED';
        throw error;
    }
    const user = await fetchUserById(userId, { db });
    if (!user) {
        const error = new Error('User not found');
        error.code = 'USER_NOT_FOUND';
        throw error;
    }
    if (!user.is_verified_developer) {
        const error = new Error('Developer verification required');
        error.code = 'VERIFIED_DEVELOPER_REQUIRED';
        throw error;
    }

    const platformOverride = normalizePlatform(input.platform || input.platform_override);
    if (platformOverride && !validatePlatform(platformOverride)) {
        const error = new Error('Unsupported platform');
        error.code = 'UNSUPPORTED_PLATFORM';
        throw error;
    }

    const requiredAppName = requireAppName(input.app_name);
    const compatiblePlatformsInput = parseCompatiblePlatformsInput(
        Object.prototype.hasOwnProperty.call(input || {}, 'compatible_platforms')
            ? input.compatible_platforms
            : input.platforms
    );
    if (compatiblePlatformsInput.invalid.length > 0) {
        const error = new Error('Unsupported compatible platform');
        error.code = 'UNSUPPORTED_PLATFORM';
        throw error;
    }
    const projectDescription = normalizeProjectDescription(input.project_description || input.description);
    const releaseTag = normalizeReleaseTag(input.release_tag);
    const releaseAssetName = normalizeReleaseAssetName(input.release_asset_name);

    const officialSiteUrl = normalizeUrl(input.official_site_url);
    if (officialSiteUrl) {
        try {
            const parsed = new URL(officialSiteUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                throw new Error('unsupported');
            }
        } catch (_) {
            const error = new Error('Invalid official site URL');
            error.code = 'INVALID_OFFICIAL_SITE_URL';
            throw error;
        }
    }

    const discovery = await discoverVerificationSubmission({
        repositoryUrl: input.repository_url,
        appName: requiredAppName,
        platform: platformOverride,
        releaseTag,
        releaseAssetName
    });
    const repo = discovery.repoMeta;
    const appName = discovery.appName;
    const selectedPlatform = discovery.platform;
    const selectedRelease = discovery.release;
    const selectedAsset = discovery.asset;
    const compatiblePlatforms = ensureCompatiblePlatforms(selectedPlatform, compatiblePlatformsInput.platforms);
    const existingByRepo = await fetchLatestVerifiedAppByRepository(userId, repo.canonicalUrl, db);

    if (existingByRepo) {
        if (['QUEUED', 'RUNNING'].includes(String(existingByRepo.status || '').toUpperCase())) {
            return {
                kind: 'in_progress',
                app: toPrivateRecord(existingByRepo),
                message: 'Текущая проверка этого приложения ещё не завершилась.'
            };
        }

        if (sameReleaseSelection(existingByRepo, selectedRelease, selectedAsset)) {
            return {
                kind: 'no_update',
                app: toPrivateRecord(existingByRepo),
                message: 'Нового релиза для повторной проверки пока нет.'
            };
        }

        const app = await queueExistingVerificationUpdate(existingByRepo, {
            repo,
            selectedRelease,
            selectedAsset,
            selectedPlatform,
            compatiblePlatforms,
            appName,
            officialSiteUrl,
            projectDescription,
            user
        }, db);
        return {
            kind: 'update_queued',
            app,
            message: 'Найден новый релиз. Перепроверка уже запущена.'
        };
    }

    const [activeRows] = await db.query(
        `SELECT COUNT(*) AS active_count
         FROM verified_apps
         WHERE owner_user_id = ?
           AND status IN ('QUEUED', 'RUNNING')`,
        [userId]
    );
    if (Number(activeRows[0]?.active_count || 0) >= VERIFIED_APP_MAX_ACTIVE_PER_USER) {
        const error = new Error('Too many active verification jobs');
        error.code = 'TOO_MANY_ACTIVE_VERIFICATION_JOBS';
        throw error;
    }

    const [recentRows] = await db.query(
        `SELECT id, created_at, status
         FROM verified_apps
         WHERE owner_user_id = ?
         ORDER BY created_at DESC
         LIMIT 1`,
        [userId]
    );
    const recent = recentRows[0];
    if (recent && nowMs() - Number(recent.created_at || 0) < VERIFIED_APP_SUBMIT_COOLDOWN_MS) {
        const error = new Error('Verification submit cooldown active');
        error.code = 'VERIFICATION_SUBMIT_COOLDOWN';
        error.retryAfterMs = Math.max(0, VERIFIED_APP_SUBMIT_COOLDOWN_MS - (nowMs() - Number(recent.created_at || 0)));
        throw error;
    }

    const now = nowMs();
    const id = uuidv4();
    await db.query(
        `INSERT INTO verified_apps
         (id, owner_user_id, repository_url, repository_owner, repository_name, release_artifact_url, release_tag, release_name, release_asset_name, release_published_at, official_site_url, project_description, platform, platform_compatibility_json, app_name, author_name, status, queued_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)`,
        [
            id,
            userId,
            repo.canonicalUrl,
            repo.owner,
            repo.repo,
            selectedAsset.browserDownloadUrl,
            selectedRelease.tagName,
            selectedRelease.name,
            selectedAsset.name,
            selectedRelease.publishedAt,
            officialSiteUrl || null,
            projectDescription,
            selectedPlatform,
            serializeCompatiblePlatforms(selectedPlatform, compatiblePlatforms),
            appName,
            String(user.name || '').slice(0, 120) || 'Unknown',
            now,
            now,
            now
        ]
    );
    enqueueVerificationJob(id);
    return {
        kind: 'created',
        app: toPrivateRecord(await fetchVerifiedAppById(id, db)),
        message: 'Проверка запущена. Сервер сам разберёт репозиторий, релизы и соберёт итог в списке.'
    };
}

async function checkVerificationJobUpdate(userId, appId, input = {}, db = pool) {
    await ensureVerifiedAppsSchema(db);
    if (!isVerifiedAppsAiConfigured()) {
        const error = new Error('AI review is not configured');
        error.code = 'VERIFICATION_AI_NOT_CONFIGURED';
        throw error;
    }

    const user = await fetchUserById(userId, { db });
    if (!user) {
        const error = new Error('User not found');
        error.code = 'USER_NOT_FOUND';
        throw error;
    }
    if (!user.is_verified_developer) {
        const error = new Error('Developer verification required');
        error.code = 'VERIFIED_DEVELOPER_REQUIRED';
        throw error;
    }

    const existing = await fetchVerifiedAppById(appId, db);
    if (!existing || String(existing.owner_user_id || '') !== String(userId || '')) {
        const error = new Error('Verified app not found');
        error.code = 'VERIFIED_APP_NOT_FOUND';
        throw error;
    }

    if (['QUEUED', 'RUNNING'].includes(String(existing.status || '').toUpperCase())) {
        return {
            kind: 'in_progress',
            app: toPrivateRecord(existing),
            message: 'Текущая проверка этого приложения ещё не завершилась.'
        };
    }

    const platformOverride = normalizePlatform(input.platform || input.platform_override || existing.platform);
    if (platformOverride && !validatePlatform(platformOverride)) {
        const error = new Error('Unsupported platform');
        error.code = 'UNSUPPORTED_PLATFORM';
        throw error;
    }

    const officialSiteUrl = normalizeUrl(input.official_site_url || existing.official_site_url);
    if (officialSiteUrl) {
        try {
            const parsed = new URL(officialSiteUrl);
            if (!['http:', 'https:'].includes(parsed.protocol)) {
                throw new Error('unsupported');
            }
        } catch (_) {
            const error = new Error('Invalid official site URL');
            error.code = 'INVALID_OFFICIAL_SITE_URL';
            throw error;
        }
    }

    const projectDescription = normalizeProjectDescription(
        Object.prototype.hasOwnProperty.call(input || {}, 'project_description')
            ? input.project_description
            : (Object.prototype.hasOwnProperty.call(input || {}, 'description') ? input.description : existing.project_description)
    );
    const compatiblePlatformsInput = parseCompatiblePlatformsInput(
        Object.prototype.hasOwnProperty.call(input || {}, 'compatible_platforms')
            ? input.compatible_platforms
            : input.platforms
    );
    if (compatiblePlatformsInput.invalid.length > 0) {
        const error = new Error('Unsupported compatible platform');
        error.code = 'UNSUPPORTED_PLATFORM';
        throw error;
    }
    const releaseTag = normalizeReleaseTag(input.release_tag);
    const releaseAssetName = normalizeReleaseAssetName(input.release_asset_name);
    const requestedAppName = normalizeAppName(input.app_name) || normalizeAppName(existing.app_name) || 'NeuralV App';

    const discovery = await discoverVerificationSubmission({
        repositoryUrl: existing.repository_url,
        appName: requestedAppName,
        platform: platformOverride,
        releaseTag,
        releaseAssetName
    });

    if (sameReleaseSelection(existing, discovery.release, discovery.asset)) {
        return {
            kind: 'no_update',
            app: toPrivateRecord(existing),
            message: 'Нового релиза для повторной проверки пока нет.'
        };
    }

    const compatiblePlatforms = compatiblePlatformsInput.provided
        ? ensureCompatiblePlatforms(discovery.platform, compatiblePlatformsInput.platforms)
        : parseCompatiblePlatformsFromRow(existing);

    const app = await queueExistingVerificationUpdate(existing, {
        repo: discovery.repoMeta,
        selectedRelease: discovery.release,
        selectedAsset: discovery.asset,
        selectedPlatform: discovery.platform,
        compatiblePlatforms,
        appName: requestedAppName,
        officialSiteUrl,
        projectDescription,
        user
    }, db);

    return {
        kind: 'update_queued',
        app,
        message: 'Найден новый релиз. Перепроверка уже запущена.'
    };
}

async function updateJobStatus(id, values, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const assignments = [];
    const params = [];
    for (const [key, value] of Object.entries(values)) {
        assignments.push(`${key} = ?`);
        params.push(value);
    }
    assignments.push('updated_at = ?');
    params.push(nowMs());
    params.push(id);
    await db.query(
        `UPDATE verified_apps
         SET ${assignments.join(', ')}
         WHERE id = ?`,
        params
    );
}

function enqueueVerificationJob(id) {
    if (!id || queuedIds.has(id)) {
        return;
    }
    queuedIds.add(id);
    if (!queueDrainPromise) {
        queueDrainPromise = drainQueue().finally(() => {
            queueDrainPromise = null;
        });
    }
}

async function drainQueue() {
    while (queuedIds.size > 0 && activeWorkers < VERIFIED_APP_QUEUE_CONCURRENCY) {
        const nextId = queuedIds.values().next().value;
        queuedIds.delete(nextId);
        activeWorkers += 1;
        processVerificationJob(nextId)
            .catch((error) => {
                console.error(`Verified app job ${nextId} failed:`, error);
            })
            .finally(() => {
                activeWorkers = Math.max(0, activeWorkers - 1);
                if (queuedIds.size > 0) {
                    setImmediate(() => {
                        if (!queueDrainPromise) {
                            queueDrainPromise = drainQueue().finally(() => {
                                queueDrainPromise = null;
                            });
                        }
                    });
                }
            });
    }
}

async function processVerificationJob(id, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const job = await fetchVerifiedAppById(id, db);
    if (!job || !['QUEUED', 'RUNNING'].includes(String(job.status || ''))) {
        return;
    }

    const startedAt = nowMs();
    await updateJobStatus(id, {
        status: 'RUNNING',
        started_at: startedAt,
        completed_at: null,
        error_message: null
    }, db);

    try {
        const analysis = await analyzeVerificationCandidate(job);
        await updateJobStatus(id, {
            status: analysis.status,
            repository_default_branch: analysis.summary.repo.default_branch || null,
            release_artifact_url: analysis.releaseArtifactUrl || job.release_artifact_url || '',
            release_tag: analysis.releaseTag || job.release_tag || null,
            release_name: analysis.releaseName || null,
            release_asset_name: analysis.releaseAssetName || null,
            release_published_at: analysis.releasePublishedAt || null,
            platform: analysis.platform || job.platform,
            platform_compatibility_json: serializeCompatiblePlatforms(analysis.platform || job.platform, analysis.compatiblePlatforms),
            app_name: analysis.appName || job.app_name,
            avatar_url: analysis.avatarUrl,
            sha256: analysis.artifact.sha256,
            artifact_file_name: analysis.artifact.fileName,
            artifact_size_bytes: analysis.artifact.sizeBytes,
            artifact_content_type: analysis.artifact.contentType,
            risk_score: analysis.riskScore,
            public_summary: analysis.publicSummary,
            summary_json: JSON.stringify(analysis.summary),
            findings_json: JSON.stringify(analysis.findings),
            error_message: analysis.status === 'FAILED' ? analysis.errorMessage : null,
            completed_at: nowMs(),
            verified_at: analysis.status === 'SAFE' ? nowMs() : null
        }, db);
    } catch (error) {
        await updateJobStatus(id, {
            status: 'FAILED',
            error_message: String(error?.message || 'Verification failed').slice(0, 255),
            completed_at: nowMs(),
            verified_at: null
        }, db);
    }
}

async function analyzeVerificationCandidate(job) {
    const repoMeta = parseGithubRepo(job.repository_url);
    if (!repoMeta) {
        throw new Error('Stored repository URL is invalid');
    }

    const repo = await fetchJson(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repoMeta.owner)}/${encodeURIComponent(repoMeta.repo)}`,
        { headers: githubHeaders() }
    );
    if (repo.private) {
        throw new Error('Private repositories are not supported');
    }
    if (!repo.default_branch) {
        throw new Error('Repository default branch is unavailable');
    }

    const releases = await fetchGithubReleaseCatalog(repoMeta);

    const tree = await fetchJson(
        `${GITHUB_API_BASE}/repos/${encodeURIComponent(repoMeta.owner)}/${encodeURIComponent(repoMeta.repo)}/git/trees/${encodeURIComponent(repo.default_branch)}?recursive=1`,
        { headers: githubHeaders(), timeoutMs: VERIFIED_APP_DOWNLOAD_TIMEOUT_MS }
    );
    const treeEntries = Array.isArray(tree.tree) ? tree.tree : [];
    if (tree.truncated || treeEntries.length > VERIFIED_APP_MAX_REPO_TREE_ENTRIES) {
        throw new Error(`Repository is too large for automatic verification (${treeEntries.length} files)`);
    }

    const blobPaths = treeEntries
        .filter((entry) => entry && entry.type === 'blob' && typeof entry.path === 'string')
        .map((entry) => entry.path);

    const inferredPlatform = inferPlatformFromRepo({
        paths: blobPaths,
        releases,
        description: repo.description,
        ownerRepo: `${repoMeta.owner}/${repoMeta.repo}`
    });
    const targetPlatform = validatePlatform(normalizePlatform(job.platform))
        ? normalizePlatform(job.platform)
        : inferredPlatform.platform;

    const storedSelection = releases
        .map((release) => ({
            release,
            asset: release.assets.find((asset) => asset.browserDownloadUrl === job.release_artifact_url) || null
        }))
        .find((entry) => entry.asset);
    const selectedRelease = storedSelection || chooseReleaseAsset(releases, {
            platform: targetPlatform,
            releaseTag: job.release_tag,
            releaseAssetName: job.release_asset_name
        });
    if (!selectedRelease?.asset?.browserDownloadUrl) {
        const error = new Error('Не удалось подобрать релиз с пригодным файлом для проверки.');
        error.code = 'VERIFICATION_RELEASE_NOT_FOUND';
        throw error;
    }

    const artifactUrl = selectedRelease.asset.browserDownloadUrl;
    const artifact = await downloadArtifactAndHash(artifactUrl);
    const textCandidates = buildCandidateTextPaths(blobPaths);
    const sampledFiles = [];
    let totalTextBytes = 0;
    for (const path of textCandidates) {
        try {
            const segments = path.split('/').map((segment) => encodeURIComponent(segment)).join('/');
            const content = await fetchText(
                `https://raw.githubusercontent.com/${encodeURIComponent(repoMeta.owner)}/${encodeURIComponent(repoMeta.repo)}/${encodeURIComponent(repo.default_branch)}/${segments}`
            );
            totalTextBytes += Buffer.byteLength(content, 'utf8');
            if (totalTextBytes > VERIFIED_APP_MAX_TOTAL_TEXT_BYTES) {
                break;
            }
            sampledFiles.push({
                path,
                content,
                contentLower: content.toLowerCase(),
                excerpt: truncateText(content, 1200)
            });
        } catch (_) {
            // ignore unreadable text files
        }
    }

    const serverAnalysis = analyzeSampledFiles(sampledFiles, blobPaths);
    const topLevel = Array.from(new Set(blobPaths.map((path) => String(path).split('/')[0]).filter(Boolean))).slice(0, 40);
    const suspiciousFiles = serverAnalysis.findings.flatMap((finding) => finding.paths || []).slice(0, 18);
    const aiPayload = {
        task: 'security_verification',
        repository: {
            url: repo.canonicalUrl || repo.html_url || repoMeta.canonicalUrl,
            full_name: repo.full_name || `${repoMeta.owner}/${repoMeta.repo}`,
            description: truncateText(repo.description, 400),
            default_branch: repo.default_branch,
            archived: Boolean(repo.archived),
            stars: Number(repo.stargazers_count || 0),
            forks: Number(repo.forks_count || 0),
            topics: Array.isArray(repo.topics) ? repo.topics.slice(0, 20) : [],
            top_level_directories: topLevel,
            total_files: blobPaths.length,
            language_hints: buildRepoLanguageHints(blobPaths)
        },
        user_input: {
            app_name: job.app_name || null,
            official_site_url: job.official_site_url || null,
            description: job.project_description || null,
            platform_override: validatePlatform(normalizePlatform(job.platform)) ? normalizePlatform(job.platform) : null,
            requested_release_tag: job.release_tag || null,
            requested_release_asset_name: job.release_asset_name || null
        },
        releases: releases.map((release) => ({
            tag: release.tagName,
            name: release.name,
            draft: release.draft,
            prerelease: release.prerelease,
            published_at: release.publishedAt,
            asset_count: release.assets.length,
            assets: release.assets.slice(0, 12).map((asset) => ({
                name: asset.name,
                size: asset.size,
                content_type: asset.contentType,
                download_count: asset.downloadCount
            }))
        })),
        selected_release: {
            tag: selectedRelease.release.tagName,
            name: selectedRelease.release.name,
            published_at: selectedRelease.release.publishedAt,
            asset_name: selectedRelease.asset.name,
            asset_size: selectedRelease.asset.size
        },
        server_findings: {
            inferred_platform: inferredPlatform,
            suspicious_files: suspiciousFiles,
            hard_signals: serverAnalysis.hardSignals,
            findings: serverAnalysis.findings
        },
        sampled_files: sampledFiles.slice(0, 22).map((file) => ({
            path: file.path,
            excerpt: file.excerpt
        }))
    };

    const aiResult = await callVerificationAi(aiPayload);
    const aiFindings = [
        ...Array.isArray(aiResult.concerns)
            ? aiResult.concerns.map((item) => ({
                severity: 'high',
                title: truncateText(item, 120),
                detail: truncateText(item, 360),
                paths: []
            }))
            : [],
        ...Array.isArray(aiResult.highlights)
            ? aiResult.highlights.map((item) => ({
                severity: 'low',
                title: truncateText(item, 120),
                detail: '',
                paths: []
            }))
            : []
    ].filter((finding) => finding.title);

    const aiMarksUnsafe = String(aiResult.verdict || '').toUpperCase() !== 'SAFE';
    const blockingServerSignals = serverAnalysis.hardSignals.length > 0
        || serverAnalysis.criticalCount > 0
        || serverAnalysis.highCount >= 2;
    const aiConfidence = Number(aiResult.confidence || 0);
    const status = blockingServerSignals || (aiMarksUnsafe && (serverAnalysis.riskScore >= 52 || aiConfidence >= 0.78))
        ? 'FAILED'
        : 'SAFE';
    const riskScore = Math.min(
        99,
        Math.max(
            serverAnalysis.riskScore,
            status === 'FAILED'
                ? (Number(aiResult.confidence || 0) >= 0.8 ? 92 : 78)
                : 18
        )
    );

    const publicSummary = truncateText(
        aiResult.summary
            || buildPublicSummary({
                appName: job.app_name,
                platform: targetPlatform,
                repositoryRef: repo.full_name || `${repoMeta.owner}/${repoMeta.repo}`,
                artifactFileName: artifact.fileName,
                hardSignals: serverAnalysis.hardSignals
            }),
        280
    );

    return {
        status,
        platform: validatePlatform(normalizePlatform(aiResult.platform)) ? normalizePlatform(aiResult.platform) : targetPlatform,
        compatiblePlatforms: ensureCompatiblePlatforms(
            validatePlatform(normalizePlatform(aiResult.platform)) ? normalizePlatform(aiResult.platform) : targetPlatform,
            parseCompatiblePlatformsFromRow(job)
        ),
        appName: normalizeAppName(aiResult.appName || job.app_name || repo.name || repoMeta.repo) || job.app_name,
        releaseTag: selectedRelease.release.tagName,
        releaseName: selectedRelease.release.name || null,
        releaseAssetName: selectedRelease.asset.name || artifact.fileName,
        releaseArtifactUrl: artifactUrl,
        releasePublishedAt: selectedRelease.release.publishedAt || null,
        riskScore,
        errorMessage: status === 'FAILED'
            ? truncateText(
                aiResult.concerns?.[0]
                || 'Автоматическая проверка нашла рискованные признаки в исходниках или релизе.',
                255
            )
            : null,
        avatarUrl: String(repo.owner?.avatar_url || '').trim() || null,
        artifact: {
            ...artifact,
            fileName: selectedRelease.asset.name || artifact.fileName
        },
        findings: {
            repo: {
                full_name: repo.full_name,
                default_branch: repo.default_branch,
                description: String(repo.description || '').slice(0, 280),
                archived: Boolean(repo.archived),
                tree_entries: treeEntries.length,
                sampled_files: sampledFiles.length,
                releases_checked: releases.length
            },
            hard_signals: serverAnalysis.hardSignals,
            server_findings: serverAnalysis.findings,
            ai_findings: aiFindings
        },
        publicSummary,
        summary: {
            repo: {
                owner: repoMeta.owner,
                name: repoMeta.repo,
                full_name: repo.full_name,
                default_branch: repo.default_branch,
                html_url: repo.html_url,
                description: String(repo.description || '').slice(0, 280),
                stars: Number(repo.stargazers_count || 0),
                forks: Number(repo.forks_count || 0),
                archived: Boolean(repo.archived),
                tree_entries: treeEntries.length
            },
            release: {
                tag: selectedRelease.release.tagName,
                name: selectedRelease.release.name,
                published_at: selectedRelease.release.publishedAt,
                asset_name: selectedRelease.asset.name,
                asset_size: selectedRelease.asset.size,
                asset_download_url: artifactUrl
            },
            artifact: {
                file_name: selectedRelease.asset.name || artifact.fileName,
                size_bytes: artifact.sizeBytes,
                content_type: artifact.contentType,
                sha256: artifact.sha256
            },
            inference: {
                platform: validatePlatform(normalizePlatform(aiResult.platform)) ? normalizePlatform(aiResult.platform) : targetPlatform,
                platform_reason: truncateText(aiResult.projectDescription || aiResult.summary, 220),
                model: VERIFIED_APP_AI_MODEL,
                verdict: aiResult.verdict,
                confidence: aiResult.confidence
            },
            releases_checked: releases.map((release) => ({
                tag: release.tagName,
                asset_count: release.assets.length,
                published_at: release.publishedAt
            })),
            limits: {
                max_repo_tree_entries: VERIFIED_APP_MAX_REPO_TREE_ENTRIES,
                max_text_files: VERIFIED_APP_MAX_TEXT_FILES,
                max_text_file_bytes: VERIFIED_APP_MAX_TEXT_FILE_BYTES,
                max_total_text_bytes: VERIFIED_APP_MAX_TOTAL_TEXT_BYTES,
                max_artifact_bytes: VERIFIED_APP_MAX_ARTIFACT_BYTES
            }
        }
    };
}

async function resumePendingVerifiedAppsJobs(db = pool) {
    await ensureVerifiedAppsSchema(db);
    const [rows] = await db.query(
        `SELECT id
         FROM verified_apps
         WHERE status IN ('QUEUED', 'RUNNING')
         ORDER BY created_at ASC
         LIMIT 200`
    );
    for (const row of rows) {
        enqueueVerificationJob(row.id);
    }
}

async function findTrustedVerifiedAppMatch({ sha256, platform, appName }, db = pool) {
    await ensureVerifiedAppsSchema(db);
    const normalizedHash = String(sha256 || '').trim().toLowerCase();
    const normalizedPlatform = normalizePlatform(platform);
    const normalizedAppName = normalizeAppName(appName).toLowerCase();

    if (!validatePlatform(normalizedPlatform)) {
        return { kind: 'none', app: null };
    }

    if (/^[a-f0-9]{64}$/.test(normalizedHash)) {
        const [exactRows] = await db.query(
            `SELECT *
             FROM verified_apps
             WHERE status = 'SAFE' AND platform = ? AND sha256 = ?
             ORDER BY verified_at DESC, created_at DESC
             LIMIT 1`,
            [normalizedPlatform, normalizedHash]
        );
        if (exactRows.length > 0) {
            return {
                kind: 'exact',
                app: toPublicRecord(exactRows[0])
            };
        }
    }

    if (!normalizedAppName) {
        return { kind: 'none', app: null };
    }

    const [candidateRows] = await db.query(
        `SELECT *
         FROM verified_apps
         WHERE status = 'SAFE' AND platform = ?
         ORDER BY verified_at DESC, created_at DESC
         LIMIT 100`,
        [normalizedPlatform]
    );

    const matched = candidateRows.find((row) => normalizeAppName(row.app_name).toLowerCase() === normalizedAppName);
    if (!matched) {
        return { kind: 'none', app: null };
    }

    if (normalizedHash && /^[a-f0-9]{64}$/.test(normalizedHash) && String(matched.sha256 || '').trim().toLowerCase() !== normalizedHash) {
        return {
            kind: 'mismatch',
            app: toPublicRecord(matched)
        };
    }

    return { kind: 'none', app: null };
}

module.exports = {
    adminDeveloperApplicationsEmail,
    getDeveloperStatus,
    createDeveloperApplication,
    reviewDeveloperApplicationAction,
    createVerificationJob,
    checkVerificationJobUpdate,
    listMyVerifiedApps,
    listPublicVerifiedApps,
    fetchVerifiedAppById,
    fetchPublicVerifiedAppById,
    resumePendingVerifiedAppsJobs,
    findTrustedVerifiedAppMatch
};
