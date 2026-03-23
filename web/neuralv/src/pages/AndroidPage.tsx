import { getArtifact, getArtifactSystemRequirements, getArtifactVersion, isArtifactReady } from '../lib/manifest';
import { useReleaseManifest } from '../hooks/useReleaseManifest';

const androidPoints = [
  'Один APK и общий вход с другими версиями NeuralV.',
  'История проверок живёт в том же аккаунте, что и на ПК.',
  'Ставится без отдельного desktop-инструмента.'
] as const;

export function AndroidPage() {
  const manifestState = useReleaseManifest('android');
  const artifact = getArtifact(manifestState.manifest, 'android');
  const ready = isArtifactReady(artifact);
  const version = getArtifactVersion(manifestState.manifest, 'android') || 'pending';
  const requirements = getArtifactSystemRequirements(artifact, manifestState.manifest);

  return (
    <div className="page-stack">
      <section className="hero-shell platform-shell">
        <div className="hero-copy hero-copy-tight">
          <span className="eyebrow">Android client</span>
          <h1>NeuralV для Android</h1>
          <p>Телефон, планшет и общий аккаунт без отдельной мороки вокруг установки.</p>
          <div className="hero-actions">
            {ready && artifact?.downloadUrl ? <a className="nv-button" href={artifact.downloadUrl} target="_blank" rel="noreferrer">Скачать APK</a> : <button className="nv-button is-disabled" type="button" disabled>APK скоро</button>}
          </div>
        </div>

        <article className="surface-card platform-summary-card accent-card">
          <span className="summary-kicker">Актуальная версия</span>
          <strong>{version}</strong>
          <span>{requirements[0] || 'Требования ещё не дошли в manifest.'}</span>
        </article>
      </section>

      <section className="section-grid section-grid-platform">
        <article className="surface-card platform-install-card">
          <div className="card-heading"><h2>Что получаешь</h2></div>
          <ul className="bullet-list">
            {androidPoints.map((item) => <li key={item}>{item}</li>)}
          </ul>
        </article>

        <article className="surface-card platform-install-card">
          <div className="card-heading"><h2>Как поставить</h2></div>
          <div className="command-card"><pre>1. Скачай APK.{`\n`}2. Подтверди установку на Android.{`\n`}3. Открой NeuralV и войди в аккаунт.</pre></div>
        </article>
      </section>
    </div>
  );
}
