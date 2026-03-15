const { nowMs } = require('../utils/security');

const REMOTE_BRANCHES = [
    'site-builds',
    'android-builds',
    'windows-builds',
    'linux-builds'
];

const PLATFORM_ORDER = ['site', 'android', 'windows', 'linux', 'nv', 'shell'];

function normalizeArtifact(item) {
    if (!item || typeof item !== 'object') return null;
    const platform = String(item.platform || '').trim().toLowerCase();
    if (!platform) return null;
    return {
        platform,
        channel: item.channel ? String(item.channel) : undefined,
        version: item.version ? String(item.version) : undefined,
        sha256: item.sha256 ? String(item.sha256) : undefined,
        download_url: item.download_url ? String(item.download_url) : (item.downloadUrl ? String(item.downloadUrl) : undefined),
        install_command: item.install_command ? String(item.install_command) : (item.installCommand ? String(item.installCommand) : ''),
        file_name: item.file_name ? String(item.file_name) : (item.fileName ? String(item.fileName) : undefined),
        notes: Array.isArray(item.notes) ? item.notes.map((entry) => String(entry)) : [],
        metadata: item.metadata && typeof item.metadata === 'object' ? item.metadata : {}
    };
}

async function fetchBranchManifest(repo, branch) {
    const url = `https://raw.githubusercontent.com/${repo}/${branch}/manifest.json`;
    try {
        const response = await fetch(url, {
            method: 'GET',
            headers: { Accept: 'application/json' },
            signal: AbortSignal.timeout(10_000)
        });
        if (response.status === 404) {
            return null;
        }
        if (!response.ok) {
            throw new Error(`${branch}: ${response.status}`);
        }
        const payload = await response.json();
        const artifacts = Array.isArray(payload?.artifacts)
            ? payload.artifacts.map(normalizeArtifact).filter(Boolean)
            : [];
        if (artifacts.length === 0) {
            return null;
        }
        return {
            branch,
            generated_at: payload.generated_at || payload.generatedAt || null,
            release_channel: payload.release_channel || payload.releaseChannel || null,
            artifacts
        };
    } catch (error) {
        console.warn(`Release manifest fetch failed for ${branch}: ${error instanceof Error ? error.message : String(error)}`);
        return null;
    }
}

function fallbackArtifacts(repo) {
    return [
        {
            platform: 'site',
            channel: 'main',
            version: 'pending',
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${repo}/site-builds/site/neuralv-site.zip`,
            install_command: '',
            file_name: 'neuralv-site.zip',
            notes: ['Site bundle will appear after GitHub site publish.'],
            metadata: {}
        },
        {
            platform: 'android',
            channel: 'release',
            version: 'pending',
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${repo}/android-builds/android/neuralv-android-release.apk`,
            install_command: '',
            file_name: 'neuralv-android-release.apk',
            notes: ['Android APK will appear after GitHub Android publish.'],
            metadata: {}
        },
        {
            platform: 'windows',
            channel: 'beta',
            version: 'pending',
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${repo}/windows-builds/windows/neuralv-windows.zip`,
            install_command: '',
            file_name: 'neuralv-windows.zip',
            notes: ['Windows GUI will appear after GitHub Windows publish.'],
            metadata: {}
        },
        {
            platform: 'linux',
            channel: 'beta',
            version: 'pending',
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${repo}/linux-builds/linux/neuralv-linux.tar.gz`,
            install_command: '',
            file_name: 'neuralv-linux.tar.gz',
            notes: ['Linux GUI will appear after GitHub Linux publish.'],
            metadata: {
                daemonUrl: `https://raw.githubusercontent.com/${repo}/linux-builds/shell/neuralvd-linux.tar.gz`
            }
        },
        {
            platform: 'nv',
            channel: 'beta',
            version: 'pending',
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${repo}/linux-builds/shell/nv-linux.tar.gz`,
            install_command: 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh',
            file_name: 'nv-linux.tar.gz',
            notes: ['nv bootstrap will appear after GitHub Linux publish.'],
            metadata: {}
        },
        {
            platform: 'shell',
            channel: 'beta',
            version: 'pending',
            sha256: '',
            download_url: `https://raw.githubusercontent.com/${repo}/linux-builds/shell/neuralv-shell-linux.tar.gz`,
            install_command: 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh && nv install neuralv@latest',
            file_name: 'neuralv-shell-linux.tar.gz',
            notes: ['Linux shell client will appear after GitHub Linux publish.'],
            metadata: {
                daemonUrl: `https://raw.githubusercontent.com/${repo}/linux-builds/shell/neuralvd-linux.tar.gz`
            }
        }
    ];
}

async function getReleaseManifest() {
    const repo = String(process.env.PUBLIC_REPOSITORY || 'Perdonus/fatalerror').trim();
    const manifests = (await Promise.all(REMOTE_BRANCHES.map((branch) => fetchBranchManifest(repo, branch))))
        .filter(Boolean);

    if (manifests.length === 0) {
        return {
            success: true,
            generated_at: nowMs(),
            release_channel: 'split-builds',
            artifacts: fallbackArtifacts(repo)
        };
    }

    const artifactMap = new Map();
    for (const manifest of manifests) {
        for (const artifact of manifest.artifacts) {
            if (!artifactMap.has(artifact.platform)) {
                artifactMap.set(artifact.platform, artifact);
            }
        }
    }

    const artifacts = Array.from(artifactMap.values()).sort((a, b) => {
        const ai = PLATFORM_ORDER.indexOf(a.platform);
        const bi = PLATFORM_ORDER.indexOf(b.platform);
        return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });

    const generated = manifests
        .map((entry) => Date.parse(String(entry.generated_at || '')))
        .filter((value) => Number.isFinite(value));

    return {
        success: true,
        generated_at: generated.length > 0 ? new Date(Math.max(...generated)).toISOString() : nowMs(),
        release_channel: 'split-builds',
        artifacts
    };
}

module.exports = {
    getReleaseManifest
};
