import { useEffect, useMemo, useState } from 'react';
import { Navigate, useLocation, useParams } from 'react-router-dom';
import { CenteredHeroSection } from '../components/CenteredHeroSection';
import {
  buildVerifiedAppDetailsPath,
  fetchPublicVerifiedApps,
  formatVerifiedAppPlatform,
  formatVerifiedAppPlatforms,
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

function getHeroMedia(platform: string) {
  switch (formatVerifiedAppPlatform(platform)) {
    case 'Android':
      return { kind: 'video' as const, src: '/media/story/android-loop.mp4', poster: '/media/story/android.jpg', alt: 'Android verified app' };
    case 'Linux':
      return { kind: 'image' as const, src: '/media/story/linux.jpg', alt: 'Linux verified app' };
    case 'Plugins':
    case 'Heroku':
      return { kind: 'image' as const, src: '/media/story/telegram.jpg', alt: 'Telegram verified app' };
    case 'Windows':
    default:
      return { kind: 'video' as const, src: '/media/story/windows-loop.mp4', poster: '/media/story/windows.jpg', alt: 'Windows verified app' };
  }
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
  const platformLabel = app ? formatVerifiedAppPlatforms(app.compatiblePlatforms || [String(app.platform || '')]) : '';
  const verifiedAt = app ? formatDate(app.verifiedAt || app.createdAt) : null;
  const artifactSize = app ? formatSize(app.artifactSizeBytes) : null;

  if (!loading && !error && app && canonicalPath && canonicalPath !== location.pathname) {
    return <Navigate to={canonicalPath} replace />;
  }

  if (loading) {
    return (
      <div className="page-stack platform-story-shell">
        <CenteredHeroSection
          title="Загружаем приложение…"
          media={{ kind: 'image', src: '/media/story/platforms.jpg', alt: 'Loading verified app' }}
        />
      </div>
    );
  }

  if (error) {
    return (
      <div className="page-stack platform-story-shell">
        <CenteredHeroSection
          title="Страница недоступна"
          body={humanizeError(error)}
          actions={[{ label: 'Вернуться в каталог', to: '/verified-apps' }]}
          media={{ kind: 'image', src: '/media/story/route.jpg', alt: 'Verified app unavailable' }}
        />
      </div>
    );
  }

  if (!app) {
    return (
      <div className="page-stack platform-story-shell">
        <CenteredHeroSection
          title="Приложение не найдено"
          body="Запись в каталоге недоступна или уже была обновлена."
          actions={[{ label: 'Вернуться в каталог', to: '/verified-apps' }]}
          media={{ kind: 'image', src: '/media/story/privacy.jpg', alt: 'Verified app not found' }}
        />
      </div>
    );
  }

  return (
    <div className="page-stack platform-story-shell">
      <CenteredHeroSection
        title={app.appName}
        body={app.publicSummary || app.projectDescription || 'Проверенное приложение из каталога NeuralV.'}
        actions={[
          ...(app.releaseArtifactUrl ? [{ label: 'Скачать', href: app.releaseArtifactUrl, external: true }] : []),
          ...(app.repositoryUrl ? [{ label: 'Репозиторий', href: app.repositoryUrl, external: true, variant: 'secondary' as const }] : []),
          ...(app.officialSiteUrl ? [{ label: 'Сайт', href: app.officialSiteUrl, external: true, variant: 'secondary' as const }] : [])
        ]}
        media={getHeroMedia(String(app.platform || 'windows'))}
        meta={[
          { label: 'Раздел', value: platformLabel },
          { label: 'Статус', value: formatStatus(app) },
          ...(verifiedAt ? [{ label: 'Проверено', value: verifiedAt }] : []),
          ...(artifactSize ? [{ label: 'Размер файла', value: artifactSize }] : [])
        ]}
      />

      <section className="story-download-section">
        <h2>Скачать</h2>
        <div className="platform-install-grid platform-install-grid-centered verified-app-download-grid">
          <article className="platform-install-card platform-install-card-centered">
            <h3>Релиз</h3>
            <p>Это тот же файл, который был указан для проверки и привязан к опубликованной версии.</p>
            <div className="platform-install-actions">
              {app.releaseArtifactUrl ? <a className="nv-button" href={app.releaseArtifactUrl} target="_blank" rel="noreferrer">Скачать</a> : <span className="profile-inline-note">Файл релиза не указан.</span>}
            </div>
          </article>
          <article className="platform-install-card platform-install-card-centered">
            <h3>Источник</h3>
            <p>Здесь остаются основные ссылки, чтобы быстро сверить релиз, репозиторий и сайт проекта.</p>
            <div className="platform-install-actions verified-app-download-actions">
              {app.repositoryUrl ? <a className="shell-chip" href={app.repositoryUrl} target="_blank" rel="noreferrer">Репозиторий</a> : null}
              {app.officialSiteUrl ? <a className="shell-chip" href={app.officialSiteUrl} target="_blank" rel="noreferrer">Сайт</a> : null}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
