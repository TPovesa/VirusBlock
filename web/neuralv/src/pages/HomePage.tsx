import { Link } from 'react-router-dom';
import { ManifestBanner } from '../components/ManifestBanner';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact, type ReleaseArtifact } from '../lib/manifest';

const homePageStyles = `
  .nv-page {
    display: grid;
    gap: 20px;
  }

  .nv-hero,
  .nv-strip,
  .nv-grid,
  .nv-steps,
  .nv-cta {
    display: grid;
    gap: 16px;
  }

  .nv-hero {
    padding: clamp(24px, 4vw, 38px);
    grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
    align-items: stretch;
    background:
      radial-gradient(circle at 0 0, rgba(93, 103, 247, 0.16), transparent 28%),
      radial-gradient(circle at 100% 0, rgba(0, 165, 154, 0.12), transparent 24%),
      linear-gradient(180deg, var(--nv-surface-strong), var(--nv-surface));
  }

  .nv-hero-copy,
  .nv-hero-side,
  .nv-card,
  .nv-step,
  .nv-mini {
    display: grid;
    gap: 12px;
  }

  .nv-hero-title,
  .nv-card h3,
  .nv-step h3,
  .nv-cta h3 {
    margin: 0;
    letter-spacing: -0.04em;
  }

  .nv-hero-title {
    font-size: clamp(2.8rem, 6vw, 5.2rem);
    line-height: 0.92;
    max-width: 10ch;
  }

  .nv-lead,
  .nv-card p,
  .nv-step p,
  .nv-mini p,
  .nv-cta p {
    margin: 0;
    color: var(--nv-text-soft);
    line-height: 1.65;
  }

  .nv-chip-row,
  .nv-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .nv-chip {
    padding: 10px 14px;
    border-radius: 999px;
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface-muted);
    color: var(--nv-text-soft);
    font-size: 0.92rem;
  }

  .nv-strip {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .nv-mini {
    padding: 18px 20px;
    border-radius: var(--nv-radius-lg);
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface-muted);
  }

  .nv-mini strong {
    font-size: 1.35rem;
    letter-spacing: -0.04em;
  }

  .nv-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .nv-card,
  .nv-step,
  .nv-cta {
    padding: 24px;
  }

  .nv-card {
    border-radius: var(--nv-radius-xl);
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface);
  }

  .nv-card-top {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
  }

  .nv-status {
    padding: 8px 12px;
    border-radius: 999px;
    background: var(--nv-primary-soft);
    color: var(--nv-primary-strong);
    font-size: 0.84rem;
    white-space: nowrap;
  }

  .nv-list {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
    color: var(--nv-text-soft);
    line-height: 1.55;
  }

  .nv-steps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .nv-step {
    border-radius: var(--nv-radius-lg);
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface-muted);
  }

  .nv-step-index,
  .nv-eyebrow {
    color: var(--nv-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.74rem;
  }

  .nv-cta {
    border-radius: var(--nv-radius-xl);
    border: 1px solid var(--nv-stroke);
    background: linear-gradient(180deg, var(--nv-surface-strong), var(--nv-surface));
  }

  .nv-platform-links {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  @media (max-width: 980px) {
    .nv-hero,
    .nv-grid,
    .nv-strip,
    .nv-steps {
      grid-template-columns: 1fr;
    }
  }
`;

const platformMeta = [
  {
    platform: 'android' as const,
    route: '/android',
    title: 'Android',
    summary: 'Проверка приложений на телефоне, фоновая защита и серверная перепроверка.',
    bullets: ['Гостевой режим', 'Фоновая защита', 'Серверные deep/selective/APK проверки'],
    fallback: 'APK скоро появится'
  },
  {
    platform: 'windows' as const,
    route: '/windows',
    title: 'Windows',
    summary: 'GUI-клиент для EXE/DLL, фонового мониторинга и серверного триажа.',
    bullets: ['Локальная EXE-проверка', 'Resident protection', 'Один аккаунт с Android и Linux'],
    fallback: 'Сборка GUI готовится'
  },
  {
    platform: 'linux' as const,
    route: '/linux',
    title: 'Linux',
    summary: 'Desktop GUI, shell/TUI и daemon через новый nv flow.',
    bullets: ['GUI для workstation', 'Shell/TUI для терминала', 'Установка через nv'],
    fallback: 'Linux GUI готовится'
  }
];

function ArtifactAction({ artifact, fallback, label }: { artifact?: ReleaseArtifact; fallback: string; label: string }) {
  if (!artifact?.downloadUrl) {
    return <md-outlined-button disabled>{fallback}</md-outlined-button>;
  }

  return (
    <a href={artifact.downloadUrl} target="_blank" rel="noreferrer">
      <md-filled-button>{label}</md-filled-button>
    </a>
  );
}

export function HomePage() {
  const manifestState = useReleaseManifest();
  const android = getArtifact(manifestState.manifest, 'android');
  const windows = getArtifact(manifestState.manifest, 'windows');
  const linux = getArtifact(manifestState.manifest, 'linux');

  return (
    <>
      <style>{homePageStyles}</style>
      <div className="nv-page">
        <ManifestBanner {...manifestState} />

        <section className="surface-card nv-hero">
          <div className="nv-hero-copy">
            <div className="nv-eyebrow">NeuralV</div>
            <h1 className="nv-hero-title">Одна защита для Android, Windows и Linux.</h1>
            <p className="nv-lead">
              Зашёл, выбрал свою платформу, скачал нужную версию и вошёл в тот же аккаунт. Без перегруженной витрины и без лишней технички.
            </p>

            <div className="nv-chip-row">
              <span className="nv-chip">Один аккаунт</span>
              <span className="nv-chip">Локальная проверка</span>
              <span className="nv-chip">Серверная перепроверка</span>
            </div>

            <div className="nv-actions">
              <a href="#platforms">
                <md-filled-button>Выбрать версию</md-filled-button>
              </a>
              <Link to="/linux">
                <md-filled-tonal-button>Linux через nv</md-filled-tonal-button>
              </Link>
            </div>
          </div>

          <div className="nv-hero-side">
            <div className="nv-mini">
              <span className="nv-eyebrow">Скачать</span>
              <strong>Под свою платформу</strong>
              <p>Android APK, Windows GUI и Linux GUI/shell живут в одной витрине.</p>
            </div>
            <div className="nv-mini">
              <span className="nv-eyebrow">Войти</span>
              <strong>Тем же аккаунтом</strong>
              <p>История и серверные проверки синхронизируются между устройствами.</p>
            </div>
            <div className="nv-mini">
              <span className="nv-eyebrow">Понять</span>
              <strong>Без лишнего шума</strong>
              <p>Показываем, что доступно, как поставить и что именно умеет версия.</p>
            </div>
          </div>
        </section>

        <section className="nv-strip" aria-label="Коротко о NeuralV">
          <article className="nv-mini surface-card">
            <strong>3 версии</strong>
            <p>Телефон, рабочий стол и терминал.</p>
          </article>
          <article className="nv-mini surface-card">
            <strong>1 backend</strong>
            <p>Один auth и один release manifest.</p>
          </article>
          <article className="nv-mini surface-card">
            <strong>24/7</strong>
            <p>Там, где платформа умеет держать защиту в фоне.</p>
          </article>
        </section>

        <section id="platforms" className="nv-grid" aria-label="Платформы NeuralV">
          {platformMeta.map((item) => {
            const artifact = item.platform === 'android' ? android : item.platform === 'windows' ? windows : linux;
            const status = artifact?.version ? artifact.version : 'pending';
            return (
              <article key={item.platform} className="nv-card surface-card">
                <div className="nv-card-top">
                  <div>
                    <div className="nv-eyebrow">{item.title}</div>
                    <h3>{item.summary}</h3>
                  </div>
                  <span className="nv-status">{status}</span>
                </div>
                <ul className="nv-list">
                  {item.bullets.map((bullet) => (
                    <li key={bullet}>{bullet}</li>
                  ))}
                </ul>
                <div className="nv-actions">
                  <Link to={item.route}>
                    <md-filled-tonal-button>Открыть страницу</md-filled-tonal-button>
                  </Link>
                  <ArtifactAction artifact={artifact} fallback={item.fallback} label="Скачать" />
                </div>
              </article>
            );
          })}
        </section>

        <section className="nv-steps" aria-label="Как начать">
          <article className="nv-step surface-card">
            <span className="nv-step-index">01</span>
            <h3>Выбери платформу</h3>
            <p>На отдельной странице сразу видно, что умеет версия и есть ли готовая сборка.</p>
          </article>
          <article className="nv-step surface-card">
            <span className="nv-step-index">02</span>
            <h3>Скачай релиз</h3>
            <p>Кнопка берёт реальный артефакт из manifest, а не захардкоженную ссылку.</p>
          </article>
          <article className="nv-step surface-card">
            <span className="nv-step-index">03</span>
            <h3>Войди и проверь</h3>
            <p>После входа история и серверные проверки работают в общем контуре NeuralV.</p>
          </article>
        </section>

        <section className="nv-cta surface-card">
          <div className="nv-eyebrow">Быстрые переходы</div>
          <h3>Нужна конкретная версия?</h3>
          <p>Открой платформу и скачай сборку без чтения лишней документации.</p>
          <div className="nv-platform-links">
            <Link to="/android"><md-outlined-button>Android</md-outlined-button></Link>
            <Link to="/windows"><md-outlined-button>Windows</md-outlined-button></Link>
            <Link to="/linux"><md-outlined-button>Linux</md-outlined-button></Link>
            <a href="/basedata/api/releases/manifest" target="_blank" rel="noreferrer">
              <md-outlined-button>Manifest JSON</md-outlined-button>
            </a>
          </div>
        </section>
      </div>
    </>
  );
}
