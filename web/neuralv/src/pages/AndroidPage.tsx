import { StoryScene } from '../components/StoryScene';
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
              <p>Мобильный клиент для ежедневной проверки, входа и общей истории без отдельного сценария для телефона.</p>
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
                <span className="story-scene-kicker">Версия и требования</span>
                <strong>{version}</strong>
                <p>{requirement}</p>
              </div>
              <div className="platform-meta-chip">Телефон и планшет</div>
              <div className="platform-meta-chip">Один APK</div>
              <div className="platform-meta-chip">Общий аккаунт</div>
            </div>
          </article>
        </div>
      </section>

      <div className="story-track">
        <StoryScene
          compact
          title="Установка без лишних шагов"
          body="Скачай APK, установи приложение и сразу войди в тот же аккаунт, который уже используется в других клиентах."
          accent="Один файл, один привычный маршрут, без ручной настройки."
          visual="android"
        />
        <StoryScene
          compact
          title="История остаётся рядом"
          body="Основные действия, вход и история проверок не отрезаны от остальных устройств. Телефон остаётся частью общего продукта, а не отдельным приложением в стороне."
          accent="Тот же аккаунт и та же логика, но в мобильном формате."
          visual="shield"
        />
      </div>
    </div>
  );
}
