const RELEASE_BRANCH_TIMEOUT_MS = parseInt(process.env.RELEASE_BRANCH_TIMEOUT_MS || '10000', 10);
const PUBLIC_REPOSITORY = String(process.env.PUBLIC_REPOSITORY || 'Perdonus/fatalerror').trim();

const BRANCH_SOURCES = [
    { branch: 'site-builds', label: 'site', platforms: ['site'] },
    { branch: 'android-builds', label: 'android', platforms: ['android'] },
    { branch: 'windows-builds', label: 'windows', platforms: ['windows'] },
    { branch: 'linux-builds', label: 'linux', platforms: ['linux', 'nv', 'shell'] }
];

const PLATFORM_ORDER = ['android', 'windows', 'linux', 'nv', 'shell', 'site'];

function rawBase(branch) {
    return `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}/${branch}`;
}

function branchManifestUrl(branch) {
    return `${rawBase(branch)}/manifest.json`;
}

function fallbackArtifacts() {
    return [
        {
            platform: 'android',
            channel: 'release',
            version: 'pending',
            sha256: '',
            download_url: `${rawBase('android-builds')}/android/neuralv-android-release.apk`,
            install_command: '',
            file_name: 'neuralv-android-release.apk',
            notes: ['Android APK будет опубликован в android-builds.'],
            metadata: {
                source_branch: 'android-builds',
                source_label: 'android',
                available: false
            }
        },
        {
            platform: 'windows',
            channel: 'beta',
            version: 'pending',
            sha256: '',
            download_url: `${rawBase('windows-builds')}/windows/neuralv-windows.zip`,
            install_command: '',
            file_name: 'neuralv-windows.zip',
            notes: ['Windows GUI будет опубликован в windows-builds.'],
            metadata: {
                source_branch: 'windows-builds',
                source_label: 'windows',
                available: false
            }
        },
        {
            platform: 'linux',
            channel: 'beta',
            version: 'pending',
            sha256: '',
            download_url: `${rawBase('linux-builds')}/linux/neuralv-linux.tar.gz`,
            install_command: '',
            file_name: 'neuralv-linux.tar.gz',
            notes: ['Linux GUI будет опубликован в linux-builds.'],
            metadata: {
                source_branch: 'linux-builds',
                source_label: 'linux',
                daemonUrl: `${rawBase('linux-builds')}/shell/neuralvd-linux.tar.gz`,
                available: false
            }
        },
        {
            platform: 'nv',
            channel: 'beta',
            version: 'pending',
            sha256: '',
            download_url: `${rawBase('linux-builds')}/shell/nv-linux.tar.gz`,
            install_command: 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh',
            file_name: 'nv-linux.tar.gz',
            notes: ['Linux bootstrap manager for NeuralV releases.'],
            metadata: {
                source_branch: 'linux-builds',
                source_label: 'linux',
                available: false
            }
        },
        {
            platform: 'shell',
            channel: 'beta',
            version: 'pending',
            sha256: '',
            download_url: `${rawBase('linux-builds')}/shell/neuralv-shell-linux.tar.gz`,
            install_command: 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh && nv install neuralv@latest',
            file_name: 'neuralv-shell-linux.tar.gz',
            notes: ['Bubble Tea shell client.'],
            metadata: {
                source_branch: 'linux-builds',
                source_label: 'linux',
                daemonUrl: `${rawBase('linux-builds')}/shell/neuralvd-linux.tar.gz`,
                available: false
            }
        },
        {
            platform: 'site',
            channel: 'main',
            version: 'pending',
            sha256: '',
            download_url: `${rawBase('site-builds')}/site/neuralv-site.zip`,
            install_command: '',
            file_name: 'neuralv-site.zip',
            notes: ['Static web bundle for /neuralv/.'],
            metadata: {
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
        file_name: String(item.file_name || item.fileName || '').trim(),
        notes: Array.isArray(item.notes)
            ? item.notes.map((entry) => String(entry).trim()).filter(Boolean)
            : [],
        metadata: {
            ...metadata,
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
        file_name: incomingArtifact.file_name || baseArtifact.file_name || '',
        notes: incomingArtifact.notes?.length ? incomingArtifact.notes : (baseArtifact.notes || []),
        metadata: mergedMetadata
    };
}

async function fetchBranchManifest(source) {
    const response = await fetch(branchManifestUrl(source.branch), {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(RELEASE_BRANCH_TIMEOUT_MS)
    });

    if (!response.ok) {
        throw new Error(`${source.branch} manifest responded with ${response.status}`);
    }

    const manifest = await response.json();
    if (!manifest || !Array.isArray(manifest.artifacts)) {
        throw new Error(`${source.branch} manifest is invalid`);
    }

    return manifest;
}

function buildSourceStatus(source, result) {
    if (result.status === 'fulfilled') {
        const manifest = result.value.manifest;
        return {
            branch: source.branch,
            label: source.label,
            manifest_url: branchManifestUrl(source.branch),
            available: true,
            generated_at: manifest.generated_at || null,
            release_channel: manifest.release_channel || 'main',
            platforms: source.platforms,
            artifact_count: Array.isArray(manifest.artifacts) ? manifest.artifacts.length : 0,
            error: null
        };
    }

    return {
        branch: source.branch,
        label: source.label,
        manifest_url: branchManifestUrl(source.branch),
        available: false,
        generated_at: null,
        release_channel: null,
        platforms: source.platforms,
        artifact_count: 0,
        error: result.reason instanceof Error ? result.reason.message : String(result.reason)
    };
}

async function getReleaseManifest() {
    const merged = new Map(fallbackArtifacts().map((artifact) => [artifact.platform, artifact]));
    let generatedAt = null;
    let releaseChannel = 'main';

    const settled = await Promise.allSettled(
        BRANCH_SOURCES.map(async (source) => ({ source, manifest: await fetchBranchManifest(source) }))
    );

    const sources = settled.map((result, index) => {
        const source = BRANCH_SOURCES[index];
        return buildSourceStatus(source, result);
    });

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
            const current = merged.get(normalized.platform);
            merged.set(normalized.platform, current ? mergeArtifact(current, normalized) : normalized);
        }
    }

    return {
        success: true,
        generated_at: generatedAt || new Date().toISOString(),
        release_channel: releaseChannel,
        partial: sources.some((source) => !source.available),
        sources,
        artifacts: PLATFORM_ORDER
            .map((platform) => merged.get(platform))
            .filter(Boolean)
    };
}

module.exports = {
    getReleaseManifest
};
