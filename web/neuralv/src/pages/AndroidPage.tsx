import { CenteredHeroSection } from '../components/CenteredHeroSection';
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
      <CenteredHeroSection
        title="NeuralV для Android"
        body="Один APK, нормальный мобильный ритм и общий аккаунт без отдельного обходного сценария для телефона."
        media={{
          kind: 'video',
          src: '/media/story/android-loop.mp4',
          poster: '/media/story/android.jpg',
          alt: 'NeuralV Android'
        }}
        actions={[
          ready && artifact?.downloadUrl
            ? { label: 'Скачать APK', href: artifact.downloadUrl, external: true }
            : { label: 'APK скоро', disabled: true }
        ]}
        meta={[
          { label: 'Версия', value: version },
          { label: 'Требования', value: requirement }
        ]}
      />

      <div className="story-track platform-story-track">
        <StoryScene
          kicker="Android"
          title="Телефон и планшет без desktop-компромиссов"
          body="Android-версия остаётся короткой и прямой: установка, вход и рабочий сценарий без лишних промежуточных экранов."
          accent="Один APK. Один аккаунт. Нормальный мобильный поток."
          visual="android"
          mediaAlign="left"
          chips={['APK', 'Телефон', 'Планшет']}
        />
      </div>

      <section className="story-download-section">
        <h2>Скачать</h2>
        <div className="platform-install-grid platform-install-grid-single platform-install-grid-centered">
          <article className="platform-install-card platform-install-card-centered">
            <h3>Android APK</h3>
            <p>{requirement}</p>
            <div className="platform-install-actions">
              {ready && artifact?.downloadUrl ? (
                <a className="nv-button" href={artifact.downloadUrl} target="_blank" rel="noreferrer">Скачать</a>
              ) : (
                <button className="nv-button is-disabled" type="button" disabled>APK скоро</button>
              )}
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
