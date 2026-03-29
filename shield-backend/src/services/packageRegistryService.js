const fs = require('fs');
const path = require('path');

const PACKAGE_REGISTRY_PATH = path.resolve(__dirname, '../data/package-registry.json');
const PACKAGE_REGISTRY_TIMEOUT_MS = parseInt(process.env.PACKAGE_REGISTRY_TIMEOUT_MS || '10000', 10);
const PACKAGE_REGISTRY_CACHE_TTL_MS = parseInt(process.env.PACKAGE_REGISTRY_CACHE_TTL_MS || '60000', 10);
const PACKAGE_REGISTRY_REMOTE_URL = String(
    process.env.PACKAGE_REGISTRY_REMOTE_URL || 'https://raw.githubusercontent.com/Perdonus/NV/main/registry/packages.json'
).trim();
const PUBLIC_WEB_BASE = String(process.env.PUBLIC_WEB_BASE || 'https://neuralvv.org').trim().replace(/\/+$/, '');
const NV_HUB_STORE_PATH = path.resolve(__dirname, '../data/nv-hub.json');

let registryCache = null;
let registryCacheExpiresAt = 0;

function loadLocalRegistryConfig() {
    const content = fs.readFileSync(PACKAGE_REGISTRY_PATH, 'utf8');
    const parsed = JSON.parse(content);
    return Array.isArray(parsed?.packages) ? parsed.packages : [];
}

function cloneJson(value) {
    return value == null ? value : JSON.parse(JSON.stringify(value));
}

function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

function normalizeOs(value) {
    const normalized = normalizeText(value);
    if (normalized === 'win32' || normalized === 'win') return 'windows';
    return normalized;
}

function normalizePlatform(value) {
    const normalized = normalizeText(value);
    switch (normalized) {
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
            return normalized;
    }
}

function buildPublicReleaseDownloadUrl(platform) {
    const normalized = normalizePlatform(platform);
    return `${PUBLIC_WEB_BASE}/basedata/api/releases/download?platform=${encodeURIComponent(normalized)}`;
}

function shouldProxyInternalDownload(source) {
    const repo = normalizeText(source?.repo);
    return repo === 'tpovesa/virusblock' || repo === 'perdonus/fatalerror' || repo === 'perdonus/nv';
}

function publicArtifactDownloadUrl(artifact, source) {
    if (!artifact) {
        return '';
    }
    if (shouldProxyInternalDownload(source)) {
        return buildPublicReleaseDownloadUrl(artifact.platform);
    }
    return String(artifact.download_url || '').trim();
}

function semverParts(raw) {
    const matched = String(raw || '').trim().match(/^(\d+)\.(\d+)\.(\d+)$/);
    if (!matched) return null;
    return matched.slice(1).map((value) => Number(value));
}

function compareSemver(left, right) {
    const a = semverParts(left);
    const b = semverParts(right);
    if (!a || !b) return 0;
    for (let index = 0; index < 3; index += 1) {
        if (a[index] !== b[index]) return a[index] > b[index] ? 1 : -1;
    }
    return 0;
}

function manifestUrl(source) {
    return `https://raw.githubusercontent.com/${source.repo}/${source.branch}/manifest.json`;
}

async function fetchJson(url) {
    const response = await fetch(url, {
        method: 'GET',
        headers: { Accept: 'application/json' },
        signal: AbortSignal.timeout(PACKAGE_REGISTRY_TIMEOUT_MS)
    });

    if (!response.ok) {
        throw new Error(`${url} responded with ${response.status}`);
    }
    return response.json();
}

function canonicalPackageName(rawName) {
    const normalized = normalizeText(rawName);
    const namespaced = normalized.match(/^@?([a-z0-9._-]+)\/([a-z0-9._-]+)$/);
    if (namespaced) {
        return `@${namespaced[1]}/${namespaced[2]}`;
    }
    switch (normalized) {
        case 'neuralv':
        case '@lvls/neuralv':
            return '@lvls/neuralv';
        case 'nv':
        case '@lvls/nv':
            return '@lvls/nv';
        default:
            return String(rawName || '').trim().toLowerCase();
    }
}

function parsePackageRef(rawRef) {
    let value = String(rawRef || '').trim();
    if (!value) {
        return { name: '', version: '' };
    }

    let version = '';
    if (value.startsWith('@')) {
        const versionSeparator = value.indexOf('@', 1);
        if (versionSeparator > 1) {
            version = value.slice(versionSeparator + 1).trim();
            value = value.slice(0, versionSeparator).trim();
        }
    } else {
        const versionSeparator = value.lastIndexOf('@');
        if (versionSeparator > 0) {
            version = value.slice(versionSeparator + 1).trim();
            value = value.slice(0, versionSeparator).trim();
        }
    }

    return {
        name: canonicalPackageName(value),
        version: normalizeText(version)
    };
}

function escapeRegExp(value) {
    return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function normalizePrimaryInstallCommand(command, packageName) {
    const raw = String(command || '').trim();
    const canonicalName = canonicalPackageName(packageName);
    if (!raw || !canonicalName) {
        return raw;
    }
    if (!/\bnv\s+install\b|nv\.exe/i.test(raw)) {
        return raw;
    }

    const aliases = canonicalName === '@lvls/neuralv'
        ? ['@lvls/neuralv', 'neuralv']
        : canonicalName === '@lvls/nv'
            ? ['@lvls/nv', 'nv']
            : [canonicalName];

    let output = raw;
    for (const alias of aliases) {
        const pattern = new RegExp(`(\\binstall\\s+)${escapeRegExp(alias)}(?:@([a-z0-9][a-z0-9._-]*))?(?=(?:\\s|["');&|])|$)`, 'gi');
        output = output.replace(pattern, (_, prefix, version = '') => {
            const normalizedVersion = normalizeText(version);
            return `${prefix}${normalizedVersion && normalizedVersion !== 'latest' ? `${canonicalName}@${normalizedVersion}` : canonicalName}`;
        });
    }

    return output;
}

function ensureArray(value) {
    return Array.isArray(value) ? value : [];
}

function loadHubStorePackages() {
    try {
        const raw = fs.readFileSync(NV_HUB_STORE_PATH, 'utf8');
        const parsed = JSON.parse(raw);
        return ensureArray(parsed?.packages);
    } catch {
        return [];
    }
}

function ensureAliases(packageDef, fallbacks = []) {
    const aliases = new Set();
    for (const entry of [...ensureArray(packageDef?.aliases), ...fallbacks]) {
        const normalized = String(entry || '').trim().toLowerCase();
        if (normalized) {
            aliases.add(normalized);
        }
    }
    const canonical = canonicalPackageName(packageDef?.name || '');
    if (canonical === '@lvls/neuralv') aliases.add('neuralv');
    if (canonical === '@lvls/nv') aliases.add('nv');
    aliases.delete(canonical.toLowerCase());
    return Array.from(aliases);
}

function normalizeSourceDefinition(source, role = 'primary') {
    if (!source || typeof source !== 'object') {
        return null;
    }
    const repo = String(source.repo || '').trim();
    const branch = String(source.branch || '').trim();
    const platform = normalizePlatform(source.platform);
    if (!repo || !branch || !platform) {
        return null;
    }
    return {
        type: String(source.type || 'github-branch-manifest').trim() || 'github-branch-manifest',
        repo,
        branch,
        platform,
        role: String(source.role || role).trim() || role
    };
}

function findVariant(packageDef, predicate) {
    return ensureArray(packageDef?.variants).find(predicate) || null;
}

function canonicalizeNeuralVPackage(packageDef) {
    const variants = ensureArray(packageDef?.variants);
    const windowsVariant = findVariant(packageDef, (variant) => {
        const id = normalizeText(variant?.id);
        const os = normalizeOs(variant?.os);
        const platform = normalizePlatform(variant?.source?.platform || variant?.metadata?.artifactPlatform);
        return id === 'windows' || id === 'windows-gui' || os === 'windows' || platform === 'windows';
    });
    const linuxVariant = findVariant(packageDef, (variant) => {
        const id = normalizeText(variant?.id);
        const os = normalizeOs(variant?.os);
        const platform = normalizePlatform(variant?.source?.platform || variant?.metadata?.artifactPlatform);
        return id === 'linux' || id === 'linux-gui' || os === 'linux' || platform === 'linux';
    });
    const linuxCliVariant = findVariant(packageDef, (variant) => {
        const id = normalizeText(variant?.id);
        const platform = normalizePlatform(variant?.source?.platform || variant?.metadata?.artifactPlatform);
        return id === 'linux-cli' || platform === 'shell';
    });

    const windowsMetadata = { ...(windowsVariant?.metadata || {}) };
    const windowsVariantRecord = {
        id: 'windows',
        label: String(windowsVariant?.label || 'Windows').trim() || 'Windows',
        os: 'windows',
        default: true,
        install_strategy: String(windowsVariant?.install_strategy || 'windows-desktop-bundle').trim(),
        uninstall_strategy: String(windowsVariant?.uninstall_strategy || 'windows-remove-dir').trim(),
        install_root: String(windowsVariant?.install_root || '%LOCALAPPDATA%/Programs/NeuralV').trim(),
        launcher_path: String(windowsVariant?.launcher_path || 'NeuralV.exe').trim(),
        binary_name: String(windowsVariant?.binary_name || windowsMetadata.cliBinary || 'neuralv.exe').trim(),
        install_command: '%LOCALAPPDATA%\\NV\\nv.exe install @lvls/neuralv',
        update_command: '%LOCALAPPDATA%\\NV\\nv.exe install @lvls/neuralv',
        update_policy: String(windowsVariant?.update_policy || 'startup-auto').trim() || 'startup-auto',
        auto_update: typeof windowsVariant?.auto_update === 'boolean' ? windowsVariant.auto_update : true,
        source: normalizeSourceDefinition(windowsVariant?.source, 'gui') || {
            type: 'github-branch-manifest',
            repo: 'TPovesa/VirusBlock',
            branch: 'windows-builds',
            platform: 'windows',
            role: 'gui'
        },
        metadata: {
            ...windowsMetadata,
            artifactPlatform: 'windows',
            desktopTrack: String(windowsMetadata.desktopTrack || 'windows').trim() || 'windows',
            versionSourceFile: String(windowsMetadata.versionSourceFile || 'versions/windows.txt').trim() || 'versions/windows.txt',
            bundledComponents: ['gui', 'cli', 'updater'],
            cliBinary: String(windowsMetadata.cliBinary || windowsVariant?.binary_name || 'neuralv.exe').trim(),
            guiBinaryName: String(windowsMetadata.guiBinaryName || 'NeuralV.Gui.exe').trim(),
            launcherBinaryName: String(windowsMetadata.launcherBinaryName || 'NeuralV.exe').trim(),
            updaterBinaryName: String(windowsMetadata.updaterBinaryName || 'neuralv-updater.exe').trim(),
            updaterHostBinaryName: String(windowsMetadata.updaterHostBinaryName || 'neuralv-updater-host.exe').trim(),
            guiRelativePath: String(windowsMetadata.guiRelativePath || 'libs/NeuralV.Gui.exe').trim(),
            cliRelativePath: String(windowsMetadata.cliRelativePath || 'bin/neuralv.exe').trim(),
            updaterRelativePath: String(windowsMetadata.updaterRelativePath || 'bin/neuralv-updater.exe').trim(),
            updaterHostRelativePath: String(windowsMetadata.updaterHostRelativePath || 'libs/neuralv-updater-host.exe').trim(),
            logRelativePath: String(windowsMetadata.logRelativePath || 'log.txt').trim(),
            binDirectory: String(windowsMetadata.binDirectory || 'bin').trim(),
            libsDirectory: String(windowsMetadata.libsDirectory || 'libs').trim(),
            commands: {
                ...(windowsMetadata.commands || {}),
                powershell: {
                    ...((windowsMetadata.commands && windowsMetadata.commands.powershell) || {}),
                    install: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://neuralvv.org/install/nv.ps1 | iex; & (Join-Path $env:LOCALAPPDATA \'NV\\nv.exe\') install @lvls/neuralv"',
                    update: '& (Join-Path $env:LOCALAPPDATA \'NV\\nv.exe\') install @lvls/neuralv'
                },
                cmd: {
                    ...((windowsMetadata.commands && windowsMetadata.commands.cmd) || {}),
                    install: 'curl.exe -fsSL https://neuralvv.org/install/nv.cmd -o "%TEMP%\\nv-install.cmd" && cmd /c "%TEMP%\\nv-install.cmd" && "%LOCALAPPDATA%\\NV\\nv.exe" install @lvls/neuralv',
                    update: '"%LOCALAPPDATA%\\NV\\nv.exe" install @lvls/neuralv'
                }
            }
        }
    };

    const linuxMetadata = { ...(linuxVariant?.metadata || {}) };
    const relatedSources = [];
    const primaryLinuxSource = normalizeSourceDefinition(linuxVariant?.source, 'gui') || {
        type: 'github-branch-manifest',
        repo: 'TPovesa/VirusBlock',
        branch: 'linux-gui-builds',
        platform: 'linux',
        role: 'gui'
    };
    const explicitRelated = ensureArray(linuxMetadata.relatedSources).map((entry) => normalizeSourceDefinition(entry, entry?.role || 'related')).filter(Boolean);
    for (const entry of explicitRelated) {
        relatedSources.push(entry);
    }
    const cliSource = normalizeSourceDefinition(linuxCliVariant?.source, 'cli');
    if (cliSource && !relatedSources.some((entry) => `${entry.repo}::${entry.branch}::${entry.platform}` === `${cliSource.repo}::${cliSource.branch}::${cliSource.platform}`)) {
        relatedSources.push(cliSource);
    }

    const directPackages = linuxMetadata.directPackages || linuxMetadata.packages || {};
    const linuxVariantRecord = {
        id: 'linux',
        label: String(linuxVariant?.label || 'Linux').trim() || 'Linux',
        os: 'linux',
        default: true,
        install_strategy: String(linuxVariant?.install_strategy || 'linux-desktop-unified').trim(),
        uninstall_strategy: String(linuxVariant?.uninstall_strategy || 'linux-remove-dir').trim(),
        install_root: String(linuxVariant?.install_root || '$HOME/.local/opt/NeuralV').trim(),
        launcher_path: String(linuxVariant?.launcher_path || 'bin/NeuralV').trim(),
        binary_name: String(linuxVariant?.binary_name || 'neuralv').trim(),
        wrapper_name: String(linuxVariant?.wrapper_name || linuxCliVariant?.wrapper_name || 'neuralv').trim(),
        install_command: 'nv install @lvls/neuralv',
        update_command: 'nv install @lvls/neuralv',
        update_policy: String(linuxVariant?.update_policy || 'nv-command').trim() || 'nv-command',
        auto_update: typeof linuxVariant?.auto_update === 'boolean' ? linuxVariant.auto_update : false,
        source: primaryLinuxSource,
        metadata: {
            ...linuxMetadata,
            artifactPlatform: 'linux',
            desktopTrack: String(linuxMetadata.desktopTrack || 'linux').trim() || 'linux',
            versionSourceFile: String(linuxMetadata.versionSourceFile || 'versions/linux-gui.txt').trim() || 'versions/linux-gui.txt',
            bundledComponents: ['gui', 'cli'],
            relatedSources,
            directPackages,
            stableCliArtifactPath: String(linuxMetadata.stableCliArtifactPath || linuxCliVariant?.metadata?.stableArtifactPath || 'shell/neuralv-shell-linux.tar.gz').trim(),
            stableDaemonArtifactPath: String(linuxMetadata.stableDaemonArtifactPath || linuxCliVariant?.metadata?.stableDaemonArtifactPath || 'shell/neuralvd-linux.tar.gz').trim()
        }
    };

    return {
        name: '@lvls/neuralv',
        aliases: ensureAliases(packageDef, ['neuralv']),
        title: String(packageDef?.title || 'NeuralV').trim() || 'NeuralV',
        description: String(packageDef?.description || 'Клиент защиты NeuralV для Windows и Linux.').trim(),
        homepage: String(packageDef?.homepage || 'https://neuralvv.org/').trim(),
        variants: [windowsVariantRecord, linuxVariantRecord]
    };
}

function canonicalizeNvPackage(packageDef) {
    const linuxVariant = findVariant(packageDef, (variant) => normalizeOs(variant?.os) === 'linux' || normalizePlatform(variant?.source?.platform) === 'nv-linux');
    const windowsVariant = findVariant(packageDef, (variant) => normalizeOs(variant?.os) === 'windows' || normalizePlatform(variant?.source?.platform) === 'nv-windows');

    return {
        name: '@lvls/nv',
        aliases: ensureAliases(packageDef, ['nv']),
        title: String(packageDef?.title || 'NV').trim() || 'NV',
        description: String(packageDef?.description || 'Пакетный менеджер NeuralV.').trim(),
        homepage: String(packageDef?.homepage || 'https://neuralvv.org/nv/').trim(),
        variants: [
            {
                id: String(linuxVariant?.id || 'nv-linux').trim() || 'nv-linux',
                label: String(linuxVariant?.label || 'NV Linux').trim() || 'NV Linux',
                os: 'linux',
                default: true,
                install_strategy: String(linuxVariant?.install_strategy || 'unix-self-binary').trim(),
                install_root: String(linuxVariant?.install_root || '$HOME/.local/bin').trim(),
                binary_name: String(linuxVariant?.binary_name || 'nv').trim(),
                install_command: String(linuxVariant?.install_command || 'curl -fsSL https://neuralvv.org/install/nv.sh | sh').trim(),
                update_command: 'nv install @lvls/nv',
                update_policy: String(linuxVariant?.update_policy || 'nv-self').trim() || 'nv-self',
                auto_update: typeof linuxVariant?.auto_update === 'boolean' ? linuxVariant.auto_update : false,
                source: normalizeSourceDefinition(linuxVariant?.source, 'primary') || {
                    type: 'github-branch-manifest',
                    repo: 'Perdonus/NV',
                    branch: 'linux-builds',
                    platform: 'nv-linux',
                    role: 'primary'
                },
                metadata: {
                    ...(linuxVariant?.metadata || {}),
                    artifactPlatform: 'nv-linux',
                    packageTrack: String(linuxVariant?.metadata?.packageTrack || 'nv-linux').trim() || 'nv-linux'
                }
            },
            {
                id: String(windowsVariant?.id || 'nv-windows').trim() || 'nv-windows',
                label: String(windowsVariant?.label || 'NV Windows').trim() || 'NV Windows',
                os: 'windows',
                default: true,
                install_strategy: String(windowsVariant?.install_strategy || 'windows-self-binary').trim(),
                install_root: String(windowsVariant?.install_root || '%LOCALAPPDATA%/NV').trim(),
                binary_name: String(windowsVariant?.binary_name || 'nv.exe').trim(),
                install_command: String(windowsVariant?.install_command || 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://neuralvv.org/install/nv.ps1 | iex"').trim(),
                update_command: '%LOCALAPPDATA%\\NV\\nv.exe install @lvls/nv',
                update_policy: String(windowsVariant?.update_policy || 'nv-self').trim() || 'nv-self',
                auto_update: typeof windowsVariant?.auto_update === 'boolean' ? windowsVariant.auto_update : false,
                source: normalizeSourceDefinition(windowsVariant?.source, 'primary') || {
                    type: 'github-branch-manifest',
                    repo: 'Perdonus/NV',
                    branch: 'windows-builds',
                    platform: 'nv-windows',
                    role: 'primary'
                },
                metadata: {
                    ...(windowsVariant?.metadata || {}),
                    artifactPlatform: 'nv-windows',
                    packageTrack: String(windowsVariant?.metadata?.packageTrack || 'nv-windows').trim() || 'nv-windows'
                }
            }
        ]
    };
}

function canonicalizeGenericPackage(packageDef) {
    return {
        ...cloneJson(packageDef),
        name: canonicalPackageName(packageDef?.name),
        aliases: ensureAliases(packageDef)
    };
}

function canonicalizeRegistryPackages(packages) {
    const byCanonicalName = new Map();

    for (const rawPackage of ensureArray(packages)) {
        const packageDef = cloneJson(rawPackage);
        const canonicalName = canonicalPackageName(packageDef?.name);
        let normalized = null;
        if (canonicalName === '@lvls/neuralv') {
            normalized = canonicalizeNeuralVPackage(packageDef);
        } else if (canonicalName === '@lvls/nv') {
            normalized = canonicalizeNvPackage(packageDef);
        } else {
            normalized = canonicalizeGenericPackage(packageDef);
        }

        const existing = byCanonicalName.get(normalized.name);
        if (!existing) {
            byCanonicalName.set(normalized.name, normalized);
            continue;
        }

        const aliasSet = new Set([...ensureAliases(existing), ...ensureAliases(normalized)]);
        byCanonicalName.set(normalized.name, {
            ...existing,
            ...normalized,
            aliases: Array.from(aliasSet),
            variants: ensureArray(normalized.variants).length ? normalized.variants : existing.variants
        });
    }

    return Array.from(byCanonicalName.values());
}

async function loadRegistryConfig() {
    if (registryCache && registryCacheExpiresAt > Date.now()) {
        return registryCache;
    }

    const localPackages = canonicalizeRegistryPackages(loadLocalRegistryConfig());
    let packages = localPackages;
    let source = 'local';
    let sourceUrl = null;
    let fetchedAt = new Date().toISOString();

    if (PACKAGE_REGISTRY_REMOTE_URL) {
        try {
            const remote = await fetchJson(PACKAGE_REGISTRY_REMOTE_URL);
            if (Array.isArray(remote?.packages)) {
                packages = canonicalizeRegistryPackages(remote.packages);
                source = 'remote';
                sourceUrl = PACKAGE_REGISTRY_REMOTE_URL;
                fetchedAt = new Date().toISOString();
            }
        } catch (error) {
            console.warn(`Package registry remote fetch failed: ${error instanceof Error ? error.message : String(error)}`);
        }
    }

    registryCache = { packages, source, sourceUrl, fetchedAt };
    registryCacheExpiresAt = Date.now() + PACKAGE_REGISTRY_CACHE_TTL_MS;
    return registryCache;
}

function normalizeArtifact(item) {
    if (!item || typeof item !== 'object') return null;
    const platform = normalizePlatform(item.platform || item.platform_id || item.id);
    if (!platform) return null;
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
        notes: Array.isArray(item.notes) ? item.notes.map((entry) => String(entry).trim()).filter(Boolean) : [],
        metadata: item.metadata && typeof item.metadata === 'object' ? { ...item.metadata } : {}
    };
}

async function fetchSourceArtifact(source) {
    if (!source || source.type !== 'github-branch-manifest') {
        return null;
    }
    const manifest = await fetchJson(manifestUrl(source));
    const artifacts = Array.isArray(manifest?.artifacts) ? manifest.artifacts : [];
    const platform = normalizePlatform(source.platform);
    const matching = artifacts
        .map(normalizeArtifact)
        .filter(Boolean)
        .filter((artifact) => artifact.platform === platform)
        .sort((left, right) => compareSemver(right.version, left.version));
    return matching[0] || null;
}

function collectVariantSources(definition) {
    const sources = [];
    const pushSource = (entry, role = 'primary') => {
        const normalized = normalizeSourceDefinition(entry, role);
        if (!normalized) {
            return;
        }
        const key = `${normalized.repo}::${normalized.branch}::${normalized.platform}`;
        if (sources.some((source) => `${source.repo}::${source.branch}::${source.platform}` === key)) {
            return;
        }
        sources.push(normalized);
    };

    pushSource(definition?.source, definition?.source?.role || 'primary');
    for (const entry of ensureArray(definition?.sources)) {
        pushSource(entry, entry?.role || 'related');
    }
    for (const entry of ensureArray(definition?.metadata?.relatedSources)) {
        pushSource(entry, entry?.role || 'related');
    }

    return sources;
}

function listPackageVariantSourceMappings(packages) {
    const mappings = [];
    for (const packageDef of ensureArray(packages)) {
        for (const variantDef of ensureArray(packageDef?.variants)) {
            for (const source of collectVariantSources(variantDef)) {
                mappings.push({
                    key: `${source.repo}::${source.branch}::${source.platform}`,
                    packageDef,
                    variantDef,
                    source
                });
            }
        }
    }
    return mappings;
}

function defaultUpdatePolicy(definition) {
    if (typeof definition.update_policy === 'string' && definition.update_policy.trim()) {
        return definition.update_policy.trim();
    }
    const strategy = String(definition.install_strategy || '').trim();
    if (strategy === 'linux-cli-wrapper' || strategy === 'linux-desktop-unified') return 'nv-command';
    if (strategy === 'windows-self-binary' || strategy === 'unix-self-binary') return 'nv-self';
    if (strategy === 'windows-portable-zip' || strategy === 'linux-portable-tar' || strategy === 'windows-desktop-bundle') return 'startup-auto';
    return 'manual';
}

function defaultAutoUpdate(definition, updatePolicy) {
    if (typeof definition.auto_update === 'boolean') {
        return definition.auto_update;
    }
    return updatePolicy === 'startup-auto';
}

function buildComponentArtifacts(primarySource, primaryArtifact, relatedArtifacts) {
    const components = [];
    const pushComponent = (source, artifact) => {
        if (!artifact) {
            return;
        }
        components.push({
            role: String(source?.role || 'primary').trim() || 'primary',
            platform: artifact.platform,
            version: artifact.version,
            download_url: publicArtifactDownloadUrl(artifact, source),
            file_name: artifact.file_name,
            sha256: artifact.sha256,
            channel: artifact.channel
        });
    };

    pushComponent(primarySource, primaryArtifact);
    for (const entry of relatedArtifacts) {
        pushComponent(entry.source, entry.artifact);
    }
    return components;
}

function buildVariantRecord(packageDef, definition, primaryArtifact, primarySource, relatedArtifacts) {
    const updatePolicy = defaultUpdatePolicy(definition);
    const autoUpdate = defaultAutoUpdate(definition, updatePolicy);
    const definitionMetadata = definition.metadata && typeof definition.metadata === 'object' ? definition.metadata : {};
    const primaryArtifactMetadata = primaryArtifact?.metadata && typeof primaryArtifact.metadata === 'object' ? primaryArtifact.metadata : {};
    const components = buildComponentArtifacts(primarySource, primaryArtifact, relatedArtifacts);
    const componentVersions = components.reduce((accumulator, component) => {
        if (component.role && component.version) {
            accumulator[component.role] = component.version;
        }
        return accumulator;
    }, {});

    return {
        id: String(definition.id || '').trim(),
        label: String(definition.label || definition.id || '').trim(),
        os: normalizeOs(definition.os),
        is_default: Boolean(definition.default),
        version: primaryArtifact?.version || '',
        channel: primaryArtifact?.channel || 'main',
        file_name: primaryArtifact?.file_name || '',
        download_url: publicArtifactDownloadUrl(primaryArtifact, primarySource),
        install_command: normalizePrimaryInstallCommand(
            String(definition.install_command || primaryArtifact?.install_command || '').trim(),
            packageDef.name
        ),
        update_command: normalizePrimaryInstallCommand(
            String(definition.update_command || primaryArtifact?.update_command || '').trim(),
            packageDef.name
        ),
        update_policy: updatePolicy,
        auto_update: autoUpdate,
        sha256: primaryArtifact?.sha256 || '',
        install_strategy: String(definition.install_strategy || '').trim(),
        uninstall_strategy: String(definition.uninstall_strategy || '').trim(),
        install_root: String(definition.install_root || '').trim(),
        binary_name: String(definition.binary_name || '').trim(),
        wrapper_name: String(definition.wrapper_name || '').trim(),
        launcher_path: String(definition.launcher_path || '').trim(),
        notes: primaryArtifact?.notes?.length ? primaryArtifact.notes : [],
        components,
        metadata: {
            ...definitionMetadata,
            ...primaryArtifactMetadata,
            source: definition.source || null,
            package_name: String(packageDef.name || '').trim(),
            package_aliases: ensureAliases(packageDef),
            variant_id: String(definition.id || '').trim(),
            update_policy: updatePolicy,
            auto_update: autoUpdate,
            manifest_url: primarySource?.repo && primarySource?.branch ? manifestUrl(primarySource) : '',
            component_versions: componentVersions,
            related_artifacts: relatedArtifacts.map((entry) => ({
                role: entry.source.role,
                platform: entry.artifact.platform,
                version: entry.artifact.version,
                download_url: publicArtifactDownloadUrl(entry.artifact, entry.source),
                file_name: entry.artifact.file_name,
                sha256: entry.artifact.sha256,
                manifest_url: manifestUrl(entry.source)
            }))
        }
    };
}

async function materializeVariant(packageDef, definition) {
    const sources = collectVariantSources(definition);
    const artifacts = [];
    for (const source of sources) {
        const artifact = await fetchSourceArtifact(source);
        artifacts.push({ source, artifact });
    }

    const primaryEntry = artifacts.find((entry) => entry.source.role === 'primary') || artifacts[0] || { source: null, artifact: null };
    const relatedEntries = artifacts.filter((entry) => entry !== primaryEntry && entry.artifact);
    return buildVariantRecord(packageDef, definition, primaryEntry.artifact, primaryEntry.source, relatedEntries);
}

async function materializePackage(packageDef, os = '') {
    const requestedOs = normalizeOs(os);
    const variantDefs = ensureArray(packageDef?.variants);
    const chosenDefs = requestedOs
        ? variantDefs.filter((variant) => normalizeOs(variant.os) === requestedOs)
        : variantDefs;

    const variants = [];
    for (const definition of chosenDefs) {
        variants.push(await materializeVariant(packageDef, definition));
    }

    const latestVersions = variants.reduce((accumulator, variant) => {
        if (variant.os && variant.version) {
            accumulator[variant.os] = variant.version;
        }
        return accumulator;
    }, {});

    const latestVersion = requestedOs
        ? (latestVersions[requestedOs] || '')
        : (Object.keys(latestVersions).length === 1 ? Object.values(latestVersions)[0] : '');

    return {
        name: String(packageDef.name || '').trim(),
        aliases: ensureAliases(packageDef),
        title: String(packageDef.title || packageDef.name || '').trim(),
        description: String(packageDef.description || '').trim(),
        homepage: String(packageDef.homepage || '').trim(),
        latest_version: latestVersion,
        latest_versions: latestVersions,
        variants
    };
}

function normalizeHubRelease(release, packageDef) {
    const os = normalizeOs(release?.os || release?.platform || '');
    if (!os) {
        return null;
    }
    const version = String(release?.version || '').trim();
    if (!version) {
        return null;
    }
    return {
        id: `${os}-${version}`,
        label: platformLabelForHub(os),
        os,
        is_default: false,
        version,
        channel: String(release?.channel || 'community').trim() || 'community',
        file_name: String(release?.file_name || '').trim(),
        download_url: String(release?.download_url || '').trim(),
        install_command: normalizePrimaryInstallCommand(
            String(release?.install_command || packageDef.install_command || `nv install ${packageDef.name}`).trim(),
            packageDef.name
        ),
        update_command: normalizePrimaryInstallCommand(
            String(release?.update_command || packageDef.update_command || packageDef.install_command || `nv install ${packageDef.name}`).trim(),
            packageDef.name
        ),
        update_policy: 'nv-command',
        auto_update: false,
        sha256: String(release?.sha256 || '').trim(),
        install_strategy: String(release?.install_strategy || '').trim(),
        uninstall_strategy: '',
        install_root: '',
        binary_name: '',
        wrapper_name: '',
        launcher_path: '',
        notes: ensureArray(release?.notes).map((entry) => String(entry || '').trim()).filter(Boolean),
        metadata: release?.metadata && typeof release.metadata === 'object'
            ? {
                ...release.metadata,
                source: 'hub',
                package_name: packageDef.name,
                variant_id: `${os}-${version}`
            }
            : {
                source: 'hub',
                package_name: packageDef.name,
                variant_id: `${os}-${version}`
            }
    };
}

function platformLabelForHub(os) {
    return os === 'windows' ? 'Windows' : os === 'linux' ? 'Linux' : os;
}

function materializeHubPackage(rawPackage, os = '') {
    const requestedOs = normalizeOs(os);
    const creatorSlug = normalizeText(rawPackage?.creator_slug || parsePackageRef(rawPackage?.name || '').name.split('/')[0] || '').replace(/^@/, '');
    const packageSlug = normalizeText(rawPackage?.package_slug || parsePackageRef(rawPackage?.name || '').name.split('/')[1] || '');
    const canonicalName = canonicalPackageName(rawPackage?.name || (creatorSlug && packageSlug ? `@${creatorSlug}/${packageSlug}` : ''));
    if (!canonicalName || String(rawPackage?.visibility || 'public').trim() !== 'public') {
        return null;
    }

    const variants = ensureArray(rawPackage?.releases)
        .map((release) => normalizeHubRelease(release, {
            name: canonicalName,
            install_command: String(rawPackage?.install_command || `nv install ${canonicalName}`).trim(),
            update_command: String(rawPackage?.update_command || rawPackage?.install_command || `nv install ${canonicalName}`).trim()
        }))
        .filter(Boolean)
        .filter((variant) => !requestedOs || variant.os === requestedOs)
        .sort((left, right) => {
            const versionDelta = compareSemver(right.version, left.version);
            if (versionDelta !== 0) return versionDelta;
            return left.os.localeCompare(right.os);
        });

    const latestVersions = variants.reduce((accumulator, variant) => {
        if (!accumulator[variant.os]) {
            accumulator[variant.os] = variant.version;
        }
        return accumulator;
    }, {});

    const defaultKeys = new Set();
    for (const variant of variants) {
        if (!defaultKeys.has(variant.os)) {
            variant.is_default = true;
            defaultKeys.add(variant.os);
        }
    }

    const latestVersion = requestedOs
        ? (latestVersions[requestedOs] || '')
        : (Object.keys(latestVersions).length === 1 ? Object.values(latestVersions)[0] : String(rawPackage?.latest_version || variants[0]?.version || '').trim());

    return {
        name: canonicalName,
        aliases: [],
        title: String(rawPackage?.title || packageSlug || canonicalName).trim(),
        description: String(rawPackage?.description || '').trim(),
        homepage: String(rawPackage?.homepage || '').trim(),
        latest_version: latestVersion,
        latest_versions: latestVersions,
        variants
    };
}

function loadHubMaterializedPackages(os = '') {
    return loadHubStorePackages()
        .map((pkg) => materializeHubPackage(pkg, os))
        .filter(Boolean);
}

function matchesPackageRef(packageDef, rawRef) {
    const parsed = parsePackageRef(rawRef);
    const canonicalName = String(packageDef?.name || '').trim().toLowerCase();
    if (parsed.name && parsed.name === canonicalName) {
        return true;
    }
    const aliases = ensureAliases(packageDef).map((entry) => entry.toLowerCase());
    const raw = normalizeText(rawRef);
    return aliases.includes(raw) || aliases.includes(parsed.name);
}

async function getPackageRegistry({ os = '' } = {}) {
    const registry = await loadRegistryConfig();
    const materialized = [];
    for (const packageDef of registry.packages) {
        materialized.push(await materializePackage(packageDef, os));
    }
    const hubPackages = loadHubMaterializedPackages(os);
    const merged = new Map();
    for (const pkg of [...materialized, ...hubPackages]) {
        merged.set(pkg.name, pkg);
    }
    return {
        success: true,
        source: registry.source,
        source_url: registry.sourceUrl,
        fetched_at: registry.fetchedAt,
        packages: Array.from(merged.values())
    };
}

async function getPackageDetails(name, { os = '' } = {}) {
    const registry = await loadRegistryConfig();
    const packageDef = registry.packages.find((entry) => matchesPackageRef(entry, name));
    if (packageDef) {
        return {
            success: true,
            source: registry.source,
            source_url: registry.sourceUrl,
            fetched_at: registry.fetchedAt,
            package: await materializePackage(packageDef, os)
        };
    }
    const hubPackage = loadHubMaterializedPackages(os).find((entry) => matchesPackageRef(entry, name));
    if (!hubPackage) {
        return null;
    }
    return {
        success: true,
        source: 'hub',
        source_url: '',
        fetched_at: new Date().toISOString(),
        package: hubPackage
    };
}

function pickVariant(pkg, variantId, requestedVersion) {
    const normalizedVariant = normalizeText(variantId);
    let variants = pkg.variants || [];
    if (normalizedVariant) {
        variants = variants.filter((variant) => normalizeText(variant.id) === normalizedVariant);
    }
    if (!variants.length) {
        return null;
    }
    if (requestedVersion && requestedVersion !== 'latest') {
        return variants.find((variant) => variant.version === requestedVersion) || null;
    }
    return variants.find((variant) => variant.is_default && variant.version)
        || variants.find((variant) => variant.version)
        || variants[0];
}

async function resolvePackage(name, { os = '', version = 'latest', variant = '' } = {}) {
    const parsed = parsePackageRef(name);
    const requestedVersion = normalizeText(version) || parsed.version || 'latest';
    const details = await getPackageDetails(parsed.name || name, { os });
    if (!details) {
        return {
            status: 404,
            payload: { error: `Пакет ${name} не найден` }
        };
    }

    const selectedVariant = pickVariant(details.package, variant, requestedVersion);
    if (!selectedVariant) {
        return {
            status: 404,
            payload: { error: `Для пакета ${name} не найден подходящий вариант` }
        };
    }

    return {
        status: 200,
        payload: {
            success: true,
            source: details.source,
            source_url: details.source_url,
            fetched_at: details.fetched_at,
            package: {
                ...details.package,
                resolved_version: selectedVariant.version,
                variant: selectedVariant
            }
        }
    };
}

module.exports = {
    getPackageRegistry,
    getPackageDetails,
    resolvePackage,
    loadRegistryConfig,
    compareSemver,
    canonicalPackageName,
    parsePackageRef,
    listPackageVariantSourceMappings
};
