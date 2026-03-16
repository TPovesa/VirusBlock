import { useEffect, useMemo, useState } from 'react';
import { getArtifact, isArtifactReady, ReleaseArtifact } from '../lib/manifest';
import { useReleaseManifest } from '../hooks/useReleaseManifest';

type InstallMode = 'gui' | 'cli';
type DistroKey = 'ubuntu' | 'fedora' | 'arch' | 'generic';

type DistroOption = {
  key: DistroKey;
  label: string;
  title: string;
};

type PackageMetadata = {
  downloadUrl?: string;
  url?: string;
  packageType?: string;
  format?: string;
  repoCommands?: string[];
  installCommands?: string[];
};

type ArtifactMetadataShape = {
  packages?: Partial<Record<DistroKey, PackageMetadata>>;
};

type InstallVariant = {
  title: string;
  commandText: string;
  downloadUrl?: string;
  buttonLabel?: string;
};

const NV_INSTALL_URL = 'https://sosiskibot.ru/neuralv/install/nv.sh';
const REPO_ROOT = 'https://sosiskibot.ru/neuralv/repo';

const distroOptions: DistroOption[] = [
  { key: 'ubuntu', label: 'Ubuntu / Debian', title: 'Ubuntu, Debian, Pop!_OS, Mint' },
  { key: 'fedora', label: 'Fedora / RHEL', title: 'Fedora, Nobara, RHEL-совместимые' },
  { key: 'arch', label: 'Arch / Manjaro', title: 'Arch, EndeavourOS, Manjaro' },
  { key: 'generic', label: 'Другой Linux', title: 'Любой совместимый x64 Linux' }
];

const compactSegmentsStyle: React.CSSProperties = {
  display: 'flex',
  gap: '0.6rem',
  flexWrap: 'wrap',
  alignItems: 'center',
  padding: 0,
  background: 'transparent',
  boxShadow: 'none'
};

const compactSegmentStyle: React.CSSProperties = {
  flex: '0 0 auto',
  width: 'auto',
  minWidth: 'unset'
};

function getMetadata(artifact?: ReleaseArtifact): ArtifactMetadataShape | undefined {
  return artifact?.metadata && typeof artifact.metadata === 'object'
    ? (artifact.metadata as ArtifactMetadataShape)
    : undefined;
}

function getGuiPackage(distro: DistroKey, artifact?: ReleaseArtifact): PackageMetadata | undefined {
  return getMetadata(artifact)?.packages?.[distro];
}

function getPackageDownloadUrl(packageMeta?: PackageMetadata, artifact?: ReleaseArtifact) {
  return packageMeta?.downloadUrl ?? packageMeta?.url ?? artifact?.downloadUrl;
}

function buildUbuntuCommands(packageUrl?: string) {
  return [
    '# 1) Подключи репозиторий NeuralV',
    `curl -fsSL ${REPO_ROOT}/debian/neuralv.gpg | sudo gpg --dearmor -o /usr/share/keyrings/neuralv-archive-keyring.gpg`,
    `echo "deb [signed-by=/usr/share/keyrings/neuralv-archive-keyring.gpg] ${REPO_ROOT}/debian stable main" | sudo tee /etc/apt/sources.list.d/neuralv.list >/dev/null`,
    'sudo apt update',
    '',
    '# 2) Установи GUI',
    'sudo apt install neuralv',
    '',
    '# 3) Локальный пакет',
    `# ${packageUrl ?? '<deb-url>'}`
  ].join('\n');
}

function buildFedoraCommands(packageUrl?: string) {
  return [
    '# 1) Подключи репозиторий NeuralV',
    `sudo rpm --import ${REPO_ROOT}/rpm/RPM-GPG-KEY-neuralv`,
    'sudo tee /etc/yum.repos.d/neuralv.repo >/dev/null <<\'EOF\'',
    '[neuralv]',
    'name=NeuralV',
    `baseurl=${REPO_ROOT}/rpm`,
    'enabled=1',
    'gpgcheck=1',
    `gpgkey=${REPO_ROOT}/rpm/RPM-GPG-KEY-neuralv`,
    'EOF',
    '',
    '# 2) Установи GUI',
    'sudo dnf install neuralv',
    '',
    '# 3) Локальный пакет',
    `# ${packageUrl ?? '<rpm-url>'}`
  ].join('\n');
}

function buildArchCommands(packageUrl?: string) {
  return [
    '# 1) Подключи репозиторий NeuralV',
    'sudo install -d /etc/pacman.d',
    `echo "[neuralv]\nServer = ${REPO_ROOT}/arch/$arch" | sudo tee /etc/pacman.d/neuralv-mirrorlist >/dev/null`,
    'if ! grep -q "^\[neuralv\]" /etc/pacman.conf; then',
    '  printf "\n[neuralv]\nInclude = /etc/pacman.d/neuralv-mirrorlist\n" | sudo tee -a /etc/pacman.conf >/dev/null',
    'fi',
    'sudo pacman -Sy',
    '',
    '# 2) Установи GUI',
    'sudo pacman -S neuralv',
    '',
    '# 3) Portable-файл',
    `# ${packageUrl ?? '<appimage-url>'}`
  ].join('\n');
}

function buildGenericCommands(packageUrl?: string) {
  return [
    '# 1) Скачай GUI',
    `curl -L "${packageUrl ?? '<gui-url>'}" -o NeuralV.AppImage`,
    '',
    '# 2) Дай права на запуск',
    'chmod +x NeuralV.AppImage',
    '',
    '# 3) Запусти GUI',
    './NeuralV.AppImage'
  ].join('\n');
}

function buildGuiVariant(distro: DistroOption, artifact?: ReleaseArtifact): InstallVariant {
  const packageMeta = getGuiPackage(distro.key, artifact);
  const downloadUrl = getPackageDownloadUrl(packageMeta, artifact);
  const packageType = String(packageMeta?.packageType ?? packageMeta?.format ?? '').toLowerCase();
  const repoCommands = Array.isArray(packageMeta?.repoCommands)
    ? packageMeta.repoCommands.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const installCommands = Array.isArray(packageMeta?.installCommands)
    ? packageMeta.installCommands.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];

  let commandText = '';
  if (repoCommands.length > 0 || installCommands.length > 0) {
    commandText = [
      '# 1) Подключи репозиторий NeuralV',
      ...repoCommands,
      '',
      '# 2) Установи GUI',
      ...installCommands
    ].join('\n');
  } else {
    switch (distro.key) {
      case 'ubuntu':
        commandText = buildUbuntuCommands(downloadUrl);
        break;
      case 'fedora':
        commandText = buildFedoraCommands(downloadUrl);
        break;
      case 'arch':
        commandText = buildArchCommands(downloadUrl);
        break;
      default:
        commandText = buildGenericCommands(downloadUrl);
        break;
    }
  }

  const buttonLabel = distro.key === 'ubuntu'
    ? 'Скачать .deb'
    : distro.key === 'fedora'
      ? 'Скачать .rpm'
      : distro.key === 'arch'
        ? (packageType.includes('pkg') ? 'Скачать пакет' : 'Скачать AppImage')
        : 'Скачать GUI';

  return {
    title: 'GUI',
    commandText,
    downloadUrl,
    buttonLabel
  };
}

function buildCliVariant(): InstallVariant {
  return {
    title: 'CLI',
    commandText: [
      '# 1) Установи nv',
      `curl -fsSL ${NV_INSTALL_URL} | sh`,
      '',
      '# 2) Поставь NeuralV CLI',
      'nv install neuralv@latest',
      '',
      '# 3) Запусти клиент',
      'neuralv'
    ].join('\n')
  };
}

export function LinuxPage() {
  const manifestState = useReleaseManifest();
  const guiArtifact = getArtifact(manifestState.manifest, 'linux');
  const guiReady = isArtifactReady(guiArtifact);

  const [installMode, setInstallMode] = useState<InstallMode>(() => (guiReady ? 'gui' : 'cli'));
  const [distro, setDistro] = useState<DistroKey>('ubuntu');
  const [copyState, setCopyState] = useState<'idle' | 'done'>('idle');

  useEffect(() => {
    if (installMode === 'gui' && !guiReady) {
      setInstallMode('cli');
    }
  }, [guiReady, installMode]);

  const selectedDistro = distroOptions.find((item) => item.key === distro) ?? distroOptions[0];
  const guiVariant = useMemo(() => buildGuiVariant(selectedDistro, guiArtifact), [guiArtifact, selectedDistro]);
  const cliVariant = useMemo(() => buildCliVariant(), []);
  const activeVariant = installMode === 'gui' ? guiVariant : cliVariant;

  const handleCopy = async () => {
    if (typeof navigator === 'undefined' || !navigator.clipboard) {
      return;
    }

    try {
      await navigator.clipboard.writeText(activeVariant.commandText);
      setCopyState('done');
      window.setTimeout(() => setCopyState('idle'), 1600);
    } catch {
      setCopyState('idle');
    }
  };

  return (
    <div className="page-stack">
      <section className="hero-card platform-hero linux-hero">
        <div className="hero-copy">
          <h1>NeuralV для Linux</h1>
          <div className="hero-actions">
            <a className="nv-button" href="#linux-install">Установка</a>
            {guiReady && guiArtifact?.downloadUrl ? (
              <a className="nv-button tonal" href={guiArtifact.downloadUrl} target="_blank" rel="noreferrer">Скачать GUI</a>
            ) : (
              <button className="nv-button tonal is-disabled" type="button" disabled>GUI скоро</button>
            )}
          </div>
        </div>
      </section>

      <section id="linux-install" className="section-block">
        <div className="section-head section-head-tight">
          <h2>Установка</h2>
        </div>

        <div className="install-layout">
          <aside className="content-card chooser-card">
            <div className="chooser-section">
              <div className="segmented-row" style={compactSegmentsStyle}>
                <button
                  type="button"
                  className={`segment${installMode === 'gui' ? ' is-active' : ''}`}
                  style={compactSegmentStyle}
                  onClick={() => setInstallMode('gui')}
                  disabled={!guiReady}
                >
                  GUI
                </button>
                <button
                  type="button"
                  className={`segment${installMode === 'cli' ? ' is-active' : ''}`}
                  style={compactSegmentStyle}
                  onClick={() => setInstallMode('cli')}
                >
                  CLI
                </button>
              </div>
            </div>

            {installMode === 'gui' ? (
              <div className="chooser-section">
                <span className="chooser-label">Дистрибутив</span>
                <div className="distro-grid">
                  {distroOptions.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      className={`distro-pill${distro === option.key ? ' is-active' : ''}`}
                      onClick={() => setDistro(option.key)}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </aside>

          <div className="content-card install-card">
            <div className="install-card-head">
              <div>
                <h3>{activeVariant.title}</h3>
              </div>
              <div className="install-card-head-actions">
                {installMode === 'gui' ? (
                  activeVariant.downloadUrl ? (
                    <a className="nv-button tonal" href={activeVariant.downloadUrl} target="_blank" rel="noreferrer">{activeVariant.buttonLabel}</a>
                  ) : (
                    <button className="nv-button tonal is-disabled" type="button" disabled>Пакет скоро</button>
                  )
                ) : null}
                <button className="copy-button" type="button" onClick={handleCopy}>
                  {copyState === 'done' ? 'Скопировано' : 'Скопировать'}
                </button>
              </div>
            </div>

            <div className="command-shell">
              <pre>{activeVariant.commandText}</pre>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
