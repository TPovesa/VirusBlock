const fs = require('fs');
const fsp = require('fs/promises');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const router = express.Router();
const auth = require('../middleware/auth');
const {
    createDeepScanJob,
    getDeepScanJob,
    attachDeepScanApk,
    getUserDeepScanLimits,
    getDeepScanFullReports
} = require('../services/deepScanService');

function parseUploadLimitBytes(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return 256 * 1024 * 1024;
    }
    const matched = normalized.match(/^(\d+)(b|kb|mb|gb)?$/);
    if (!matched) {
        return 256 * 1024 * 1024;
    }
    const amount = Number(matched[1] || 0);
    const unit = matched[2] || 'b';
    const multiplier = unit === 'gb'
        ? 1024 * 1024 * 1024
        : unit === 'mb'
            ? 1024 * 1024
            : unit === 'kb'
                ? 1024
                : 1;
    return amount * multiplier;
}

const UPLOAD_LIMIT_BYTES = parseUploadLimitBytes(process.env.DEEP_SCAN_UPLOAD_LIMIT || '256mb');

async function readApkUploadToTempFile(req) {
    const tempPath = path.join(os.tmpdir(), `shield-upload-${crypto.randomUUID()}.apk`);
    const writeStream = fs.createWriteStream(tempPath, { flags: 'wx' });
    const hash = crypto.createHash('sha256');
    let total = 0;
    let settled = false;

    return new Promise((resolve, reject) => {
        const cleanup = async () => {
            try {
                await fsp.rm(tempPath, { force: true });
            } catch (_) {}
        };

        const fail = async (error) => {
            if (settled) {
                return;
            }
            settled = true;
            req.unpipe(writeStream);
            writeStream.destroy();
            await cleanup();
            reject(error);
        };

        writeStream.on('error', (error) => {
            void fail(error);
        });
        req.on('error', (error) => {
            void fail(error);
        });
        req.on('data', (chunk) => {
            total += chunk.length;
            if (total > UPLOAD_LIMIT_BYTES) {
                const error = new Error('APK payload is too large');
                error.code = 'PAYLOAD_TOO_LARGE';
                req.destroy(error);
                return;
            }
            hash.update(chunk);
        });

        writeStream.on('finish', () => {
            if (settled) {
                return;
            }
            settled = true;
            if (total <= 0) {
                void cleanup().finally(() => reject(new Error('APK payload is empty')));
                return;
            }
            resolve({
                tempFilePath: tempPath,
                sizeBytes: total,
                sha256: hash.digest('hex')
            });
        });

        req.pipe(writeStream);
    });
}

function classifyFullReportError(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();

    if ([
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'PROTOCOL_CONNECTION_LOST',
        'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
    ].includes(code)) {
        return {
            status: 503,
            payload: { error: 'Deep scan report storage is temporarily unavailable', code: 'REPORTS_STORAGE_UNAVAILABLE' }
        };
    }

    if (code.startsWith('ER_') && /table|column|sql|parse|unknown/i.test(String(error?.sqlMessage || error?.message || ''))) {
        return {
            status: 502,
            payload: { error: 'Deep scan report backend returned an invalid response', code: 'REPORTS_BACKEND_ERROR' }
        };
    }

    if (/database|mysql|connection|pool/.test(message)) {
        return {
            status: 503,
            payload: { error: 'Deep scan report storage is temporarily unavailable', code: 'REPORTS_STORAGE_UNAVAILABLE' }
        };
    }

    return null;
}

function classifyDeepScanRuntimeError(error) {
    const code = String(error?.code || '').toUpperCase();
    const message = String(error?.message || '').toLowerCase();
    const sqlMessage = String(error?.sqlMessage || '').toLowerCase();

    if ([
        'ECONNREFUSED',
        'ECONNRESET',
        'ETIMEDOUT',
        'EAI_AGAIN',
        'PROTOCOL_CONNECTION_LOST',
        'PROTOCOL_ENQUEUE_AFTER_FATAL_ERROR'
    ].includes(code)) {
        return {
            status: 503,
            payload: { error: 'Сервер проверки временно недоступен. Попробуйте ещё раз через минуту.' }
        };
    }

    if (code === 'EACCES' || message.includes('permission denied')) {
        return {
            status: 503,
            payload: { error: 'Сервер не смог подготовить хранилище для APK. Повторите попытку позже.' }
        };
    }

    if (code.startsWith('ER_') || code === 'WARN_DATA_TRUNCATED') {
        if (sqlMessage.includes('unknown column') || sqlMessage.includes('data truncated')) {
            return {
                status: 503,
                payload: { error: 'Сервер проверки обновляется. Повторите попытку через минуту.' }
            };
        }
        return {
            status: 503,
            payload: { error: 'База данных сервера проверки временно недоступна. Попробуйте позже.' }
        };
    }

    if (message.includes('database') || message.includes('mysql') || message.includes('pool')) {
        return {
            status: 503,
            payload: { error: 'База данных сервера проверки временно недоступна. Попробуйте позже.' }
        };
    }

    return null;
}

function sanitizeDeepScanForClient(scan) {
    if (!scan || typeof scan !== 'object') {
        return scan;
    }

    const findings = Array.isArray(scan.findings)
        ? scan.findings.map((finding) => ({
            ...finding,
            source: null
        }))
        : [];

    return {
        ...scan,
        request: undefined,
        summary: scan.summary ? {
            ...scan.summary,
            sources: []
        } : null,
        findings
    };
}

router.post('/start', auth, async (req, res) => {
    try {
        const job = await createDeepScanJob(req.userId, req.body || {});
        if (job?.error) {
            return res.status(job.status_code || 400).json({
                error: job.error,
                code: job.code || null,
                limits: job.limits || null
            });
        }

        return res.status(job.status === 'AWAITING_UPLOAD' ? 202 : 202).json({
            success: true,
            scan: job
        });
    } catch (error) {
        console.error('Deep scan start error:', error);
        const classified = classifyDeepScanRuntimeError(error);
        if (classified) {
            return res.status(classified.status).json(classified.payload);
        }
        return res.status(500).json({ error: 'Сервер не смог запустить проверку. Попробуйте позже.' });
    }
});

router.post('/:id/apk', auth, async (req, res) => {
    let upload = null;
    try {
        upload = await readApkUploadToTempFile(req);
        const scan = await attachDeepScanApk(
            req.params.id,
            req.userId,
            {
                ...upload,
                originalName: req.get('X-File-Name') || 'sample.apk'
            }
        );
        if (scan?.error) {
            return res.status(400).json({ error: scan.error });
        }
        if (!scan) {
            return res.status(404).json({ error: 'Deep scan not found' });
        }
        return res.status(202).json({ success: true, scan });
    } catch (error) {
        if (upload?.tempFilePath) {
            await fsp.rm(upload.tempFilePath, { force: true }).catch(() => {});
        }
        if (String(error?.code || '').toUpperCase() === 'PAYLOAD_TOO_LARGE') {
            return res.status(413).json({ error: 'APK payload is too large' });
        }
        console.error('Deep scan upload error:', error);
        const classified = classifyDeepScanRuntimeError(error);
        if (classified) {
            return res.status(classified.status).json(classified.payload);
        }
        return res.status(500).json({ error: 'Сервер не смог принять APK для проверки.' });
    }
});

router.get('/limits', auth, async (req, res) => {
    try {
        const limits = await getUserDeepScanLimits(req.userId);
        if (limits?.error) {
            return res.status(404).json({ error: limits.error, code: limits.code || null });
        }
        return res.json({
            success: true,
            limits
        });
    } catch (error) {
        console.error('Deep scan limits error:', error);
        return res.status(500).json({ error: 'Server error' });
    }
});

router.post('/full-report', auth, async (req, res) => {
    try {
        const ids = req.body?.ids;
        const hasValidId = Array.isArray(ids) && ids.some((id) => String(id || '').trim().length > 0);
        if (!hasValidId) {
            return res.status(400).json({
                error: 'ids must be a non-empty array'
            });
        }
        const normalizedIds = ids
            .map((value) => String(value || '').trim())
            .filter(Boolean);
        const validIds = normalizedIds.filter((value) => /^[a-zA-Z0-9-]{20,64}$/.test(value));
        if (validIds.length === 0) {
            return res.status(400).json({
                error: 'ids contains no valid scan identifiers'
            });
        }

        const reports = await getDeepScanFullReports(validIds, req.userId);
        if (!Array.isArray(reports) || reports.length === 0) {
            return res.status(404).json({
                error: 'No deep scan reports found for current user',
                code: 'REPORTS_NOT_FOUND'
            });
        }

        const foundIds = new Set(reports.map((item) => item.scan_id));
        const missing_ids = validIds.filter((id) => !foundIds.has(id));
        const invalid_ids = normalizedIds.filter((id) => !/^[a-zA-Z0-9-]{20,64}$/.test(id));
        return res.json({
            success: true,
            generated_at: Date.now(),
            reports,
            missing_ids,
            invalid_ids
        });
    } catch (error) {
        console.error('Deep scan full-report error:', error);
        const classified = classifyFullReportError(error);
        if (classified) {
            return res.status(classified.status).json(classified.payload);
        }
        return res.status(500).json({ error: 'Unexpected server error', code: 'REPORTS_UNEXPECTED_ERROR' });
    }
});

router.get('/:id', auth, async (req, res) => {
    try {
        const scan = await getDeepScanJob(req.params.id, req.userId);
        if (!scan) {
            return res.status(404).json({ error: 'Deep scan not found' });
        }

        return res.json({
            success: true,
            scan: sanitizeDeepScanForClient(scan)
        });
    } catch (error) {
        console.error('Deep scan fetch error:', error);
        const classified = classifyDeepScanRuntimeError(error);
        if (classified) {
            return res.status(classified.status).json(classified.payload);
        }
        return res.status(500).json({ error: 'Сервер не смог отдать статус проверки.' });
    }
});

module.exports = router;
