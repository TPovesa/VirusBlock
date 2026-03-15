import { ManifestBanner } from '../components/ManifestBanner';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact } from '../lib/manifest';

const bootstrapCommand = 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh';

const linuxPageStyles = `
  .nv-linux {
    display: grid;
    gap: 20px;
  }

  .nv-linux-hero,
  .nv-linux-grid,
  .nv-linux-commands,
  .nv-linux-steps {
    display: grid;
    gap: 18px;
  }

  .nv-linux-hero {
    padding: clamp(24px, 4vw, 38px);
    grid-template-columns: minmax(0, 1.1fr) minmax(300px, 0.9fr);
    background:
      radial-gradient(circle at 0 0, rgba(255, 196, 92, 0.16), transparent 24%),
      radial-gradient(circle at 100% 0, rgba(90, 195, 176, 0.12), transparent 22%),
      linear-gradient(180deg, var(--nv-surface-strong), var(--nv-surface));
  }

  .nv-linux-copy,
  .nv-linux-side,
  .nv-linux-card,
  .nv-linux-command,
  .nv-linux-step {
    display: grid;
    gap: 12px;
  }

  .nv-linux-copy h1,
  .nv-linux-card h3,
  .nv-linux-command h3,
  .nv-linux-step h3 {
    margin: 0;
    letter-spacing: -0.04em;
  }

  .nv-linux-copy h1 {
    font-size: clamp(2.5rem, 6vw, 4.8rem);
    line-height: 0.92;
    max-width: 11ch;
  }

  .nv-linux-copy p,
  .nv-linux-card p,
  .nv-linux-command p,
  .nv-linux-step p,
  .nv-linux-side p {
    margin: 0;
    color: var(--nv-text-soft);
    line-height: 1.65;
  }

  .nv-linux-actions,
  .nv-linux-chip-row {
    display: flex;
    flex-wrap: wrap;
    gap: 12px;
  }

  .nv-linux-chip,
  .nv-linux-pill {
    padding: 10px 14px;
    border-radius: 999px;
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface-muted);
    color: var(--nv-text-soft);
    font-size: 0.92rem;
  }

  .nv-linux-pill strong {
    color: var(--nv-text);
    font-size: 1rem;
  }

  .nv-linux-grid,
  .nv-linux-commands,
  .nv-linux-steps {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }

  .nv-linux-card,
  .nv-linux-command,
  .nv-linux-step {
    padding: 24px;
    border-radius: var(--nv-radius-xl);
    border: 1px solid var(--nv-stroke);
    background: var(--nv-surface);
  }

  .nv-linux-command code {
    display: block;
    padding: 16px 18px;
    border-radius: 20px;
    background: rgba(6, 12, 24, 0.92);
    color: #eef4ff;
    font-family: 'JetBrains Mono', monospace;
    font-size: 0.92rem;
    line-height: 1.6;
    word-break: break-word;
    white-space: pre-wrap;
  }

  .nv-linux-list {
    margin: 0;
    padding-left: 18px;
    display: grid;
    gap: 8px;
    color: var(--nv-text-soft);
    line-height: 1.55;
  }

  .nv-linux-index,
  .nv-linux-eyebrow {
    color: var(--nv-text-faint);
    text-transform: uppercase;
    letter-spacing: 0.16em;
    font-size: 0.74rem;
  }

  .nv-linux-command.wide {
    grid-column: span 2;
  }

  @media (max-width: 980px) {
    .nv-linux-hero,
    .nv-linux-grid,
    .nv-linux-commands,
    .nv-linux-steps {
      grid-template-columns: 1fr;
    }

    .nv-linux-command.wide {
      grid-column: auto;
    }
  }
`;

export function LinuxPage() {
  const manifestState = useReleaseManifest();
  const guiArtifact = getArtifact(manifestState.manifest, 'linux');
  const shellArtifact = getArtifact(manifestState.manifest, 'shell');
  const nvArtifact = getArtifact(manifestState.manifest, 'nv');

  return (
    <>
      <style>{linuxPageStyles}</style>
      <div className="nv-linux">
        <ManifestBanner {...manifestState} />

        <section className="surface-card nv-linux-hero">
          <div className="nv-linux-copy">
            <div className="nv-linux-eyebrow">Linux</div>
            <h1>GUI, shell и daemon через один nv flow.</h1>
            <p>
              На Linux мы больше не ведём пользователя в старый bootstrap. Сначала ставится маленький `nv`, потом он подтягивает NeuralV нужной версии.
            </p>
            <div className="nv-linux-chip-row">
              <span className="nv-linux-chip">Compose Desktop GUI</span>
              <span className="nv-linux-chip">Shell/TUI</span>
              <span className="nv-linux-chip">neuralvd daemon</span>
            </div>
            <div className="nv-linux-actions">
              <a href="#linux-install">
                <md-filled-button>Установить через nv</md-filled-button>
              </a>
              {guiArtifact?.downloadUrl ? (
                <a href={guiArtifact.downloadUrl} target="_blank" rel="noreferrer">
                  <md-filled-tonal-button>Скачать Linux GUI</md-filled-tonal-button>
                </a>
              ) : (
                <md-outlined-button disabled>GUI готовится</md-outlined-button>
              )}
            </div>
          </div>

          <div className="nv-linux-side">
            <div className="nv-linux-pill">
              <div className="nv-linux-eyebrow">nv</div>
              <strong>{nvArtifact?.version ?? shellArtifact?.version ?? 'pending'}</strong>
            </div>
            <div className="nv-linux-pill">
              <div className="nv-linux-eyebrow">NeuralV</div>
              <strong>{guiArtifact?.version ?? shellArtifact?.version ?? 'pending'}</strong>
            </div>
            <div className="nv-linux-pill">
              <div className="nv-linux-eyebrow">Подходит для</div>
              <p>Рабочей станции, терминала по SSH и узла, где нужен daemon с systemd.</p>
            </div>
          </div>
        </section>

        <section className="nv-linux-grid">
          <article className="nv-linux-card surface-card">
            <div className="nv-linux-eyebrow">GUI</div>
            <h3>Для рабочего стола</h3>
            <ul className="nv-linux-list">
              <li>Обычный визуальный клиент для workstation.</li>
              <li>История, статусы и вход тем же аккаунтом.</li>
              <li>Хорошо подходит, если не хочется жить только в терминале.</li>
            </ul>
          </article>

          <article className="nv-linux-card surface-card">
            <div className="nv-linux-eyebrow">Shell</div>
            <h3>Для терминала</h3>
            <ul className="nv-linux-list">
              <li>Полноэкранный TUI для SSH и headless-сценариев.</li>
              <li>Быстрый старт без тяжёлой GUI-сборки.</li>
              <li>Тот же backend и тот же аккаунт, что у GUI.</li>
            </ul>
          </article>

          <article className="nv-linux-card surface-card">
            <div className="nv-linux-eyebrow">Daemon</div>
            <h3>Для фоновой защиты</h3>
            <ul className="nv-linux-list">
              <li>Отдельный `neuralvd`, если нужен постоянный мониторинг.</li>
              <li>Ставится отдельно и живёт как systemd service.</li>
              <li>Не навязывается там, где нужен только on-demand скан.</li>
            </ul>
          </article>
        </section>

        <section id="linux-install" className="nv-linux-commands">
          <article className="nv-linux-command wide surface-card">
            <div className="nv-linux-eyebrow">Шаг 1</div>
            <h3>Поставить nv</h3>
            <p>Этот bootstrap ставит только менеджер `nv`. Он потом уже скачивает нужную версию NeuralV.</p>
            <code>{bootstrapCommand}</code>
          </article>

          <article className="nv-linux-command surface-card">
            <div className="nv-linux-eyebrow">Шаг 2</div>
            <h3>Поставить NeuralV</h3>
            <code>nv install neuralv@latest</code>
          </article>

          <article className="nv-linux-command surface-card">
            <div className="nv-linux-eyebrow">Шаг 3</div>
            <h3>Проверить версии</h3>
            <code>nv -v\nneuralv -v</code>
          </article>

          <article className="nv-linux-command surface-card">
            <div className="nv-linux-eyebrow">Версия по номеру</div>
            <h3>Поставить конкретный релиз</h3>
            <code>{`nv install neuralv@${shellArtifact?.version ?? 'VERSION'}`}</code>
          </article>

          <article className="nv-linux-command surface-card">
            <div className="nv-linux-eyebrow">Удаление</div>
            <h3>Снять пакет</h3>
            <code>nv uninstall neuralv</code>
          </article>

          <article className="nv-linux-command surface-card">
            <div className="nv-linux-eyebrow">GUI</div>
            <h3>Скачать архив вручную</h3>
            {guiArtifact?.downloadUrl ? (
              <a href={guiArtifact.downloadUrl} target="_blank" rel="noreferrer">
                <md-filled-tonal-button>Скачать Linux GUI</md-filled-tonal-button>
              </a>
            ) : (
              <md-outlined-button disabled>GUI готовится</md-outlined-button>
            )}
          </article>
        </section>

        <section className="nv-linux-steps">
          <article className="nv-linux-step surface-card">
            <div className="nv-linux-index">01</div>
            <h3>Поставить nv</h3>
            <p>Небольшой менеджер ложится в `~/.local/bin` и дальше работает без длинных shell-скриптов.</p>
          </article>
          <article className="nv-linux-step surface-card">
            <div className="nv-linux-index">02</div>
            <h3>Поставить пакет NeuralV</h3>
            <p>`nv install neuralv@latest` тянет актуальную shell-сборку и daemon-файлы.</p>
          </article>
          <article className="nv-linux-step surface-card">
            <div className="nv-linux-index">03</div>
            <h3>Запустить GUI или shell</h3>
            <p>GUI скачивается отдельно, shell запускается командой `neuralv` после установки пакета.</p>
          </article>
        </section>
      </div>
    </>
  );
}
