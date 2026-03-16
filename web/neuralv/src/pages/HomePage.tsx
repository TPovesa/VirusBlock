import { getArtifact, isArtifactReady, ReleaseArtifact } from '../lib/manifest';
import { useReleaseManifest } from '../hooks/useReleaseManifest';

const productPoints = [
  'Один вход для всех версий.',
  'Проверки для телефона, ПК и Linux.',
  'Быстрый старт без лишней возни.'
];

const baseUrl = import.meta.env.BASE_URL;
const deviceShowcaseUrl = `${baseUrl}media/neuralv-devices.svg`;

// Помести реальные скриншоты в web/neuralv/public/media/screenshots/
// и пропиши src в формате `${baseUrl}media/screenshots/android-home.png`.
// Если src пустой, на сайте останется аккуратная заглушка.
const screenshotSlots = [
  { title: 'Android', caption: 'Телефон', src: '' },
  { title: 'Windows', caption: 'Рабочий стол', src: '' },
  { title: 'Linux', caption: 'GUI и CLI', src: '' }
];

function DownloadButton({ artifact, label, disabledLabel }: { artifact?: ReleaseArtifact; label: string; disabledLabel: string }) {
  const ready = isArtifactReady(artifact);

  if (ready && artifact?.downloadUrl) {
    return (
      <a className="nv-button" href={artifact.downloadUrl} target="_blank" rel="noreferrer">
        {label}
      </a>
    );
  }

  return (
    <button className="nv-button is-disabled" type="button" disabled>
      {disabledLabel}
    </button>
  );
}

export function HomePage() {
  const manifestState = useReleaseManifest();
  const androidArtifact = getArtifact(manifestState.manifest, 'android');
  const windowsArtifact = getArtifact(manifestState.manifest, 'windows');
  const linuxGuiArtifact = getArtifact(manifestState.manifest, 'linux');
  const linuxShellArtifact = getArtifact(manifestState.manifest, 'shell') ?? getArtifact(manifestState.manifest, 'nv');

  return (
    <div className="page-stack">
      <section className="hero-card home-hero">
        <div className="hero-copy hero-copy-wide">
          <h1>NeuralV для Android, Windows и Linux.</h1>
          <p>Скачай свою версию и переходи к проверке без длинных инструкций.</p>
          <div className="hero-actions">
            <a className="nv-button" href="#downloads">Скачать</a>
          </div>
        </div>
      </section>

      <section id="overview" className="showcase-band">
        <article className="content-card showcase-card">
          <div className="showcase-copy">
            <h2>Один продукт для всех устройств.</h2>
            <p>Телефон, настольный клиент и Linux-инструменты работают как одна система.</p>
            <ul className="showcase-points">
              {productPoints.map((point) => (
                <li key={point}>{point}</li>
              ))}
            </ul>
          </div>

          <div className="showcase-visual">
            <div className="device-glow device-glow-a" aria-hidden="true" />
            <div className="device-glow device-glow-b" aria-hidden="true" />
            <img className="device-showcase" src={deviceShowcaseUrl} alt="Телефон, ноутбук и монитор с NeuralV" />
          </div>
        </article>

        <article className="content-card screenshot-card">
          <div className="screenshot-head">
            <h3>Скриншоты продукта</h3>
            <p>Здесь можно показать Android, Windows и Linux рядом в одном аккуратном блоке.</p>
          </div>

          <div className="screenshot-grid">
            {screenshotSlots.map((slot) => (
              <div key={slot.title} className="shot-card">
                {slot.src ? (
                  <img src={slot.src} alt={`${slot.title} — ${slot.caption}`} />
                ) : (
                  <div className="shot-placeholder" aria-hidden="true">
                    <span>{slot.title}</span>
                  </div>
                )}
                <div className="shot-meta">
                  <strong>{slot.title}</strong>
                  <span>{slot.caption}</span>
                </div>
              </div>
            ))}
          </div>
        </article>
      </section>

      <section id="downloads" className="section-block">
        <div className="section-head section-head-tight">
          <h2>Скачать</h2>
        </div>

        <div className="card-grid three-up">
          <article className="content-card platform-card">
            <div className="platform-card-head">
              <div>
                <h3>Android</h3>
                <p>Телефон и планшет.</p>
              </div>
            </div>
            <div className="platform-meta">Android 10 и новее</div>
            <div className="card-actions">
              <DownloadButton artifact={androidArtifact} label="Скачать APK" disabledLabel="APK скоро" />
            </div>
          </article>

          <article className="content-card platform-card">
            <div className="platform-card-head">
              <div>
                <h3>Windows</h3>
                <p>Настольный клиент для ПК.</p>
              </div>
            </div>
            <div className="platform-meta">Windows 10 и 11</div>
            <div className="card-actions">
              <DownloadButton artifact={windowsArtifact} label="Скачать Windows" disabledLabel="Сборка скоро" />
            </div>
          </article>

          <article className="content-card platform-card linux-home-card">
            <div className="platform-card-head">
              <div>
                <h3>Linux</h3>
                <p>GUI для рабочего стола и CLI для терминала.</p>
              </div>
            </div>
            <div className="platform-meta">x64 desktop и серверные сценарии</div>
            <div className="card-actions card-actions-stacked">
              <DownloadButton artifact={linuxGuiArtifact} label="Скачать GUI" disabledLabel="GUI скоро" />
              <DownloadButton artifact={linuxShellArtifact} label="Скачать CLI" disabledLabel="CLI скоро" />
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
