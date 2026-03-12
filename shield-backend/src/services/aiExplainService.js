const AIH_BASE_URL = (process.env.AIH_BASE_URL || 'https://sosiskibot.ru/api/v1').replace(/\/$/, '');
const AIH_TIMEOUT_MS = parseInt(process.env.AIH_TIMEOUT_MS || '15000', 10);
let cachedModel = null;
let cachedModelAt = 0;

function isAiConfigured() {
    return Boolean(String(process.env.AIH_API_KEY || '').trim());
}

async function apiRequest(path, body = null) {
    const response = await fetch(`${AIH_BASE_URL}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
            'authorization': `Bearer ${process.env.AIH_API_KEY}`,
            'content-type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(AIH_TIMEOUT_MS)
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        throw new Error(`AI upstream failed: ${response.status} ${text.slice(0, 200)}`);
    }

    return response.json();
}

function sanitizeInput(value) {
    if (value === null || value === undefined) return null;
    if (typeof value === 'string') return value.trim().slice(0, 20000);
    try {
        return JSON.stringify(value, null, 2).slice(0, 20000);
    } catch (_) {
        return String(value).slice(0, 20000);
    }
}

function extractJsonBlock(text) {
    const trimmed = String(text || '').trim();
    const firstBrace = trimmed.indexOf('{');
    const lastBrace = trimmed.lastIndexOf('}');
    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
        return null;
    }
    return trimmed.slice(firstBrace, lastBrace + 1);
}

function coerceAiResponse(content) {
    const jsonBlock = extractJsonBlock(content);
    if (jsonBlock) {
        try {
            const parsed = JSON.parse(jsonBlock);
            return {
                explanation: String(parsed.explanation || '').trim(),
                advice: Array.isArray(parsed.advice)
                    ? parsed.advice.map((item) => String(item).trim()).filter(Boolean).slice(0, 5)
                    : []
            };
        } catch (_) {
            // fall through to plain text fallback
        }
    }

    const text = String(content || '').trim();
    return {
        explanation: text.slice(0, 800),
        advice: []
    };
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function normalizeVerdict(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['clean', 'low_risk', 'suspicious', 'malicious'].includes(normalized)) {
        return normalized;
    }
    return null;
}

function coerceDeepScanTriage(content) {
    const jsonBlock = extractJsonBlock(content);
    if (!jsonBlock) {
        throw new Error('AI triage returned no JSON block');
    }

    const parsed = JSON.parse(jsonBlock);
    const suggestedVerdict = normalizeVerdict(parsed?.suggested_verdict || parsed?.verdict || parsed?.decision);
    const probability = Number(parsed?.benign_probability ?? parsed?.probability ?? 0);
    const suppressTypes = Array.isArray(parsed?.suppress_types)
        ? parsed.suppress_types.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 16)
        : [];
    const reason = String(parsed?.reason || parsed?.rationale || '').trim().slice(0, 400);

    return {
        suggestedVerdict,
        benignProbability: Number.isFinite(probability) ? clamp(probability, 0, 1) : 0,
        suppressTypes,
        reason
    };
}

function severityLabel(severity) {
    switch (String(severity || '').toUpperCase()) {
        case 'CRITICAL':
            return 'критический';
        case 'HIGH':
            return 'высокий';
        case 'MEDIUM':
            return 'средний';
        default:
            return 'низкий';
    }
}

function buildFallbackExplanation({ summary, result }) {
    const findings = Array.isArray(result?.findings) ? result.findings : [];
    const topFinding = findings[0];
    const totalThreats = Number(result?.threatsFound || summary?.totalThreats || findings.length || 0);
    const totalScanned = Number(result?.totalScanned || 0);
    const scanMode = String(result?.scanType || summary?.mode || '').toLowerCase();
    const modeLabel = scanMode === 'full' ? 'глубокой проверке' : scanMode === 'quick' ? 'быстрой проверке' : 'проверке';

    if (!topFinding) {
        return {
            model: 'local-fallback',
            explanation: [
                '## Итог',
                totalScanned > 0
                    ? `Проверка завершена. Просмотрено **${totalScanned}** приложений, явных угроз не найдено.`
                    : 'Проверка завершена, явных угроз не найдено.',
                '',
                '## Что сделать сейчас',
                '- Обновите приложения и систему до последних версий.',
                '- Проверьте, что установки из неизвестных источников отключены.',
                '',
                '## Дополнительно',
                '- Повторите глубокую проверку при необычном поведении устройства.'
            ].join('\n'),
            advice: ['Повторите глубокую проверку позже, если поведение устройства кажется подозрительным.']
        };
    }

    const engine = topFinding.detectionEngine ? ` Источник сигнала: ${topFinding.detectionEngine}.` : '';
    const summaryText = topFinding.summary ? ` ${topFinding.summary}` : '';

    return {
        model: 'local-fallback',
        explanation: [
            '## Что найдено',
            `Приложение **${topFinding.appName}** помечено как риск **${severityLabel(topFinding.severity)}**.`,
            `Причина: **${topFinding.threatName}**.`,
            '',
            '## Почему это важно',
            totalThreats > 1
                ? `В отчёте есть ещё **${totalThreats - 1}** сигнал(ов), это не единичный индикатор.`
                : `Это основной сигнал в текущей ${modeLabel}.`,
            `${engine}${summaryText}`.trim(),
            '',
            '## Что сделать сейчас',
            '- Если приложение установлено не из официального магазина, удалите его.',
            '- Ограничьте чувствительные разрешения (SMS, Accessibility, Overlay).',
            '- Запустите повторную глубокую проверку после обновлений.',
            '',
            '## Что проверить дополнительно',
            '- Источник установки и сертификат подписи.',
            '- Поведение в фоне и автозапуск.'
        ].join('\n'),
        advice: [
            'Если приложение установлено не из официального магазина, лучше удалить его.',
            'Проверьте выданные разрешения и отключите лишние.',
            'Повторите глубокую проверку после обновления базы.'
        ]
    };
}

async function resolveModel() {
    if (process.env.AIH_MODEL) {
        return process.env.AIH_MODEL.trim();
    }

    const now = Date.now();
    if (cachedModel && now - cachedModelAt < 10 * 60 * 1000) {
        return cachedModel;
    }

    const payload = await apiRequest('/models');
    const candidate = Array.isArray(payload?.data)
        ? payload.data.find((item) => item && typeof item.id === 'string')
        : null;

    if (!candidate?.id) {
        throw new Error('AI upstream returned no usable model');
    }

    cachedModel = candidate.id;
    cachedModelAt = now;
    return cachedModel;
}

async function explainScan({ summary, result }) {
    if (!isAiConfigured()) {
        const error = new Error('AI service is not configured');
        error.statusCode = 503;
        throw error;
    }

    try {
        const model = await resolveModel();
        const summaryText = sanitizeInput(summary);
        const resultText = sanitizeInput(result);

        const completion = await apiRequest('/chat/completions', {
            model,
            temperature: 0.15,
            max_tokens: 900,
            messages: [
                {
                    role: 'system',
                    content: [
                        'Ты аналитик мобильной безопасности для Android-антивируса.',
                        'Пиши только по-русски, максимально прикладно и коротко.',
                        'Никакой воды, общих фраз и предположений без данных.',
                        'Используй только факты из входных данных; ничего не выдумывай.',
                        'Если данных мало: напиши это явно и кратко в формате "Недостаточно данных: ...".',
                        'Поле explanation верни в Markdown строго с секциями:',
                        '## Итог',
                        '## Подтверждено данными',
                        '## Что делать сейчас',
                        '## Что ещё проверить',
                        'Ограничения по объёму: каждая секция 1-3 короткие строки или 2-4 буллета.',
                        'В "Итог" дай 1-2 простых предложения без терминов.',
                        'Для CRITICAL/HIGH: тон прямой и жёсткий, 3-5 конкретных шагов в приоритетном порядке (сначала срочные).',
                        'Для LOW/CLEAN/угроз не найдено: спокойный тон, не пугай, дай 1-3 шага профилактики.',
                        'Если проверка быстрая и неполная — явно укажи ограничение покрытия.',
                        'Секция "Что ещё проверить" должна быть пустой или очень короткой, если добавить нечего.',
                        'Возвращай строго JSON вида {"explanation":"...markdown...","advice":["...","..."]}.',
                        'advice: 2-5 пунктов, только действия, без повторов и абстракций.'
                    ].join(' ')
                },
                {
                    role: 'user',
                    content: `Сводка сканирования:\n${summaryText || 'Нет сводки.'}\n\nДетальные результаты:\n${resultText || 'Нет подробных данных.'}`
                }
            ]
        });

        const content = completion?.choices?.[0]?.message?.content;
        if (!content) {
            throw new Error('AI upstream returned empty completion');
        }

        const parsed = coerceAiResponse(content);
        return {
            model,
            explanation: parsed.explanation,
            advice: parsed.advice
        };
    } catch (error) {
        console.error('AI explain fallback:', error);
        return buildFallbackExplanation({ summary, result });
    }
}

async function triageDeepScanFindings({
    normalized,
    vt,
    verdict,
    riskScore,
    findings
}) {
    if (!isAiConfigured()) {
        const error = new Error('AI service is not configured');
        error.statusCode = 503;
        throw error;
    }

    const model = await resolveModel();
    const compactFindings = (Array.isArray(findings) ? findings : [])
        .slice(0, 14)
        .map((finding) => ({
            type: finding.type,
            severity: finding.severity,
            source: finding.source,
            title: finding.title,
            permission: finding?.evidence?.permission || null
        }));

    const payloadForModel = {
        package_name: normalized?.packageName || null,
        installer_package: normalized?.installerPackage || null,
        permission_count: Array.isArray(normalized?.permissions) ? normalized.permissions.length : 0,
        permissions: Array.isArray(normalized?.permissions) ? normalized.permissions.slice(0, 40) : [],
        risk_score: Number(riskScore || 0),
        current_verdict: String(verdict || 'clean'),
        virus_total: {
            status: vt?.status || null,
            malicious: Number(vt?.malicious || 0),
            suspicious: Number(vt?.suspicious || 0),
            harmless: Number(vt?.harmless || 0)
        },
        findings: compactFindings
    };

    const completion = await apiRequest('/chat/completions', {
        model,
        temperature: 0.05,
        max_tokens: 320,
        messages: [
            {
                role: 'system',
                content: [
                    'Ты серверный модуль AI-триажа Android deep scan.',
                    'Твоя задача: снижать ложные срабатывания, но не пропускать опасные сочетания.',
                    'Если есть сильные признаки (VirusTotal malicious>0, accessibility+overlay+sms, внешние malware-маркеры), не давай benign.',
                    'Unknown installer сам по себе не является угрозой.',
                    'Верни только JSON без пояснений.',
                    'Формат JSON:',
                    '{"suggested_verdict":"clean|low_risk|suspicious|malicious","benign_probability":0..1,"suppress_types":["install_source"],"reason":"<=200 chars"}',
                    'suppress_types содержит только типы findings, которые можно скрыть для снижения ложных срабатываний.'
                ].join(' ')
            },
            {
                role: 'user',
                content: sanitizeInput(payloadForModel) || '{}'
            }
        ]
    });

    const content = completion?.choices?.[0]?.message?.content;
    if (!content) {
        throw new Error('AI triage completion is empty');
    }

    const parsed = coerceDeepScanTriage(content);
    return {
        model,
        ...parsed
    };
}

module.exports = {
    isAiConfigured,
    explainScan,
    triageDeepScanFindings
};
