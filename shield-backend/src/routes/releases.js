const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { Readable } = require('stream');
const router = express.Router();
const { getReleaseManifest } = require('../services/releaseManifestService');
const REPO_ROOT = path.resolve(__dirname, '../../..');
const PUBLIC_REPOSITORY = String(process.env.PUBLIC_REPOSITORY || 'TPovesa/VirusBlock').trim();
const PUBLIC_WEB_BASE = String(process.env.PUBLIC_WEB_BASE || 'https://neuralvv.org').trim().replace(/\/+$/, '');

function normalizePlatform(input) {
    const value = String(input || '').trim().toLowerCase();
    switch (value) {
        case 'win':
        case 'win32':
        case 'windows':
        case 'windows-gui':
        case 'windows-native':
        case 'desktop':
            return 'windows';
        case 'linux':
        case 'linux-gui':
            return 'linux';
        case 'shell':
        case 'linux-cli':
        case 'linux-shell':
        case 'cli':
            return 'shell';
        case 'nv-win':
        case 'nv-windows':
            return 'nv-windows';
        case 'nv-linux':
            return 'nv-linux';
        case 'android':
            return 'android';
        case 'site':
            return 'site';
        default:
            return value;
    }
}

function normalizeKind(input) {
    const value = String(input || '').trim().toLowerCase();
    switch (value) {
        case 'setup':
        case 'portable':
        case 'daemon':
        case 'cli':
        case 'artifact':
            return value;
        default:
            return '';
    }
}

function firstNonEmpty(...values) {
    for (const value of values) {
        const text = String(value || '').trim();
        if (text) {
            return text;
        }
    }
    return '';
}

function isLocalProxyUrl(value) {
    const url = String(value || '').trim();
    return url.includes('/basedata/api/releases/download');
}

function normalizeRepoName(value) {
    const repo = String(value || '').trim();
    return repo.toLowerCase() === 'perdonus/fatalerror' ? PUBLIC_REPOSITORY : repo;
}

function buildPublicReleaseDownloadUrl(platform, kind = '') {
    const normalizedPlatform = encodeURIComponent(normalizePlatform(platform) || String(platform || '').trim().toLowerCase());
    const normalizedKind = String(kind || '').trim().toLowerCase();
    const query = normalizedKind ? `?platform=${normalizedPlatform}&kind=${encodeURIComponent(normalizedKind)}` : `?platform=${normalizedPlatform}`;
    return `${PUBLIC_WEB_BASE}/basedata/api/releases/download${query}`;
}

function rewriteInternalUrl(value) {
    const url = String(value || '').trim();
    if (!url) {
        return '';
    }
    return url
        .replace(/https:\/\/github\.com\/Perdonus\/fatalerror/gi, `https://github.com/${PUBLIC_REPOSITORY}`)
        .replace(/https:\/\/raw\.githubusercontent\.com\/Perdonus\/fatalerror/gi, `https://raw.githubusercontent.com/${PUBLIC_REPOSITORY}`);
}

function parseInternalRawUrl(value) {
    const url = String(value || '').trim();
    const matched = url.match(/^https:\/\/raw\.githubusercontent\.com\/([^/]+\/[^/]+)\/([^/]+)\/(.+)$/i);
    if (!matched) {
        return null;
    }

    const repo = normalizeRepoName(matched[1]);
    if (repo !== 'TPovesa/VirusBlock') {
        return null;
    }

    return {
        repo,
        branch: matched[2],
        filePath: matched[3].replace(/^\/+/, '')
    };
}

function contentTypeForFileName(fileName) {
    const lower = String(fileName || '').toLowerCase();
    if (lower.endsWith('.apk')) return 'application/vnd.android.package-archive';
    if (lower.endsWith('.zip')) return 'application/zip';
    if (lower.endsWith('.tar.gz') || lower.endsWith('.tgz')) return 'application/gzip';
    if (lower.endsWith('.exe')) return 'application/vnd.microsoft.portable-executable';
    return 'application/octet-stream';
}

function buildPublicInstallScriptUrl(platform, kind) {
    const normalizedPlatform = normalizePlatform(platform);
    if (normalizedPlatform === 'windows') {
        if (kind === 'cmd') return `${PUBLIC_WEB_BASE}/install/nv.cmd`;
        return `${PUBLIC_WEB_BASE}/install/nv.ps1`;
    }
    if (normalizedPlatform === 'linux' || normalizedPlatform === 'shell') {
        return `${PUBLIC_WEB_BASE}/install/linux.sh`;
    }
    return '';
}

function gitRefForBranch(branch) {
    return `origin/${String(branch || '').trim()}`;
}

function streamGitBlob(branch, filePath, res, fileName) {
    return new Promise((resolve, reject) => {
        const rev = `${gitRefForBranch(branch)}:${filePath}`;
        const sizeProc = spawn('git', ['cat-file', '-s', rev], { cwd: REPO_ROOT });
        let sizeOutput = '';
        let stderr = '';

        sizeProc.stdout.on('data', (chunk) => { sizeOutput += chunk.toString(); });
        sizeProc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
        sizeProc.on('error', reject);
        sizeProc.on('close', (sizeCode) => {
            if (sizeCode !== 0) {
                reject(new Error(stderr || `git cat-file failed for ${rev}`));
                return;
            }

            const blobProc = spawn('git', ['show', rev], { cwd: REPO_ROOT });
            blobProc.on('error', reject);
            blobProc.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
            blobProc.on('close', (blobCode) => {
                if (blobCode !== 0) {
                    reject(new Error(stderr || `git show failed for ${rev}`));
                    return;
                }
                resolve();
            });

            res.set('Cache-Control', 'no-store, max-age=0');
            res.set('Content-Type', contentTypeForFileName(fileName));
            const size = parseInt(sizeOutput.trim(), 10);
            if (Number.isFinite(size) && size >= 0) {
                res.set('Content-Length', String(size));
            }
            res.set('Content-Disposition', `attachment; filename="${String(fileName || path.basename(filePath)).replace(/"/g, '')}"`);
            blobProc.stdout.pipe(res);
        });
    });
}

function resolveDownloadTarget(artifact, kind = '') {
    const metadata = artifact?.metadata && typeof artifact.metadata === 'object'
        ? artifact.metadata
        : {};

    const pick = (...candidates) => {
        const selected = firstNonEmpty(...candidates);
        return selected && !isLocalProxyUrl(selected) ? selected : '';
    };

    switch (kind) {
        case 'setup':
            return {
                url: pick(metadata.sourceSetupUrl, metadata.setup_source_url),
                fileName: firstNonEmpty(metadata.setupFileName, artifact?.metadata?.setupFileName, 'neuralv-setup.exe')
            };
        case 'portable':
            return {
                url: pick(metadata.sourcePortableUrl, metadata.portable_source_url, metadata.sourceDownloadUrl),
                fileName: firstNonEmpty(metadata.portableFileName, artifact?.file_name, 'download.bin')
            };
        case 'daemon':
            return {
                url: pick(metadata.sourceDaemonUrl, metadata.daemon_source_url),
                fileName: firstNonEmpty(metadata.daemonFileName, 'download.bin')
            };
        case 'cli':
            return {
                url: pick(metadata.sourceStableCliArtifactUrl, metadata.sourceCliArtifactUrl, metadata.stable_cli_source_url),
                fileName: firstNonEmpty(metadata.cliFileName, 'download.bin')
            };
        case 'artifact':
            return {
                url: pick(metadata.sourceStableArtifactUrl, metadata.stable_artifact_source_url, metadata.sourceDownloadUrl),
                fileName: firstNonEmpty(artifact?.file_name, 'download.bin')
            };
        default:
            return {
                url: pick(metadata.sourceDownloadUrl, metadata.source_download_url, artifact?.download_url),
                fileName: firstNonEmpty(artifact?.file_name, 'download.bin')
            };
    }
}

function sanitizeArtifactForPublicResponse(artifact) {
    if (!artifact || typeof artifact !== 'object') {
        return artifact;
    }

    const platform = normalizePlatform(artifact.platform);
    const metadata = artifact.metadata && typeof artifact.metadata === 'object'
        ? JSON.parse(JSON.stringify(artifact.metadata))
        : {};

    const applyPublicTarget = (sourceKey, kind = '') => {
        if (metadata[sourceKey]) {
            metadata[sourceKey] = buildPublicReleaseDownloadUrl(platform, kind);
        }
    };

    if (metadata.source_repo) {
        metadata.source_repo = normalizeRepoName(metadata.source_repo);
    }
    if (metadata.versionSource && typeof metadata.versionSource === 'object' && metadata.versionSource.repo) {
        metadata.versionSource.repo = normalizeRepoName(metadata.versionSource.repo);
    }
    if (Array.isArray(metadata.relatedSources)) {
        metadata.relatedSources = metadata.relatedSources.map((entry) => {
            if (!entry || typeof entry !== 'object') {
                return entry;
            }
            return {
                ...entry,
                repo: normalizeRepoName(entry.repo)
            };
        });
    }

    applyPublicTarget('sourceDownloadUrl');
    applyPublicTarget('sourcePortableUrl', 'portable');
    applyPublicTarget('sourceSetupUrl', 'setup');
    applyPublicTarget('sourceDaemonUrl', 'daemon');
    applyPublicTarget('sourceStableArtifactUrl', 'artifact');
    applyPublicTarget('sourceStableCliArtifactUrl', 'cli');

    metadata.portableUrl = buildPublicReleaseDownloadUrl(platform, 'portable');
    if (platform === 'windows') {
        metadata.setupUrl = buildPublicReleaseDownloadUrl(platform, 'setup');
    }
    if (platform === 'shell') {
        metadata.daemonUrl = buildPublicReleaseDownloadUrl(platform, 'daemon');
        metadata.stableArtifactUrl = buildPublicReleaseDownloadUrl(platform, 'artifact');
        metadata.stableCliArtifactUrl = buildPublicReleaseDownloadUrl(platform, 'cli');
    }
    if (platform === 'linux') {
        metadata.stableArtifactUrl = buildPublicReleaseDownloadUrl(platform, 'artifact');
        metadata.stableCliArtifactUrl = buildPublicReleaseDownloadUrl(platform, 'cli');
        metadata.daemonUrl = buildPublicReleaseDownloadUrl(platform, 'daemon');
    }

    const powershellInstall = buildPublicInstallScriptUrl(platform, 'ps1');
    const cmdInstall = buildPublicInstallScriptUrl(platform, 'cmd');
    if (platform === 'windows') {
        if (metadata.installScriptPs1) metadata.installScriptPs1 = powershellInstall;
        if (metadata.installScriptCmd) metadata.installScriptCmd = cmdInstall;
        if (metadata.powershellInstallCommand && metadata.commands?.powershell?.install) {
            metadata.powershellInstallCommand = metadata.commands.powershell.install;
        }
        if (metadata.cmdInstallCommand && metadata.commands?.cmd?.install) {
            metadata.cmdInstallCommand = metadata.commands.cmd.install;
        }
    } else if (platform === 'linux' || platform === 'shell') {
        if (metadata.installScript) metadata.installScript = buildPublicInstallScriptUrl(platform, 'sh');
    }

    return {
        ...artifact,
        download_url: buildPublicReleaseDownloadUrl(platform),
        metadata
    };
}

router.get('/manifest', async (req, res) => {
    try {
        const manifest = await getReleaseManifest();
        res.set('Cache-Control', 'no-store, max-age=0');
        const artifacts = Array.isArray(manifest.artifacts)
            ? manifest.artifacts
            : Object.values(manifest.artifacts || {});
        const sources = Array.isArray(manifest.sources) ? manifest.sources : [];
        const platform = normalizePlatform(req.query.platform);
        const selectedArtifact = platform
            ? artifacts.find((artifact) => String(artifact.platform || '').trim().toLowerCase() === platform) || null
            : null;
        const publicArtifacts = artifacts.map((artifact) => sanitizeArtifactForPublicResponse(artifact));
        const publicSelectedArtifact = selectedArtifact ? sanitizeArtifactForPublicResponse(selectedArtifact) : null;

        return res.json({
            success: true,
            generated_at: manifest.generated_at,
            release_channel: manifest.release_channel || 'main',
            partial: Boolean(manifest.partial),
            platform: platform || null,
            version: publicSelectedArtifact?.version || null,
            download_url: publicSelectedArtifact?.download_url || null,
            install_command: publicSelectedArtifact?.install_command || null,
            update_command: publicSelectedArtifact?.update_command || null,
            update_policy: publicSelectedArtifact?.update_policy || null,
            auto_update: typeof publicSelectedArtifact?.auto_update === 'boolean' ? publicSelectedArtifact.auto_update : null,
            setupUrl: publicSelectedArtifact?.metadata?.setupUrl || publicSelectedArtifact?.download_url || null,
            portableUrl: publicSelectedArtifact?.metadata?.portableUrl || publicSelectedArtifact?.download_url || null,
            package_registry_url: publicSelectedArtifact?.metadata?.package_registry_url || null,
            package_name: publicSelectedArtifact?.metadata?.package_name || null,
            variant_id: publicSelectedArtifact?.metadata?.variant_id || null,
            selected_artifact: publicSelectedArtifact,
            sources,
            artifacts: publicArtifacts,
            manifest: {
                ...manifest,
                artifacts: publicArtifacts,
                sources
            }
        });
    } catch (error) {
        console.error('Release manifest error:', error);
        return res.status(500).json({ error: 'Release manifest is unavailable' });
    }
});

router.get('/download', async (req, res) => {
    try {
        const manifest = await getReleaseManifest();
        const artifacts = Array.isArray(manifest.artifacts)
            ? manifest.artifacts
            : Object.values(manifest.artifacts || {});
        const platform = normalizePlatform(req.query.platform);
        const kind = normalizeKind(req.query.kind);

        if (!platform) {
            return res.status(400).json({ error: 'platform is required' });
        }

        const artifact = artifacts.find((item) => String(item?.platform || '').trim().toLowerCase() === platform);
        if (!artifact) {
            return res.status(404).json({ error: 'artifact not found' });
        }

        const target = resolveDownloadTarget(artifact, kind);
        if (!target.url) {
            return res.status(404).json({ error: 'download target unavailable' });
        }

        target.url = rewriteInternalUrl(target.url);

        const internalRaw = parseInternalRawUrl(target.url);
        if (internalRaw) {
            await streamGitBlob(internalRaw.branch, internalRaw.filePath, res, target.fileName);
            return;
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 60000);
        let upstream;
        try {
            upstream = await fetch(target.url, {
                method: 'GET',
                redirect: 'follow',
                signal: controller.signal,
                headers: { 'User-Agent': 'NeuralVBackend/1.0' }
            });
        } finally {
            clearTimeout(timeout);
        }

        if (!upstream.ok || !upstream.body) {
            return res.status(502).json({ error: 'upstream download failed' });
        }

        const upstreamType = upstream.headers.get('content-type');
        const upstreamLength = upstream.headers.get('content-length');
        const upstreamDisposition = upstream.headers.get('content-disposition');
        const finalFileName = target.fileName || path.basename(new URL(target.url).pathname) || 'download.bin';

        res.set('Cache-Control', 'no-store, max-age=0');
        res.set('Content-Type', upstreamType || 'application/octet-stream');
        if (upstreamLength) {
            res.set('Content-Length', upstreamLength);
        }
        res.set('Content-Disposition', upstreamDisposition || `attachment; filename="${finalFileName.replace(/"/g, '')}"`);

        Readable.fromWeb(upstream.body).pipe(res);
    } catch (error) {
        console.error('Release download proxy error:', error);
        return res.status(500).json({ error: 'download proxy failed' });
    }
});

module.exports = router;
