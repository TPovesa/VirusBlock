import { useMemo } from 'react';
import { usePackageRegistry } from '../hooks/usePackageRegistry';

const linuxInstallCommand = 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh';
const windowsInstallCommand = 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://sosiskibot.ru/neuralv/install/nv.ps1 | iex"';

export function NVPage() {
  const { catalog, loading, error } = usePackageRegistry();
  const packages = catalog.packages;

  const neuralvPackage = useMemo(
    () => packages.find((item) => item.name === 'neuralv'),
    [packages]
  );

  const nvPackage = useMemo(
    () => packages.find((item) => item.name === 'nv'),
    [packages]
  );

  return (
    <div className="page-stack">
      <section className="hero-card">
        <div className="hero-copy hero-copy-wide">
          <h1>NV</h1>
          <p>Пакетный менеджер NeuralV. Установка, обновление и выдача версий теперь идут через серверный registry, без списка пакетов в коде клиента.</p>
          <div className="hero-actions">
            <a className="nv-button" href="#nv-install">Установить NV</a>
            <a className="nv-button tonal" href="#nv-packages">Пакеты</a>
          </div>
        </div>
      </section>

      <section id="nv-install" className="section-block">
        <div className="install-layout install-layout-static">
          <article className="content-card install-card">
            <div className="install-card-head simple-head">
              <div>
                <h3>Установка NV</h3>
              </div>
            </div>
            <div className="card-actions card-actions-stacked">
              <a className="nv-button" href="/neuralv/install/nv.sh">Скачать nv.sh</a>
              <a className="nv-button tonal" href="/neuralv/install/nv.ps1">Скачать nv.ps1</a>
            </div>
          </article>

          <article className="content-card install-card">
            <div className="install-card-head simple-head">
              <div>
                <h3>Команды</h3>
              </div>
            </div>
            <div className="command-shell light-shell">
              <pre>{`# Linux\n${linuxInstallCommand}\n\n# Windows\n${windowsInstallCommand}\n\n# Установить NeuralV\nnv install neuralv@latest\n\n# Обновить NV\nnv install nv@latest\n\n# Удалить пакет\nnv uninstall neuralv`}</pre>
            </div>
          </article>
        </div>
      </section>

      <section id="nv-packages" className="section-block">
        <div className="section-head section-head-tight">
          <h2>Пакеты</h2>
        </div>
        <div className="card-grid two-up">
          {loading && (
            <article className="content-card">
              <h3>Загружаем registry</h3>
            </article>
          )}

          {!loading && error && (
            <article className="content-card">
              <h3>Registry недоступен</h3>
              <p>{error}</p>
            </article>
          )}

          {!loading && !error && packages.map((pkg) => (
            <article key={pkg.name} className="content-card platform-card">
              <div className="platform-card-head">
                <div>
                  <h3>{pkg.title}</h3>
                </div>
              </div>
              <div className="platform-meta">{pkg.latest_version || 'pending'}</div>
              <p>{pkg.description}</p>
              <div className="chooser-section">
                {pkg.variants.map((variant) => (
                  <div key={`${pkg.name}-${variant.id}`} className="shot-card">
                    <strong>{variant.label}</strong>
                    <div className="platform-meta">{variant.os} · {variant.version || 'pending'}</div>
                    {variant.install_command ? (
                      <div className="command-shell light-shell" style={{ marginTop: 12 }}>
                        <pre>{variant.install_command}</pre>
                      </div>
                    ) : null}
                    {variant.download_url ? (
                      <div className="card-actions" style={{ marginTop: 12 }}>
                        <a className="nv-button tonal" href={variant.download_url}>Скачать</a>
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <article className="content-card">
          <div className="section-head section-head-tight">
            <h2>Быстрые команды</h2>
          </div>
          <div className="command-shell">
            <pre>{`# Показать версию NV\nnv version\n\n# Установить или обновить пакет\nnv install neuralv@latest\n\n# Поставить конкретную версию\nnv install neuralv@1.3.1\n\n# Удалить пакет\nnv uninstall neuralv`}</pre>
          </div>
          {nvPackage || neuralvPackage ? (
            <p className="install-hint">
              Registry уже отдаёт живые пакеты и версии с сервера. Новые пакеты добавляются на сервер и сразу становятся видны клиенту и сайту.
            </p>
          ) : null}
        </article>
      </section>
    </div>
  );
}
