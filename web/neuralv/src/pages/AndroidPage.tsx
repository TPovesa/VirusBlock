import { ManifestBanner } from '../components/ManifestBanner';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact } from '../lib/manifest';

const androidPageStyles = `
  .nv-android {
    display: grid;
    gap: 20px;
  }

  .nv-android-hero,
  .nv-android-grid,
  .nv-android-steps {
    display: grid;
    gap: 18px;
  }

  .nv-android-hero {
    padding: clamp(24px, 4vw, 38px);
    grid-template-columns: minmax(0, 1.15fr) minmax(280px, 0.85fr);
    background:
      radial-gradient(circle at 0 0, rgba(93, 103, 247, 0.14), transparent 24%),
      radial-gradient(circle at 100% 0, rgba(0, 165, 154, 0.12), transparent 22%),
      linear-gradient(180deg, var(--nv-surface-strong), var(--nv-surface));
  }

  .nv-android-copy,
  .nv-android-side,
  .nv-android-card,
  .nv-android-step {
    display: grid;
    gap: 12px;
  }

  .nv-android-copy h1,
  .nv-android-card h3,
  .nv-android-step h3 {
    margin: 0;
    letter-spacing: -0.04em;
  }

  .nv-android-copy h1 {
    font-size: clamp(2.5rem, 6vw, 4.8rem);
    line-height: 0.92;
    max-width: 10ch;
  }

  .nv-android-copy p,
  .nv-android-card p,
  .nv-android-step p,
  .nv-android-side p {
    margin: 0;
    color: var(--nv-text-soft);
    line-height: 1.65;
  }

  .nv-android-actions,
  .nv-android-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .nv-android-chip,
  .nv-android-pill {
    padding: 10px 14px;
    border-radius: 999px;
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface-muted);
    color: var(--nv-text-soft);
    font-size: 0.92rem;
  }

  .nv-android-pill strong {
    color: var(--nv-text);
    font-size: 1rem;
  }

  .nv-android-grid,
  .nv-android-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nv-android-card,
  .nv-android-step {
    padding: 24px;
    border-radius: var(--nv-radius-xl);
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface);
  }

  .nv-android-list {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
    color: var(--nv-text-soft);
    line-height: 1.55;
  }

  .nv-android-step-index,
  .nv-android-eyebrow {
    color: var(--nv-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.74rem;
  }

  @media (max-width: 980px) {
    .nv-android-hero,
    .nv-android-grid,
    .nv-android-steps {
      grid-template-columns: 1fr;
    }
  }
`;

export function AndroidPage() {
  const manifestState = useReleaseManifest();
  const artifact = getArtifact(manifestState.manifest, 'android');

  return (
    <>
      <style>{androidPageStyles}</style>
      <div className="nv-android">
        <ManifestBanner {...manifestState} />

        <section className="surface-card nv-android-hero">
          <div className="nv-android-copy">
            <div className="nv-android-eyebrow">Android</div>
            <h1>NeuralV для Android.</h1>
            <p>
              Быстрая локальная проверка, фоновая защита и серверная перепроверка там, где на телефоне уже не стоит тратить батарею и время.
            </p>
            <div className="nv-android-chip-row">
              <span className="nv-android-chip">Гостевой режим</span>
              <span className="nv-android-chip">Фоновая защита</span>
              <span className="nv-android-chip">Серверные проверки</span>
            </div>
            <div className="nv-android-actions">
              {artifact?.downloadUrl ? (
                <a href={artifact.downloadUrl} target="_blank" rel="noreferrer">
                  <md-filled-button>Скачать APK</md-filled-button>
                </a>
              ) : (
                <md-outlined-button disabled>APK готовится</md-outlined-button>
              )}
              <a href="#android-install">
                <md-filled-tonal-button>Как установить</md-filled-tonal-button>
              </a>
            </div>
          </div>

          <div className="nv-android-side">
            <div className="nv-android-pill">
              <span className="nv-android-eyebrow">Версия</span>
              <strong>{artifact?.version ?? 'pending'}</strong>
            </div>
            <div className="nv-android-pill">
              <span className="nv-android-eyebrow">Файл</span>
              <strong>{artifact?.fileName ?? 'NeuralV-android.apk'}</strong>
            </div>
            <div className="nv-android-pill">
              <span className="nv-android-eyebrow">Что важно</span>
              <p>Обычный пользователь видит только итог, а тяжёлый анализ остаётся на сервере.</p>
            </div>
          </div>
        </section>

        <section className="nv-android-grid">
          <article className="nv-android-card surface-card">
            <div className="nv-android-eyebrow">На устройстве</div>
            <h3>Что проверяется локально</h3>
            <ul className="nv-android-list">
              <li>Установленные приложения и новые установки.</li>
              <li>Источник установки, базовые разрешения и быстрые сигналы.</li>
              <li>Фоновый контроль без тяжёлого серверного прохода на каждый шаг.</li>
            </ul>
          </article>

          <article className="nv-android-card surface-card">
            <div className="nv-android-eyebrow">На сервере</div>
            <h3>Что уходит на перепроверку</h3>
            <ul className="nv-android-list">
              <li>Глубокая, выборочная и APK-проверка.</li>
              <li>Спорные случаи, где локального сигнала мало.</li>
              <li>Финальный фильтр перед показом результата пользователю.</li>
            </ul>
          </article>
        </section>

        <section id="android-install" className="nv-android-steps">
          <article className="nv-android-step surface-card">
            <div className="nv-android-step-index">01</div>
            <h3>Скачать APK</h3>
            <p>Кнопка выше ведёт на актуальный артефакт из release manifest.</p>
          </article>
          <article className="nv-android-step surface-card">
            <div className="nv-android-step-index">02</div>
            <h3>Разрешить установку</h3>
            <p>Если Android попросит, разреши установку APK из браузера или файлового менеджера.</p>
          </article>
          <article className="nv-android-step surface-card">
            <div className="nv-android-step-index">03</div>
            <h3>Запустить и выбрать режим</h3>
            <p>Можно остаться в гостевом режиме или войти в аккаунт для серверных проверок и истории.</p>
          </article>
          <article className="nv-android-step surface-card">
            <div className="nv-android-step-index">04</div>
            <h3>Оставить защиту включённой</h3>
            <p>После первой настройки приложение само ловит новые установки и обновления.</p>
          </article>
        </section>
      </div>
    </>
  );
}
