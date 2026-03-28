import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useLocation, useParams } from 'react-router-dom';
import {
  buildVerifiedAppDetailsPath,
  fetchPublicVerifiedApps,
  formatVerifiedAppPlatform,
  humanizeError,
  matchesVerifiedAppRef,
  type SiteVerifiedApp
} from '../lib/siteAuth';
import '../styles/story.css';
import '../styles/auth.css';

function formatDate(value: string | number | null | undefined) {
  if (!value) {
    return null;
  }
  const parsed = typeof value === 'number' ? value : Date.parse(String(value));
  if (!Number.isFinite(parsed)) {
    return null;
  }
  return new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(parsed);
}

function formatSize(sizeBytes: number | undefined) {
  if (!sizeBytes || sizeBytes <= 0) {
    return null;
  }
  const units = ['Б', 'КБ', 'МБ', 'ГБ'];
  let size = sizeBytes;
  let unitIndex = 0;
  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024;
    unitIndex += 1;
  }
  return `${size.toFixed(size >= 100 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

function formatStatus(app: SiteVerifiedApp) {
  const status = String(app.status || '').trim().toUpperCase();
  if (status === 'SAFE' || status === 'SUCCESS') {
    return 'Безопасно';
  }
  if (status === 'RUNNING' || status === 'QUEUED') {
    return 'В проверке';
  }
  if (status === 'FAILED') {
    return 'Не подтверждено';
  }
  return app.status || 'Проверено';
}

export function VerifiedAppDetailsPage() {
  const { appRef = '' } = useParams();
  const location = useLocation();
  const [app, setApp] = useState<SiteVerifiedApp | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;

    async function load() {
      setLoading(true);
      setError('');
      const result = await fetchPublicVerifiedApps({ limit: 200 });
      if (disposed) {
        return;
      }
      if (!result.ok) {
        setError(result.error || 'Не удалось открыть страницу приложения.');
        setLoading(false);
        return;
      }
      setApp((result.data || []).find((item) => matchesVerifiedAppRef(item, appRef)) || null);
      setLoading(false);
    }

    void load();
    return () => {
      disposed = true;
    };
  }, [appRef]);

  const canonicalPath = useMemo(() => (app ? buildVerifiedAppDetailsPath(app) : ''), [app]);
  const platformLabel = app ? formatVerifiedAppPlatform(String(app.platform || '')) : '';
  const verifiedAt = app ? formatDate(app.verifiedAt || app.createdAt) : null;
  const artifactSize = app ? formatSize(app.artifactSizeBytes) : null;

  if (!loading && !error && app && canonicalPath && canonicalPath !== location.pathname) {
    return <Navigate to={canonicalPath} replace />;
  }

  return (
    <div className="page-stack platform-story-shell">
      <section className="platform-hero">
        <div className="platform-hero-center">
          <article className="platform-hero-card platform-hero-card-centered verified-app-details-card">
            {loading ? (
              <div className="platform-hero-copy platform-hero-copy-centered">
                <h1>Загружаем приложение…</h1>
              </div>
            ) : error ? (
              <div className="platform-hero-copy platform-hero-copy-centered">
                <h1>Страница недоступна</h1>
                <p>{humanizeError(error)}</p>
                <div className="platform-hero-actions">
                  <Link className="nv-button" to="/verified-apps">Вернуться в каталог</Link>
                </div>
              </div>
            ) : app ? (
              <>
                <div className="platform-hero-copy platform-hero-copy-centered">
                  <h1>{app.appName}</h1>
                  <p>{app.publicSummary || app.projectDescription || 'Проверенное приложение из каталога NeuralV.'}</p>
                  <div className="platform-hero-actions">
                    {app.releaseArtifactUrl ? <a className="nv-button" href={app.releaseArtifactUrl} target="_blank" rel="noreferrer">Скачать</a> : null}
                    {app.repositoryUrl ? <a className="shell-chip" href={app.repositoryUrl} target="_blank" rel="noreferrer">Репозиторий</a> : null}
                    {app.officialSiteUrl ? <a className="shell-chip" href={app.officialSiteUrl} target="_blank" rel="noreferrer">Сайт</a> : null}
                  </div>
                </div>
                <div className="platform-hero-grid platform-hero-grid-centered verified-app-details-grid">
                  <div className="platform-main-stat">
                    <strong>{platformLabel}</strong>
                    <p>{formatStatus(app)}</p>
                  </div>
                  <div className="verified-app-details-meta-grid">
                    {verifiedAt ? (
                      <div className="verified-app-details-meta-card">
                        <strong>{verifiedAt}</strong>
                        <p>Дата проверки</p>
                      </div>
                    ) : null}
                    {artifactSize ? (
                      <div className="verified-app-details-meta-card">
                        <strong>{artifactSize}</strong>
                        <p>Размер файла</p>
                      </div>
                    ) : null}
                    {app.releaseAssetName ? (
                      <div className="verified-app-details-meta-card">
                        <strong>{app.releaseAssetName}</strong>
                        <p>Файл релиза</p>
                      </div>
                    ) : null}
                  </div>
                </div>
              </>
            ) : (
              <div className="platform-hero-copy platform-hero-copy-centered">
                <h1>Приложение не найдено</h1>
                <p>Запись в каталоге недоступна или уже была обновлена.</p>
                <div className="platform-hero-actions">
                  <Link className="nv-button" to="/verified-apps">Вернуться в каталог</Link>
                </div>
              </div>
            )}
          </article>
        </div>
      </section>

      {!loading && !error && app ? (
        <section className="platform-install-shell">
          <div className="platform-section-heading platform-section-heading-centered">
            <h2>Скачать</h2>
          </div>
          <div className="platform-install-grid platform-install-grid-centered verified-app-download-grid">
            <article className="platform-install-card platform-install-card-centered">
              <h3>Релиз</h3>
              <p>Открывает тот файл, который был указан для проверки и привязан к опубликованной версии.</p>
              <div className="platform-install-actions">
                {app.releaseArtifactUrl ? <a className="nv-button" href={app.releaseArtifactUrl} target="_blank" rel="noreferrer">Скачать</a> : <span className="profile-inline-note">Файл релиза не указан.</span>}
              </div>
            </article>
            <article className="platform-install-card platform-install-card-centered">
              <h3>Источник</h3>
              <p>Здесь остаются основные ссылки, чтобы можно было быстро сверить релиз, репозиторий и сайт проекта.</p>
              <div className="platform-install-actions verified-app-download-actions">
                {app.repositoryUrl ? <a className="shell-chip" href={app.repositoryUrl} target="_blank" rel="noreferrer">Репозиторий</a> : null}
                {app.officialSiteUrl ? <a className="shell-chip" href={app.officialSiteUrl} target="_blank" rel="noreferrer">Сайт</a> : null}
              </div>
            </article>
          </div>
        </section>
      ) : null}
    </div>
  );
}
