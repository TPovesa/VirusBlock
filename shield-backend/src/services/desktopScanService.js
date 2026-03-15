const fs = require('fs/promises');
const fsNative = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const pool = require('../db/pool');
const { nowMs } = require('../utils/security');
const {
    normalizeDesktopScanPayload,
    validateDesktopScanPayload,
    analyzeDesktopMetadata,
    buildFinding,
    computeRiskScore,
    classifyDesktopVerdict,
    hasHardSignals
} = require('../utils/desktopScanHeuristics');
const { isAiConfigured, triageDesktopScanFindings } = require('./aiExplainService');

const STORAGE_ROOT = process.env.DESKTOP_SCAN_UPLOAD_DIR || path.join(process.cwd(), 'storage', 'desktop-scans');
const VT_API_BASE = (process.env.VT_API_BASE || 'https://www.virustotal.com/api/v3').replace(/\/$/, '');
const VT_TIMEOUT_MS = parseInt(process.env.VT_TIMEOUT_MS || '8000', 10);
const MAX_UPLOAD_BYTES = parseInt(process.env.DESKTOP_SCAN_MAX_UPLOAD_BYTES || String(512 * 1024 * 1024), 10);
const ACTIVE_JOBS = new Set();
const QUEUE = [];
const ENQUEUED = new Set();
let queueRunning = false;

function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

async function ensureStorage() {
    await fs.mkdir(STORAGE_ROOT, { recursive: true });
}

function severityRank(severity) {
    switch (String(severity || '').toLowerCase()) {
        case 'critical': return 4;
        case 'high': return 3;
        case 'medium': return 2;
        default: return 1;
    }
}

function normalizeFindings(findings) {
    if (!Array.isArray(findings)) return [];
    return findings
        .filter((item) => item && typeof item === 'object')
        .map((item, index) => ({
            id: String(item.id || `finding-${index + 1}`),
            title: String(item.title || 'Сигнал').slice(0, 200),
            verdict: normalizeVerdict(item.verdict || item.severity),
            risk_score: Number(item.risk_score ?? item.score ?? 0) || 0,
            summary: String(item.summary || item.detail || '').slice(0, 500),
            evidence: Array.isArray(item.evidence)
                ? item.evidence.map((entry) => String(entry).slice(0, 240)).filter(Boolean).slice(0, 8)
                : buildEvidenceLines(item.evidence),
            artifact: item.artifact && typeof item.artifact === 'object'
                ? {
                    id: String(item.artifact.id || item.artifact.path || item.artifact.displayName || 'artifact'),
                    display_name: String(item.artifact.display_name || item.artifact.displayName || item.artifact.path || 'Artifact').slice(0, 255),
                    path: String(item.artifact.path || '').slice(0, 700),
                    sha256: item.artifact.sha256 || null,
                    size_bytes: Number(item.artifact.size_bytes || item.artifact.sizeBytes || 0) || null,
                    signer: item.artifact.signer || null,
                    package_origin: item.artifact.package_origin || item.artifact.packageOrigin || null,
                    is_system_managed: Boolean(item.artifact.is_system_managed || item.artifact.isSystemManaged),
                    risk_score: Number(item.artifact.risk_score || item.artifact.riskScore || 0) || 0,
                    verdict: normalizeVerdict(item.artifact.verdict),
                    reasons: Array.isArray(item.artifact.reasons)
                        ? item.artifact.reasons.map((entry) => String(entry).slice(0, 200)).slice(0, 8)
                        : []
                }
                : null,
            engines: Array.isArray(item.engines)
                ? item.engines.map((entry) => String(entry).slice(0, 80)).filter(Boolean).slice(0, 10)
                : []
        }));
}

function buildEvidenceLines(evidence) {
    if (!evidence || typeof evidence !== 'object') {
        return [];
    }
    return Object.entries(evidence)
        .slice(0, 8)
        .map(([key, value]) => `${key}: ${Array.isArray(value) ? value.join(', ') : String(value)}`)
        .filter(Boolean);
}

function normalizeVerdict(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['clean', 'low_risk', 'suspicious', 'malicious', 'unknown'].includes(normalized)) {
        return normalized.toUpperCase();
    }
    if (normalized === 'critical' || normalized === 'high') return 'MALICIOUS';
    if (normalized === 'medium') return 'SUSPICIOUS';
    if (normalized === 'low') return 'LOW_RISK';
    return 'UNKNOWN';
}

function summarizeTimeline(stages) {
    return stages
        .map((stage) => String(stage || '').trim())
        .filter(Boolean)
        .slice(0, 24);
}

async function lookupVirusTotal(sha256) {
    const apiKey = String(process.env.VT_API_KEY || '').trim();
    if (!apiKey || !sha256) {
        return null;
    }

    const response = await fetch(`${VT_API_BASE}/files/${sha256}`, {
        headers: { 'x-apikey': apiKey },
        signal: AbortSignal.timeout(VT_TIMEOUT_MS)
    });

    if (response.status === 404) {
        return { status: 'not_found', malicious: 0, suspicious: 0, harmless: 0 };
    }
    if (!response.ok) {
        throw new Error(`VirusTotal lookup failed: ${response.status}`);
    }
    const payload = await response.json();
    const stats = payload?.data?.attributes?.last_analysis_stats || {};
    return {
        status: 'ok',
        malicious: Number(stats.malicious || 0),
        suspicious: Number(stats.suspicious || 0),
        harmless: Number(stats.harmless || 0)
    };
}

async function sniffArtifact(jobId, uploadedArtifact, normalized) {
    if (!uploadedArtifact?.storagePath) {
        return [];
    }

    const findings = [];
    const handle = await fs.open(uploadedArtifact.storagePath, 'r');
    try {
        const header = Buffer.alloc(512);
        const { bytesRead } = await handle.read(header, 0, header.length, 0);
        const sample = header.subarray(0, bytesRead);
        const asAscii = sample.toString('utf8').replace(/\0/g, ' ');
        const headerHex = sample.subarray(0, 16).toString('hex');

        if (normalized.platform === 'WINDOWS') {
            if (sample.length >= 2 && sample[0] === 0x4d && sample[1] === 0x5a) {
                if (/powershell|wscript|mshta|rundll32|regsvr32/i.test(asAscii)) {
                    findings.push(buildFinding({
                        type: 'script_exec_chain',
                        severity: 'high',
                        title: 'В PE-файле видны строки исполнения скриптов',
                        detail: 'Бинарник содержит команды, типичные для цепочек script-to-exec.',
                        source: 'NeuralV PE Static',
                        score: 28,
                        evidence: { sample: asAscii.match(/powershell|wscript|mshta|rundll32|regsvr32/gi)?.slice(0, 6) || [] }
                    }));
                }
            } else {
                findings.push(buildFinding({
                    type: 'tampered_binary',
                    severity: 'medium',
                    title: 'Файл не выглядит как корректный PE',
                    detail: 'Для Windows-артефакта не найден сигнатурный заголовок MZ.',
                    source: 'NeuralV PE Static',
                    score: 16,
                    evidence: { header_hex: headerHex }
                }));
            }
        }

        if (normalized.platform === 'LINUX') {
            const isElf = sample.length >= 4 && sample[0] === 0x7f && sample[1] === 0x45 && sample[2] === 0x4c && sample[3] === 0x46;
            const isScript = asAscii.startsWith('#!');
            if (!isElf && !isScript) {
                findings.push(buildFinding({
                    type: 'tampered_binary',
                    severity: 'medium',
                    title: 'Файл не выглядит как корректный ELF или launcher-script',
                    detail: 'Linux-артефакт не совпадает с ожидаемым исполняемым форматом.',
                    source: 'NeuralV ELF Static',
                    score: 16,
                    evidence: { header_hex: headerHex }
                }));
            }
            if (/curl\s|wget\s|chmod\s\+x|systemctl\s|nohup\s|LD_PRELOAD/i.test(asAscii)) {
                findings.push(buildFinding({
                    type: 'script_exec_chain',
                    severity: 'high',
                    title: 'Обнаружена подозрительная shell-цепочка',
                    detail: 'Статический анализ увидел команды доставки или закрепления в системе.',
                    source: 'NeuralV ELF Static',
                    score: 28,
                    evidence: { sample: asAscii.match(/curl\s|wget\s|chmod\s\+x|systemctl\s|nohup\s|LD_PRELOAD/gi)?.slice(0, 6) || [] }
                }));
            }
        }
    } finally {
        await handle.close();
    }

    const sizeBytes = Number(uploadedArtifact.sizeBytes || 0);
    if (sizeBytes > 0 && sizeBytes <= 64 * 1024 && String(normalized.artifactKind || '').toUpperCase() === 'EXECUTABLE') {
        findings.push(buildFinding({
            type: 'tiny_executable',
            severity: 'low',
            title: 'Подозрительно маленький исполняемый файл',
            detail: 'Очень маленькие исполняемые файлы часто используются как launcher/dropper.',
            source: 'NeuralV Static',
            score: 10,
            evidence: { size_bytes: sizeBytes, job_id: jobId }
        }));
    }

    return findings;
}

async function storeArtifact(jobId, userId, upload) {
    await ensureStorage();
    const targetDir = path.join(STORAGE_ROOT, userId, jobId);
    await fs.mkdir(targetDir, { recursive: true });
    const originalName = String(upload.originalName || 'artifact.bin').replace(/[^a-zA-Z0-9._-]/g, '_');
    const targetPath = path.join(targetDir, originalName);
    await fs.rm(targetPath, { force: true }).catch(() => {});
    await fs.rename(upload.tempFilePath, targetPath).catch(async (error) => {
        if (String(error?.code || '').toUpperCase() !== 'EXDEV') {
            throw error;
        }
        await fs.copyFile(upload.tempFilePath, targetPath);
        await fs.rm(upload.tempFilePath, { force: true });
    });
    const [result] = await pool.query(
        `INSERT INTO desktop_scan_artifacts
         (job_id, user_id, file_name, storage_path, sha256, size_bytes, mime_type, created_at, uploaded_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [jobId, userId, originalName, targetPath, upload.sha256 || null, Number(upload.sizeBytes || 0), upload.mimeType || null, nowMs(), nowMs()]
    );
    return {
        id: result.insertId,
        fileName: originalName,
        storagePath: targetPath,
        sha256: upload.sha256 || null,
        sizeBytes: Number(upload.sizeBytes || 0)
    };
}

async function fetchArtifactByJob(jobId) {
    const [rows] = await pool.query(
        `SELECT id, file_name, storage_path, sha256, size_bytes, mime_type
         FROM desktop_scan_artifacts
         WHERE job_id = ?
         ORDER BY id DESC
         LIMIT 1`,
        [jobId]
    );
    const row = rows[0];
    if (!row) return null;
    return {
        id: row.id,
        fileName: row.file_name,
        storagePath: row.storage_path,
        sha256: row.sha256,
        sizeBytes: row.size_bytes,
        mimeType: row.mime_type
    };
}

async function createDesktopScanJob(userId, payload) {
    const normalized = normalizeDesktopScanPayload(payload || {});
    const validationError = validateDesktopScanPayload(normalized);
    if (validationError) {
        return { error: validationError, status_code: 400 };
    }

    const id = crypto.randomUUID();
    const createdAt = nowMs();
    const artifactRequired = Boolean(normalized.artifactMetadata?.uploadRequired)
        || ['ARTIFACT', 'PACKAGE', 'SCRIPT', 'ARCHIVE'].includes(String(normalized.artifactKind || '').toUpperCase())
        || normalized.mode === 'ARTIFACT'
        || normalized.mode === 'SELECTIVE';

    await pool.query(
        `INSERT INTO desktop_scan_jobs
         (id, user_id, platform, mode, artifact_kind, target_name, target_path, sha256, status, artifact_required, request_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
            id,
            userId,
            normalized.platform,
            normalized.mode,
            normalized.artifactKind,
            normalized.artifactMetadata?.targetName || null,
            normalized.artifactMetadata?.targetPath || null,
            normalized.sha256 || null,
            artifactRequired ? 'AWAITING_UPLOAD' : 'QUEUED',
            artifactRequired ? 1 : 0,
            JSON.stringify({ normalized }),
            createdAt,
            createdAt
        ]
    );

    if (!artifactRequired) {
        enqueueJob(id);
    }
    return getDesktopScanJob(id, userId);
}

async function attachDesktopArtifact(jobId, userId, upload) {
    if (Number(upload.sizeBytes || 0) > MAX_UPLOAD_BYTES) {
        return { error: 'Artifact is too large' };
    }
    const scan = await getDesktopScanJob(jobId, userId, { includeRaw: true });
    if (!scan) return null;
    await storeArtifact(jobId, userId, upload);
    await pool.query(
        `UPDATE desktop_scan_jobs
         SET status = 'QUEUED', sha256 = COALESCE(?, sha256), updated_at = ?
         WHERE id = ? AND user_id = ?`,
        [upload.sha256 || null, nowMs(), jobId, userId]
    );
    enqueueJob(jobId);
    return getDesktopScanJob(jobId, userId);
}

async function getDesktopScanJob(jobId, userId, options = {}) {
    const [rows] = await pool.query(
        `SELECT id, user_id, platform, mode, artifact_kind, target_name, target_path, sha256, status, verdict, risk_score,
                surfaced_findings, hidden_findings, artifact_required, request_json, summary_json, findings_json, full_report_json,
                error_message, created_at, started_at, completed_at, updated_at
         FROM desktop_scan_jobs
         WHERE id = ? AND user_id = ?
         LIMIT 1`,
        [jobId, userId]
    );
    const row = rows[0];
    if (!row) return null;
    const summary = parseJson(row.summary_json, {});
    const findings = normalizeFindings(parseJson(row.findings_json, []));
    const timeline = Array.isArray(summary.timeline) ? summary.timeline : [];
    const scan = {
        id: row.id,
        platform: row.platform,
        mode: row.mode,
        status: row.status,
        verdict: normalizeVerdict(row.verdict || summary.verdict || 'unknown'),
        risk_score: Number(row.risk_score || 0),
        surfaced_findings: Number(row.surfaced_findings || findings.length || 0),
        hidden_findings: Number(row.hidden_findings || 0),
        started_at: row.started_at,
        completed_at: row.completed_at,
        message: row.error_message || summary.message || buildStatusMessage(row.status, row.verdict, findings.length),
        findings,
        timeline: summarizeTimeline(timeline)
    };
    if (options.includeRaw) {
        scan.request_json = row.request_json;
        scan.summary_json = row.summary_json;
        scan.full_report_json = row.full_report_json;
    }
    return scan;
}

function buildStatusMessage(status, verdict, surfacedFindings) {
    switch (String(status || '').toUpperCase()) {
        case 'AWAITING_UPLOAD':
            return 'Ожидаем загрузку desktop-артефакта';
        case 'QUEUED':
            return 'Задача поставлена в очередь server-side analysis';
        case 'RUNNING':
            return 'Сервер анализирует артефакт и фильтрует отчёт';
        case 'FAILED':
            return 'Server-side проверка завершилась с ошибкой';
        case 'CANCELLED':
            return 'Проверка отменена';
        case 'COMPLETED':
        default:
            if (String(verdict || '').toUpperCase() === 'CLEAN' || Number(surfacedFindings || 0) === 0) {
                return 'Значимых угроз не обнаружено';
            }
            return `Найдено значимых сигналов: ${Number(surfacedFindings || 0)}`;
    }
}

function enqueueJob(jobId) {
    if (ENQUEUED.has(jobId)) return;
    ENQUEUED.add(jobId);
    QUEUE.push(jobId);
    void runQueue();
}

async function runQueue() {
    if (queueRunning) return;
    queueRunning = true;
    try {
        while (QUEUE.length > 0) {
            const jobId = QUEUE.shift();
            ENQUEUED.delete(jobId);
            if (!jobId) continue;
            await processJob(jobId);
        }
    } finally {
        queueRunning = false;
    }
}

async function processJob(jobId) {
    const [rows] = await pool.query(
        `SELECT id, user_id, platform, mode, artifact_kind, target_name, target_path, sha256, request_json, status
         FROM desktop_scan_jobs
         WHERE id = ? LIMIT 1`,
        [jobId]
    );
    const row = rows[0];
    if (!row) return;
    if (!['QUEUED', 'RUNNING'].includes(String(row.status || '').toUpperCase())) {
        return;
    }

    ACTIVE_JOBS.add(jobId);
    await pool.query(
        `UPDATE desktop_scan_jobs SET status = 'RUNNING', started_at = COALESCE(started_at, ?), updated_at = ? WHERE id = ?`,
        [nowMs(), nowMs(), jobId]
    );

    try {
        const normalized = parseJson(row.request_json, {}).normalized || {};
        const artifact = await fetchArtifactByJob(jobId);
        if (artifact?.sha256 && !normalized.sha256) {
            normalized.sha256 = artifact.sha256;
        }
        const timeline = [
            `accepted ${new Date(nowMs()).toISOString()}`,
            'metadata heuristics',
            artifact ? 'artifact static sniff' : 'metadata-only scan'
        ];
        const metadataFindings = analyzeDesktopMetadata(normalized);
        const staticFindings = await sniffArtifact(jobId, artifact, normalized);
        const localFindings = Array.isArray(normalized.localFindings) ? normalized.localFindings : [];
        const vt = normalized.sha256 ? await lookupVirusTotal(normalized.sha256).catch(() => null) : null;
        if (vt && Number(vt.malicious || 0) > 0) {
            metadataFindings.push(buildFinding({
                type: 'virustotal',
                severity: vt.malicious > 1 ? 'critical' : 'high',
                title: 'VirusTotal отметил артефакт как вредоносный',
                detail: `malicious=${vt.malicious}, suspicious=${vt.suspicious}, harmless=${vt.harmless}`,
                source: 'VirusTotal',
                score: 36,
                evidence: vt
            }));
        }

        const allFindings = [...metadataFindings, ...staticFindings, ...localFindings];
        const riskScore = computeRiskScore(allFindings);
        let verdict = classifyDesktopVerdict(allFindings, riskScore);
        let surfacedFindings = allFindings;
        let hiddenFindings = [];
        let aiFilter = null;

        if (isAiConfigured() && allFindings.length > 0) {
            timeline.push('ai post-filter');
            try {
                aiFilter = await triageDesktopScanFindings({
                    platform: normalized.platform,
                    mode: normalized.mode,
                    artifactKind: normalized.artifactKind,
                    targetName: normalized.artifactMetadata?.targetName,
                    targetPath: normalized.artifactMetadata?.targetPath,
                    sha256: normalized.sha256,
                    metadata: normalized.artifactMetadata,
                    vt,
                    verdict,
                    riskScore,
                    findings: allFindings
                });
                const suppressTypes = new Set((aiFilter.suppressTypes || []).map((value) => String(value).toLowerCase()));
                const hardSignals = hasHardSignals(allFindings, vt);
                if (!hardSignals) {
                    surfacedFindings = allFindings.filter((finding) => !suppressTypes.has(String(finding.type || '').toLowerCase()));
                    hiddenFindings = allFindings.filter((finding) => suppressTypes.has(String(finding.type || '').toLowerCase()));
                    if (aiFilter.reportToUser === false && surfacedFindings.length <= 1 && aiFilter.benignProbability >= 0.65) {
                        hiddenFindings = allFindings;
                        surfacedFindings = [];
                    }
                }
                if (aiFilter.suggestedVerdict) {
                    verdict = aiFilter.suggestedVerdict;
                } else if (surfacedFindings.length === 0 && !hardSignals) {
                    verdict = 'clean';
                }
            } catch (error) {
                timeline.push(`ai filter skipped: ${String(error.message || error)}`);
            }
        }

        const userFacingFindings = normalizeFindings(surfacedFindings.map((finding, index) => ({
            id: `${jobId}-${index + 1}`,
            title: finding.title,
            verdict,
            risk_score: finding.score,
            summary: finding.detail || finding.title,
            evidence: buildEvidenceLines(finding.evidence),
            artifact: {
                id: normalized.sha256 || jobId,
                display_name: normalized.artifactMetadata?.targetName || row.target_name || 'Artifact',
                path: normalized.artifactMetadata?.targetPath || row.target_path || 'n/a',
                sha256: normalized.sha256 || row.sha256 || null,
                size_bytes: artifact?.sizeBytes || normalized.artifactMetadata?.fileSizeBytes || null,
                signer: normalized.artifactMetadata?.signer || normalized.artifactMetadata?.publisher || null,
                package_origin: normalized.artifactMetadata?.packageManager || null,
                is_system_managed: Boolean((normalized.artifactMetadata?.packageSources || []).length),
                risk_score: riskScore,
                verdict,
                reasons: [finding.title]
            },
            engines: [finding.source || 'NeuralV Desktop Rules']
        })));

        const summary = {
            message: userFacingFindings.length > 0
                ? aiFilter?.userSummary || `Найдено сигналов: ${userFacingFindings.length}`
                : 'Значимых угроз не обнаружено',
            verdict,
            riskScore,
            timeline,
            vt,
            ai_filter: aiFilter,
            hidden_findings: hiddenFindings,
            artifact: artifact ? {
                file_name: artifact.fileName,
                sha256: artifact.sha256,
                size_bytes: artifact.sizeBytes
            } : null
        };
        const fullReport = {
            summary,
            surfaced_findings: userFacingFindings,
            hidden_findings: hiddenFindings,
            all_findings: allFindings,
            request: normalized
        };

        await pool.query(
            `UPDATE desktop_scan_jobs
             SET status = 'COMPLETED', verdict = ?, risk_score = ?, surfaced_findings = ?, hidden_findings = ?,
                 summary_json = ?, findings_json = ?, full_report_json = ?, error_message = NULL,
                 completed_at = ?, updated_at = ?
             WHERE id = ?`,
            [
                verdict,
                riskScore,
                userFacingFindings.length,
                hiddenFindings.length,
                JSON.stringify(summary),
                JSON.stringify(userFacingFindings),
                JSON.stringify(fullReport),
                nowMs(),
                nowMs(),
                jobId
            ]
        );
    } catch (error) {
        console.error('Desktop scan job failed:', error);
        await pool.query(
            `UPDATE desktop_scan_jobs
             SET status = 'FAILED', error_message = ?, completed_at = ?, updated_at = ?
             WHERE id = ?`,
            [String(error?.message || error || 'Desktop scan failed').slice(0, 255), nowMs(), nowMs(), jobId]
        );
    } finally {
        ACTIVE_JOBS.delete(jobId);
    }
}

async function cancelActiveDesktopScans(userId) {
    const cancelledAt = nowMs();
    await pool.query(
        `UPDATE desktop_scan_jobs
         SET status = 'CANCELLED', error_message = 'Проверка остановлена пользователем', completed_at = ?, updated_at = ?
         WHERE user_id = ? AND status IN ('QUEUED', 'RUNNING', 'AWAITING_UPLOAD')`,
        [cancelledAt, cancelledAt, userId]
    );
    return {
        success: true,
        cancelled_at: cancelledAt
    };
}

async function getDesktopFullReports(userId, ids) {
    const validIds = Array.from(new Set((Array.isArray(ids) ? ids : [])
        .map((value) => String(value || '').trim())
        .filter(Boolean)));

    if (validIds.length === 0) {
        return { reports: [], invalid_ids: [], missing_ids: [] };
    }

    const placeholders = validIds.map(() => '?').join(',');
    const [rows] = await pool.query(
        `SELECT id, platform, mode, status, verdict, risk_score, surfaced_findings, hidden_findings, summary_json, findings_json, full_report_json,
                started_at, completed_at, error_message
         FROM desktop_scan_jobs
         WHERE user_id = ? AND id IN (${placeholders})`,
        [userId, ...validIds]
    );

    const foundIds = new Set(rows.map((row) => row.id));
    return {
        reports: rows.map((row) => ({
            id: row.id,
            platform: row.platform,
            mode: row.mode,
            status: row.status,
            verdict: normalizeVerdict(row.verdict || 'unknown'),
            risk_score: Number(row.risk_score || 0),
            surfaced_findings: Number(row.surfaced_findings || 0),
            hidden_findings: Number(row.hidden_findings || 0),
            started_at: row.started_at,
            completed_at: row.completed_at,
            message: row.error_message || parseJson(row.summary_json, {}).message || buildStatusMessage(row.status, row.verdict, row.surfaced_findings),
            findings: normalizeFindings(parseJson(row.findings_json, [])),
            timeline: summarizeTimeline(parseJson(row.summary_json, {}).timeline || []),
            full_report: parseJson(row.full_report_json, null)
        })),
        invalid_ids: [],
        missing_ids: validIds.filter((id) => !foundIds.has(id))
    };
}

async function getReleaseManifest() {
    const { getReleaseManifest: getAggregatedReleaseManifest } = require('./releaseManifestService');
    return getAggregatedReleaseManifest();
}

async function resumePendingDesktopScans() {
    const [rows] = await pool.query(
        `SELECT id FROM desktop_scan_jobs WHERE status IN ('QUEUED', 'RUNNING') ORDER BY created_at ASC LIMIT 24`
    ).catch(() => [[]]);
    rows.forEach((row) => enqueueJob(row.id));
}

module.exports = {
    createDesktopScanJob,
    attachDesktopArtifact,
    getDesktopScanJob,
    cancelActiveDesktopScans,
    getDesktopFullReports,
    getReleaseManifest,
    resumePendingDesktopScans
};
