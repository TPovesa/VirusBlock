const fs = require('fs');
const path = require('path');
const { loadRegistryConfig } = require('./packageRegistryService');

const RELEASE_BRANCH_TIMEOUT_MS = parseInt(process.env.RELEASE_BRANCH_TIMEOUT_MS || '10000', 10);
const PUBLIC_REPOSITORY = String(process.env.PUBLIC_REPOSITORY || 'Perdonus/fatalerror').trim();
const DEFAULT_RELEASE_VERSION = loadConfiguredReleaseVersion();
const PACKAGE_REGISTRY_URL = String(process.env.PACKAGE_REGISTRY_URL || '/api/packages').trim() || '/api/packages';

const BRANCH_SOURCES = [
    { repo: PUBLIC_REPOSITORY, branch: 'site-builds', label: 'site', platforms: ['site'] },
    { repo: PUBLIC_REPOSITORY, branch: 'android-builds', label: 'android', platforms: ['android'] },
    { repo: PUBLIC_REPOSITORY, branch: 'windows-builds', label: 'windows', platforms: ['windows'] },
    { repo: PUBLIC_REPOSITORY, branch: 'linux-gui-builds', label: 'linux-gui', platforms: ['linux'] },
    { repo: PUBLIC_REPOSITORY, branch: 'linux-cli-builds', label: 'linux-cli', platforms: ['shell'] },
    { repo: 'Perdonus/NV', branch: 'windows-builds', label: 'nv-windows', platforms: ['nv-windows'] },
    { repo: 'Perdonus/NV', branch: 'linux-builds', label: 'nv-linux', platforms: ['nv-linux'] }
];

const PLATFORM_ORDER = ['android', 'windows', 'linux', 'shell', 'nv-windows', 'nv-linux', 'site'];

function rawBaseForSource(source) {
    return `https://raw.githubusercontent.com/${source.repo}/${source.branch}`;
}

function branchManifestUrl(source, { bust = false } = {}) {
    const base = `${rawBaseForSource(source)}/manifest.json`;
    if (!bust) {
        return base;
    }
    return `${base}?ts=${Date.now()}`;
}

function loadConfiguredReleaseVersion() {
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

function fallbackArtifacts() {
    return [
        {
            platform: 'android',
            channel: 'release',
            version: DEFAULT_RELEASE_VERSION,
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/android-builds/android/neuralv-android-${DEFAULT_RELEASE_VERSION}.apk`,
            install_command: '',
            update_command: '',
            update_policy: 'manual',
            auto_update: false,
            file_name: `neuralv-android-${DEFAULT_RELEASE_VERSION}.apk`,
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
            version: DEFAULT_RELEASE_VERSION,
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/windows-builds/windows/neuralv-windows-${DEFAULT_RELEASE_VERSION}.zip`,
            install_command: 'winget install --id NeuralV.NeuralV -e',
            update_command: '%LOCALAPPDATA%\\NV\\nv.exe install neuralv@latest',
            update_policy: 'startup-auto',
            auto_update: true,
            file_name: `neuralv-windows-${DEFAULT_RELEASE_VERSION}.zip`,
            notes: ['Windows GUI будет опубликован в windows-builds.'],
            metadata: {
                source_repo: PUBLIC_REPOSITORY,
                source_branch: 'windows-builds',
                source_label: 'windows',
                available: false
            }
        },
        {
            platform: 'linux',
            channel: 'main',
            version: DEFAULT_RELEASE_VERSION,
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/linux-gui-builds/linux/neuralv-linux-${DEFAULT_RELEASE_VERSION}.tar.gz`,
            install_command: 'sudo apt install neuralv',
            update_command: 'sudo apt update && sudo apt install --only-upgrade neuralv',
            update_policy: 'startup-auto',
            auto_update: true,
            file_name: `neuralv-linux-${DEFAULT_RELEASE_VERSION}.tar.gz`,
            notes: ['Linux GUI будет опубликован в linux-gui-builds.'],
            metadata: {
                source_repo: PUBLIC_REPOSITORY,
                source_branch: 'linux-gui-builds',
                source_label: 'linux-gui',
                available: false
            }
        },
        {
            platform: 'shell',
            channel: 'main',
            version: DEFAULT_RELEASE_VERSION,
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/linux-cli-builds/shell/neuralv-shell-linux-${DEFAULT_RELEASE_VERSION}.tar.gz`,
            install_command: 'curl -fsSL https://raw.githubusercontent.com/Perdonus/NV/linux-builds/nv.sh | sh && nv install neuralv@latest',
            update_command: 'nv install neuralv@latest',
            update_policy: 'nv-command',
            auto_update: false,
            file_name: `neuralv-shell-linux-${DEFAULT_RELEASE_VERSION}.tar.gz`,
            notes: ['Linux CLI будет опубликован в linux-cli-builds.'],
            metadata: {
                source_repo: PUBLIC_REPOSITORY,
                source_branch: 'linux-cli-builds',
                source_label: 'linux-cli',
                available: false,
                daemonUrl: `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/linux-cli-builds/shell/neuralvd-linux-${DEFAULT_RELEASE_VERSION}.tar.gz`
            }
        },
        {
            platform: 'nv-windows',
            channel: 'main',
            version: 'pending',
            sha256: '',
            download_url: 'https://raw.githubusercontent.com/Perdonus/NV/windows-builds/windows/nv.exe',
            install_command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Perdonus/NV/windows-builds/nv.ps1 | iex"',
            update_command: '%LOCALAPPDATA%\\NV\\nv.exe install nv@latest',
            update_policy: 'nv-self',
            auto_update: false,
            file_name: 'nv.exe',
            notes: ['NV для Windows будет опубликован в Perdonus/NV windows-builds.'],
            metadata: {
                source_repo: 'Perdonus/NV',
                source_branch: 'windows-builds',
                source_label: 'nv-windows',
                available: false
            }
        },
        {
            platform: 'nv-linux',
            channel: 'main',
            version: 'pending',
            sha256: '',
            download_url: 'https://raw.githubusercontent.com/Perdonus/NV/linux-builds/linux/nv-linux.tar.gz',
            install_command: 'curl -fsSL https://raw.githubusercontent.com/Perdonus/NV/linux-builds/nv.sh | sh',
            update_command: 'nv install nv@latest',
            update_policy: 'nv-self',
            auto_update: false,
            file_name: 'nv-linux.tar.gz',
            notes: ['NV для Linux будет опубликован в Perdonus/NV linux-builds.'],
            metadata: {
                source_repo: 'Perdonus/NV',
                source_branch: 'linux-builds',
                source_label: 'nv-linux',
                available: false
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
    const response = await fetch(branchManifestUrl(source, { bust: true }), {
        method: 'GET',
        headers: { Accept: 'application/json' },
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
    for (const pkg of registryPackages) {
        for (const variant of Array.isArray(pkg?.variants) ? pkg.variants : []) {
            const repo = String(variant?.source?.repo || '').trim();
            const branch = String(variant?.source?.branch || '').trim();
            const platform = String(variant?.source?.platform || '').trim().toLowerCase();
            if (!repo || !branch || !platform) {
                continue;
            }
            index.set(`${repo}::${branch}::${platform}`, { packageDef: pkg, variantDef: variant });
        }
    }
    return index;
}

function attachRegistryMetadata(artifact, registryMatch) {
    if (!registryMatch) {
        return artifact;
    }

    const { packageDef, variantDef } = registryMatch;
    const variantMetadata = variantDef.metadata && typeof variantDef.metadata === 'object' ? variantDef.metadata : {};
    const updatePolicy = String(variantDef.update_policy || artifact.update_policy || variantMetadata.updatePolicy || 'manual').trim() || 'manual';
    const autoUpdate = typeof variantDef.auto_update === 'boolean'
        ? variantDef.auto_update
        : (typeof artifact.auto_update === 'boolean' ? artifact.auto_update : updatePolicy === 'startup-auto');

    return mergeArtifact(artifact, {
        install_command: String(variantDef.install_command || artifact.install_command || '').trim(),
        update_command: String(variantDef.update_command || artifact.update_command || '').trim(),
        update_policy: updatePolicy,
        auto_update: autoUpdate,
        metadata: {
            ...variantMetadata,
            package_name: String(packageDef.name || '').trim(),
            package_title: String(packageDef.title || packageDef.name || '').trim(),
            variant_id: String(variantDef.id || '').trim(),
            install_strategy: String(variantDef.install_strategy || '').trim(),
            uninstall_strategy: String(variantDef.uninstall_strategy || '').trim(),
            install_root: String(variantDef.install_root || '').trim(),
            binary_name: String(variantDef.binary_name || '').trim(),
            wrapper_name: String(variantDef.wrapper_name || '').trim(),
            launcher_path: String(variantDef.launcher_path || '').trim(),
            manifest_url: branchManifestUrl({ repo: variantDef.source.repo, branch: variantDef.source.branch }),
            package_registry_url: PACKAGE_REGISTRY_URL,
            update_policy: updatePolicy,
            auto_update: autoUpdate
        }
    });
}

async function getReleaseManifest() {
    const merged = new Map(fallbackArtifacts().map((artifact) => [artifact.platform, artifact]));
    let generatedAt = null;
    let releaseChannel = 'main';

    const registry = await loadRegistryConfig();
    const registryIndex = indexRegistryVariants(registry.packages);

    const settled = await Promise.allSettled(
        BRANCH_SOURCES.map(async (source) => ({ source, manifest: await fetchBranchManifest(source) }))
    );

    const sources = settled.map((result, index) => buildSourceStatus(BRANCH_SOURCES[index], result));

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

    return {
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
}

module.exports = {
    getReleaseManifest
};
