const path = require('path');

const SUPPORTED_PLATFORMS = new Set(['WINDOWS', 'LINUX']);
const SUPPORTED_MODES = new Set(['ON_DEMAND', 'SELECTIVE', 'ARTIFACT', 'RESIDENT_EVENT', 'QUICK', 'FULL']);
const HARD_SIGNAL_TYPES = new Set([
    'virustotal',
    'publisher_untrusted',
    'suspicious_imports',
    'high_entropy',
    'script_exec_chain',
    'autorun_persistence',
    'privilege_escalation',
    'dropped_binary',
    'unsigned_binary',
    'tampered_binary'
]);

function normalizeString(value, maxLength = 255) {
    const normalized = String(value || '').trim();
    return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizeStringList(value, limit = 32, maxLength = 120) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(new Set(
        value
            .map((item) => normalizeString(item, maxLength))
            .filter(Boolean)
    )).slice(0, limit);
}

function normalizePathEntry(value, maxLength = 700) {
    const normalized = String(value || '').trim().replace(/^["']+|["']+$/g, '');
    return normalized ? normalized.slice(0, maxLength) : null;
}

function normalizePathList(value, limit = 256, maxLength = 700) {
    if (!Array.isArray(value)) {
        return [];
    }

    const result = [];
    const seen = new Set();
    for (const item of value) {
        const candidate = typeof item === 'string'
            ? normalizePathEntry(item, maxLength)
            : normalizePathEntry(
                item?.path || item?.root || item?.dir || item?.directory || item?.location || item?.mount || item?.mountPoint,
                maxLength
            );
        if (!candidate) continue;
        const key = candidate.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(candidate);
        if (result.length >= limit) break;
    }
    return result;
}

function normalizeObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function mergeObjects(...values) {
    return Object.assign({}, ...values.map((value) => normalizeObject(value)));
}

function normalizeBoolean(value) {
    return value === true || value === 'true' || value === 1 || value === '1';
}

function normalizeSeverity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['critical', 'high', 'medium', 'low'].includes(normalized)) {
        return normalized;
    }
    return 'low';
}

function normalizeScore(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed)) {
        return 0;
    }
    return Math.max(0, Math.min(100, Math.round(parsed)));
}

function normalizePositiveInt(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return null;
    }
    return Math.round(parsed);
}

function normalizeEntropy(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
        return null;
    }
    return Math.max(0, Math.min(8, parsed));
}

function normalizeSha256(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return /^[a-f0-9]{64}$/.test(normalized) ? normalized : null;
}

function uniqueStrings(values, limit = 256, maxLength = 700) {
    const result = [];
    const seen = new Set();
    for (const value of Array.isArray(values) ? values : []) {
        const normalized = normalizeString(value, maxLength);
        if (!normalized) continue;
        const key = normalized.toLowerCase();
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(normalized);
        if (result.length >= limit) break;
    }
    return result;
}

function basenameAnyPath(value) {
    const normalized = String(value || '').trim();
    const parts = normalized.split(/[\\/]/).filter(Boolean);
    return parts[parts.length - 1] || normalized;
}

function normalizePackageInventory(value, limit = 1024) {
    if (!Array.isArray(value)) {
        return [];
    }

    const result = [];
    const seen = new Set();
    for (const item of value) {
        let entry = null;
        if (item && typeof item === 'object' && !Array.isArray(item)) {
            const itemPath = normalizePathEntry(
                item.path || item.install_path || item.installPath || item.location || item.binary || item.executable,
                700
            );
            const installRoot = normalizePathEntry(
                item.install_root || item.installRoot || item.directory || item.dir,
                700
            );
            const name = normalizeString(
                item.name || item.package_name || item.packageName || item.display_name || item.displayName || basenameAnyPath(itemPath),
                255
            );
            if (!name && !itemPath && !installRoot) continue;
            entry = {
                name: name || 'package',
                version: normalizeString(item.version || item.package_version || item.packageVersion, 120),
                path: itemPath,
                source: normalizeString(item.source || item.manager || item.package_manager || item.packageManager || item.origin, 120),
                install_root: installRoot,
                publisher: normalizeString(item.publisher || item.vendor, 255),
                system_managed: normalizeBoolean(item.system_managed || item.systemManaged || item.is_system_managed || item.isSystemManaged)
            };
        } else {
            const name = normalizeString(item, 255);
            if (!name) continue;
            entry = {
                name,
                version: null,
                path: null,
                source: null,
                install_root: null,
                publisher: null,
                system_managed: false
            };
        }

        const key = [
            String(entry.name || '').toLowerCase(),
            String(entry.version || '').toLowerCase(),
            String(entry.path || '').toLowerCase(),
            String(entry.install_root || '').toLowerCase(),
            String(entry.source || '').toLowerCase()
        ].join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        result.push(entry);
        if (result.length >= limit) break;
    }
    return result;
}

function normalizePlatform(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return SUPPORTED_PLATFORMS.has(normalized) ? normalized : null;
}

function normalizeMode(value) {
    const normalized = String(value || '').trim().toUpperCase();
    if (!SUPPORTED_MODES.has(normalized)) {
        return 'FULL';
    }
    return normalized;
}

function normalizeArtifactKind(value) {
    const normalized = String(value || '').trim().toUpperCase();
    return normalized ? normalized.slice(0, 32) : 'UNKNOWN';
}

function looksLikeWindowsPath(value) {
    return /^[A-Za-z]:[\\/]/.test(String(value || '').trim()) || String(value || '').startsWith('\\\\');
}

function looksLikeFilePath(value) {
    const base = basenameAnyPath(value);
    return /\.[a-z0-9]{1,8}$/i.test(base);
}

function addPathAncestry(value, platform, add, depth = 4) {
    const normalized = normalizePathEntry(value, 700);
    if (!normalized) return;

    const isWindows = platform === 'WINDOWS' || looksLikeWindowsPath(normalized);
    const pathApi = isWindows ? path.win32 : path.posix;
    const parsed = pathApi.parse(normalized);
    let current = looksLikeFilePath(normalized) ? parsed.dir : normalized.replace(/[\\/]+$/, '');

    while (current && depth > 0) {
        add(current);
        const parent = pathApi.dirname(current);
        if (!parent || parent === current) break;
        current = parent;
        depth -= 1;
    }

    if (parsed.root) {
        add(parsed.root);
    }
}

function defaultCoverageRoots(platform) {
    if (platform === 'WINDOWS') {
        return [
            'C:\\',
            'C:\\Program Files',
            'C:\\Program Files (x86)',
            'C:\\ProgramData',
            'C:\\Users\\Public',
            '%USERPROFILE%\\Desktop',
            '%USERPROFILE%\\Downloads',
            '%LOCALAPPDATA%',
            '%LOCALAPPDATA%\\Programs',
            '%APPDATA%',
            '%TEMP%',
            'C:\\Users\\%USERNAME%\\AppData\\Local\\Programs',
            'C:\\Users\\%USERNAME%\\AppData\\Local\\Microsoft\\WindowsApps'
        ];
    }

    return [
        '/',
        '/bin',
        '/sbin',
        '/usr/bin',
        '/usr/sbin',
        '/usr/local/bin',
        '/usr/local/sbin',
        '/opt',
        '/usr/lib',
        '/usr/libexec',
        '/usr/share/applications',
        '/usr/local/share/applications',
        '/var/lib',
        '/var/lib/flatpak',
        '/var/lib/flatpak/app',
        '/var/lib/snapd/snap',
        '/snap',
        '/home',
        '/mnt',
        '/media',
        '~/.local/bin',
        '~/bin',
        '~/.local/share/applications',
        '~/.config/autostart',
        '~/Downloads',
        '/tmp',
        '/var/tmp',
        '/etc/systemd/system'
    ];
}

function deriveRecommendedScanRoots(platform, metadata) {
    const roots = [];
    const seen = new Set();
    const add = (value) => {
        const normalized = normalizePathEntry(value, 700);
        if (!normalized) return;
        const key = normalized.toLowerCase();
        if (seen.has(key)) return;
        seen.add(key);
        roots.push(normalized);
    };

    defaultCoverageRoots(platform).forEach(add);

    [
        metadata.targetPath,
        metadata.originPath,
        ...(metadata.installRoots || []),
        ...(metadata.scanRoots || [])
    ].forEach((entry) => addPathAncestry(entry, platform, add, 4));

    (metadata.candidatePaths || []).slice(0, 256).forEach((entry) => addPathAncestry(entry, platform, add, 3));
    (metadata.packageInventory || []).slice(0, 256).forEach((entry) => {
        addPathAncestry(entry.path, platform, add, 3);
        addPathAncestry(entry.install_root, platform, add, 3);
    });

    const managers = uniqueStrings([
        metadata.packageManager,
        ...(metadata.packageManagers || []),
        ...(metadata.packageSources || [])
    ], 32, 120).map((value) => value.toLowerCase());

    if (platform === 'WINDOWS') {
        if (managers.some((value) => ['winget', 'msix', 'appx'].includes(value))) {
            add('C:\\Program Files\\WindowsApps');
        }
        if (managers.includes('scoop')) {
            add('%USERPROFILE%\\scoop');
        }
        if (managers.includes('choco') || managers.includes('chocolatey')) {
            add('C:\\ProgramData\\chocolatey');
        }
    }

    if (platform === 'LINUX') {
        if (managers.includes('flatpak')) {
            add('/var/lib/flatpak');
            add('~/.local/share/flatpak');
        }
        if (managers.includes('snap')) {
            add('/var/lib/snapd/snap');
            add('/snap');
        }
        if (managers.some((value) => ['dpkg', 'apt'].includes(value))) {
            add('/usr/lib');
            add('/usr/share');
        }
        if (managers.some((value) => ['rpm', 'dnf', 'yum', 'zypper'].includes(value))) {
            add('/usr/lib64');
        }
    }

    return roots.slice(0, 256);
}

function summarizeDesktopCoverage(normalized) {
    const metadata = normalizeObject(normalized?.artifactMetadata);
    const declaredRoots = uniqueStrings([
        ...(metadata.installRoots || []),
        ...(metadata.scanRoots || [])
    ], 256, 700);
    const recommendedRoots = Array.isArray(metadata.recommendedScanRoots) && metadata.recommendedScanRoots.length > 0
        ? metadata.recommendedScanRoots
        : deriveRecommendedScanRoots(normalized?.platform, metadata);
    const packageManagers = uniqueStrings([
        metadata.packageManager,
        ...(metadata.packageManagers || []),
        ...(metadata.packageSources || [])
    ], 64, 120);
    const packageInventory = Array.isArray(metadata.packageInventory) ? metadata.packageInventory : [];
    const candidatePaths = Array.isArray(metadata.candidatePaths) ? metadata.candidatePaths : [];
    const packageCount = Math.max(Number(metadata.packageCount || 0), packageInventory.length);
    const candidateCount = Math.max(Number(metadata.candidateCount || 0), candidatePaths.length);

    return {
        declaredRoots,
        declaredRootCount: declaredRoots.length,
        recommendedRoots,
        recommendedRootCount: recommendedRoots.length,
        packageManagers,
        packageManagerCount: packageManagers.length,
        packageCount,
        candidateCount,
        packagePreview: packageInventory.slice(0, 24),
        candidatePreview: candidatePaths.slice(0, 24)
    };
}

function hasCoverageDrivenMetadata(metadata) {
    const normalized = normalizeObject(metadata);
    return Boolean(normalized.coverageMode)
        || (Array.isArray(normalized.installRoots) && normalized.installRoots.length > 0)
        || (Array.isArray(normalized.scanRoots) && normalized.scanRoots.length > 0)
        || (Array.isArray(normalized.relatedBinaryRoots) && normalized.relatedBinaryRoots.length > 0)
        || (Array.isArray(normalized.metadataRoots) && normalized.metadataRoots.length > 0)
        || (Array.isArray(normalized.candidatePaths) && normalized.candidatePaths.length > 0)
        || (Array.isArray(normalized.packageInventory) && normalized.packageInventory.length > 0)
        || Number(normalized.packageCount || 0) > 0
        || Number(normalized.candidateCount || 0) > 0;
}

function requiresDesktopArtifactUpload(normalized) {
    const metadata = normalizeObject(normalized?.artifactMetadata);
    const artifactKind = String(normalized?.artifactKind || '').trim().toUpperCase();

    if (metadata.uploadRequired) {
        return true;
    }

    // Coverage-driven scans send filesystem/package inventory metadata and should
    // start server-side analysis immediately instead of waiting for a binary upload.
    if (hasCoverageDrivenMetadata(metadata)) {
        return false;
    }

    return ['PACKAGE', 'SCRIPT', 'ARCHIVE'].includes(artifactKind);
}

function normalizeDesktopScanPayload(payload) {
    const envelope = normalizeObject(payload);
    const nestedPayload = normalizeObject(
        envelope.payload
        || envelope.scan_payload
        || envelope.scanPayload
        || envelope.request_payload
        || envelope.requestPayload
        || envelope.scan_request
        || envelope.scanRequest
    );
    const source = mergeObjects(nestedPayload, envelope);
    const artifactMetadata = normalizeObject(
        source.artifact_metadata
        || source.artifactMetadata
        || source.artifact
        || source.artifact_payload
        || source.artifactPayload
        || source.metadata
        || source.desktop_artifact
        || source.desktopArtifact
    );
    const platform = normalizePlatform(source.platform);

    const localFindings = Array.isArray(source.local_findings || source.localFindings)
        ? (source.local_findings || source.localFindings)
            .slice(0, 64)
            .map((item) => {
                if (item && typeof item === 'object') {
                    return {
                        type: normalizeString(item.type, 64) || 'local_signal',
                        severity: normalizeSeverity(item.severity),
                        title: normalizeString(item.title, 160) || 'Локальный сигнал',
                        detail: normalizeString(item.detail, 500) || '',
                        source: normalizeString(item.source, 120) || 'Local Desktop Engine',
                        score: normalizeScore(item.score),
                        evidence: normalizeObject(item.evidence)
                    };
                }
                const text = normalizeString(item, 240);
                if (!text) return null;
                return {
                    type: 'local_signal',
                    severity: 'low',
                    title: 'Локальный сигнал',
                    detail: text,
                    source: 'Local Desktop Engine',
                    score: 6,
                    evidence: {}
                };
            })
            .filter(Boolean)
        : [];

    const normalizedMetadata = {
        targetName: normalizeString(artifactMetadata.target_name || artifactMetadata.targetName || source.target_name || source.targetName),
        targetPath: normalizeString(artifactMetadata.target_path || artifactMetadata.targetPath || source.target_path || source.targetPath, 512),
        fileName: normalizeString(artifactMetadata.file_name || artifactMetadata.fileName || source.file_name || source.fileName, 255),
        mimeType: normalizeString(artifactMetadata.mime_type || artifactMetadata.mimeType || source.mime_type || source.mimeType, 120),
        originPath: normalizeString(artifactMetadata.origin_path || artifactMetadata.originPath || source.origin_path || source.originPath, 512),
        packageManager: normalizeString(artifactMetadata.package_manager || artifactMetadata.packageManager || source.package_manager || source.packageManager, 64),
        packageManagers: normalizeStringList(
            artifactMetadata.package_managers || artifactMetadata.packageManagers || source.package_managers || source.packageManagers,
            32,
            64
        ),
        publisher: normalizeString(artifactMetadata.publisher || source.publisher, 255),
        signer: normalizeString(artifactMetadata.signer || source.signer, 255),
        signerTrusted: normalizeBoolean(
            artifactMetadata.signer_trusted
            ?? artifactMetadata.signerTrusted
            ?? source.signer_trusted
            ?? source.signerTrusted
        ),
        executable: normalizeBoolean(artifactMetadata.executable ?? source.executable),
        recentlyDropped: normalizeBoolean(
            artifactMetadata.recently_dropped
            ?? artifactMetadata.recentlyDropped
            ?? source.recently_dropped
            ?? source.recentlyDropped
        ),
        fromDownloads: normalizeBoolean(
            artifactMetadata.from_downloads
            ?? artifactMetadata.fromDownloads
            ?? source.from_downloads
            ?? source.fromDownloads
        ),
        fromTemp: normalizeBoolean(
            artifactMetadata.from_temp
            ?? artifactMetadata.fromTemp
            ?? source.from_temp
            ?? source.fromTemp
        ),
        runsAsRoot: normalizeBoolean(
            artifactMetadata.runs_as_root
            ?? artifactMetadata.runsAsRoot
            ?? source.runs_as_root
            ?? source.runsAsRoot
        ),
        hasSuid: normalizeBoolean(
            artifactMetadata.has_suid
            ?? artifactMetadata.hasSuid
            ?? source.has_suid
            ?? source.hasSuid
        ),
        writableLauncher: normalizeBoolean(
            artifactMetadata.writable_launcher
            ?? artifactMetadata.writableLauncher
            ?? source.writable_launcher
            ?? source.writableLauncher
        ),
        autorunLocations: normalizeStringList(
            artifactMetadata.autorun_locations || artifactMetadata.autorunLocations || source.autorun_locations || source.autorunLocations,
            48,
            255
        ),
        persistenceSurfaces: normalizeStringList(
            artifactMetadata.persistence_surfaces || artifactMetadata.persistenceSurfaces || source.persistence_surfaces || source.persistenceSurfaces,
            48,
            255
        ),
        suspiciousImports: normalizeStringList(
            artifactMetadata.suspicious_imports || artifactMetadata.suspiciousImports || source.suspicious_imports || source.suspiciousImports,
            80,
            64
        ),
        capabilities: normalizeStringList(artifactMetadata.capabilities || source.capabilities, 48, 64),
        packageSources: normalizeStringList(
            artifactMetadata.package_sources || artifactMetadata.packageSources || source.package_sources || source.packageSources,
            128,
            120
        ),
        desktopEntries: normalizeStringList(
            artifactMetadata.desktop_entries || artifactMetadata.desktopEntries || source.desktop_entries || source.desktopEntries,
            128,
            255
        ),
        installRoots: normalizePathList(
            artifactMetadata.install_roots
            || artifactMetadata.installRoots
            || artifactMetadata.program_directories
            || artifactMetadata.programDirectories
            || source.install_roots
            || source.installRoots,
            256,
            700
        ),
        coverageMode: normalizeString(
            artifactMetadata.coverage_mode
            || artifactMetadata.coverageMode
            || source.coverage_mode
            || source.coverageMode,
            64
        ),
        scanRoots: normalizePathList(
            artifactMetadata.scan_roots
            || artifactMetadata.scanRoots
            || artifactMetadata.coverage_roots
            || artifactMetadata.coverageRoots
            || artifactMetadata.search_roots
            || artifactMetadata.searchRoots
            || source.scan_roots
            || source.scanRoots
            || source.coverage_roots
            || source.coverageRoots,
            256,
            700
        ),
        relatedBinaryRoots: normalizePathList(
            artifactMetadata.related_binary_roots
            || artifactMetadata.relatedBinaryRoots
            || source.related_binary_roots
            || source.relatedBinaryRoots,
            256,
            700
        ),
        metadataRoots: normalizePathList(
            artifactMetadata.metadata_roots
            || artifactMetadata.metadataRoots
            || source.metadata_roots
            || source.metadataRoots,
            256,
            700
        ),
        candidatePaths: normalizePathList(
            artifactMetadata.candidate_paths || artifactMetadata.candidatePaths || artifactMetadata.paths || source.candidate_paths || source.candidatePaths,
            4096,
            700
        ),
        packageInventory: normalizePackageInventory(
            artifactMetadata.package_inventory
            || artifactMetadata.packageInventory
            || artifactMetadata.installed_packages
            || artifactMetadata.installedPackages
            || source.package_inventory
            || source.packageInventory,
            2048
        ),
        uploadRequired: normalizeBoolean(
            artifactMetadata.upload_required
            ?? artifactMetadata.uploadRequired
            ?? source.upload_required
            ?? source.uploadRequired
        ),
        fileSizeBytes: normalizePositiveInt(
            artifactMetadata.file_size_bytes
            ?? artifactMetadata.fileSizeBytes
            ?? source.file_size_bytes
            ?? source.fileSizeBytes
        ),
        packageCount: normalizePositiveInt(
            artifactMetadata.package_count
            ?? artifactMetadata.packageCount
            ?? source.package_count
            ?? source.packageCount
        ),
        candidateCount: normalizePositiveInt(
            artifactMetadata.candidate_count
            ?? artifactMetadata.candidateCount
            ?? source.candidate_count
            ?? source.candidateCount
        ),
        entropy: normalizeEntropy(artifactMetadata.entropy ?? source.entropy),
        notes: normalizeString(artifactMetadata.notes || source.notes, 500)
    };

    normalizedMetadata.recommendedScanRoots = deriveRecommendedScanRoots(platform, normalizedMetadata);
    normalizedMetadata.effectiveScanRoots = uniqueStrings([
        ...normalizedMetadata.scanRoots,
        ...normalizedMetadata.relatedBinaryRoots,
        ...normalizedMetadata.metadataRoots
    ], 512, 700);
    normalizedMetadata.packageCount = normalizedMetadata.packageCount || normalizedMetadata.packageInventory.length || null;
    normalizedMetadata.candidateCount = normalizedMetadata.candidateCount || normalizedMetadata.candidatePaths.length || null;

    return {
        platform,
        mode: normalizeMode(source.mode),
        artifactKind: normalizeArtifactKind(
            source.artifact_kind
            || source.artifactKind
            || artifactMetadata.artifact_kind
            || artifactMetadata.artifactKind
        ),
        artifactMetadata: normalizedMetadata,
        sha256: normalizeSha256(source.sha256 || artifactMetadata.sha256),
        localFindings,
        localSummary: normalizeObject(source.local_summary || source.localSummary),
        externalRefs: normalizeObject(source.external_refs || source.externalRefs),
        raw: source
    };
}

function validateDesktopScanPayload(normalized) {
    if (!normalized.platform) {
        return 'platform must be WINDOWS or LINUX';
    }
    if (!normalized.mode) {
        return 'mode is required';
    }
    const metadata = normalized.artifactMetadata || {};
    if (!metadata.targetName && !normalized.sha256 && normalized.mode !== 'RESIDENT_EVENT') {
        return 'artifact target_name or sha256 is required';
    }
    return null;
}

function buildFinding({ type, severity = 'low', title, detail = '', source = 'NeuralV Desktop Rules', score = 0, evidence = {} }) {
    return {
        type: normalizeString(type, 64) || 'signal',
        severity: normalizeSeverity(severity),
        title: normalizeString(title, 160) || 'Сигнал',
        detail: normalizeString(detail, 600) || '',
        source: normalizeString(source, 120) || 'NeuralV Desktop Rules',
        score: normalizeScore(score),
        evidence: normalizeObject(evidence)
    };
}

function severityWeight(severity) {
    switch (String(severity || '').toLowerCase()) {
        case 'critical': return 40;
        case 'high': return 24;
        case 'medium': return 12;
        default: return 5;
    }
}

function computeRiskScore(findings) {
    const normalized = Array.isArray(findings) ? findings : [];
    if (normalized.length === 0) {
        return 0;
    }
    const base = normalized.reduce((acc, finding) => acc + severityWeight(finding.severity) + Number(finding.score || 0), 0);
    return Math.max(0, Math.min(100, Math.round(base / Math.max(1, Math.min(normalized.length, 4)))));
}

function classifyDesktopVerdict(findings, riskScore) {
    const normalized = Array.isArray(findings) ? findings : [];
    if (normalized.some((finding) => String(finding.severity) === 'critical') || Number(riskScore) >= 85) {
        return 'malicious';
    }
    if (normalized.some((finding) => String(finding.severity) === 'high') || Number(riskScore) >= 55) {
        return 'suspicious';
    }
    if (normalized.length > 0 || Number(riskScore) >= 20) {
        return 'low_risk';
    }
    return 'clean';
}

function analyzeDesktopMetadata(normalized) {
    const findings = [];
    const metadata = normalizeObject(normalized?.artifactMetadata);
    const platform = normalized?.platform;
    const coverage = summarizeDesktopCoverage(normalized);
    const hasReportedCoverage = coverage.candidateCount > 0 || coverage.packageCount > 0 || coverage.declaredRootCount > 0;

    if (platform === 'WINDOWS') {
        if (!metadata.signerTrusted && (metadata.publisher || metadata.signer)) {
            findings.push(buildFinding({
                type: 'publisher_untrusted',
                severity: 'medium',
                title: 'Подпись издателя не подтверждена',
                detail: 'Файл заявляет издателя, но подпись не помечена как доверенная.',
                score: 18,
                evidence: { publisher: metadata.publisher, signer: metadata.signer }
            }));
        }
        if (!metadata.signer && ['EXE', 'DLL', 'MSI'].includes(normalized.artifactKind)) {
            findings.push(buildFinding({
                type: 'unsigned_binary',
                severity: 'medium',
                title: 'Исполняемый файл без подписи',
                detail: 'Для PE/installer-артефакта не передана информация о кодовой подписи.',
                score: 16,
                evidence: { artifact_kind: normalized.artifactKind }
            }));
        }
        if (metadata.suspiciousImports.length > 0) {
            findings.push(buildFinding({
                type: 'suspicious_imports',
                severity: metadata.suspiciousImports.length >= 3 ? 'high' : 'medium',
                title: 'Обнаружены рискованные импорты Windows API',
                detail: `Импорты: ${metadata.suspiciousImports.slice(0, 6).join(', ')}`,
                score: 24,
                evidence: { imports: metadata.suspiciousImports }
            }));
        }
        if (metadata.persistenceSurfaces.length > 0 || metadata.autorunLocations.length > 0) {
            findings.push(buildFinding({
                type: 'autorun_persistence',
                severity: 'high',
                title: 'Есть признаки автозапуска или закрепления в системе',
                detail: 'Сигнал получен по Run keys, Startup folder, scheduled tasks или службам.',
                score: 28,
                evidence: {
                    persistence_surfaces: metadata.persistenceSurfaces,
                    autorun_locations: metadata.autorunLocations
                }
            }));
        }
    }

    if (platform === 'LINUX') {
        if (metadata.hasSuid || metadata.runsAsRoot) {
            findings.push(buildFinding({
                type: 'privilege_escalation',
                severity: 'high',
                title: 'Артефакт требует повышенных привилегий',
                detail: 'Есть признаки root execution, SUID или запуска с повышенными правами.',
                score: 30,
                evidence: { has_suid: metadata.hasSuid, runs_as_root: metadata.runsAsRoot }
            }));
        }
        if (metadata.capabilities.length > 0) {
            findings.push(buildFinding({
                type: 'linux_capabilities',
                severity: 'medium',
                title: 'Выданы расширенные Linux capabilities',
                detail: `Capabilities: ${metadata.capabilities.join(', ')}`,
                score: 16,
                evidence: { capabilities: metadata.capabilities }
            }));
        }
        if (metadata.writableLauncher || metadata.desktopEntries.length > 0) {
            findings.push(buildFinding({
                type: 'launcher_anomaly',
                severity: 'medium',
                title: 'Подозрительный launcher или .desktop entry',
                detail: 'Launcher может быть изменяемым или привязан к нестандартной автозагрузке.',
                score: 18,
                evidence: {
                    writable_launcher: metadata.writableLauncher,
                    desktop_entries: metadata.desktopEntries
                }
            }));
        }
        if (metadata.packageSources.length === 0 && coverage.packageCount === 0 && metadata.executable) {
            findings.push(buildFinding({
                type: 'unknown_origin',
                severity: 'low',
                title: 'Не удалось подтвердить источник пакета',
                detail: 'Для исполняемого файла не передан provenance из dpkg/rpm/pacman/flatpak/snap.',
                score: 8,
                evidence: { executable: metadata.executable }
            }));
        }
    }

    if (metadata.recentlyDropped || metadata.fromDownloads || metadata.fromTemp) {
        findings.push(buildFinding({
            type: 'dropped_binary',
            severity: 'medium',
            title: 'Файл появился в зоне повышенного риска',
            detail: 'Артефакт отмечен как недавно появившийся или пришедший из Downloads/Temp.',
            score: 14,
            evidence: {
                recently_dropped: metadata.recentlyDropped,
                from_downloads: metadata.fromDownloads,
                from_temp: metadata.fromTemp
            }
        }));
    }

    if (Number(metadata.entropy || 0) >= 7.2) {
        findings.push(buildFinding({
            type: 'high_entropy',
            severity: 'medium',
            title: 'Высокая энтропия содержимого',
            detail: 'Это может указывать на упаковщик, шифрование или скрытие полезной нагрузки.',
            score: 22,
            evidence: { entropy: metadata.entropy }
        }));
    }

    if (hasReportedCoverage && (platform === 'WINDOWS' || platform === 'LINUX')) {
        const narrowCandidates = coverage.candidateCount > 0 && coverage.candidateCount <= 5;
        const narrowPackages = coverage.packageCount > 0 && coverage.packageCount <= 5;
        if ((narrowCandidates || narrowPackages) && coverage.declaredRootCount < 3 && coverage.recommendedRootCount > coverage.declaredRootCount) {
            findings.push(buildFinding({
                type: 'limited_coverage',
                severity: 'low',
                title: 'Desktop scan пришёл с узким покрытием кандидатов',
                detail: `Клиент сообщил candidates=${coverage.candidateCount}, packages=${coverage.packageCount}, scan_roots=${coverage.declaredRootCount}; для ${platform} рекомендуется обходить более широкий набор каталогов.`,
                score: 6,
                evidence: {
                    declared_roots: coverage.declaredRoots.slice(0, 8),
                    recommended_roots: coverage.recommendedRoots.slice(0, 12),
                    candidate_preview: coverage.candidatePreview.slice(0, 8),
                    package_preview: coverage.packagePreview.slice(0, 8).map((item) => item.name)
                }
            }));
        }
    }

    return findings;
}

function hasHardSignals(findings, vt = null) {
    const normalized = Array.isArray(findings) ? findings : [];
    if (Number(vt?.malicious || 0) > 0) {
        return true;
    }
    return normalized.some((finding) => HARD_SIGNAL_TYPES.has(String(finding.type || '').toLowerCase()));
}

module.exports = {
    SUPPORTED_PLATFORMS,
    SUPPORTED_MODES,
    normalizeDesktopScanPayload,
    requiresDesktopArtifactUpload,
    validateDesktopScanPayload,
    analyzeDesktopMetadata,
    summarizeDesktopCoverage,
    buildFinding,
    computeRiskScore,
    classifyDesktopVerdict,
    hasHardSignals
};
