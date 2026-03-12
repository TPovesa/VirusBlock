const fs = require('fs/promises');
const path = require('path');
const crypto = require('crypto');
const pool = require('../db/pool');
const { nowMs } = require('../utils/security');
const {
    normalizeDeepScanPayload,
    validateDeepScanPayload,
    analyzeHeuristics,
    classifyVerdict
} = require('../utils/deepScanHeuristics');
const { runAnalyzer } = require('./apkStaticAnalysis');
const { isAiConfigured, triageDeepScanFindings } = require('./aiExplainService');

const VT_API_BASE = (process.env.VT_API_BASE || 'https://www.virustotal.com/api/v3').replace(/\/$/, '');
const VT_TIMEOUT_MS = parseInt(process.env.VT_TIMEOUT_MS || '8000', 10);
const UPLOAD_ROOT = process.env.DEEP_SCAN_UPLOAD_DIR || path.join(process.cwd(), 'storage', 'deep-scans');
const MAX_UPLOAD_BYTES = parseInt(process.env.DEEP_SCAN_MAX_UPLOAD_BYTES || String(256 * 1024 * 1024), 10);
const APK_FETCH_URL_TEMPLATE = String(process.env.DEEP_SCAN_APK_FETCH_URL_TEMPLATE || '').trim();
const APK_FETCH_TIMEOUT_MS = parseInt(process.env.DEEP_SCAN_APK_FETCH_TIMEOUT_MS || '12000', 10);
const APK_FETCH_MAX_BYTES = parseInt(process.env.DEEP_SCAN_APK_FETCH_MAX_BYTES || String(MAX_UPLOAD_BYTES), 10);
const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const SCAN_MODE_LIMITS = Object.freeze({
    FULL: 1,
    SELECTIVE: 3,
    APK: 3
});
const PROCESSING_QUEUE = [];
const ENQUEUED_IDS = new Set();
let queueActive = false;
let pendingResume = false;

const LOW_SIGNAL_FINDING_TYPES = new Set([
    'install_source',
    'recent_sideload',
    'metadata_gap',
    'signature_gap',
    'certificate_gap',
    'virustotal_lookup',
    'platform_age',
    'update_staleness'
]);

const HIGH_SIGNAL_FINDING_TYPES = new Set([
    'virustotal',
    'hash_mismatch',
    'apkid',
    'yara',
    'dynamic_loader',
    'shell_exec',
    'accessibility_automation',
    'telegram_c2',
    'discord_webhook',
    'anti_analysis',
    'hardcoded_ip',
    'cleartext_endpoint',
    'permission_combo'
]);

const HARD_SIGNAL_SOURCES = new Set([
    'VirusTotal',
    'APKiD',
    'YARA'
]);

const AGGRESSIVE_FINDING_TYPES_FOR_BENIGN = new Set([
    'install_source',
    'recent_sideload',
    'metadata_gap',
    'signature_gap',
    'certificate_gap',
    'virustotal_lookup'
]);

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

function computeSha256(buffer) {
    return crypto.createHash('sha256').update(buffer).digest('hex');
}

function severityRank(severity) {
    switch (String(severity || '').toLowerCase()) {
        case 'critical': return 4;
        case 'high': return 3;
        case 'medium': return 2;
        default: return 1;
    }
}

function verdictRank(verdict) {
    switch (String(verdict || '').toLowerCase()) {
        case 'malicious': return 4;
        case 'suspicious': return 3;
        case 'low_risk': return 2;
        default: return 1;
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeFindingsList(findings) {
    if (!Array.isArray(findings)) {
        return [];
    }
    return findings
        .filter((item) => item && typeof item === 'object')
        .map((item) => ({
            type: item.type || null,
            severity: item.severity || 'low',
            title: item.title || 'Signal',
            detail: item.detail || '',
            source: item.source || 'Shield Rules',
            score: Number(item.score || 0),
            evidence: item.evidence && typeof item.evidence === 'object' ? item.evidence : {}
        }));
}

function formatTimestamp(value) {
    const parsed = Number(value || 0);
    if (!Number.isFinite(parsed) || parsed <= 0) {
        return 'n/a';
    }
    return new Date(parsed).toISOString();
}

function formatVerdict(value) {
    const verdict = String(value || '').toLowerCase();
    switch (verdict) {
        case 'malicious': return 'malicious';
        case 'suspicious': return 'suspicious';
        case 'low_risk': return 'low_risk';
        case 'clean': return 'clean';
        default: return 'unknown';
    }
}

function groupFindingsBySource(findings) {
    const sourceMap = new Map();
    normalizeFindingsList(findings).forEach((finding) => {
        const source = String(finding.source || 'Shield Rules');
        const bucket = sourceMap.get(source) || [];
        bucket.push(finding);
        sourceMap.set(source, bucket);
    });
    return Array.from(sourceMap.entries()).map(([source, items]) => ({
        source,
        count: items.length,
        maxSeverity: items.reduce((acc, item) => {
            return severityRank(item.severity) > severityRank(acc) ? item.severity : acc;
        }, 'low'),
        findings: items
    }));
}

function serializeEvidence(evidence) {
    if (!evidence || typeof evidence !== 'object' || Object.keys(evidence).length === 0) {
        return null;
    }
    try {
        return JSON.stringify(evidence);
    } catch (_) {
        return null;
    }
}

function renderFindingsSection(title, findings) {
    const normalized = normalizeFindingsList(findings);
    const lines = [`## ${title}`];
    if (normalized.length === 0) {
        lines.push('- Сигналы не обнаружены.');
        lines.push('');
        return lines;
    }
    normalized.forEach((finding, index) => {
        lines.push(`${index + 1}. [${String(finding.severity || 'low').toUpperCase()}] ${finding.title}`);
        lines.push(`   - Тип: ${finding.type || 'n/a'}`);
        lines.push(`   - Источник: ${finding.source || 'Shield Rules'}`);
        lines.push(`   - Детали: ${finding.detail || 'n/a'}`);
        if (Number(finding.score || 0) > 0) {
            lines.push(`   - Балл: ${Number(finding.score)}`);
        }
        const evidence = serializeEvidence(finding.evidence);
        if (evidence) {
            lines.push(`   - Evidence: ${evidence}`);
        }
    });
    lines.push('');
    return lines;
}

function buildDeepScanFullReportPayload(row) {
    const request = parseJson(row.request_json, {});
    const summary = parseJson(row.summary_json, {});
    const finalFindings = normalizeFindingsList(parseJson(row.findings_json, []));
    const metadata = summary?.metadata && typeof summary.metadata === 'object' ? summary.metadata : {};
    const stages = metadata?.stages && typeof metadata.stages === 'object' ? metadata.stages : {};
    const heuristicsStage = stages.heuristics || {};
    const staticStage = stages.static_analysis || {};
    const mergedStage = stages.merged_before_triage || {};
    const deterministicStage = stages.deterministic_triage || {};
    const aiStage = stages.ai_triage || {};
    const finalStage = stages.final || {};
    const userFacingGate = stages.user_facing_gate || metadata?.user_facing_gate || finalStage?.user_facing_gate || {};
    const triage = summary?.triage || metadata?.triage || {};

    const groupedFinal = groupFindingsBySource(finalFindings);
    const lines = [];
    lines.push('# Shield Deep Scan Full Report');
    lines.push('');
    lines.push(`- Generated at: ${new Date().toISOString()}`);
    lines.push(`- Scan ID: ${row.id}`);
    lines.push(`- Status: ${row.status}`);
    lines.push(`- App: ${row.app_name || request.app_name || request.appName || 'n/a'}`);
    lines.push(`- Package: ${row.package_name || request.package_name || request.packageName || 'n/a'}`);
    lines.push(`- Mode: ${normalizeScanMode(row.scan_mode || request.scan_mode || request.scanMode)}`);
    lines.push(`- SHA-256: ${row.sha256 || request.sha256 || request.uploaded_apk_sha256 || 'n/a'}`);
    lines.push(`- Started: ${formatTimestamp(row.started_at)}`);
    lines.push(`- Completed: ${formatTimestamp(row.completed_at)}`);
    lines.push(`- Final verdict: ${formatVerdict(row.verdict || summary?.verdict || finalStage.verdict)}`);
    lines.push(`- Final risk score: ${Number(row.risk_score ?? summary?.risk_score ?? finalStage.risk_score ?? 0)}`);
    lines.push('');

    lines.push('## Stage: Heuristics + Metadata');
    lines.push(`- Verdict: ${formatVerdict(heuristicsStage.verdict)}`);
    lines.push(`- Risk score: ${Number(heuristicsStage.risk_score || 0)}`);
    lines.push(`- Findings: ${normalizeFindingsList(heuristicsStage.findings).length}`);
    lines.push('');
    lines.push(...renderFindingsSection('Heuristics Findings', heuristicsStage.findings));

    lines.push('## Stage: APK Static Analysis');
    lines.push(`- Analyzer ok: ${Boolean(staticStage.ok)}`);
    lines.push(`- Risk bonus: ${Number(staticStage.risk_bonus || 0)}`);
    lines.push(`- Sources: ${(Array.isArray(staticStage.sources) ? staticStage.sources : []).join(', ') || 'n/a'}`);
    if (staticStage.error) {
        lines.push(`- Error: ${String(staticStage.error)}`);
    }
    lines.push('');
    lines.push(...renderFindingsSection('Static Analysis Findings', staticStage.findings));

    lines.push('## Stage: Merge Before Triage');
    lines.push(`- Verdict: ${formatVerdict(mergedStage.verdict)}`);
    lines.push(`- Risk score: ${Number(mergedStage.risk_score || 0)}`);
    lines.push(`- Findings: ${normalizeFindingsList(mergedStage.findings).length}`);
    lines.push('');
    lines.push(...renderFindingsSection('Merged Findings', mergedStage.findings));

    lines.push('## Stage: Deterministic Filter');
    lines.push(`- Applied: ${Boolean(deterministicStage.applied)}`);
    lines.push(`- Reason: ${deterministicStage.reason || 'n/a'}`);
    lines.push(`- Before verdict/risk: ${formatVerdict(deterministicStage.before?.verdict)} / ${Number(deterministicStage.before?.risk_score || 0)}`);
    lines.push(`- After verdict/risk: ${formatVerdict(deterministicStage.after?.verdict)} / ${Number(deterministicStage.after?.risk_score || 0)}`);
    lines.push('');

    lines.push('## Stage: AI Filter');
    lines.push(`- Configured: ${Boolean(aiStage.configured)}`);
    lines.push(`- Attempted: ${Boolean(aiStage.attempted)}`);
    lines.push(`- Applied: ${Boolean(aiStage.applied)}`);
    lines.push(`- Model: ${aiStage.model || triage?.ai?.model || 'n/a'}`);
    lines.push(`- report_to_user: ${aiStage.report_to_user ?? triage?.ai?.report_to_user ?? 'n/a'}`);
    lines.push(`- benign_probability: ${Number(aiStage.benign_probability ?? triage?.ai?.benign_probability ?? 0)}`);
    lines.push(`- Reason: ${aiStage.reason || triage?.reason || triage?.ai?.reason || 'n/a'}`);
    if (aiStage.user_summary || triage?.ai?.user_summary) {
        lines.push(`- user_summary: ${aiStage.user_summary || triage?.ai?.user_summary}`);
    }
    if (aiStage.error) {
        lines.push(`- Error: ${String(aiStage.error)}`);
    }
    lines.push('');

    lines.push('## Stage: Final User-Facing Result');
    lines.push(`- Verdict: ${formatVerdict(finalStage.verdict || row.verdict || summary?.verdict)}`);
    lines.push(`- Risk score: ${Number(finalStage.risk_score ?? row.risk_score ?? summary?.risk_score ?? 0)}`);
    lines.push(`- Gate allow_threats_to_user: ${userFacingGate.allow_threats_to_user ?? 'n/a'}`);
    lines.push(`- Gate reason: ${userFacingGate.reason || finalStage.gate_reason || 'n/a'}`);
    lines.push(`- Findings shown to user: ${finalFindings.length}`);
    lines.push('');
    if (groupedFinal.length === 0) {
        lines.push('- После фильтрации пользователю не показываются угрозы для этого пакета.');
    } else {
        groupedFinal.forEach((group, index) => {
            lines.push(`${index + 1}. ${group.source} (${group.maxSeverity}, ${group.count})`);
            group.findings.forEach((finding) => {
                lines.push(`   - [${String(finding.severity || 'low').toUpperCase()}] ${finding.title}: ${finding.detail}`);
            });
        });
    }
    lines.push('');
    lines.push('## VirusTotal');
    lines.push(`- Status: ${summary?.virus_total?.status || row.vt_status || 'n/a'}`);
    lines.push(`- malicious/suspicious/harmless: ${Number(row.vt_malicious || 0)}/${Number(row.vt_suspicious || 0)}/${Number(row.vt_harmless || 0)}`);
    lines.push('');
    lines.push('## Recommendations');
    const recommendations = Array.isArray(summary?.recommendations) ? summary.recommendations : [];
    if (recommendations.length === 0) {
        lines.push('- n/a');
    } else {
        recommendations.forEach((item) => lines.push(`- ${String(item)}`));
    }
    lines.push('');

    return {
        scan_id: row.id,
        app_name: row.app_name || request.app_name || request.appName || null,
        package_name: row.package_name || request.package_name || request.packageName || null,
        scan_mode: normalizeScanMode(row.scan_mode || request.scan_mode || request.scanMode),
        status: row.status,
        generated_at: nowMs(),
        final_verdict: formatVerdict(row.verdict || summary?.verdict || finalStage.verdict),
        final_risk_score: Number(row.risk_score ?? summary?.risk_score ?? finalStage.risk_score ?? 0),
        file_name: `shield-full-report-${row.id}.md`,
        markdown: lines.join('\n')
    };
}

function findingScore(finding) {
    const explicit = Number(finding?.score);
    if (Number.isFinite(explicit) && explicit > 0) {
        return explicit;
    }
    const severity = severityRank(finding?.severity);
    if (severity >= 4) return 20;
    if (severity >= 3) return 14;
    if (severity >= 2) return 8;
    return 3;
}

function hasStrongThreatSignals({ findings, vt, riskScore }) {
    const malicious = Number(vt?.malicious || 0);
    const suspicious = Number(vt?.suspicious || 0);
    if (malicious >= 1) {
        return true;
    }
    if (riskScore >= 75) {
        return true;
    }
    if (suspicious >= 6 && riskScore >= 40) {
        return true;
    }

    const hasCritical = findings.some((finding) => severityRank(finding.severity) >= 4);
    if (hasCritical) {
        return true;
    }

    const hasHighSignalFinding = findings.some((finding) => {
        if (HIGH_SIGNAL_FINDING_TYPES.has(finding.type)) {
            if (finding.type !== 'permission_combo') {
                return true;
            }
            return severityRank(finding.severity) >= 3;
        }
        return false;
    });
    return hasHighSignalFinding;
}

function downgradeFindingForBenign(finding) {
    if (!finding || typeof finding !== 'object') {
        return finding;
    }

    if (finding.type === 'install_source') {
        return {
            ...finding,
            severity: 'low',
            score: Math.min(2, findingScore(finding)),
            title: 'Unknown install source (weak signal)',
            detail: 'Unknown installer alone is not sufficient evidence of malware without stronger indicators.'
        };
    }

    if (finding.type === 'recent_sideload') {
        return {
            ...finding,
            severity: 'low',
            score: Math.min(2, findingScore(finding))
        };
    }

    if (finding.type === 'permission_volume') {
        return {
            ...finding,
            severity: 'low',
            score: Math.min(6, findingScore(finding))
        };
    }

    return finding;
}

function buildCalmRecommendations(recommendations, fallbackLine) {
    const safe = (Array.isArray(recommendations) ? recommendations : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .filter((item) => !/удалите apk|удалите приложение|троян|malware/i.test(item));
    return Array.from(new Set([fallbackLine, ...safe])).slice(0, 4);
}

function applyDeterministicTriage({ verdict, riskScore, findings, recommendations, vt }) {
    const originalFindings = Array.isArray(findings) ? findings : [];
    const strongSignals = hasStrongThreatSignals({
        findings: originalFindings,
        vt,
        riskScore
    });

    if (strongSignals) {
        return {
            verdict,
            riskScore,
            findings: originalFindings,
            recommendations,
            triage: {
                applied: false,
                source: 'deterministic',
                reason: 'strong_signals_present',
                benign_probability: 0
            },
            strongSignals
        };
    }

    const downgraded = dedupeFindings(originalFindings.map(downgradeFindingForBenign));
    const noisyOnly = downgraded.every((finding) => LOW_SIGNAL_FINDING_TYPES.has(finding.type));
    if (noisyOnly) {
        return {
            verdict: 'clean',
            riskScore: Math.min(10, riskScore),
            findings: [],
            recommendations: buildCalmRecommendations(
                recommendations,
                'Сильных серверных индикаторов угрозы не найдено.'
            ),
            triage: {
                applied: true,
                source: 'deterministic',
                reason: 'noisy_only_signals',
                benign_probability: 0.92
            },
            strongSignals
        };
    }

    const filteredForBenign = downgraded.filter((finding) => !AGGRESSIVE_FINDING_TYPES_FOR_BENIGN.has(finding.type));
    const highSeverityLeft = filteredForBenign.filter((finding) => severityRank(finding.severity) >= 3).length;

    if (verdictRank(verdict) >= verdictRank('suspicious') && riskScore <= 60 && highSeverityLeft === 0) {
        return {
            verdict: 'low_risk',
            riskScore: clamp(Math.min(riskScore, 34), 20, 34),
            findings: filteredForBenign.slice(0, 8),
            recommendations: buildCalmRecommendations(
                recommendations,
                'Найдены слабые/контекстные риски, но явных признаков вредоносной активности нет.'
            ),
            triage: {
                applied: true,
                source: 'deterministic',
                reason: 'downgraded_without_strong_signals',
                benign_probability: 0.76
            },
            strongSignals
        };
    }

    return {
        verdict,
        riskScore,
        findings: downgraded,
        recommendations,
        triage: {
            applied: false,
            source: 'deterministic',
            reason: 'no_override_needed',
            benign_probability: 0.4
        },
        strongSignals
    };
}

function applyAiTriageDecision(base, aiTriage) {
    if (!aiTriage) {
        return base;
    }

    if (aiTriage.reportToUser === false) {
        if (base.strongSignals) {
            return {
                ...base,
                triage: {
                    ...base.triage,
                    ai: {
                        applied: false,
                        model: aiTriage.model || null,
                        reason: aiTriage.reason || 'ai_hide_rejected_due_to_strong_signals',
                        benign_probability: aiTriage.benignProbability,
                        report_to_user: true,
                        user_summary: aiTriage.userSummary || null
                    }
                }
            };
        }

        return {
            ...base,
            verdict: 'clean',
            riskScore: Math.min(base.riskScore, 10),
            findings: [],
            recommendations: buildCalmRecommendations(
                base.recommendations,
                aiTriage.userSummary || 'AI-триаж не подтвердил угрозу, сигнал скрыт.'
            ),
            triage: {
                ...base.triage,
                applied: true,
                source: 'deterministic+ai',
                reason: aiTriage.reason || 'ai_report_gate_hidden',
                benign_probability: Math.max(0.82, Number(aiTriage.benignProbability || 0)),
                ai: {
                    applied: true,
                    model: aiTriage.model || null,
                    benign_probability: aiTriage.benignProbability,
                    report_to_user: false,
                    user_summary: aiTriage.userSummary || null
                }
            }
        };
    }

    if (base.strongSignals || aiTriage.benignProbability < 0.72) {
        return {
            ...base,
            triage: {
                ...base.triage,
                ai: {
                    applied: false,
                    model: aiTriage.model || null,
                    reason: aiTriage.reason || 'ai_threshold_not_met',
                    benign_probability: aiTriage.benignProbability,
                    report_to_user: true,
                    user_summary: aiTriage.userSummary || null
                }
            }
        };
    }

    const allowedVerdict = ['clean', 'low_risk'].includes(aiTriage.suggestedVerdict)
        ? aiTriage.suggestedVerdict
        : null;
    if (!allowedVerdict || verdictRank(allowedVerdict) > verdictRank(base.verdict)) {
        return {
            ...base,
            triage: {
                ...base.triage,
                ai: {
                    applied: false,
                    model: aiTriage.model || null,
                    reason: aiTriage.reason || 'ai_verdict_rejected',
                    benign_probability: aiTriage.benignProbability,
                    report_to_user: true,
                    user_summary: aiTriage.userSummary || null
                }
            }
        };
    }

    const suppressTypes = new Set(Array.isArray(aiTriage.suppressTypes) ? aiTriage.suppressTypes : []);
    const aiFilteredFindings = dedupeFindings(
        (Array.isArray(base.findings) ? base.findings : [])
            .map(downgradeFindingForBenign)
            .filter((finding) => !suppressTypes.has(finding.type))
            .filter((finding) => allowedVerdict !== 'clean' || !AGGRESSIVE_FINDING_TYPES_FOR_BENIGN.has(finding.type))
    ).slice(0, 8);

    const adjustedRisk = allowedVerdict === 'clean'
        ? Math.min(base.riskScore, 12)
        : clamp(Math.min(base.riskScore, 34), 20, 34);

    const calmRecommendations = buildCalmRecommendations(
        base.recommendations,
        allowedVerdict === 'clean'
            ? 'По серверным признакам приложение похоже на benign/чистое.'
            : 'Риск низкий: сильных технических индикаторов вредоносного поведения не найдено.'
    );

    return {
        ...base,
        verdict: allowedVerdict,
        riskScore: adjustedRisk,
        findings: aiFilteredFindings,
        recommendations: calmRecommendations,
        triage: {
            ...base.triage,
            applied: true,
            source: 'deterministic+ai',
            reason: aiTriage.reason || 'ai_benign_override',
            benign_probability: aiTriage.benignProbability,
            ai: {
                applied: true,
                model: aiTriage.model || null,
                benign_probability: aiTriage.benignProbability,
                report_to_user: true,
                user_summary: aiTriage.userSummary || null
            }
        }
    };
}

function isWeakSignalOnlyFinding(finding) {
    if (!finding || typeof finding !== 'object') {
        return false;
    }
    const type = String(finding.type || '');
    return LOW_SIGNAL_FINDING_TYPES.has(type) && severityRank(finding.severity) <= 2;
}

function isCriticalHardSignalFinding(finding) {
    if (!finding || typeof finding !== 'object') {
        return false;
    }
    if (severityRank(finding.severity) < 4) {
        return false;
    }
    if (HIGH_SIGNAL_FINDING_TYPES.has(String(finding.type || ''))) {
        return true;
    }
    return HARD_SIGNAL_SOURCES.has(String(finding.source || ''));
}

function applyUserFacingThreatGate({ verdict, riskScore, findings, recommendations, vt }) {
    const normalizedFindings = normalizeFindingsList(findings);
    const verdictIsThreat = verdictRank(verdict) >= verdictRank('suspicious');
    const vtMalicious = Number(vt?.malicious || 0);
    const criticalHardSignals = normalizedFindings.filter(isCriticalHardSignalFinding);
    const hasHardSignals = vtMalicious > 0 || criticalHardSignals.length > 0;
    const weakSignalsOnly = normalizedFindings.length > 0 && normalizedFindings.every(isWeakSignalOnlyFinding);

    let allowThreatsToUser = verdictIsThreat || hasHardSignals;
    let gateReason = allowThreatsToUser ? 'allow_verdict_or_hard_signals' : 'blocked_without_verdict_or_hard_signals';
    if (weakSignalsOnly && !hasHardSignals) {
        allowThreatsToUser = false;
        gateReason = 'blocked_weak_signals_only';
    }

    if (allowThreatsToUser) {
        return {
            verdict,
            riskScore,
            findings: normalizedFindings,
            recommendations,
            gate: {
                applied: true,
                allow_threats_to_user: true,
                reason: gateReason,
                verdict_is_suspicious_or_malicious: verdictIsThreat,
                hard_signals_present: hasHardSignals,
                vt_malicious: vtMalicious,
                weak_signals_only: weakSignalsOnly,
                critical_hard_signal_count: criticalHardSignals.length,
                critical_hard_signal_types: Array.from(new Set(criticalHardSignals.map((item) => item.type).filter(Boolean))).slice(0, 8),
                findings_before_gate: normalizedFindings.length,
                findings_after_gate: normalizedFindings.length
            }
        };
    }

    const fallbackReason = weakSignalsOnly
        ? 'Отмечены только слабые контекстные сигналы, без подтверждённой вредоносности.'
        : 'Сигналы не достигли пользовательского порога угрозы после фильтрации.';
    const normalizedVerdict = formatVerdict(verdict);
    const nextVerdict = verdictRank(verdict) >= verdictRank('suspicious')
        ? 'clean'
        : (normalizedVerdict === 'low_risk' ? 'low_risk' : 'clean');
    const nextRiskScore = verdictRank(verdict) >= verdictRank('suspicious')
        ? Math.min(12, Number(riskScore || 0))
        : Math.min(15, Number(riskScore || 0));

    return {
        verdict: nextVerdict,
        riskScore: clamp(nextRiskScore, 0, 100),
        findings: [],
        recommendations: buildCalmRecommendations(recommendations, fallbackReason),
        gate: {
            applied: true,
            allow_threats_to_user: false,
            reason: gateReason,
            verdict_is_suspicious_or_malicious: verdictIsThreat,
            hard_signals_present: hasHardSignals,
            vt_malicious: vtMalicious,
            weak_signals_only: weakSignalsOnly,
            critical_hard_signal_count: criticalHardSignals.length,
            critical_hard_signal_types: Array.from(new Set(criticalHardSignals.map((item) => item.type).filter(Boolean))).slice(0, 8),
            findings_before_gate: normalizedFindings.length,
            findings_after_gate: 0
        }
    };
}

function normalizeScanMode(value) {
    const mode = String(value || 'FULL').trim().toUpperCase();
    return Object.prototype.hasOwnProperty.call(SCAN_MODE_LIMITS, mode) ? mode : 'FULL';
}

function getUtcDayWindow(now = nowMs()) {
    const date = new Date(now);
    const start = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate());
    return {
        dayKey: new Date(start).toISOString().slice(0, 10),
        startAt: start,
        endAt: start + ONE_DAY_MS
    };
}

function parseCsvSet(value, normalizer = (entry) => entry) {
    return new Set(
        String(value || '')
            .split(',')
            .map((entry) => normalizer(String(entry || '').trim()))
            .filter(Boolean)
    );
}

function isUserInDevMode(user) {
    if (!user) {
        return false;
    }
    if (String(process.env.DEEP_SCAN_DEV_MODE || '').trim() === '1') {
        return true;
    }

    const forcedIds = parseCsvSet(process.env.DEEP_SCAN_DEV_USER_IDS);
    const forcedEmails = parseCsvSet(process.env.DEEP_SCAN_DEV_USER_EMAILS, (entry) => entry.toLowerCase());
    if (forcedIds.has(String(user.id || '').trim())) {
        return true;
    }
    if (forcedEmails.has(String(user.email || '').trim().toLowerCase())) {
        return true;
    }

    return Number(user.is_dev_mode || 0) === 1;
}

async function getUserDevMode(userId, db = pool) {
    const [rows] = await db.query(
        `SELECT id, email, is_dev_mode
         FROM users
         WHERE id = ?
         LIMIT 1`,
        [userId]
    );
    if (rows.length === 0) {
        return {
            exists: false,
            devMode: false
        };
    }
    return {
        exists: true,
        devMode: isUserInDevMode(rows[0])
    };
}

async function incrementDailyUsage(connection, userId, scanMode, dayKey, now) {
    await connection.query(
        `INSERT INTO deep_scan_daily_usage
         (user_id, usage_date, scan_mode, launches_count, created_at, updated_at)
         VALUES (?, ?, ?, 1, ?, ?)
         ON DUPLICATE KEY UPDATE
            launches_count = launches_count + 1,
            updated_at = VALUES(updated_at)`,
        [userId, dayKey, scanMode, now, now]
    );
}

async function consumeDailyUsageWithLimit(connection, userId, scanMode, dayKey, limit, now) {
    await connection.query(
        `INSERT INTO deep_scan_daily_usage
         (user_id, usage_date, scan_mode, launches_count, created_at, updated_at)
         VALUES (?, ?, ?, 0, ?, ?)
         ON DUPLICATE KEY UPDATE updated_at = VALUES(updated_at)`,
        [userId, dayKey, scanMode, now, now]
    );

    const [rows] = await connection.query(
        `SELECT launches_count
         FROM deep_scan_daily_usage
         WHERE user_id = ? AND usage_date = ? AND scan_mode = ?
         FOR UPDATE`,
        [userId, dayKey, scanMode]
    );
    const used = Number(rows[0]?.launches_count || 0);
    if (used >= limit) {
        return false;
    }

    await connection.query(
        `UPDATE deep_scan_daily_usage
         SET launches_count = launches_count + 1, updated_at = ?
         WHERE user_id = ? AND usage_date = ? AND scan_mode = ?`,
        [now, userId, dayKey, scanMode]
    );
    return true;
}

async function getUserDeepScanLimits(userId) {
    const now = nowMs();
    const window = getUtcDayWindow(now);
    const [{ exists, devMode }, [usageRows]] = await Promise.all([
        getUserDevMode(userId),
        pool.query(
            `SELECT scan_mode, launches_count
             FROM deep_scan_daily_usage
             WHERE user_id = ? AND usage_date = ?`,
            [userId, window.dayKey]
        )
    ]);

    if (!exists) {
        return {
            error: 'User not found',
            code: 'USER_NOT_FOUND'
        };
    }

    const usageMap = new Map(
        usageRows.map((row) => [String(row.scan_mode || '').toUpperCase(), Number(row.launches_count || 0)])
    );
    const modes = Object.fromEntries(
        Object.entries(SCAN_MODE_LIMITS).map(([mode, limit]) => {
            const used = usageMap.get(mode) || 0;
            return [mode, {
                limit,
                used,
                remaining: Math.max(0, limit - used),
                enforced: !devMode
            }];
        })
    );

    return {
        user_id: userId,
        dev_mode: devMode,
        timezone: 'UTC',
        day_key: window.dayKey,
        day_start_at: window.startAt,
        day_end_at: window.endAt,
        modes
    };
}

function chooseNextAction(normalized) {
    const mode = normalizeScanMode(normalized.scanMode);
    const wantsFullServerAnalysis = mode === 'FULL' || mode === 'SELECTIVE';

    if (mode === 'APK') {
        if (normalized.uploadedApkPath) {
            return {
                nextAction: 'poll',
                reason: null
            };
        }
        return {
            nextAction: 'upload_apk',
            reason: 'Режим APK требует загрузку APK для статической проверки.'
        };
    }

    if (!normalized.sha256) {
        return {
            nextAction: 'upload_apk',
            reason: 'Нет SHA-256. Для полной проверки нужен сам APK.'
        };
    }
    if (wantsFullServerAnalysis) {
        return {
            nextAction: 'poll',
            reason: 'Сначала выполняем hash+metadata этап; APK подтягивается сервером опционально при наличии источника.'
        };
    }
    return {
        nextAction: 'poll',
        reason: null
    };
}

function dedupeFindings(findings) {
    const seen = new Set();
    return findings.filter((finding) => {
        const key = [finding.source, finding.type, finding.title, finding.detail].join('::');
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

function buildSourceSummaries(findings, vt) {
    const sourceMap = new Map();
    findings.forEach((finding) => {
        const source = finding.source || 'Shield Rules';
        const bucket = sourceMap.get(source) || [];
        bucket.push(finding);
        sourceMap.set(source, bucket);
    });

    const summaries = Array.from(sourceMap.entries()).map(([source, items]) => ({
        source,
        severity: items.reduce((current, item) => {
            return severityRank(item.severity) > severityRank(current) ? item.severity : current;
        }, 'low'),
        finding_count: items.length,
        summary: items.slice(0, 3).map((item) => item.title).join('; ')
    }));

    if (vt?.status === 'found') {
        summaries.push({
            source: 'VirusTotal',
            severity: vt.malicious > 0 ? 'high' : vt.suspicious > 0 ? 'medium' : 'low',
            finding_count: (vt.malicious || 0) + (vt.suspicious || 0),
            summary: vt.malicious > 0
                ? `${vt.malicious} malicious, ${vt.suspicious || 0} suspicious verdicts`
                : vt.suspicious > 0
                    ? `${vt.suspicious} suspicious verdicts`
                    : 'Hash checked, no detections'
        });
    }

    return summaries;
}

function mergeVerdicts(baseVerdict, combinedScore, vt, findings) {
    const hasCritical = findings.some((finding) => severityRank(finding.severity) >= 4);
    const strongExternalSignals = findings.filter((finding) => ['VirusTotal', 'APKiD', 'YARA'].includes(finding.source)).length;

    let verdict = classifyVerdict(combinedScore, vt);
    if (verdictRank(baseVerdict) > verdictRank(verdict)) {
        verdict = baseVerdict;
    }
    if (hasCritical || strongExternalSignals >= 2 || (vt?.malicious || 0) >= 5) {
        return 'malicious';
    }
    if (strongExternalSignals >= 1 && combinedScore >= 45 && verdictRank(verdict) < verdictRank('suspicious')) {
        return 'suspicious';
    }
    return verdict;
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

function buildApkFetchUrl(sha256) {
    if (!sha256 || !APK_FETCH_URL_TEMPLATE || !APK_FETCH_URL_TEMPLATE.includes('{sha256}')) {
        return null;
    }
    return APK_FETCH_URL_TEMPLATE.replace(/\{sha256\}/g, encodeURIComponent(sha256));
}

async function readResponseBufferWithLimit(response, maxBytes) {
    const contentLength = Number(response.headers.get('content-length') || 0);
    if (Number.isFinite(contentLength) && contentLength > 0 && contentLength > maxBytes) {
        throw new Error(`APK fetch exceeded max size (${contentLength} > ${maxBytes})`);
    }

    if (response.body && typeof response.body.getReader === 'function') {
        const reader = response.body.getReader();
        const chunks = [];
        let total = 0;
        while (true) {
            const { done, value } = await reader.read();
            if (done) {
                break;
            }
            const chunk = Buffer.from(value);
            total += chunk.length;
            if (total > maxBytes) {
                throw new Error(`APK fetch exceeded max size (${total} > ${maxBytes})`);
            }
            chunks.push(chunk);
        }
        return Buffer.concat(chunks, total);
    }

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
        throw new Error(`APK fetch exceeded max size (${buffer.length} > ${maxBytes})`);
    }
    return buffer;
}

async function tryFetchApkForJob(jobId, request, normalized) {
    if (normalized.uploadedApkPath) {
        return { request, normalized };
    }

    const sha256 = String(normalized.sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(sha256)) {
        return { request, normalized };
    }

    const fetchUrl = buildApkFetchUrl(sha256);
    if (!fetchUrl) {
        return { request, normalized };
    }

    try {
        const response = await fetch(fetchUrl, {
            method: 'GET',
            signal: AbortSignal.timeout(APK_FETCH_TIMEOUT_MS)
        });
        if (!response.ok) {
            throw new Error(`status ${response.status}`);
        }

        const maxBytes = Number.isFinite(APK_FETCH_MAX_BYTES) && APK_FETCH_MAX_BYTES > 0
            ? APK_FETCH_MAX_BYTES
            : MAX_UPLOAD_BYTES;
        const buffer = await readResponseBufferWithLimit(response, maxBytes);
        if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
            throw new Error('empty payload');
        }

        const fetchedSha256 = computeSha256(buffer);
        if (fetchedSha256 !== sha256) {
            throw new Error(`hash mismatch (${fetchedSha256} != ${sha256})`);
        }

        const dir = path.join(UPLOAD_ROOT, jobId);
        await fs.mkdir(dir, { recursive: true });
        const fileName = `fetched-${sha256.slice(0, 12)}.apk`;
        const filePath = path.join(dir, fileName);
        await fs.writeFile(filePath, buffer);

        const updatedRequest = {
            ...request,
            uploaded_apk_path: filePath,
            uploaded_apk_name: fileName,
            uploaded_apk_sha256: fetchedSha256,
            uploaded_apk_size_bytes: buffer.length,
            sha256,
            next_action: 'poll',
            upload_reason: null
        };
        const now = nowMs();
        await pool.query(
            `UPDATE deep_scan_jobs
             SET sha256 = ?, request_json = ?, updated_at = ?
             WHERE id = ?`,
            [sha256, JSON.stringify(updatedRequest), now, jobId]
        );

        return {
            request: updatedRequest,
            normalized: normalizeDeepScanPayload(updatedRequest)
        };
    } catch (error) {
        console.error(`Deep scan APK fetch skipped for ${jobId}:`, String(error?.message || error));
        return { request, normalized };
    }
}

async function createDeepScanJob(userId, payload) {
    const normalized = normalizeDeepScanPayload(payload);
    normalized.scanMode = normalizeScanMode(normalized.scanMode);
    const validationError = validateDeepScanPayload(normalized);
    if (validationError && normalized.scanMode !== 'APK') {
        return { error: validationError };
    }

    const id = crypto.randomUUID();
    const now = nowMs();
    const window = getUtcDayWindow(now);
    const modeLimit = SCAN_MODE_LIMITS[normalized.scanMode];
    const decision = chooseNextAction(normalized);
    const requestJson = JSON.stringify({
        ...normalized,
        next_action: decision.nextAction,
        upload_reason: decision.reason
    });
    const status = decision.nextAction === 'upload_apk' ? 'AWAITING_UPLOAD' : 'QUEUED';
    const connection = await pool.getConnection();

    try {
        await connection.beginTransaction();
        const userMode = await getUserDevMode(userId, connection);
        if (!userMode.exists) {
            await connection.rollback();
            return { error: 'User not found', code: 'USER_NOT_FOUND', status_code: 404 };
        }

        if (userMode.devMode) {
            await incrementDailyUsage(connection, userId, normalized.scanMode, window.dayKey, now);
        } else {
            const consumed = await consumeDailyUsageWithLimit(
                connection,
                userId,
                normalized.scanMode,
                window.dayKey,
                modeLimit,
                now
            );
            if (!consumed) {
                await connection.rollback();
                const limits = await getUserDeepScanLimits(userId);
                return {
                    error: `Daily limit reached for ${normalized.scanMode} scans`,
                    code: 'DAILY_LIMIT_REACHED',
                    status_code: 429,
                    limits
                };
            }
        }

        await connection.query(
            `INSERT INTO deep_scan_jobs
             (id, user_id, package_name, app_name, sha256, scan_mode, status, request_json, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
                id,
                userId,
                normalized.packageName,
                normalized.appName,
                normalized.sha256,
                normalized.scanMode,
                status,
                requestJson,
                now,
                now
            ]
        );
        await connection.commit();
    } catch (error) {
        try {
            await connection.rollback();
        } catch (_) {}
        throw error;
    } finally {
        connection.release();
    }

    if (status === 'QUEUED') {
        enqueueDeepScan(id);
    }

    return {
        id,
        status,
        created_at: now,
        scan_mode: normalized.scanMode,
        package_name: normalized.packageName,
        app_name: normalized.appName,
        sha256: normalized.sha256,
        next_action: decision.nextAction,
        upload_reason: decision.reason
    };
}

async function getDeepScanJob(id, userId) {
    const [rows] = await pool.query(
        `SELECT id, user_id, package_name, app_name, sha256, scan_mode, status, verdict, risk_score,
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
    const request = parseJson(row.request_json, {});
    return {
        id: row.id,
        status: row.status,
        scan_mode: normalizeScanMode(row.scan_mode || request.scan_mode || request.scanMode),
        package_name: row.package_name,
        app_name: row.app_name,
        sha256: row.sha256,
        verdict: row.verdict,
        risk_score: row.risk_score,
        next_action: request.next_action || (row.status === 'AWAITING_UPLOAD' ? 'upload_apk' : 'poll'),
        upload_reason: request.upload_reason || null,
        vt: {
            status: row.vt_status,
            malicious: row.vt_malicious,
            suspicious: row.vt_suspicious,
            harmless: row.vt_harmless
        },
        request,
        summary: parseJson(row.summary_json, null),
        findings: parseJson(row.findings_json, []),
        error: row.error_message,
        created_at: row.created_at,
        started_at: row.started_at,
        completed_at: row.completed_at,
        updated_at: row.updated_at
    };
}

async function getDeepScanFullReports(ids, userId) {
    const normalizedIds = Array.from(
        new Set((Array.isArray(ids) ? ids : [])
            .map((value) => String(value || '').trim())
            .filter((value) => /^[a-zA-Z0-9-]{20,64}$/.test(value)))
    ).slice(0, 80);
    if (normalizedIds.length === 0) {
        return [];
    }

    const placeholders = normalizedIds.map(() => '?').join(',');
    const [rows] = await pool.query(
        `SELECT id, user_id, package_name, app_name, sha256, scan_mode, status, verdict, risk_score,
                vt_status, vt_malicious, vt_suspicious, vt_harmless,
                request_json, summary_json, findings_json, created_at, started_at, completed_at, updated_at
         FROM deep_scan_jobs
         WHERE user_id = ? AND id IN (${placeholders})`,
        [userId, ...normalizedIds]
    );

    const rowMap = new Map(rows.map((row) => [row.id, row]));
    return normalizedIds
        .map((id) => rowMap.get(id))
        .filter(Boolean)
        .map((row) => buildDeepScanFullReportPayload(row));
}

async function attachDeepScanApk(id, userId, buffer, originalName = 'sample.apk') {
    if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
        return { error: 'APK payload is empty' };
    }
    if (buffer.length > MAX_UPLOAD_BYTES) {
        return { error: 'APK payload is too large' };
    }

    const [rows] = await pool.query(
        `SELECT request_json FROM deep_scan_jobs WHERE id = ? AND user_id = ? LIMIT 1`,
        [id, userId]
    );
    if (rows.length === 0) {
        return null;
    }

    const request = parseJson(rows[0].request_json, {});
    const dir = path.join(UPLOAD_ROOT, id);
    await fs.mkdir(dir, { recursive: true });
    const filePath = path.join(dir, 'sample.apk');
    await fs.writeFile(filePath, buffer);

    const uploadedSha256 = computeSha256(buffer);
    const updatedRequest = {
        ...request,
        uploaded_apk_path: filePath,
        uploaded_apk_name: String(originalName || 'sample.apk').slice(0, 255),
        uploaded_apk_sha256: uploadedSha256,
        uploaded_apk_size_bytes: buffer.length,
        sha256: request.sha256 || uploadedSha256,
        next_action: 'poll'
    };
    const now = nowMs();

    await pool.query(
        `UPDATE deep_scan_jobs
         SET sha256 = ?, status = 'QUEUED', request_json = ?, updated_at = ?, error_message = NULL
         WHERE id = ? AND user_id = ?`,
        [updatedRequest.sha256, JSON.stringify(updatedRequest), now, id, userId]
    );

    enqueueDeepScan(id);
    return getDeepScanJob(id, userId);
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
    if (row.status === 'COMPLETED' || row.status === 'FAILED' || row.status === 'AWAITING_UPLOAD') {
        return;
    }

    const startedAt = nowMs();
    await pool.query(
        `UPDATE deep_scan_jobs
         SET status = 'RUNNING', started_at = COALESCE(started_at, ?), updated_at = ?, error_message = NULL
         WHERE id = ?`,
        [startedAt, startedAt, jobId]
    );

    let request = parseJson(row.request_json, {});
    let normalized = normalizeDeepScanPayload(request);

    try {
        const fetchResult = await tryFetchApkForJob(jobId, request, normalized);
        request = fetchResult.request;
        normalized = fetchResult.normalized;

        let vt = { status: normalized.sha256 ? 'pending' : 'skipped' };
        try {
            vt = await lookupVirusTotalByHash(normalized.sha256 || normalized.uploadedApkSha256);
        } catch (error) {
            vt = { status: 'error', error: error.message };
        }

        const heuristics = analyzeHeuristics(normalized, vt);
        const apkAnalysis = normalized.uploadedApkPath
            ? await runAnalyzer(normalized.uploadedApkPath)
            : { ok: false, findings: [], metadata: {}, risk_bonus: 0, sources: [] };

        const mergedFindings = dedupeFindings([
            ...heuristics.findings,
            ...(Array.isArray(apkAnalysis.findings) ? apkAnalysis.findings : [])
        ]);
        const baseCombinedScore = Math.max(
            heuristics.riskScore,
            Math.min(100, heuristics.riskScore + Number(apkAnalysis.risk_bonus || 0))
        );
        const baseVerdict = mergeVerdicts(heuristics.verdict, baseCombinedScore, vt, mergedFindings);
        const baseRecommendations = Array.from(new Set([
            ...heuristics.recommendations,
            ...(apkAnalysis.ok ? ['Сверьте совпадения по источникам и удалите APK, если приложение установлено в обход магазина.'] : [])
        ])).slice(0, 6);
        const stageBreakdown = {
            heuristics: {
                verdict: heuristics.verdict,
                risk_score: heuristics.riskScore,
                findings: normalizeFindingsList(heuristics.findings),
                metadata: heuristics.metadata || {}
            },
            static_analysis: {
                ok: Boolean(apkAnalysis.ok),
                risk_bonus: Number(apkAnalysis.risk_bonus || 0),
                findings: normalizeFindingsList(apkAnalysis.findings || []),
                metadata: apkAnalysis.metadata || {},
                sources: Array.isArray(apkAnalysis.sources) ? apkAnalysis.sources : [],
                error: apkAnalysis.error || null
            },
            merged_before_triage: {
                verdict: baseVerdict,
                risk_score: baseCombinedScore,
                findings: normalizeFindingsList(mergedFindings)
            }
        };
        let triaged = applyDeterministicTriage({
            verdict: baseVerdict,
            riskScore: baseCombinedScore,
            findings: mergedFindings,
            recommendations: baseRecommendations,
            vt
        });
        stageBreakdown.deterministic_triage = {
            applied: Boolean(triaged?.triage?.applied),
            source: triaged?.triage?.source || 'deterministic',
            reason: triaged?.triage?.reason || null,
            benign_probability: Number(triaged?.triage?.benign_probability || 0),
            before: {
                verdict: baseVerdict,
                risk_score: baseCombinedScore,
                findings_count: mergedFindings.length
            },
            after: {
                verdict: triaged.verdict,
                risk_score: triaged.riskScore,
                findings_count: Array.isArray(triaged.findings) ? triaged.findings.length : 0
            }
        };

        const hasDangerSignals = Array.isArray(triaged.findings) && triaged.findings.length > 0;
        stageBreakdown.ai_triage = {
            configured: isAiConfigured(),
            attempted: false,
            applied: false,
            model: null,
            reason: null,
            report_to_user: true,
            benign_probability: 0,
            user_summary: null,
            error: null
        };
        if (isAiConfigured() && hasDangerSignals) {
            try {
                stageBreakdown.ai_triage.attempted = true;
                const aiTriage = await triageDeepScanFindings({
                    normalized,
                    vt,
                    verdict: triaged.verdict,
                    riskScore: triaged.riskScore,
                    findings: triaged.findings
                });
                triaged = applyAiTriageDecision(triaged, aiTriage);
                stageBreakdown.ai_triage = {
                    configured: true,
                    attempted: true,
                    applied: Boolean(triaged?.triage?.ai?.applied),
                    model: aiTriage.model || null,
                    reason: aiTriage.reason || triaged?.triage?.reason || null,
                    report_to_user: aiTriage.reportToUser ?? triaged?.triage?.ai?.report_to_user ?? true,
                    benign_probability: Number(aiTriage.benignProbability || 0),
                    user_summary: aiTriage.userSummary || null,
                    suggested_verdict: aiTriage.suggestedVerdict || null,
                    suppress_types: Array.isArray(aiTriage.suppressTypes) ? aiTriage.suppressTypes : [],
                    result_verdict: triaged.verdict,
                    result_risk_score: triaged.riskScore
                };
            } catch (error) {
                triaged = {
                    ...triaged,
                    triage: {
                        ...triaged.triage,
                        ai: {
                            applied: false,
                            model: null,
                            reason: 'ai_unavailable_fallback',
                            benign_probability: 0,
                            report_to_user: true,
                            user_summary: null
                        }
                    }
                };
                stageBreakdown.ai_triage = {
                    configured: true,
                    attempted: true,
                    applied: false,
                    model: null,
                    reason: 'ai_unavailable_fallback',
                    report_to_user: true,
                    benign_probability: 0,
                    user_summary: null,
                    error: String(error?.message || error || 'AI triage error').slice(0, 255)
                };
                console.error('Deep scan AI triage fallback:', error?.message || error);
            }
        }
        const userFacing = applyUserFacingThreatGate({
            verdict: triaged.verdict,
            riskScore: triaged.riskScore,
            findings: triaged.findings,
            recommendations: triaged.recommendations,
            vt
        });
        triaged = {
            ...triaged,
            verdict: userFacing.verdict,
            riskScore: userFacing.riskScore,
            findings: userFacing.findings,
            recommendations: userFacing.recommendations,
            user_facing_gate: userFacing.gate
        };
        stageBreakdown.user_facing_gate = userFacing.gate;
        stageBreakdown.final = {
            verdict: triaged.verdict,
            risk_score: triaged.riskScore,
            gate_reason: userFacing?.gate?.reason || null,
            allow_threats_to_user: Boolean(userFacing?.gate?.allow_threats_to_user),
            findings_count: Array.isArray(triaged.findings) ? triaged.findings.length : 0,
            findings: normalizeFindingsList(triaged.findings || [])
        };

        const sourceSummaries = buildSourceSummaries(triaged.findings, vt);
        const completedAt = nowMs();
        const summary = {
            scanned_at: completedAt,
            verdict: triaged.verdict,
            risk_score: triaged.riskScore,
            recommendations: triaged.recommendations,
            metadata: {
                ...heuristics.metadata,
                static_analysis: apkAnalysis.metadata || {},
                next_action: 'poll',
                triage: triaged.triage,
                user_facing_gate: userFacing.gate,
                stages: stageBreakdown
            },
            sources: sourceSummaries,
            virus_total: vt,
            analyzer: {
                ok: Boolean(apkAnalysis.ok),
                error: apkAnalysis.error || null
            },
            triage: triaged.triage
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
                triaged.verdict,
                triaged.riskScore,
                vt.status || null,
                vt.malicious ?? null,
                vt.suspicious ?? null,
                vt.harmless ?? null,
                JSON.stringify(summary),
                JSON.stringify(triaged.findings),
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
    getDeepScanFullReports,
    attachDeepScanApk,
    getUserDeepScanLimits,
    resumePendingDeepScans
};
