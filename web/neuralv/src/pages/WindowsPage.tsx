import { ManifestBanner } from '../components/ManifestBanner';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact } from '../lib/manifest';

const windowsPageStyles = `
  .nv-windows {
    display: grid;
    gap: 20px;
  }

  .nv-windows-hero,
  .nv-windows-grid,
  .nv-windows-steps {
    display: grid;
    gap: 18px;
  }

  .nv-windows-hero {
    padding: clamp(24px, 4vw, 38px);
    grid-template-columns: minmax(0, 1.1fr) minmax(280px, 0.9fr);
    background:
      radial-gradient(circle at 0 0, rgba(96, 188, 255, 0.16), transparent 26%),
      radial-gradient(circle at 100% 0, rgba(27, 140, 132, 0.12), transparent 22%),
      linear-gradient(180deg, var(--nv-surface-strong), var(--nv-surface));
  }

  .nv-windows-copy,
  .nv-windows-side,
  .nv-windows-card,
  .nv-windows-step {
    display: grid;
    gap: 12px;
  }

  .nv-windows-copy h1,
  .nv-windows-card h3,
  .nv-windows-step h3 {
    margin: 0;
    letter-spacing: -0.04em;
  }

  .nv-windows-copy h1 {
    font-size: clamp(2.5rem, 6vw, 4.8rem);
    line-height: 0.92;
    max-width: 10ch;
  }

  .nv-windows-copy p,
  .nv-windows-card p,
  .nv-windows-step p,
  .nv-windows-side p {
    margin: 0;
    color: var(--nv-text-soft);
    line-height: 1.65;
  }

  .nv-windows-actions,
  .nv-windows-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .nv-windows-chip,
  .nv-windows-pill {
    padding: 10px 14px;
    border-radius: 999px;
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface-muted);
    color: var(--nv-text-soft);
    font-size: 0.92rem;
  }

  .nv-windows-pill strong {
    color: var(--nv-text);
    font-size: 1rem;
  }

  .nv-windows-grid {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .nv-windows-steps {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }

  .nv-windows-card,
  .nv-windows-step {
    padding: 24px;
    border-radius: var(--nv-radius-xl);
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface);
  }

  .nv-windows-list {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
    color: var(--nv-text-soft);
    line-height: 1.55;
  }

  .nv-windows-step-index,
  .nv-windows-eyebrow {
    color: var(--nv-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.74rem;
  }

  @media (max-width: 980px) {
    .nv-windows-hero,
    .nv-windows-grid,
    .nv-windows-steps {
      grid-template-columns: 1fr;
    }
  }
`;

export function WindowsPage() {
  const manifestState = useReleaseManifest();
  const artifact = getArtifact(manifestState.manifest, 'windows');

  return (
    <>
      <style>{windowsPageStyles}</style>
      <div className="nv-windows">
        <ManifestBanner {...manifestState} />

        <section className="surface-card nv-windows-hero">
          <div className="nv-windows-copy">
            <div className="nv-windows-eyebrow">Windows</div>
            <h1>NeuralV для Windows.</h1>
            <p>
              GUI-клиент для EXE и DLL, фонового мониторинга и серверной перепроверки без тяжёлого enterprise-интерфейса.
            </p>
            <div className="nv-windows-chip-row">
              <span className="nv-windows-chip">EXE / DLL</span>
              <span className="nv-windows-chip">Resident protection</span>
              <span className="nv-windows-chip">Server triage</span>
            </div>
            <div className="nv-windows-actions">
              {artifact?.downloadUrl ? (
                <a href={artifact.downloadUrl} target="_blank" rel="noreferrer">
                  <md-filled-button>Скачать Windows GUI</md-filled-button>
                </a>
              ) : (
                <md-outlined-button disabled>Сборка GUI готовится</md-outlined-button>
              )}
            </div>
          </div>

          <div className="nv-windows-side">
            <div className="nv-windows-pill">
              <div className="nv-windows-eyebrow">Версия</div>
              <strong>{artifact?.version ?? 'pending'}</strong>
            </div>
            <div className="nv-windows-pill">
              <div className="nv-windows-eyebrow">Файл</div>
              <strong>{artifact?.fileName ?? 'neuralv-windows.zip'}</strong>
            </div>
            <div className="nv-windows-pill">
              <div className="nv-windows-eyebrow">Подходит для</div>
              <p>Обычного ПК, рабочей станции и тестового стенда, где нужен понятный GUI и фоновая защита.</p>
            </div>
          </div>
        </section>

        <section className="nv-windows-grid">
          <article className="nv-windows-card surface-card">
            <div className="nv-windows-eyebrow">Локально</div>
            <h3>Что проверяется сразу</h3>
            <ul className="nv-windows-list">
              <li>EXE и DLL, которые только что появились на диске.</li>
              <li>Подпись, базовый профиль файла и подозрительные признаки упаковки.</li>
              <li>Типичные зоны риска: загрузки, temp и автозапуск.</li>
            </ul>
          </article>

          <article className="nv-windows-card surface-card">
            <div className="nv-windows-eyebrow">В фоне</div>
            <h3>Что делает resident protection</h3>
            <ul className="nv-windows-list">
              <li>Следит за новыми бинарниками и изменениями в риск-зонах.</li>
              <li>Ловит странные autorun и sideload-сценарии.</li>
              <li>Не заставляет пользователя вручную проверять каждый файл.</li>
            </ul>
          </article>

          <article className="nv-windows-card surface-card">
            <div className="nv-windows-eyebrow">На сервере</div>
            <h3>Когда подключается backend</h3>
            <ul className="nv-windows-list">
              <li>Когда локального сигнала мало или он спорный.</li>
              <li>Для hash reputation, правил и более тяжёлого статического анализа.</li>
              <li>Чтобы до пользователя доходил уже отфильтрованный итог.</li>
            </ul>
          </article>
        </section>

        <section className="nv-windows-steps">
          <article className="nv-windows-step surface-card">
            <div className="nv-windows-step-index">01</div>
            <h3>Скачать сборку</h3>
            <p>Кнопка на странице тянет актуальный GUI-артефакт из общего manifest.</p>
          </article>
          <article className="nv-windows-step surface-card">
            <div className="nv-windows-step-index">02</div>
            <h3>Установить и войти</h3>
            <p>Windows-клиент использует тот же аккаунт, что Android и Linux.</p>
          </article>
          <article className="nv-windows-step surface-card">
            <div className="nv-windows-step-index">03</div>
            <h3>Включить фоновую защиту</h3>
            <p>После этого клиент начинает следить за новыми файлами и событиями запуска.</p>
          </article>
          <article className="nv-windows-step surface-card">
            <div className="nv-windows-step-index">04</div>
            <h3>Проверять спорные файлы через сервер</h3>
            <p>Не всё уходит в backend: только то, где от серверной проверки есть смысл.</p>
          </article>
        </section>
      </div>
    </>
  );
}
