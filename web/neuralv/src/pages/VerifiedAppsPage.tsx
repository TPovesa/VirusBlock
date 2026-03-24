import { useEffect, useMemo, useState } from 'react';
import { fetchPublicVerifiedApps, humanizeError, type SiteVerifiedApp } from '../lib/siteAuth';
import '../styles/auth.css';

type PlatformFilter = 'all' | 'android' | 'windows' | 'linux';

function VerifiedAppTile({ app }: { app: SiteVerifiedApp }) {
  const initial = (app.appName || '?').slice(0, 1).toUpperCase();
  const verifiedAt = app.verifiedAt ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(app.verifiedAt)) : null;

  return (
    <article className="content-card developer-app-card developer-app-card-public">
      <div className="developer-app-card-head">
        <div className="developer-app-avatar" aria-hidden="true">
          {app.avatarUrl ? <img src={app.avatarUrl} alt="" loading="lazy" /> : <span>{initial}</span>}
        </div>
        <div className="developer-app-meta">
          <div className="developer-app-title-row">
            <strong>{app.appName}</strong>
            <span className="profile-status-pill is-active">Безопасно</span>
          </div>
          <p>{app.authorName || 'Разработчик NeuralV'}</p>
        </div>
      </div>
      {app.publicSummary ? <p className="developer-app-summary">{app.publicSummary}</p> : null}
      <div className="developer-app-row">
        <span>Платформа</span>
        <strong>{String(app.platform || '').toUpperCase()}</strong>
      </div>
      <div className="developer-app-links">
        {app.repositoryUrl ? <a className="shell-chip" href={app.repositoryUrl} target="_blank" rel="noreferrer">Репозиторий</a> : null}
      </div>
      {verifiedAt ? <div className="developer-app-footnote">Проверено: {verifiedAt}</div> : null}
    </article>
  );
}

export function VerifiedAppsPage() {
  const [platform, setPlatform] = useState<PlatformFilter>('all');
  const [apps, setApps] = useState<SiteVerifiedApp[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let disposed = false;

    async function load() {
      setLoading(true);
      setError('');
      const result = await fetchPublicVerifiedApps({ platform: platform === 'all' ? undefined : platform, limit: 60 });
      if (disposed) {
        return;
      }
      if (!result.ok) {
        setError(result.error || 'Не удалось загрузить каталог.');
        setApps([]);
        setLoading(false);
        return;
      }
      setApps(result.data || []);
      setLoading(false);
    }

    void load();
    return () => {
      disposed = true;
    };
  }, [platform]);

  const title = useMemo(() => {
    switch (platform) {
      case 'android':
        return 'Проверенные приложения для Android';
      case 'windows':
        return 'Проверенные приложения для Windows';
      case 'linux':
        return 'Проверенные приложения для Linux';
      default:
        return 'Проверенные приложения';
    }
  }, [platform]);

  return (
    <div className="page-stack profile-dashboard-shell verified-apps-shell">
      <section className="hero-shell profile-hub-hero verified-apps-hero">
        <div className="hero-copy profile-hub-copy">
          <div className="profile-hub-heading">
            <h1>{title}</h1>
            <p>Здесь видны сборки, которые прошли серверную проверку по открытому исходнику и точному релизному файлу.</p>
          </div>
          <div className="auth-segmented">
            {(['all', 'android', 'windows', 'linux'] as PlatformFilter[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`segment${platform === item ? ' is-active' : ''}`}
                onClick={() => setPlatform(item)}
              >
                {item === 'all' ? 'Все' : item.toUpperCase()}
              </button>
            ))}
          </div>
        </div>
      </section>

      {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}

      {loading ? (
        <div className="content-card profile-panel-card">
          <div className="profile-empty-copy">Загружаем каталог безопасных приложений...</div>
        </div>
      ) : apps.length > 0 ? (
        <div className="developer-app-grid developer-app-grid-public">
          {apps.map((app) => (
            <VerifiedAppTile key={app.id || `${app.appName}-${app.platform}`} app={app} />
          ))}
        </div>
      ) : (
        <div className="content-card profile-panel-card">
          <div className="profile-empty-copy">Пока нет опубликованных безопасных сборок для выбранной платформы.</div>
        </div>
      )}
    </div>
  );
}
