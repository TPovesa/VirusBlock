import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  buildVerifiedAppDetailsPath,
  VERIFIED_APP_GROUPS,
  fetchPublicVerifiedApps,
  formatVerifiedAppPlatform,
  humanizeError,
  normalizeVerifiedAppPlatform,
  type SiteVerifiedApp,
  type SiteVerifiedAppFilter
} from '../lib/siteAuth';
import '../styles/auth.css';

const navGroupLabelStyle = {
  padding: '2px 4px 0',
  color: 'var(--nv-text-soft)',
  fontSize: '0.72rem',
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase' as const
};

function getFilterTitle(platform: SiteVerifiedAppFilter) {
  return platform === 'all' ? 'Все проверенные' : formatVerifiedAppPlatform(platform);
}

function VerifiedAppTile({ app }: { app: SiteVerifiedApp }) {
  const initial = (app.appName || '?').slice(0, 1).toUpperCase();
  const verifiedAt = app.verifiedAt ? new Intl.DateTimeFormat('ru-RU', { dateStyle: 'medium' }).format(new Date(app.verifiedAt)) : null;
  const platformLabel = formatVerifiedAppPlatform(String(app.platform || ''));
  const authorLabel = app.authorName || 'Проверенный разработчик';

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
        </div>
      </div>
      {app.publicSummary ? <p className="developer-app-summary">{app.publicSummary}</p> : null}
      <div className="developer-app-row">
        <span>Раздел</span>
        <strong>{platformLabel}</strong>
      </div>
      <div className="developer-app-row">
        <span>Автор</span>
        <strong>{authorLabel}</strong>
      </div>
      <div className="developer-app-links">
        {app.repositoryUrl ? <a className="shell-chip" href={app.repositoryUrl} target="_blank" rel="noreferrer">Репозиторий</a> : null}
        {app.officialSiteUrl ? <a className="shell-chip" href={app.officialSiteUrl} target="_blank" rel="noreferrer">Сайт</a> : null}
      </div>
      <div className="developer-app-action-row">
        <Link className="nv-button" to={buildVerifiedAppDetailsPath(app)}>Скачать</Link>
      </div>
      {verifiedAt ? <div className="developer-app-footnote">Проверено: {verifiedAt}</div> : null}
    </article>
  );
}

export function VerifiedAppsPage() {
  const [platform, setPlatform] = useState<SiteVerifiedAppFilter>('all');
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

  const title = useMemo(() => getFilterTitle(platform), [platform]);

  return (
    <div className="page-stack profile-dashboard-shell verified-apps-shell">
      <section className="profile-dashboard-grid verified-apps-layout">
        <aside className="content-card profile-nav-card verified-apps-nav-card">
          <div className="profile-nav-head">
            <strong>Проверенные</strong>
          </div>
          <div className="profile-nav-list" role="tablist" aria-label="Категории проверенных приложений">
            {VERIFIED_APP_GROUPS.map((group, index) => (
              <div key={group.id} className="profile-panel-stack">
                {index > 0 ? <div className="profile-nav-divider" /> : null}
                <div style={navGroupLabelStyle}>{group.label}</div>
                <div className="profile-panel-stack">
                  {group.items.map((item) => (
                    <button
                      key={item.value}
                      type="button"
                      className={`profile-nav-button${platform === item.value ? ' is-active' : ''}`}
                      onClick={() => setPlatform(item.value)}
                    >
                      <span>{item.label}</span>
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </aside>

        <div className="profile-dashboard-main">
          <article className="content-card profile-panel-card profile-panel-card-featured verified-apps-header-card">
            <div className="profile-panel-head">
              <h1>{title}</h1>
            </div>
            {!loading ? <div className="profile-inline-note">Найдено: {apps.length}</div> : null}
          </article>

          {error ? <div className="form-message is-error">{humanizeError(error)}</div> : null}

          {loading ? (
            <div className="content-card profile-panel-card">
              <div className="profile-empty-copy">Загружаем каталог...</div>
            </div>
          ) : apps.length > 0 ? (
            <div className="developer-app-grid developer-app-grid-public">
              {apps.map((app) => (
                <VerifiedAppTile key={app.id || `${app.appName}-${normalizeVerifiedAppPlatform(String(app.platform || ''))}`} app={app} />
              ))}
            </div>
          ) : (
            <div className="content-card profile-panel-card">
              <div className="profile-empty-copy">Для раздела {title} пока нет опубликованных приложений.</div>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
