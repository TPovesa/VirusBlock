const { v4: uuidv4 } = require('uuid');
const pool = require('../db/pool');
const { nowMs } = require('../utils/security');
const {
    normalizeDeepScanPayload,
    validateDeepScanPayload,
    analyzeHeuristics
} = require('../utils/deepScanHeuristics');

const VT_API_BASE = (process.env.VT_API_BASE || 'https://www.virustotal.com/api/v3').replace(/\/$/, '');
const VT_TIMEOUT_MS = parseInt(process.env.VT_TIMEOUT_MS || '8000', 10);
const PROCESSING_QUEUE = [];
const ENQUEUED_IDS = new Set();
let queueActive = false;
let pendingResume = false;

function parseJson(value, fallback) {
    if (!value) return fallback;
    try {
        return JSON.parse(value);
    } catch (_) {
        return fallback;
    }
}

function isVirusTotalConfigured() {
    return Boolean(String(process.env.VT_API_KEY || '').trim());
}

async function lookupVirusTotalByHash(sha256) {
    if (!sha256) {
        return { status: 'skipped' };
    }
    if (!isVirusTotalConfigured()) {
        return { status: 'unconfigured' };
    }

    const response = await fetch(`${VT_API_BASE}/files/${encodeURIComponent(sha256)}`, {
        method: 'GET',
        headers: {
            'x-apikey': process.env.VT_API_KEY,
            'accept': 'application/json'
        },
        signal: AbortSignal.timeout(VT_TIMEOUT_MS)
    });

    if (response.status === 404) {
        return { status: 'not_found' };
    }

    if (!response.ok) {
        const body = await response.text().catch(() => '');
        throw new Error(`VirusTotal lookup failed: ${response.status} ${body.slice(0, 160)}`);
    }

    const payload = await response.json();
    const stats = payload?.data?.attributes?.last_analysis_stats || {};
    const names = Object.entries(payload?.data?.attributes?.last_analysis_results || {})
        .filter(([, engine]) => ['malicious', 'suspicious'].includes(engine?.category))
        .slice(0, 5)
        .map(([engineName, engine]) => ({
            engine: engineName,
            category: engine.category,
            result: engine.result || null
        }));

    return {
        status: 'found',
        malicious: Number(stats.malicious || 0),
        suspicious: Number(stats.suspicious || 0),
        harmless: Number(stats.harmless || 0),
        undetected: Number(stats.undetected || 0),
        timeout: Number(stats.timeout || 0),
        reputation: Number(payload?.data?.attributes?.reputation || 0),
        names
    };
}

async function createDeepScanJob(userId, payload) {
    const normalized = normalizeDeepScanPayload(payload);
    const validationError = validateDeepScanPayload(normalized);
    if (validationError) {
        return { error: validationError };
    }

    const id = uuidv4();
    const now = nowMs();
    const requestJson = JSON.stringify(normalized);

    await pool.query(
        `INSERT INTO deep_scan_jobs
         (id, user_id, package_name, app_name, sha256, status, request_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'QUEUED', ?, ?, ?)`,
        [
            id,
            userId,
            normalized.packageName,
            normalized.appName,
            normalized.sha256,
            requestJson,
            now,
            now
        ]
    );

    enqueueDeepScan(id);

    return {
        id,
        status: 'QUEUED',
        created_at: now,
        package_name: normalized.packageName,
        app_name: normalized.appName,
        sha256: normalized.sha256
    };
}

async function getDeepScanJob(id, userId) {
    const [rows] = await pool.query(
        `SELECT id, user_id, package_name, app_name, sha256, status, verdict, risk_score,
                vt_status, vt_malicious, vt_suspicious, vt_harmless,
                request_json, summary_json, findings_json, error_message,
                created_at, started_at, completed_at, updated_at
         FROM deep_scan_jobs
         WHERE id = ? AND user_id = ?`,
        [id, userId]
    );

    if (rows.length === 0) {
        return null;
    }

    const row = rows[0];
    return {
        id: row.id,
        status: row.status,
        package_name: row.package_name,
        app_name: row.app_name,
        sha256: row.sha256,
        verdict: row.verdict,
        risk_score: row.risk_score,
        vt: {
            status: row.vt_status,
            malicious: row.vt_malicious,
            suspicious: row.vt_suspicious,
            harmless: row.vt_harmless
        },
        request: parseJson(row.request_json, {}),
        summary: parseJson(row.summary_json, null),
        findings: parseJson(row.findings_json, []),
        error: row.error_message,
        created_at: row.created_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
        updated_at: row.updated_at
    };
}

function enqueueDeepScan(jobId) {
    if (ENQUEUED_IDS.has(jobId)) {
        return;
    }
    ENQUEUED_IDS.add(jobId);
    PROCESSING_QUEUE.push(jobId);
    void drainQueue();
}

async function resumePendingDeepScans() {
    if (pendingResume) {
        return;
    }
    pendingResume = true;
    try {
        const [rows] = await pool.query(
            `SELECT id FROM deep_scan_jobs
             WHERE status IN ('QUEUED', 'RUNNING')
             ORDER BY created_at ASC
             LIMIT 100`
        );
        for (const row of rows) {
            enqueueDeepScan(row.id);
        }
    } catch (error) {
        console.error('Deep scan resume error:', error);
    } finally {
        pendingResume = false;
    }
}

async function drainQueue() {
    if (queueActive) {
        return;
    }
    queueActive = true;

    while (PROCESSING_QUEUE.length > 0) {
        const jobId = PROCESSING_QUEUE.shift();
        ENQUEUED_IDS.delete(jobId);
        try {
            await runDeepScanJob(jobId);
        } catch (error) {
            console.error('Deep scan execution error:', error);
        }
    }

    queueActive = false;
}

async function runDeepScanJob(jobId) {
    const [rows] = await pool.query(
        `SELECT id, user_id, request_json, status
         FROM deep_scan_jobs
         WHERE id = ? LIMIT 1`,
        [jobId]
    );

    if (rows.length === 0) {
        return;
    }

    const row = rows[0];
    if (row.status === 'COMPLETED' || row.status === 'FAILED') {
        return;
    }

    const startedAt = nowMs();
    await pool.query(
        `UPDATE deep_scan_jobs
         SET status = 'RUNNING', started_at = COALESCE(started_at, ?), updated_at = ?, error_message = NULL
         WHERE id = ?`,
        [startedAt, startedAt, jobId]
    );

    const request = parseJson(row.request_json, {});
    const normalized = normalizeDeepScanPayload(request);

    try {
        let vt = { status: normalized.sha256 ? 'pending' : 'skipped' };
        try {
            vt = await lookupVirusTotalByHash(normalized.sha256);
        } catch (error) {
            vt = { status: 'error', error: error.message };
        }

        const heuristics = analyzeHeuristics(normalized, vt);
        const completedAt = nowMs();
        const summary = {
            scanned_at: completedAt,
            verdict: heuristics.verdict,
            risk_score: heuristics.riskScore,
            recommendations: heuristics.recommendations,
            metadata: heuristics.metadata,
            virus_total: vt
        };

        await pool.query(
            `UPDATE deep_scan_jobs
             SET status = 'COMPLETED',
                 verdict = ?,
                 risk_score = ?,
                 vt_status = ?,
                 vt_malicious = ?,
                 vt_suspicious = ?,
                 vt_harmless = ?,
                 summary_json = ?,
                 findings_json = ?,
                 completed_at = ?,
                 updated_at = ?
             WHERE id = ?`,
            [
                heuristics.verdict,
                heuristics.riskScore,
                vt.status || null,
                vt.malicious ?? null,
                vt.suspicious ?? null,
                vt.harmless ?? null,
                JSON.stringify(summary),
                JSON.stringify(heuristics.findings),
                completedAt,
                completedAt,
                jobId
            ]
        );
    } catch (error) {
        const failedAt = nowMs();
        await pool.query(
            `UPDATE deep_scan_jobs
             SET status = 'FAILED', error_message = ?, completed_at = ?, updated_at = ?
             WHERE id = ?`,
            [String(error.message || 'Deep scan failed').slice(0, 255), failedAt, failedAt, jobId]
        );
    }
}

module.exports = {
    createDeepScanJob,
    getDeepScanJob,
    resumePendingDeepScans
};
