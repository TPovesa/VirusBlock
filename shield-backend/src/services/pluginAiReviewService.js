const DEFAULT_BASE_URL = 'https://sosiskibot.ru/api/v1';
const DEFAULT_MODEL = 'gpt-4.1-mini';
const DEFAULT_TIMEOUT_MS = 35000;
const DEFAULT_BODY_LIMIT_BYTES = 256 * 1024;
const DEFAULT_INPUT_LIMIT_BYTES = 160 * 1024;
const DEFAULT_RATE_LIMIT_WINDOW_MS = 15 * 60 * 1000;
const DEFAULT_RATE_LIMIT_MAX = 30;
const MAX_FINDINGS = 32;
const MAX_BULLETS = 5;
const MAX_META_KEYS = 20;
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504]);
const ALLOWED_VERDICTS = new Set(['clean', 'review', 'block']);
const ALLOWED_MODES = new Set(['summary', 'full']);

function parsePositiveInt(value, fallback) {
    const parsed = Number.parseInt(String(value || ''), 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function createServiceError(message, code, statusCode = 500, details = null) {
    const error = new Error(message);
    error.code = code;
    error.statusCode = statusCode;
    if (details) {
        error.details = details;
    }
    return error;
}

function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function cleanText(value, maxLength) {
    if (value === null || value === undefined) {
        return null;
    }

    const text = String(value)
        .replace(/\u0000/g, '')
        .replace(/\r\n/g, '\n')
        .trim();

    if (!text) {
        return null;
    }

    return text.slice(0, maxLength);
}

function cleanScalar(value, maxLength = 240) {
    if (typeof value === 'number') {
        return Number.isFinite(value) ? value : null;
    }

    if (typeof value === 'boolean') {
        return value;
    }

    return cleanText(value, maxLength);
}

function uniqueStrings(values, limit, maxLength = 120) {
    if (!Array.isArray(values)) {
        return [];
    }

    return Array.from(
        new Set(
            values
                .map((item) => cleanText(item, maxLength))
                .filter(Boolean)
        )
    ).slice(0, limit);
}

function normalizeSeverity(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['critical', 'high', 'medium', 'low', 'info'].includes(normalized)) {
        return normalized;
    }
    if (['warning', 'warn'].includes(normalized)) {
        return 'medium';
    }
    return null;
}

function sanitizeFindings(value) {
    if (!Array.isArray(value)) {
        return [];
    }

    return value.slice(0, MAX_FINDINGS).map((item) => {
        const source = isPlainObject(item) ? item : {};
        const lineRaw = source.line ?? source.line_number ?? source.lineNumber ?? null;
        const line = Number.isFinite(Number(lineRaw)) && Number(lineRaw) > 0
            ? Math.floor(Number(lineRaw))
            : null;
        const confidenceRaw = source.confidence ?? source.score ?? null;
        const confidence = Number.isFinite(Number(confidenceRaw))
            ? Math.max(0, Math.min(1, Number(confidenceRaw)))
            : null;

        const finding = {
            severity: normalizeSeverity(source.severity),
            title: cleanText(source.title || source.name, 160),
            summary: cleanText(source.summary || source.message, 320),
            detail: cleanText(source.detail || source.description, 720),
            file: cleanText(source.file || source.path, 220),
            line,
            rule: cleanText(source.rule || source.rule_id || source.ruleId, 120),
            confidence,
            tags: uniqueStrings(source.tags, 5, 40)
        };

        if (!finding.tags.length) {
            delete finding.tags;
        }

        return Object.fromEntries(Object.entries(finding).filter(([, fieldValue]) => fieldValue !== null && fieldValue !== undefined));
    }).filter((item) => Object.keys(item).length > 0);
}

function sanitizeMetaObject(value, maxKeys = MAX_META_KEYS) {
    if (!isPlainObject(value)) {
        return null;
    }

    const entries = [];
    for (const [key, rawValue] of Object.entries(value)) {
        if (entries.length >= maxKeys) {
            break;
        }

        const normalizedKey = cleanText(key, 64);
        if (!normalizedKey) {
            continue;
        }

        if (Array.isArray(rawValue)) {
            const list = uniqueStrings(rawValue, 6, 120);
            if (list.length > 0) {
                entries.push([normalizedKey, list]);
            }
            continue;
        }

        if (isPlainObject(rawValue)) {
            const nestedEntries = Object.entries(rawValue).slice(0, 8);
            const nested = {};
            for (const [nestedKey, nestedValue] of nestedEntries) {
                const safeKey = cleanText(nestedKey, 48);
                const safeValue = cleanScalar(nestedValue, 120);
                if (safeKey && safeValue !== null && safeValue !== undefined) {
                    nested[safeKey] = safeValue;
                }
            }
            if (Object.keys(nested).length > 0) {
                entries.push([normalizedKey, nested]);
            }
            continue;
        }

        const scalar = cleanScalar(rawValue, 160);
        if (scalar !== null && scalar !== undefined) {
            entries.push([normalizedKey, scalar]);
        }
    }

    return entries.length > 0 ? Object.fromEntries(entries) : null;
}

function getSummaryInput(body) {
    return body.summary ?? body.analysis_summary ?? body.analysisSummary ?? null;
}

function getAnalysisInput(body) {
    return body.analysis ?? body.local_analysis ?? body.localAnalysis ?? null;
}

function getFindingsInput(body) {
    return body.findings ?? body.issues ?? body.matches ?? null;
}

function getFileMetaInput(body) {
    return body.file_meta ?? body.fileMeta ?? body.file ?? null;
}

function getMetaInput(body) {
    return body.meta ?? body.metadata ?? body.scan_meta ?? body.scanMeta ?? null;
}

function normalizeMode(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return ALLOWED_MODES.has(normalized) ? normalized : 'summary';
}

function normalizeRequestPayload(body) {
    if (!isPlainObject(body)) {
        throw createServiceError(
            'Plugin review payload must be a JSON object',
            'PLUGIN_AI_REVIEW_BAD_INPUT',
            400
        );
    }

    const normalized = {
        summary: cleanText(getSummaryInput(body), 6000),
        analysis: cleanText(getAnalysisInput(body), 12000),
        findings: sanitizeFindings(getFindingsInput(body)),
        file: sanitizeMetaObject(getFileMetaInput(body), 16),
        meta: sanitizeMetaObject(getMetaInput(body), 16)
    };

    if (!normalized.summary && !normalized.analysis && normalized.findings.length === 0) {
        throw createServiceError(
            'Plugin review input requires summary, analysis, or findings',
            'PLUGIN_AI_REVIEW_INPUT_REQUIRED',
            400
        );
    }

    const normalizedJson = JSON.stringify(normalized);
    if (Buffer.byteLength(normalizedJson, 'utf8') > PLUGIN_AI_REVIEW_INPUT_LIMIT_BYTES) {
        throw createServiceError(
            'Plugin review input is too large',
            'PLUGIN_AI_REVIEW_PAYLOAD_TOO_LARGE',
            413
        );
    }

    return normalized;
}

function buildPromptPayload(input) {
    return {
        summary: input.summary,
        analysis: input.analysis,
        findings: input.findings,
        file: input.file,
        meta: input.meta
    };
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

function normalizeVerdict(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (ALLOWED_VERDICTS.has(normalized)) {
        return normalized;
    }
    if (['safe', 'allow', 'ok', 'benign', 'clean'].includes(normalized)) {
        return 'clean';
    }
    if (['block', 'deny', 'malicious', 'dangerous', 'failed'].includes(normalized)) {
        return 'block';
    }
    return 'review';
}

function coerceResult(content, mode = 'summary') {
    const jsonBlock = extractJsonBlock(content);
    if (jsonBlock) {
        try {
            const parsed = JSON.parse(jsonBlock);
            const summary = cleanText(parsed.summary || parsed.result || parsed.message, 420);
            const bullets = uniqueStrings(parsed.bullets || parsed.highlights || parsed.reasons, MAX_BULLETS, 140);
            const fullReport = cleanText(
                parsed.full_report || parsed.fullReport || parsed.detailed_report || parsed.detailedReport,
                2200
            );
            return {
                summary: summary || 'AI не смог уверенно сформировать краткую сводку. Нужна ручная проверка.',
                verdictSuggestion: normalizeVerdict(parsed.verdict_suggestion || parsed.verdictSuggestion || parsed.verdict),
                bullets,
                fullReport: mode === 'full' ? (fullReport || summary || null) : null
            };
        } catch (error) {
            console.warn('Plugin AI review returned invalid JSON:', error?.message || error);
        }
    }

    const fallbackSummary = cleanText(content, 420);
    return {
        summary: fallbackSummary || 'AI не вернул пригодную сводку. Нужна ручная проверка.',
        verdictSuggestion: 'review',
        bullets: [],
        fullReport: mode === 'full' ? (fallbackSummary || null) : null
    };
}

function shouldRetryStatus(statusCode) {
    return RETRYABLE_STATUSES.has(Number(statusCode || 0));
}

function isRetryableNetworkError(error) {
    const code = String(error?.code || error?.cause?.code || '').trim().toUpperCase();
    return [
        'ETIMEDOUT',
        'ECONNRESET',
        'ECONNREFUSED',
        'EHOSTUNREACH',
        'ENOTFOUND',
        'EAI_AGAIN',
        'UND_ERR_CONNECT_TIMEOUT',
        'UND_ERR_HEADERS_TIMEOUT',
        'UND_ERR_BODY_TIMEOUT',
        'UND_ERR_SOCKET'
    ].includes(code);
}

function getApiKey() {
    return String(process.env.PLUGIN_AI_REVIEW_API_KEY || process.env.AIH_API_KEY || '').trim();
}

function isPluginAiReviewConfigured() {
    return Boolean(getApiKey());
}

async function apiRequest(path, body = null) {
    if (!isPluginAiReviewConfigured()) {
        throw createServiceError(
            'Plugin AI review is not configured',
            'PLUGIN_AI_REVIEW_NOT_CONFIGURED',
            503
        );
    }

    const maxAttempts = 2;
    let lastError = null;

    for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
        try {
            const response = await fetch(`${PLUGIN_AI_REVIEW_BASE_URL}${path}`, {
                method: body ? 'POST' : 'GET',
                headers: {
                    authorization: `Bearer ${getApiKey()}`,
                    'content-type': 'application/json'
                },
                body: body ? JSON.stringify(body) : undefined,
                signal: AbortSignal.timeout(PLUGIN_AI_REVIEW_TIMEOUT_MS)
            });

            if (!response.ok) {
                const upstreamText = await response.text().catch(() => '');
                const statusCode = Number(response.status || 0);
                const details = {
                    upstreamStatus: statusCode,
                    upstreamBody: upstreamText.slice(0, 240)
                };

                if (statusCode === 401 || statusCode === 403 || statusCode === 404) {
                    throw createServiceError(
                        'Plugin AI upstream rejected the request',
                        'PLUGIN_AI_REVIEW_UPSTREAM_UNAVAILABLE',
                        503,
                        details
                    );
                }

                throw createServiceError(
                    'Plugin AI upstream request failed',
                    'PLUGIN_AI_REVIEW_UPSTREAM_UNAVAILABLE',
                    502,
                    details
                );
            }

            return response.json();
        } catch (error) {
            lastError = error;

            if (
                attempt < maxAttempts
                && (
                    shouldRetryStatus(error?.details?.upstreamStatus || error?.statusCode)
                    || error?.name === 'TimeoutError'
                    || error?.name === 'AbortError'
                    || isRetryableNetworkError(error)
                )
            ) {
                await new Promise((resolve) => setTimeout(resolve, attempt * 700));
                continue;
            }

            break;
        }
    }

    if (lastError?.code) {
        throw lastError;
    }

    throw createServiceError(
        'Plugin AI upstream request failed',
        'PLUGIN_AI_REVIEW_UPSTREAM_UNAVAILABLE',
        502
    );
}

async function reviewPluginAnalysisSummary(payload) {
    const mode = normalizeMode(payload?.mode);
    const normalizedInput = normalizeRequestPayload(payload);
    const modePrompt = mode === 'full'
        ? [
            'Нужен полный человеческий отчёт.',
            'Объясни поведение файла простым русским языком без номеров строк, названий правил, сигнатур и цитат из кода.',
            'Не повторяй сырой локальный список находок подряд.',
            'Сначала коротко скажи, что делает файл, потом что настораживает или почему его можно считать безопасным, затем чем это грозит на практике.',
            'full_report должен быть цельным понятным текстом до 2200 символов.'
        ].join(' ')
        : [
            'Нужна короткая сводка.',
            'Не повторяй названия локальных правил, номера строк, сигнатуры, фрагменты кода и технический мусор.',
            'Сформулируй вывод человеческим языком: что не так и почему это важно.'
        ].join(' ');
    const completion = await apiRequest('/chat/completions', {
        model: PLUGIN_AI_REVIEW_MODEL,
        temperature: 0.1,
        max_tokens: mode === 'full' ? 1200 : 700,
        messages: [
            {
                role: 'system',
                content: [
                    'Ты серверный ревьюер безопасности для Telegram plugin/module анализа в NeuralV.',
                    'На входе только локальные результаты анализа, summary, findings и file/meta без полного исходного кода.',
                    'Отвечай только по-русски и только JSON без Markdown.',
                    'Не придумывай факты и не преувеличивай уверенность.',
                    'Пиши так, будто объясняешь человеку риск человеческим языком, а не пересказываешь машинный отчёт.',
                    'Если данных мало или они неоднозначны, verdict_suggestion должен быть "review".',
                    'Если сигналы выглядят benign/служебными и не видно опасной цепочки, можно дать "clean".',
                    'Если признаки вредоносного или явно опасного поведения сильные, верни "block".',
                    modePrompt,
                    'Формат ответа: {"summary":"<=420 chars","verdict_suggestion":"clean|review|block","bullets":["<=140 chars"],"full_report":"<=2200 chars or empty string"}.',
                    'bullets должен содержать 0-5 коротких пунктов.'
                ].join(' ')
            },
            {
                role: 'user',
                content: JSON.stringify(buildPromptPayload(normalizedInput))
            }
        ]
    });

    const content = completion?.choices?.[0]?.message?.content;
    if (!content) {
        throw createServiceError(
            'Plugin AI review returned empty completion',
            'PLUGIN_AI_REVIEW_EMPTY',
            502
        );
    }

    const result = coerceResult(content, mode);
    return {
        summary: result.summary,
        verdictSuggestion: result.verdictSuggestion,
        bullets: result.bullets,
        fullReport: result.fullReport,
        model: PLUGIN_AI_REVIEW_MODEL
    };
}

const PLUGIN_AI_REVIEW_BASE_URL = (process.env.PLUGIN_AI_REVIEW_BASE_URL || process.env.AIH_BASE_URL || DEFAULT_BASE_URL)
    .replace(/\/$/, '');
const PLUGIN_AI_REVIEW_MODEL = String(process.env.PLUGIN_AI_REVIEW_MODEL || process.env.AIH_MODEL || DEFAULT_MODEL).trim() || DEFAULT_MODEL;
const PLUGIN_AI_REVIEW_TIMEOUT_MS = parsePositiveInt(
    process.env.PLUGIN_AI_REVIEW_TIMEOUT_MS || process.env.AIH_TIMEOUT_MS,
    DEFAULT_TIMEOUT_MS
);
const PLUGIN_AI_REVIEW_BODY_LIMIT_BYTES = parsePositiveInt(
    process.env.PLUGIN_AI_REVIEW_BODY_LIMIT_BYTES,
    DEFAULT_BODY_LIMIT_BYTES
);
const PLUGIN_AI_REVIEW_INPUT_LIMIT_BYTES = parsePositiveInt(
    process.env.PLUGIN_AI_REVIEW_INPUT_LIMIT_BYTES,
    DEFAULT_INPUT_LIMIT_BYTES
);
const PLUGIN_AI_REVIEW_RATE_LIMIT_WINDOW_MS = parsePositiveInt(
    process.env.PLUGIN_AI_REVIEW_RATE_LIMIT_WINDOW_MS,
    DEFAULT_RATE_LIMIT_WINDOW_MS
);
const PLUGIN_AI_REVIEW_RATE_LIMIT_MAX = parsePositiveInt(
    process.env.PLUGIN_AI_REVIEW_RATE_LIMIT_MAX,
    DEFAULT_RATE_LIMIT_MAX
);

module.exports = {
    isPluginAiReviewConfigured,
    reviewPluginAnalysisSummary,
    PLUGIN_AI_REVIEW_BODY_LIMIT_BYTES,
    PLUGIN_AI_REVIEW_RATE_LIMIT_WINDOW_MS,
    PLUGIN_AI_REVIEW_RATE_LIMIT_MAX
};
