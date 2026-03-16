import { useMemo, useState } from 'react';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact } from '../lib/manifest';
import { getPackage, getPackageVariant } from '../lib/packages';
import { usePackageRegistry } from '../hooks/usePackageRegistry';

type WindowsInstallMode = 'setup' | 'portable' | 'powershell' | 'cmd';

type WindowsMetadata = {
  setupUrl?: string;
  portableUrl?: string;
  setupDownloadLabel?: string;
  wingetPackageId?: string;
  wingetInstallCommand?: string;
  wingetUpgradeCommand?: string;
  wingetUninstallCommand?: string;
  directDownloadLabel?: string;
  powershellInstallCommand?: string;
  cmdInstallCommand?: string;
};

function getWindowsMetadata(value: unknown): WindowsMetadata | undefined {
  return value && typeof value === 'object' ? (value as WindowsMetadata) : undefined;
}

function getWindowsInstallContent(mode: WindowsInstallMode, options: {
  setupUrl?: string;
  portableUrl?: string;
  metadata?: WindowsMetadata;
}) {
  const powershellCommand =
    options.metadata?.powershellInstallCommand ||
    'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://sosiskibot.ru/neuralv/install/neuralv.ps1 | iex"';
  const cmdCommand =
    options.metadata?.cmdInstallCommand ||
    'curl.exe -fsSL https://sosiskibot.ru/neuralv/install/neuralv.cmd -o "%TEMP%\\neuralv-install.cmd" && cmd /c "%TEMP%\\neuralv-install.cmd"';

  switch (mode) {
    case 'setup':
      return {
        title: 'Setup',
        buttonLabel: options.metadata?.setupDownloadLabel || 'Скачать setup',
        downloadUrl: options.setupUrl,
        command: ''
      };
    case 'portable':
      return {
        title: 'Portable',
        buttonLabel: options.metadata?.directDownloadLabel || 'Скачать portable',
        downloadUrl: options.portableUrl,
        command: ''
      };
    case 'powershell':
      return {
        title: 'PowerShell',
        buttonLabel: '',
        downloadUrl: undefined,
        command: powershellCommand
      };
    default:
      return {
        title: 'CMD',
        buttonLabel: '',
        downloadUrl: undefined,
        command: cmdCommand
      };
  }
}

export function WindowsPage() {
  const manifestState = useReleaseManifest('windows');
  const { catalog } = usePackageRegistry();
  const neuralvPackage = useMemo(() => getPackage(catalog, 'neuralv'), [catalog]);
  const packageVariant = useMemo(() => getPackageVariant(neuralvPackage, 'windows-gui'), [neuralvPackage]);
  const manifestArtifact = useMemo(() => getArtifact(manifestState.manifest, 'windows'), [manifestState.manifest]);
  const metadata = useMemo(
    () => getWindowsMetadata(manifestArtifact?.metadata ?? packageVariant?.metadata),
    [manifestArtifact?.metadata, packageVariant?.metadata]
  );

  const version = manifestState.manifest.version || manifestArtifact?.version || packageVariant?.version || '';
  const portableUrl =
    manifestState.manifest.portableUrl ||
    metadata?.portableUrl ||
    manifestArtifact?.downloadUrl ||
    packageVariant?.download_url;
  const setupUrl = manifestState.manifest.setupUrl || metadata?.setupUrl || portableUrl;
  const ready = Boolean(portableUrl || setupUrl);
  const [mode, setMode] = useState<WindowsInstallMode>('setup');
  const [copyState, setCopyState] = useState<'idle' | 'done'>('idle');
  const active = getWindowsInstallContent(mode, { setupUrl, portableUrl, metadata });

  const handleCopy = async () => {
    if (!active.command || typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(active.command);
      setCopyState('done');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('idle');
    }
  };

  return (
    <div className="page-stack">
      <section className="hero-card platform-hero">
        <div className="hero-copy">
          <h1>NeuralV для Windows.</h1>
          <p>Ставь графический клиент так, как тебе удобнее: setup, portable или одной командой из терминала.</p>
          <div className="hero-actions">
            <a className="nv-button" href="#windows-install">
              Установка
            </a>
            {ready ? (
              <a className="nv-button tonal" href={portableUrl || setupUrl} target="_blank" rel="noreferrer">
                Скачать
              </a>
            ) : (
              <button className="nv-button tonal is-disabled" type="button" disabled>
                Сборка скоро
              </button>
            )}
          </div>
        </div>

        <div className="hero-panel compact-panel">
          <article className="mini-stat">
            <strong>{version || 'pending'}</strong>
            <span className="hero-support-text">
              {manifestArtifact?.fileName || packageVariant?.file_name || 'Windows GUI build'}
            </span>
          </article>
        </div>
      </section>

      <section id="windows-install" className="section-block">
        <article className="content-card install-card install-card-wide install-card-unified">
          <div className="install-card-head">
            <div>
              <h3>Установка</h3>
            </div>
            <div className="install-card-head-actions">
              <span className="status-chip">{version || 'pending'}</span>
            </div>
          </div>

          <div className="segmented-row install-mode-row">
            {(['setup', 'portable', 'powershell', 'cmd'] as WindowsInstallMode[]).map((item) => (
              <button
                key={item}
                type="button"
                className={`segment${mode === item ? ' is-active' : ''}`}
                onClick={() => setMode(item)}
              >
                {item === 'powershell' ? 'PowerShell' : item === 'cmd' ? 'CMD' : item[0].toUpperCase() + item.slice(1)}
              </button>
            ))}
          </div>

          <div className="install-mode-body">
            <div className="install-card-head compact-head">
              <div>
                <h3>{active.title}</h3>
              </div>
              <div className="install-card-head-actions">
                {(mode === 'setup' || mode === 'portable') && active.downloadUrl ? (
                  <a className="nv-button" href={active.downloadUrl} target="_blank" rel="noreferrer">
                    {active.buttonLabel}
                  </a>
                ) : (mode === 'setup' || mode === 'portable') ? (
                  <button className="nv-button is-disabled" type="button" disabled>
                    {active.buttonLabel}
                  </button>
                ) : (
                  <button className="copy-button" type="button" onClick={handleCopy}>
                    {copyState === 'done' ? 'Скопировано' : 'Скопировать'}
                  </button>
                )}
              </div>
            </div>

            {mode === 'powershell' || mode === 'cmd' ? (
              <div className="command-shell light-shell">
                <pre>{active.command}</pre>
              </div>
            ) : null}
          </div>
        </article>
      </section>
    </div>
  );
}
