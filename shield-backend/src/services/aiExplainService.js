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
            explanation: totalScanned > 0
                ? `Проверка завершена. Просмотрено ${totalScanned} приложений, явных угроз не найдено.`
                : 'Проверка завершена, явных угроз не найдено.',
            advice: ['Повторите глубокую проверку позже, если поведение устройства кажется подозрительным.']
        };
    }

    const engine = topFinding.detectionEngine ? ` Источник сигнала: ${topFinding.detectionEngine}.` : '';
    const summaryText = topFinding.summary ? ` ${topFinding.summary}` : '';

    return {
        model: 'local-fallback',
        explanation: [
            `${topFinding.appName} помечено как приложение с ${severityLabel(topFinding.severity)} уровнем риска.`,
            `Причина: ${topFinding.threatName}.`,
            totalThreats > 1 ? `В этом отчёте есть ещё ${totalThreats - 1} сигнал(ов).` : `Это основной сигнал в текущей ${modeLabel}.`,
            engine,
            summaryText
        ].join(' ').replace(/\s+/g, ' ').trim(),
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
                        'Пиши только по-русски, без воды, без фантазий и без выдуманных фактов.',
                        'Используй только факты из входных данных. Если данных недостаточно, явно скажи об этом.',
                        'Сформируй содержательное объяснение даже для быстрой проверки.',
                        'Структура explanation (обязательно 4 абзаца):',
                        '1) Что найдено.',
                        '2) Почему это риск именно на этом устройстве.',
                        '3) Что сделать сейчас (конкретные шаги).',
                        '4) Что проверить дополнительно (разрешения, источник установки, поведение).',
                        'Если угроз нет — так и скажи, но всё равно дай 2-3 практичных шага профилактики.',
                        'Возвращай строго JSON вида {"explanation":"...","advice":["...","..."]}.',
                        'advice: 2-5 коротких и прикладных пунктов.'
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

module.exports = {
    isAiConfigured,
    explainScan
};
