import { formatSessionExpiry, type SiteAuthSession } from '../lib/siteAuth';

type SessionSummaryCardProps = {
  session: SiteAuthSession | null;
  title?: string;
};

export function SessionSummaryCard({ session, title = 'Текущая сессия' }: SessionSummaryCardProps) {
  if (!session) {
    return (
      <article className="content-card auth-session-card auth-session-empty">
        <h3>{title}</h3>
        <p>Активная web-сессия не найдена.</p>
      </article>
    );
  }

  return (
    <article className="content-card auth-session-card">
      <h3>{title}</h3>
      <div className="auth-session-grid">
        <div>
          <span className="auth-field-label">Имя</span>
          <strong>{session.user.name}</strong>
        </div>
        <div>
          <span className="auth-field-label">Почта</span>
          <strong>{session.user.email}</strong>
        </div>
        <div>
          <span className="auth-field-label">Session ID</span>
          <strong>{session.sessionId}</strong>
        </div>
        <div>
          <span className="auth-field-label">Access до</span>
          <strong>{formatSessionExpiry(session.accessTokenExpiresAt)}</strong>
        </div>
        <div>
          <span className="auth-field-label">Refresh до</span>
          <strong>{formatSessionExpiry(session.refreshTokenExpiresAt)}</strong>
        </div>
        <div>
          <span className="auth-field-label">Аккаунт</span>
          <strong>
            {session.user.is_premium ? 'Premium' : 'Standard'}
            {session.user.is_developer_mode ? ' · Dev mode' : ''}
          </strong>
        </div>
      </div>
    </article>
  );
}
