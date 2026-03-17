const fs = require('fs');
const path = require('path');
const { loadRegistryConfig, listPackageVariantSourceMappings } = require('./packageRegistryService');

const RELEASE_BRANCH_TIMEOUT_MS = parseInt(process.env.RELEASE_BRANCH_TIMEOUT_MS || '10000', 10);
const RELEASE_MANIFEST_CACHE_TTL_MS = parseInt(process.env.RELEASE_MANIFEST_CACHE_TTL_MS || '600000', 10);
const PUBLIC_REPOSITORY = String(process.env.PUBLIC_REPOSITORY || 'Perdonus/fatalerror').trim();
const ANDROID_FALLBACK_VERSION = loadConfiguredProductVersion();
const PLATFORM_FALLBACK_VERSIONS = Object.freeze({
    windows: loadVersionFile('windows.txt'),
    linux: loadVersionFile('linux-gui.txt'),
    shell: loadVersionFile('linux-cli.txt')
});
const PACKAGE_REGISTRY_URL = String(process.env.PACKAGE_REGISTRY_URL || '/api/packages').trim() || '/api/packages';
const GITHUB_API_HEADERS = {
    Accept: 'application/vnd.github.raw+json',
    'User-Agent': 'NeuralVBackend/1.0'
};

const STATIC_BRANCH_SOURCES = [
    { repo: PUBLIC_REPOSITORY, branch: 'site-builds', label: 'site', platforms: ['site'] },
    { repo: PUBLIC_REPOSITORY, branch: 'android-builds', label: 'android', platforms: ['android'] }
];

const PLATFORM_ORDER = ['android', 'windows', 'linux', 'shell', 'nv-windows', 'nv-linux', 'site'];
let manifestCache = null;
let manifestCacheExpiresAt = 0;

function rawBaseForSource(source) {
    return `https://raw.githubusercontent.com/${source.repo}/${source.branch}`;
}

function normalizeReleasePlatform(platform) {
    const value = String(platform || '').trim().toLowerCase();
    switch (value) {
        case 'win':
        case 'win32':
        case 'windows-gui':
        case 'windows-native':
            return 'windows';
        case 'linux-gui':
            return 'linux';
        case 'linux-cli':
        case 'linux-shell':
        case 'cli':
            return 'shell';
        default:
            return value;
    }
}

function branchManifestUrl(source, { bust = false } = {}) {
    const base = `${rawBaseForSource(source)}/manifest.json`;
    if (!bust) {
        return base;
    }
    return `${base}?ts=${Date.now()}`;
}

function branchManifestApiUrl(source) {
    return `https://api.github.com/repos/${source.repo}/contents/manifest.json?ref=${encodeURIComponent(source.branch)}`;
}

function loadConfiguredProductVersion() {
    try {
        const filePath = path.resolve(__dirname, '../../../gradle.properties');
        const content = fs.readFileSync(filePath, 'utf8');
        const match = content.match(/^neuralv\.version\s*=\s*([0-9]+\.[0-9]+\.[0-9]+)\s*$/m);
        if (match && match[1]) {
            return match[1].trim();
        }
    } catch (error) {
        console.warn(`Release version load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 'pending';
}

function loadVersionFile(fileName) {
    try {
        const filePath = path.resolve(__dirname, '../../../versions', fileName);
        const value = fs.readFileSync(filePath, 'utf8').trim();
        if (/^[0-9]+\.[0-9]+\.[0-9]+$/.test(value)) {
            return value;
        }
        console.warn(`Release version file ${fileName} is invalid: ${value}`);
    } catch (error) {
        console.warn(`Release version file ${fileName} load failed: ${error instanceof Error ? error.message : String(error)}`);
    }
    return 'pending';
}

function buildBranchSources(registryPackages) {
    const sources = STATIC_BRANCH_SOURCES.map((source) => ({ ...source, platforms: [...source.platforms] }));
    const sourceIndex = new Map(
        sources.map((source, index) => [`${source.repo}::${source.branch}`, index])
    );

    for (const mapping of listPackageVariantSourceMappings(registryPackages)) {
        const repo = String(mapping?.source?.repo || '').trim();
        const branch = String(mapping?.source?.branch || '').trim();
        const platform = normalizeReleasePlatform(mapping?.source?.platform);
        if (!repo || !branch || !platform) {
            continue;
        }

        const key = `${repo}::${branch}`;
        const existingIndex = sourceIndex.get(key);
        if (typeof existingIndex === 'number') {
            const existing = sources[existingIndex];
            if (!existing.platforms.includes(platform)) {
                existing.platforms.push(platform);
            }
            if (!existing.label && mapping?.variantDef?.id) {
                existing.label = String(mapping.variantDef.id).trim();
            }
            continue;
        }

        sourceIndex.set(key, sources.length);
        sources.push({
            repo,
            branch,
            label: String(mapping?.variantDef?.id || mapping?.source?.role || platform).trim() || platform,
            platforms: [platform]
        });
    }

    return sources;
}

function fallbackArtifacts() {
    return [
        {
            platform: 'android',
            channel: 'release',
            version: ANDROID_FALLBACK_VERSION,
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/android-builds/android/neuralv-android-${ANDROID_FALLBACK_VERSION}.apk`,
            install_command: '',
            update_command: '',
            update_policy: 'manual',
            auto_update: false,
            file_name: `neuralv-android-${ANDROID_FALLBACK_VERSION}.apk`,
            notes: ['Android APK будет опубликован в android-builds.'],
            metadata: {
                source_repo: PUBLIC_REPOSITORY,
                source_branch: 'android-builds',
                source_label: 'android',
                available: false
            }
        },
        {
            platform: 'windows',
            channel: 'beta',
            version: PLATFORM_FALLBACK_VERSIONS.windows,
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/windows-builds/windows/neuralv-windows.zip`,
            install_command: 'winget install --id NeuralV.NeuralV -e',
            update_command: '%LOCALAPPDATA%\\NV\\nv.exe install @lvls/neuralv',
            update_policy: 'startup-auto',
            auto_update: true,
            file_name: 'neuralv-windows.zip',
            notes: ['Windows GUI будет опубликован в windows-builds.'],
            metadata: {
                source_repo: PUBLIC_REPOSITORY,
                source_branch: 'windows-builds',
                source_label: 'windows',
                available: false,
                artifactPlatform: 'windows',
                desktopTrack: 'windows',
                version_source: 'versions/windows.txt',
                payloadRootPath: 'windows/NeuralV/',
                portableArtifactPath: 'windows/neuralv-windows.zip',
                setupArtifactPath: 'windows/neuralv-setup.exe',
                stablePortableArtifactPath: 'windows/neuralv-windows.zip',
                stableSetupArtifactPath: 'windows/neuralv-setup.exe',
                versionedPortableArtifactPath: `windows/neuralv-windows-${PLATFORM_FALLBACK_VERSIONS.windows}.zip`,
                versionedSetupArtifactPath: `windows/neuralv-setup-${PLATFORM_FALLBACK_VERSIONS.windows}.exe`
            }
        },
        {
            platform: 'linux',
            channel: 'main',
            version: PLATFORM_FALLBACK_VERSIONS.linux,
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/linux-gui-builds/linux/neuralv-linux-${PLATFORM_FALLBACK_VERSIONS.linux}.tar.gz`,
            install_command: 'sudo apt install neuralv',
            update_command: 'sudo apt update && sudo apt install --only-upgrade neuralv',
            update_policy: 'startup-auto',
            auto_update: true,
            file_name: `neuralv-linux-${PLATFORM_FALLBACK_VERSIONS.linux}.tar.gz`,
            notes: ['Linux GUI будет опубликован в linux-gui-builds.'],
            metadata: {
                source_repo: PUBLIC_REPOSITORY,
                source_branch: 'linux-gui-builds',
                source_label: 'linux-gui',
                available: false,
                artifactPlatform: 'linux',
                desktopTrack: 'linux-gui',
                stableArtifactPath: 'linux/neuralv-linux.tar.gz',
                version_source: 'versions/linux-gui.txt'
            }
        },
        {
            platform: 'shell',
            channel: 'main',
            version: PLATFORM_FALLBACK_VERSIONS.shell,
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/linux-cli-builds/shell/neuralv-shell-linux-${PLATFORM_FALLBACK_VERSIONS.shell}.tar.gz`,
            install_command: 'curl -fsSL https://raw.githubusercontent.com/Perdonus/NV/linux-builds/nv.sh | sh && nv install @lvls/neuralv',
            update_command: 'nv install @lvls/neuralv',
            update_policy: 'nv-command',
            auto_update: false,
            file_name: `neuralv-shell-linux-${PLATFORM_FALLBACK_VERSIONS.shell}.tar.gz`,
            notes: ['Linux CLI-компонент будет опубликован в linux-cli-builds.'],
            metadata: {
                source_repo: PUBLIC_REPOSITORY,
                source_branch: 'linux-cli-builds',
                source_label: 'linux-cli',
                available: false,
                artifactPlatform: 'shell',
                desktopTrack: 'linux-cli',
                stableArtifactPath: 'shell/neuralv-shell-linux.tar.gz',
                stableDaemonArtifactPath: 'shell/neuralvd-linux.tar.gz',
                version_source: 'versions/linux-cli.txt',
                daemonUrl: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/linux-cli-builds/shell/neuralvd-linux-${PLATFORM_FALLBACK_VERSIONS.shell}.tar.gz`
            }
        },
        {
            platform: 'nv-windows',
            channel: 'main',
            version: 'pending',
            sha256: '',
            download_url: 'https://raw.githubusercontent.com/Perdonus/NV/windows-builds/windows/nv.exe',
            install_command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Perdonus/NV/windows-builds/nv.ps1 | iex"',
            update_command: '%LOCALAPPDATA%\\NV\\nv.exe install @lvls/nv',
            update_policy: 'nv-self',
            auto_update: false,
            file_name: 'nv.exe',
            notes: ['NV для Windows будет опубликован в Perdonus/NV windows-builds.'],
            metadata: {
                source_repo: 'Perdonus/NV',
                source_branch: 'windows-builds',
                source_label: 'nv-windows',
                available: false,
                artifactPlatform: 'nv-windows',
                packageTrack: 'nv-windows'
            }
        },
        {
            platform: 'nv-linux',
            channel: 'main',
            version: 'pending',
            sha256: '',
            download_url: 'https://raw.githubusercontent.com/Perdonus/NV/linux-builds/linux/nv-linux.tar.gz',
            install_command: 'curl -fsSL https://raw.githubusercontent.com/Perdonus/NV/linux-builds/nv.sh | sh',
            update_command: 'nv install @lvls/nv',
            update_policy: 'nv-self',
            auto_update: false,
            file_name: 'nv-linux.tar.gz',
            notes: ['NV для Linux будет опубликован в Perdonus/NV linux-builds.'],
            metadata: {
                source_repo: 'Perdonus/NV',
                source_branch: 'linux-builds',
                source_label: 'nv-linux',
                available: false,
                artifactPlatform: 'nv-linux',
                packageTrack: 'nv-linux'
            }
        },
        {
            platform: 'site',
            channel: 'main',
            version: 'pending',
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/site-builds/site/neuralv-site.zip`,
            install_command: '',
            update_command: '',
            update_policy: 'manual',
            auto_update: false,
            file_name: 'neuralv-site.zip',
            notes: ['Static web bundle for /neuralv/.'],
            metadata: {
                source_repo: PUBLIC_REPOSITORY,
                source_branch: 'site-builds',
                source_label: 'site',
                available: false
            }
        }
    ];
}

function normalizeArtifact(item, source) {
    if (!item || typeof item !== 'object') {
        return null;
    }

    const platform = String(item.platform || '').trim().toLowerCase();
    if (!platform) {
        return null;
    }

    const metadata = item.metadata && typeof item.metadata === 'object'
        ? { ...item.metadata }
        : {};

    return {
        platform,
        channel: String(item.channel || '').trim() || 'main',
        version: String(item.version || '').trim() || 'pending',
        sha256: String(item.sha256 || '').trim(),
        download_url: String(item.download_url || item.downloadUrl || '').trim(),
        install_command: String(item.install_command || item.installCommand || '').trim(),
        update_command: String(item.update_command || item.updateCommand || '').trim(),
        update_policy: String(item.update_policy || item.updatePolicy || '').trim(),
        auto_update: typeof item.auto_update === 'boolean' ? item.auto_update : undefined,
        file_name: String(item.file_name || item.fileName || '').trim(),
        notes: Array.isArray(item.notes)
            ? item.notes.map((entry) => String(entry).trim()).filter(Boolean)
            : [],
        metadata: {
            ...metadata,
            source_repo: metadata.source_repo || source.repo,
            source_branch: metadata.source_branch || source.branch,
            source_label: metadata.source_label || source.label,
            available: true
        }
    };
}

function mergeArtifact(baseArtifact, incomingArtifact) {
    const mergedMetadata = {
        ...(baseArtifact?.metadata || {}),
        ...(incomingArtifact?.metadata || {})
    };

    return {
        platform: incomingArtifact.platform || baseArtifact.platform,
        channel: incomingArtifact.channel || baseArtifact.channel || 'main',
        version: incomingArtifact.version || baseArtifact.version || 'pending',
        sha256: incomingArtifact.sha256 || baseArtifact.sha256 || '',
        download_url: incomingArtifact.download_url || baseArtifact.download_url || '',
        install_command: incomingArtifact.install_command || baseArtifact.install_command || '',
        update_command: incomingArtifact.update_command || baseArtifact.update_command || '',
        update_policy: incomingArtifact.update_policy || baseArtifact.update_policy || 'manual',
        auto_update: typeof incomingArtifact.auto_update === 'boolean'
            ? incomingArtifact.auto_update
            : Boolean(baseArtifact.auto_update),
        file_name: incomingArtifact.file_name || baseArtifact.file_name || '',
        notes: incomingArtifact.notes?.length ? incomingArtifact.notes : (baseArtifact.notes || []),
        metadata: mergedMetadata
    };
}

async function fetchBranchManifest(source) {
    const response = await fetch(branchManifestApiUrl(source), {
        method: 'GET',
        headers: GITHUB_API_HEADERS,
        signal: AbortSignal.timeout(RELEASE_BRANCH_TIMEOUT_MS)
    });

    if (!response.ok) {
        throw new Error(`${source.repo}@${source.branch} manifest responded with ${response.status}`);
    }

    const manifest = await response.json();
    if (!manifest || !Array.isArray(manifest.artifacts)) {
        throw new Error(`${source.repo}@${source.branch} manifest is invalid`);
    }

    return manifest;
}

async function fetchRawBranchManifest(source) {
    const response = await fetch(branchManifestUrl(source, { bust: true }), {
        method: 'GET',
        headers: {
            'User-Agent': GITHUB_API_HEADERS['User-Agent'],
            Accept: 'application/json'
        },
        signal: AbortSignal.timeout(RELEASE_BRANCH_TIMEOUT_MS)
    });

    if (!response.ok) {
        throw new Error(`${source.repo}@${source.branch} raw manifest responded with ${response.status}`);
    }

    const manifest = await response.json();
    if (!manifest || !Array.isArray(manifest.artifacts)) {
        throw new Error(`${source.repo}@${source.branch} raw manifest is invalid`);
    }

    return manifest;
}

async function fetchBranchManifestWithFallback(source) {
    try {
        return await fetchRawBranchManifest(source);
    } catch (rawError) {
        try {
            return await fetchBranchManifest(source);
        } catch (apiError) {
            const rawMessage = rawError instanceof Error ? rawError.message : String(rawError);
            const apiMessage = apiError instanceof Error ? apiError.message : String(apiError);
            throw new Error(`${source.repo}@${source.branch} manifest failed: raw=${rawMessage}; api=${apiMessage}`);
        }
    }
}

function buildSourceStatus(source, result) {
    if (result.status === 'fulfilled') {
        const manifest = result.value.manifest;
        return {
            repo: source.repo,
            branch: source.branch,
            label: source.label,
            manifest_url: branchManifestUrl(source),
            available: true,
            generated_at: manifest.generated_at || null,
            release_channel: manifest.release_channel || 'main',
            platforms: source.platforms,
            artifact_count: Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0,
            error: null
        };
    }

    return {
        repo: source.repo,
        branch: source.branch,
        label: source.label,
        manifest_url: branchManifestUrl(source),
        available: false,
        generated_at: null,
        release_channel: null,
        platforms: source.platforms,
        artifact_count: 0,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    };
}

function indexRegistryVariants(registryPackages) {
    const index = new Map();
    for (const mapping of listPackageVariantSourceMappings(registryPackages)) {
        const repo = String(mapping?.source?.repo || '').trim();
        const branch = String(mapping?.source?.branch || '').trim();
        const platform = String(mapping?.source?.platform || '').trim().toLowerCase();
        if (!repo || !branch || !platform) {
            continue;
        }
        index.set(`${repo}::${branch}::${platform}`, mapping);
    }
    return index;
}

function attachRegistryMetadata(artifact, registryMatch) {
    if (!registryMatch) {
        return artifact;
    }

    const { packageDef, variantDef, source } = registryMatch;
    const variantMetadata = variantDef.metadata && typeof variantDef.metadata === 'object' ? variantDef.metadata : {};
    const updatePolicy = String(variantDef.update_policy || artifact.update_policy || variantMetadata.updatePolicy || 'manual').trim() || 'manual';
    const autoUpdate = typeof variantDef.auto_update === 'boolean'
        ? variantDef.auto_update
        : (typeof artifact.auto_update === 'boolean' ? artifact.auto_update : updatePolicy === 'startup-auto');
    const sourceRepo = String(source?.repo || variantDef?.source?.repo || artifact?.metadata?.source_repo || '').trim();
    const sourceBranch = String(source?.branch || variantDef?.source?.branch || artifact?.metadata?.source_branch || '').trim();
    const buildRawUrl = (relativePath, sourceOverride = null) => {
        const cleanPath = String(relativePath || '').trim().replace(/^\/+/, '');
        const effectiveSource = sourceOverride && sourceOverride.repo && sourceOverride.branch
            ? sourceOverride
            : (sourceRepo && sourceBranch ? { repo: sourceRepo, branch: sourceBranch } : null);
        const rawBase = effectiveSource ? rawBaseForSource(effectiveSource) : '';
        return rawBase && cleanPath ? `${rawBase}/${cleanPath}` : '';
    };
    const relatedSources = Array.isArray(variantMetadata.relatedSources) ? variantMetadata.relatedSources : [];
    const cliSource = relatedSources.find((entry) => String(entry?.role || '').trim().toLowerCase() === 'cli') || null;
    const metadata = {
        ...variantMetadata,
        package_name: String(packageDef.name || '').trim(),
        package_aliases: Array.isArray(packageDef.aliases) ? [...packageDef.aliases] : [],
        package_title: String(packageDef.title || packageDef.name || '').trim(),
        variant_id: String(variantDef.id || '').trim(),
        component_role: String(source?.role || 'primary').trim() || 'primary',
        install_strategy: String(variantDef.install_strategy || '').trim(),
        uninstall_strategy: String(variantDef.uninstall_strategy || '').trim(),
        install_root: String(variantDef.install_root || '').trim(),
        binary_name: String(variantDef.binary_name || '').trim(),
        wrapper_name: String(variantDef.wrapper_name || '').trim(),
        launcher_path: String(variantDef.launcher_path || '').trim(),
        manifest_url: sourceRepo && sourceBranch ? branchManifestUrl({ repo: sourceRepo, branch: sourceBranch }) : '',
        package_registry_url: PACKAGE_REGISTRY_URL,
        update_policy: updatePolicy,
        auto_update: autoUpdate,
        artifact_platform: normalizeReleasePlatform(artifact.platform),
        desktop_track: String(variantMetadata.desktopTrack || '').trim(),
        package_track: String(variantMetadata.packageTrack || '').trim(),
        version_source_file: String(variantMetadata.versionSourceFile || '').trim()
    };

    if (!metadata.portableUrl && variantMetadata.stablePortableArtifactPath) {
        metadata.portableUrl = buildRawUrl(variantMetadata.stablePortableArtifactPath);
    }
    if (!metadata.setupUrl && variantMetadata.stableSetupArtifactPath) {
        metadata.setupUrl = buildRawUrl(variantMetadata.stableSetupArtifactPath);
    }
    if (!metadata.daemonUrl && variantMetadata.stableDaemonArtifactPath) {
        metadata.daemonUrl = buildRawUrl(variantMetadata.stableDaemonArtifactPath, cliSource);
    }
    if (!metadata.stableArtifactUrl && variantMetadata.stableArtifactPath) {
        metadata.stableArtifactUrl = buildRawUrl(variantMetadata.stableArtifactPath);
    }
    if (!metadata.stableCliArtifactUrl && variantMetadata.stableCliArtifactPath) {
        metadata.stableCliArtifactUrl = buildRawUrl(variantMetadata.stableCliArtifactPath, cliSource);
    }

    return mergeArtifact(artifact, {
        install_command: String(variantDef.install_command || artifact.install_command || '').trim(),
        update_command: String(variantDef.update_command || artifact.update_command || '').trim(),
        update_policy: updatePolicy,
        auto_update: autoUpdate,
        metadata
    });
}

async function getReleaseManifest() {
    if (manifestCache && manifestCacheExpiresAt > Date.now()) {
        return manifestCache;
    }

    const merged = new Map(fallbackArtifacts().map((artifact) => [artifact.platform, artifact]));
    let generatedAt = null;
    let releaseChannel = 'main';

    const registry = await loadRegistryConfig();
    const registryIndex = indexRegistryVariants(registry.packages);
    const branchSources = buildBranchSources(registry.packages);

    const settled = await Promise.allSettled(
        branchSources.map(async (source) => ({ source, manifest: await fetchBranchManifestWithFallback(source) }))
    );

    const sources = settled.map((result, index) => buildSourceStatus(branchSources[index], result));

    for (const result of settled) {
        if (result.status !== 'fulfilled') {
            console.warn(`Release manifest branch fetch failed: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`);
            continue;
        }

        const { source, manifest } = result.value;
        if (manifest.generated_at && (!generatedAt || Number(new Date(manifest.generated_at)) > Number(new Date(generatedAt)))) {
            generatedAt = manifest.generated_at;
        }
        if (manifest.release_channel && releaseChannel === 'main') {
            releaseChannel = String(manifest.release_channel).trim() || 'main';
        }

        for (const rawArtifact of manifest.artifacts) {
            const normalized = normalizeArtifact(rawArtifact, source);
            if (!normalized) {
                continue;
            }
            const registryMatch = registryIndex.get(`${source.repo}::${source.branch}::${normalized.platform}`);
            const withRegistry = attachRegistryMetadata(normalized, registryMatch);
            const current = merged.get(withRegistry.platform);
            merged.set(withRegistry.platform, current ? mergeArtifact(current, withRegistry) : withRegistry);
        }
    }

    for (const [platform, artifact] of Array.from(merged.entries())) {
        const registryMatch = registryIndex.get(`${artifact.metadata?.source_repo || ''}::${artifact.metadata?.source_branch || ''}::${platform}`);
        if (registryMatch) {
            merged.set(platform, attachRegistryMetadata(artifact, registryMatch));
        }
    }

    const manifest = {
        success: true,
        generated_at: generatedAt || new Date().toISOString(),
        release_channel: releaseChannel,
        partial: sources.some((source) => !source.available),
        package_registry_url: PACKAGE_REGISTRY_URL,
        registry_source: registry.source,
        registry_source_url: registry.sourceUrl,
        sources,
        artifacts: PLATFORM_ORDER
            .map((platform) => merged.get(platform))
            .filter(Boolean)
    };

    manifestCache = manifest;
    manifestCacheExpiresAt = Date.now() + RELEASE_MANIFEST_CACHE_TTL_MS;
    return manifest;
}

module.exports = {
    getReleaseManifest
};
