const AIH_BASE_URL = (process.env.VERIFIED_APP_AI_BASE_URL || process.env.AIH_BASE_URL || 'https://sosiskibot.ru/api/v1').replace(/\/$/, '');
const VERIFIED_APPS_AI_MODEL = String(
    process.env.VERIFIED_APPS_AI_MODEL
    || process.env.VERIFIED_APP_AI_MODEL
    || process.env.AIH_VERIFIED_APPS_MODEL
    || 'gpt-4.1-mini'
).trim() || 'gpt-4.1-mini';
const VERIFIED_APPS_AI_TIMEOUT_MS = parsePositiveInt(
    process.env.VERIFIED_APPS_AI_TIMEOUT_MS || process.env.VERIFIED_APP_AI_TIMEOUT_MS,
    parsePositiveInt(process.env.AIH_TIMEOUT_MS, 45000)
);

function parsePositiveInt(value, fallback) {
    const parsed = parseInt(value, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function isVerifiedAppsAiConfigured() {
    return Boolean(String(process.env.VERIFIED_APP_AI_API_KEY || process.env.AIH_API_KEY || process.env.SOSISKIBOT_API_KEY || '').trim());
}

async function apiRequest(path, body = null) {
    const apiKey = String(process.env.VERIFIED_APP_AI_API_KEY || process.env.AIH_API_KEY || process.env.SOSISKIBOT_API_KEY || '').trim();
    const response = await fetch(`${AIH_BASE_URL}${path}`, {
        method: body ? 'POST' : 'GET',
        headers: {
            authorization: `Bearer ${apiKey}`,
            'content-type': 'application/json'
        },
        body: body ? JSON.stringify(body) : undefined,
        signal: AbortSignal.timeout(VERIFIED_APPS_AI_TIMEOUT_MS)
    });

    if (!response.ok) {
        const text = await response.text().catch(() => '');
        const error = new Error(`AI upstream failed: ${response.status} ${text.slice(0, 240)}`);
        error.statusCode = response.status;
        throw error;
    }

    return response.json();
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

function normalizePlatform(value) {
    const normalized = String(value || '').trim().toLowerCase();
    switch (normalized) {
        case 'android':
        case 'apk':
            return 'android';
        case 'windows':
        case 'win':
            return 'windows';
        case 'linux':
        case 'shell':
            return 'linux';
        case 'plugins':
        case 'plugin':
        case 'telegram-plugin':
        case 'extera':
        case 'ayu':
            return 'plugins';
        case 'heroku':
        case 'hikka':
        case 'module':
            return 'heroku';
        default:
            return null;
    }
}

function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
}

function uniqueStrings(value, limit = 8) {
    if (!Array.isArray(value)) {
        return [];
    }
    return Array.from(
        new Set(value.map((item) => String(item || '').trim()).filter(Boolean))
    ).slice(0, limit);
}

function normalizeVerdict(value) {
    const normalized = String(value || '').trim().toLowerCase();
    if (['safe', 'clean', 'benign', 'ok'].includes(normalized)) {
        return 'SAFE';
    }
    if (['suspicious', 'warning', 'warn'].includes(normalized)) {
        return 'FAILED';
    }
    if (['dangerous', 'malicious', 'danger', 'failed', 'block'].includes(normalized)) {
        return 'FAILED';
    }
    return 'FAILED';
}

function mapRiskLevel(verdict, concernsCount) {
    if (verdict === 'SAFE') {
        return concernsCount > 0 ? 'medium' : 'low';
    }
    return concernsCount > 2 ? 'high' : 'medium';
}

async function reviewVerifiedRepositoryWithAi(payload) {
    if (!isVerifiedAppsAiConfigured()) {
        const error = new Error('AI review service is not configured');
        error.code = 'AI_REVIEW_NOT_CONFIGURED';
        error.statusCode = 503;
        throw error;
    }

    const userDescriptionProvided = Boolean(String(payload?.user_input?.description || '').trim());

    const completion = await apiRequest('/chat/completions', {
        model: VERIFIED_APPS_AI_MODEL,
        temperature: 0.08,
        max_tokens: 1400,
        messages: [
            {
                role: 'system',
                content: [
                    'Ты серверный ревьюер безопасности open-source приложений.',
                    'Отвечай только по-русски.',
                    'Ты получаешь данные GitHub-репозитория: релизы, структуру файлов, выдержки из важных файлов, выбранный релизный артефакт и локальные риск-сигналы.',
                    'Твоя задача: дать практический вердикт, можно ли автоматически пометить релиз как безопасный.',
                    'Если есть признаки удалённой загрузки кода, обфускации, кражи данных, скрытого исполнения, персистентности, подозрительных install/update цепочек или иных опасных действий, не давай safe.',
                    'Если данных не хватает или релиз не выглядит проверяемым, тоже не давай safe.',
                    'Если user_input.description пустой или отсутствует, не выдумывай описание от лица пользователя и верни "project_description": null.',
                    'Не считай опасностью сами по себе сигнатуры, rule-листы, blacklist-слова, тестовые образцы, документацию, regex-паттерны и строки-маркеры внутри анализаторов, сканеров и security tooling.',
                    'Если опасные термины встречаются только в коде проверки, в справочниках или в перечислениях паттернов, это не вредоносное поведение.',
                    'Опирайся на реальные исполняемые пути, реальные вызовы и реальные цепочки поведения, а не на одни только упоминания слов внутри строк.',
                    'Пытайся определить платформу и реальное назначение проекта сам по данным GitHub.',
                    'Верни только JSON без Markdown.',
                    'Формат:',
                    '{"verdict":"safe|suspicious|dangerous","platform":"android|windows|linux|plugins|heroku","app_name":"...","summary":"<=220 chars","project_description":"<=240 chars","highlights":["..."],"concerns":["..."],"confidence":0..1,"selected_release_tag":"..."}'
                ].join(' ')
            },
            {
                role: 'user',
                content: JSON.stringify(payload)
            }
        ]
    });

    const content = completion?.choices?.[0]?.message?.content;
    if (!content) {
        const error = new Error('AI review returned empty completion');
        error.code = 'AI_REVIEW_EMPTY';
        throw error;
    }

    const jsonBlock = extractJsonBlock(content);
    if (!jsonBlock) {
        const error = new Error('AI review returned no JSON');
        error.code = 'AI_REVIEW_INVALID';
        throw error;
    }

    let parsed;
    try {
        parsed = JSON.parse(jsonBlock);
    } catch (error) {
        const wrapped = new Error('AI review returned invalid JSON');
        wrapped.code = 'AI_REVIEW_INVALID';
        wrapped.cause = error;
        throw wrapped;
    }

    const verdict = normalizeVerdict(parsed?.verdict);
    const highlights = uniqueStrings(parsed?.highlights, 8);
    const concerns = uniqueStrings(parsed?.concerns, 8);
    const summary = String(parsed?.summary || '').trim().slice(0, 220) || null;
    const projectDescription = userDescriptionProvided
        ? (String(parsed?.project_description || '').trim().slice(0, 240) || null)
        : null;
    const platform = normalizePlatform(parsed?.platform);

    return {
        model: VERIFIED_APPS_AI_MODEL,
        verdict,
        safe: verdict === 'SAFE',
        risk_level: mapRiskLevel(verdict, concerns.length),
        platform,
        platform_reason: projectDescription || null,
        appName: String(parsed?.app_name || '').trim().slice(0, 120) || null,
        summary,
        public_summary: summary,
        private_summary: concerns[0] || summary || null,
        projectDescription,
        highlights,
        concerns,
        findings: [
            ...highlights.map((title) => ({
                severity: 'low',
                title,
                detail: title,
                paths: []
            })),
            ...concerns.map((title) => ({
                severity: verdict === 'SAFE' ? 'medium' : 'high',
                title,
                detail: title,
                paths: []
            }))
        ],
        confidence: Number.isFinite(Number(parsed?.confidence))
            ? clamp(Number(parsed.confidence), 0, 1)
            : 0.5,
        selectedReleaseTag: String(parsed?.selected_release_tag || '').trim().slice(0, 120) || null
    };
}

module.exports = {
    isVerifiedAppsAiConfigured,
    reviewVerifiedRepositoryWithAi,
    VERIFIED_APPS_AI_MODEL
};
