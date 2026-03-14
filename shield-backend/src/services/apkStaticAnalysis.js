const path = require('path');
const { spawn } = require('child_process');

const ANALYZER_TIMEOUT_MS = parseInt(process.env.APK_ANALYZER_TIMEOUT_MS || '1200000', 10);
const ANALYZER_PYTHON = process.env.APK_ANALYZER_PYTHON || 'python3';

function runAnalyzer(apkPath) {
    return new Promise((resolve) => {
        const scriptPath = path.join(__dirname, '..', '..', 'scripts', 'analyze_apk.py');
        const rulesPath = path.join(__dirname, '..', '..', 'rules', 'deep_scan.yar');
        const child = spawn(ANALYZER_PYTHON, [scriptPath, '--apk', apkPath, '--rules', rulesPath], {
            stdio: ['ignore', 'pipe', 'pipe']
        });

        let stdout = '';
        let stderr = '';
        const timer = ANALYZER_TIMEOUT_MS > 0 ? setTimeout(() => {
            child.kill('SIGKILL');
            resolve({
                ok: false,
                error: 'APK analyzer timed out',
                findings: [],
                metadata: {},
                risk_bonus: 0,
                sources: []
            });
        }, ANALYZER_TIMEOUT_MS) : null;

        child.stdout.on('data', (chunk) => {
            stdout += chunk.toString();
        });
        child.stderr.on('data', (chunk) => {
            stderr += chunk.toString();
        });
        child.on('error', (error) => {
            if (timer) clearTimeout(timer);
            resolve({
                ok: false,
                error: error.message,
                findings: [],
                metadata: {},
                risk_bonus: 0,
                sources: []
            });
        });
        child.on('close', () => {
            if (timer) clearTimeout(timer);
            try {
                const parsed = JSON.parse(stdout || '{}');
                resolve({
                    ok: Boolean(parsed.ok),
                    error: parsed.error || (stderr.trim() || null),
                    findings: Array.isArray(parsed.findings) ? parsed.findings : [],
                    metadata: parsed.metadata || {},
                    risk_bonus: Number(parsed.risk_bonus || 0),
                    sources: Array.isArray(parsed.sources) ? parsed.sources : []
                });
            } catch (_) {
                resolve({
                    ok: false,
                    error: stderr.trim() || 'APK analyzer returned invalid JSON',
                    findings: [],
                    metadata: {},
                    risk_bonus: 0,
                    sources: []
                });
            }
        });
    });
}

module.exports = {
    runAnalyzer
};
