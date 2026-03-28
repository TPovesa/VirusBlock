const express = require('express');
const auth = require('../middleware/auth');
const {
    getDeveloperStatus,
    createDeveloperApplication,
    reviewDeveloperApplicationAction,
    createVerificationJob,
    listMyVerifiedApps,
    listPublicVerifiedApps,
    fetchPublicVerifiedAppById
} = require('../services/verifiedAppsService');

const router = express.Router();

function normalizePlatform(value) {
    const normalized = String(value || '').trim().toLowerCase();
    return normalized || null;
}

function parseLimit(value, fallback = 24) {
    const numeric = Number.parseInt(String(value || ''), 10);
    if (!Number.isFinite(numeric)) {
        return fallback;
    }
    return Math.min(60, Math.max(1, numeric));
}

function mapServiceError(error) {
    const code = String(error?.code || '').trim().toUpperCase();
    switch (code) {
        case 'USER_NOT_FOUND':
            return { status: 404, error: 'Аккаунт не найден.' };
        case 'MAIL_NOT_CONFIGURED':
        case 'DEVELOPER_APPLICATION_EMAIL_NOT_CONFIGURED':
            return { status: 503, error: 'Отправка заявок временно недоступна.' };
        case 'DEVELOPER_APPLICATION_ACTION_SECRET_NOT_CONFIGURED':
            return { status: 503, error: 'Ссылки для заявок временно недоступны.' };
        case 'ALREADY_VERIFIED_DEVELOPER':
            return { status: 409, error: 'Статус разработчика уже подтверждён.' };
        case 'DEVELOPER_APPLICATION_ALREADY_PENDING':
            return { status: 409, error: 'Заявка уже отправлена и ждёт подтверждения.' };
        case 'DEVELOPER_APPLICATION_COOLDOWN':
            return {
                status: 429,
                error: 'Повторную заявку можно отправить позже.',
                retry_after_ms: Number(error?.retryAfterMs || 0) || undefined
            };
        case 'DEVELOPER_APPLICATION_NOT_FOUND':
            return { status: 404, error: 'Заявка не найдена.' };
        case 'DEVELOPER_APPLICATION_ACTION_INVALID':
        case 'DEVELOPER_APPLICATION_ACTION_INVALID_TOKEN':
            return { status: 403, error: 'Ссылка подтверждения недействительна.' };
        case 'DEVELOPER_APPLICATION_ALREADY_REVIEWED':
            return { status: 409, error: 'Заявка уже рассмотрена.', application: error?.application || null };
        case 'VERIFIED_DEVELOPER_REQUIRED':
            return { status: 403, error: 'Сначала нужно получить статус разработчика.' };
        case 'UNSUPPORTED_PLATFORM':
            return { status: 400, error: 'Укажите поддерживаемую платформу.' };
        case 'INVALID_REPOSITORY_URL':
            return { status: 400, error: 'Нужна ссылка на публичный GitHub-репозиторий.' };
        case 'PRIVATE_REPOSITORY_NOT_SUPPORTED':
            return { status: 400, error: 'Закрытые репозитории пока не поддерживаются.' };
        case 'INVALID_OFFICIAL_SITE_URL':
            return { status: 400, error: 'Ссылка на сайт указана неверно.' };
        case 'REPOSITORY_RELEASES_NOT_FOUND':
            return { status: 422, error: 'Для проверки нужен публичный GitHub Release с файлом сборки. Добавьте релиз в репозиторий и попробуйте ещё раз.' };
        case 'REPOSITORY_RELEASE_ASSET_NOT_FOUND':
        case 'VERIFICATION_RELEASE_NOT_FOUND':
            return { status: 422, error: 'Не удалось выбрать файл сборки автоматически. Откройте расширенные настройки и укажите версию или имя файла релиза.' };
        case 'AI_REVIEW_NOT_CONFIGURED':
        case 'VERIFICATION_AI_NOT_CONFIGURED':
            return { status: 503, error: 'Серверная проверка временно недоступна.' };
        case 'AI_REVIEW_EMPTY':
        case 'AI_REVIEW_INVALID':
        case 'VERIFICATION_AI_REQUEST_FAILED':
        case 'VERIFICATION_AI_INVALID_RESPONSE':
            return { status: 502, error: 'AI-проверка временно не смогла завершить разбор репозитория.' };
        case 'TOO_MANY_ACTIVE_VERIFICATION_JOBS':
            return { status: 429, error: 'Сначала дождитесь завершения текущих проверок.' };
        case 'VERIFICATION_SUBMIT_COOLDOWN':
            return {
                status: 429,
                error: 'Новую проверку можно запустить чуть позже.',
                retry_after_ms: Number(error?.retryAfterMs || 0) || undefined
            };
        case 'VERIFICATION_ALREADY_EXISTS':
            return {
                status: 409,
                error: 'Проверка этого релиза уже идёт или уже завершена.',
                job_id: error?.jobId || null,
                job_status: error?.status || null
            };
        default:
            return {
                status: 500,
                error: 'Не удалось завершить проверку. Попробуйте ещё раз чуть позже.'
            };
    }
}

async function handleDeveloperStatus(req, res) {
    try {
        const status = await getDeveloperStatus(req.userId);
        if (!status) {
            res.status(404).json({ error: 'Аккаунт не найден.' });
            return;
        }
        res.json({ status });
    } catch (error) {
        const payload = mapServiceError(error);
        res.status(payload.status).json(payload);
    }
}

async function handleDeveloperApply(req, res) {
    try {
        const application = await createDeveloperApplication(req.userId, {
            message: req.body?.message
        });
        res.status(201).json({
            success: true,
            application,
            message: 'Заявка отправлена. После подтверждения откроется сертификация приложений.'
        });
    } catch (error) {
        const payload = mapServiceError(error);
        res.status(payload.status).json(payload);
    }
}

async function handleDeveloperApplicationReview(req, res) {
    try {
        const application = await reviewDeveloperApplicationAction(
            req.params.id,
            req.params.action,
            req.query?.token
        );

        const approved = String(application?.status || '') === 'APPROVED';
        const title = approved ? 'Заявка принята' : 'Заявка отклонена';
        const description = approved
            ? 'Статус разработчика подтверждён.'
            : 'Заявка разработчика отклонена.';
        res
            .status(200)
            .type('html')
            .send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${title}</title></head><body style="margin:0;background:#111315;color:#eef1ef;font:16px/1.6 Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;"><div style="max-width:560px;width:100%;background:#181b1e;border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:28px;"><h1 style="margin:0 0 12px;font-size:28px;">${title}</h1><p style="margin:0 0 8px;">${description}</p><p style="margin:0;color:#98a19d;">ID заявки: ${application.id}</p></div></body></html>`);
    } catch (error) {
        const payload = mapServiceError(error);
        res
            .status(payload.status)
            .type('html')
            .send(`<!doctype html><html lang="ru"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Не удалось обработать заявку</title></head><body style="margin:0;background:#111315;color:#eef1ef;font:16px/1.6 Segoe UI,Arial,sans-serif;display:grid;place-items:center;min-height:100vh;padding:24px;"><div style="max-width:560px;width:100%;background:#181b1e;border:1px solid rgba(255,255,255,0.08);border-radius:24px;padding:28px;"><h1 style="margin:0 0 12px;font-size:28px;">Не удалось обработать заявку</h1><p style="margin:0;">${payload.error}</p></div></body></html>`);
    }
}

async function handleMyVerifiedApps(req, res) {
    try {
        const apps = await listMyVerifiedApps(req.userId);
        res.json({ apps });
    } catch (error) {
        const payload = mapServiceError(error);
        res.status(payload.status).json(payload);
    }
}

async function handleCreateVerificationJob(req, res) {
    try {
        const app = await createVerificationJob(req.userId, {
            repository_url: req.body?.repository_url,
            official_site_url: req.body?.official_site_url,
            platform: req.body?.platform,
            app_name: req.body?.app_name,
            description: req.body?.description,
            release_tag: req.body?.release_tag,
            release_asset_name: req.body?.release_asset_name
        });
        res.status(201).json({
            success: true,
            app,
            message: 'Проверка запущена. Сервер сам разберёт репозиторий, релизы и соберёт итог в списке.'
        });
    } catch (error) {
        const payload = mapServiceError(error);
        res.status(payload.status).json(payload);
    }
}

router.get(['/verified-apps/developer/status', '/profile/developer/status'], auth, handleDeveloperStatus);
router.post(['/verified-apps/developer/apply', '/profile/developer/apply'], auth, handleDeveloperApply);
router.get('/verified-apps/developer/applications/:id/:action', handleDeveloperApplicationReview);
router.get(['/verified-apps/mine', '/profile/developer/apps'], auth, handleMyVerifiedApps);
router.post(['/verified-apps/mine', '/profile/developer/apps/verify'], auth, handleCreateVerificationJob);

router.get('/verified-apps', async (req, res) => {
    try {
        const apps = await listPublicVerifiedApps({
            platform: normalizePlatform(req.query?.platform),
            limit: parseLimit(req.query?.limit, 24)
        });
        res.json({ apps });
    } catch (error) {
        const payload = mapServiceError(error);
        res.status(payload.status).json(payload);
    }
});

router.get('/verified-apps/:id', async (req, res) => {
    try {
        const app = await fetchPublicVerifiedAppById(req.params.id);
        if (!app) {
            res.status(404).json({ error: 'Приложение не найдено.' });
            return;
        }
        res.json({ app });
    } catch (error) {
        const payload = mapServiceError(error);
        res.status(payload.status).json(payload);
    }
});

module.exports = router;
