const express = require('express');
const auth = require('../middleware/auth');
const {
    getDeveloperStatus,
    createDeveloperApplication,
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
        case 'VERIFIED_DEVELOPER_REQUIRED':
            return { status: 403, error: 'Сначала нужно получить статус разработчика.' };
        case 'UNSUPPORTED_PLATFORM':
            return { status: 400, error: 'Укажите поддерживаемую платформу.' };
        case 'APP_NAME_REQUIRED':
            return { status: 400, error: 'Укажите название приложения.' };
        case 'INVALID_REPOSITORY_URL':
            return { status: 400, error: 'Нужна ссылка на публичный GitHub-репозиторий.' };
        case 'INVALID_RELEASE_ARTIFACT_URL':
            return { status: 400, error: 'Нужна ссылка на GitHub release artifact.' };
        case 'ARTIFACT_REPOSITORY_MISMATCH':
            return { status: 400, error: 'Артефакт должен принадлежать тому же репозиторию.' };
        case 'INVALID_OFFICIAL_SITE_URL':
            return { status: 400, error: 'Ссылка на сайт указана неверно.' };
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
                error: 'Проверка этого релиза уже есть.',
                job_id: error?.jobId || null,
                job_status: error?.status || null
            };
        default:
            return {
                status: 500,
                error: String(error?.message || 'Не удалось выполнить запрос.').slice(0, 255)
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
            release_artifact_url: req.body?.release_artifact_url,
            official_site_url: req.body?.official_site_url,
            platform: req.body?.platform,
            app_name: req.body?.app_name
        });
        res.status(201).json({
            success: true,
            app,
            message: 'Проверка запущена. Как только сервер закончит анализ, приложение появится в списке.'
        });
    } catch (error) {
        const payload = mapServiceError(error);
        res.status(payload.status).json(payload);
    }
}

router.get(['/verified-apps/developer/status', '/profile/developer/status'], auth, handleDeveloperStatus);
router.post(['/verified-apps/developer/apply', '/profile/developer/apply'], auth, handleDeveloperApply);
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
