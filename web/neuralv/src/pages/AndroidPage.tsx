import { getArtifact, isArtifactReady } from '../lib/manifest';
import { useReleaseManifest } from '../hooks/useReleaseManifest';

const installSteps = [
  '1. Скачай APK на телефон.',
  '2. Подтверди установку, если Android покажет запрос.',
  '3. Открой NeuralV и войди в аккаунт.'
];

export function AndroidPage() {
  const manifestState = useReleaseManifest();
  const artifact = getArtifact(manifestState.manifest, 'android');
  const ready = isArtifactReady(artifact);

  return (
    <div className="page-stack">
      <section className="hero-card platform-hero">
        <div className="hero-copy">
          <h1>NeuralV для Android.</h1>
          <p>
            Проверка приложений и история прямо на телефоне. Ставится как обычный APK и сразу
            подключается к твоему аккаунту.
          </p>
          <div className="hero-actions">
            {ready && artifact?.downloadUrl ? (
              <a className="nv-button" href={artifact.downloadUrl} target="_blank" rel="noreferrer">
                Скачать APK
              </a>
            ) : (
              <button className="nv-button is-disabled" type="button" disabled>
                APK скоро
              </button>
            )}
            <a className="nv-button tonal" href="#android-install">
              Установка
            </a>
          </div>
        </div>

        <div className="hero-panel compact-panel">
          <article className="mini-stat">
            <strong>Android 10+</strong>
            <span className="hero-support-text">
              Телефоны и планшеты. Один APK, история проверок и общий вход с другими версиями
              NeuralV.
            </span>
          </article>
        </div>
      </section>

      <section id="android-install" className="section-block">
        <div className="install-layout install-layout-static">
          <article className="content-card chooser-card">
            <h3>Установка</h3>
            <p>Скачай APK, установи и войди в аккаунт. Никаких отдельных утилит не нужно.</p>
          </article>

          <article className="content-card install-card">
            <div className="install-card-head simple-head">
              <h3>Как поставить</h3>
            </div>
            <div className="command-shell light-shell">
              <pre>{installSteps.join('\n')}</pre>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
