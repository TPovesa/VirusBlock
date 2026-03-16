import { getArtifact, isArtifactReady } from '../lib/manifest';
import { useReleaseManifest } from '../hooks/useReleaseManifest';

const installSteps = [
  '1. Скачай сборку для Windows.',
  '2. Открой приложение и войди в аккаунт.',
  '3. Запусти проверку или включи фоновый режим.'
];

export function WindowsPage() {
  const manifestState = useReleaseManifest();
  const artifact = getArtifact(manifestState.manifest, 'windows');
  const ready = isArtifactReady(artifact);

  return (
    <div className="page-stack">
      <section className="hero-card platform-hero">
        <div className="hero-copy">
          <h1>NeuralV для Windows.</h1>
          <p>
            Обычное настольное приложение для проверки файлов и фонового контроля на ПК без
            перегруженного интерфейса.
          </p>
          <div className="hero-actions">
            {ready && artifact?.downloadUrl ? (
              <a className="nv-button" href={artifact.downloadUrl} target="_blank" rel="noreferrer">
                Скачать Windows
              </a>
            ) : (
              <button className="nv-button is-disabled" type="button" disabled>
                Сборка скоро
              </button>
            )}
            <a className="nv-button tonal" href="#windows-install">
              Установка
            </a>
          </div>
        </div>

        <div className="hero-panel compact-panel">
          <article className="mini-stat">
            <strong>Windows 10 / 11</strong>
            <span className="hero-support-text">
              GUI-клиент для обычного рабочего стола: проверка файлов, история и тот же аккаунт,
              что на Android и Linux.
            </span>
          </article>
        </div>
      </section>

      <section id="windows-install" className="section-block">
        <div className="install-layout install-layout-static">
          <article className="content-card chooser-card">
            <h3>Установка</h3>
            <p>Скачай сборку, войди в аккаунт и сразу переходи к проверке.</p>
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
