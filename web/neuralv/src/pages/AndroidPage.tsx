import { getArtifact, getArtifactSystemRequirements, getArtifactVersion, isArtifactReady } from '../lib/manifest';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import '../styles/story.css';

export function AndroidPage() {
  const manifestState = useReleaseManifest('android');
  const artifact = getArtifact(manifestState.manifest, 'android');
  const ready = isArtifactReady(artifact);
  const version = getArtifactVersion(manifestState.manifest, 'android') || 'pending';
  const requirement = getArtifactSystemRequirements(artifact, manifestState.manifest)[0] || 'Android 8.0+ (API 26)';

  return (
    <div className="page-stack platform-story-shell">
      <section className="platform-hero">
        <div className="platform-hero-center">
          <article className="platform-hero-card platform-hero-card-centered">
            <div className="platform-hero-copy platform-hero-copy-centered">
              <h1>NeuralV для Android</h1>
              <div className="platform-hero-actions">
                {ready && artifact?.downloadUrl ? (
                  <a className="nv-button" href={artifact.downloadUrl} target="_blank" rel="noreferrer">Скачать APK</a>
                ) : (
                  <button className="nv-button is-disabled" type="button" disabled>APK скоро</button>
                )}
              </div>
            </div>
            <div className="platform-hero-grid platform-hero-grid-centered">
              <div className="platform-main-stat">
                <strong>{version}</strong>
                <p>Требования: {requirement}</p>
              </div>
              <div className="platform-meta-chip">Телефон и планшет</div>
              <div className="platform-meta-chip">Один APK</div>
              <div className="platform-meta-chip">Общий профиль</div>
            </div>
          </article>
        </div>
      </section>

      <section className="platform-install-shell">
        <div className="platform-info-grid">
          <article className="platform-install-card platform-info-card">
            <h2>Один APK</h2>
            <p>Скачиваешь приложение, устанавливаешь его и сразу переходишь к обычному рабочему сценарию без лишней подготовки.</p>
          </article>
          <article className="platform-install-card platform-info-card">
            <h2>Общий аккаунт</h2>
            <p>История, вход и основные действия остаются внутри одного аккаунта и не разваливаются на отдельные сервисы.</p>
          </article>
          <article className="platform-install-card platform-info-card">
            <h2>Для телефона и планшета</h2>
            <p>Android-версия рассчитана на мобильный формат и не пытается притворяться уменьшенной desktop-сборкой.</p>
          </article>
        </div>
      </section>

      <section className="platform-install-shell">
        <div className="platform-section-heading platform-section-heading-centered">
          <h2>Скачать</h2>
        </div>
        <div className="platform-install-grid platform-install-grid-single">
          <article className="platform-install-card platform-install-card-centered">
            <h3>Android APK</h3>
            <p>{requirement}</p>
            {ready && artifact?.downloadUrl ? (
              <a className="nv-button" href={artifact.downloadUrl} target="_blank" rel="noreferrer">Скачать APK</a>
            ) : (
              <button className="nv-button is-disabled" type="button" disabled>APK скоро</button>
            )}
          </article>
        </div>
      </section>
    </div>
  );
}
