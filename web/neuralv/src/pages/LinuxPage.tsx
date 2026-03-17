import { useMemo, useState } from 'react';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact } from '../lib/manifest';
import { getPackage, getPackageVariant, PackageVariant } from '../lib/packages';
import { usePackageRegistry } from '../hooks/usePackageRegistry';

type DirectPackageKey = 'ubuntu' | 'fedora' | 'arch' | 'appimage' | 'tarball';

type DirectPackageMetadata = {
  packageType?: string;
  artifactPath?: string;
  downloadUrl?: string;
  url?: string;
  repoCommands?: string[];
  installCommands?: string[];
  updateCommands?: string[];
};

type LinuxVariantMetadata = {
  directPackages?: Partial<Record<DirectPackageKey, DirectPackageMetadata>>;
  packages?: Partial<Record<DirectPackageKey, DirectPackageMetadata>>;
  source_repo?: string;
  source_branch?: string;
  stableArtifactUrl?: string;
};

type DirectOption = {
  key: DirectPackageKey;
  label: string;
  buttonLabel: string;
};

const linuxBootstrapCommand = 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh';
const linuxInstallCommand = 'nv install @lvls/neuralv';

const directOptions: DirectOption[] = [
  { key: 'ubuntu', label: '.deb / APT', buttonLabel: 'Скачать .deb' },
  { key: 'fedora', label: '.rpm / DNF', buttonLabel: 'Скачать .rpm' },
  { key: 'arch', label: 'Arch repo', buttonLabel: 'Открыть для Arch' },
  { key: 'appimage', label: 'AppImage', buttonLabel: 'Скачать AppImage' },
  { key: 'tarball', label: '.tar.gz', buttonLabel: 'Скачать .tar.gz' }
];

function getVariantMetadata(variant?: PackageVariant): LinuxVariantMetadata | undefined {
  return variant?.metadata && typeof variant.metadata === 'object'
    ? (variant.metadata as LinuxVariantMetadata)
    : undefined;
}

function getDirectPackage(variant: PackageVariant | undefined, key: DirectPackageKey): DirectPackageMetadata | undefined {
  const metadata = getVariantMetadata(variant);
  return metadata?.directPackages?.[key] ?? metadata?.packages?.[key];
}

function buildArtifactUrl(variant: PackageVariant | undefined, relativePath?: string, fallbackUrl?: string): string | undefined {
  if (relativePath) {
    const metadata = getVariantMetadata(variant);
    const repo = String(metadata?.source_repo ?? 'Perdonus/fatalerror').trim();
    const branch = String(metadata?.source_branch ?? 'linux-gui-builds').trim();
    return `https://raw.githubusercontent.com/${repo}/${branch}/${String(relativePath).replace(/^\/+/, '')}`;
  }
  return fallbackUrl || variant?.download_url;
}

function buildCommandText(pkg: DirectPackageMetadata | undefined, fallbackCommand: string): string {
  const repoCommands = Array.isArray(pkg?.repoCommands)
    ? pkg.repoCommands.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  const installCommands = Array.isArray(pkg?.installCommands)
    ? pkg.installCommands.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    : [];
  if (repoCommands.length === 0 && installCommands.length === 0) {
    return fallbackCommand;
  }
  return [...repoCommands, ...(repoCommands.length > 0 && installCommands.length > 0 ? [''] : []), ...installCommands].join('\n');
}

export function LinuxPage() {
  const linuxManifestState = useReleaseManifest('linux');
  const shellManifestState = useReleaseManifest('shell');
  const { catalog } = usePackageRegistry();
  const neuralvPackage = useMemo(() => getPackage(catalog, '@lvls/neuralv'), [catalog]);
  const linuxVariant = useMemo(() => getPackageVariant(neuralvPackage, 'linux'), [neuralvPackage]);
  const linuxArtifact = useMemo(() => getArtifact(linuxManifestState.manifest, 'linux'), [linuxManifestState.manifest]);
  const shellArtifact = useMemo(() => getArtifact(shellManifestState.manifest, 'shell'), [shellManifestState.manifest]);

  const guiVersion =
    linuxArtifact?.version ||
    (linuxManifestState.manifest.platform === 'linux' ? (linuxManifestState.manifest.version || '') : '') ||
    linuxVariant?.version ||
    'pending';
  const cliVersion =
    shellArtifact?.version ||
    (shellManifestState.manifest.platform === 'shell' ? (shellManifestState.manifest.version || '') : '') ||
    'pending';

  const [directKey, setDirectKey] = useState<DirectPackageKey>('ubuntu');
  const selectedOption = directOptions.find((item) => item.key === directKey) ?? directOptions[0];
  const selectedPackage = getDirectPackage(linuxVariant, directKey);
  const directDownloadUrl = buildArtifactUrl(
    linuxVariant,
    selectedPackage?.artifactPath,
    selectedPackage?.downloadUrl || selectedPackage?.url || (directKey === 'tarball' ? linuxArtifact?.downloadUrl : undefined)
  );
  const directCommand = buildCommandText(
    selectedPackage,
    directKey === 'appimage'
      ? 'curl -L "<appimage-url>" -o NeuralV.AppImage\nchmod +x NeuralV.AppImage\n./NeuralV.AppImage'
      : directKey === 'tarball'
        ? 'tar -xzf neuralv-linux.tar.gz\n./NeuralV/bin/NeuralV'
        : 'sudo apt install neuralv'
  );

  return (
    <div className="page-stack">
      <section className="hero-card platform-hero platform-hero-simple linux-hero">
        <div className="hero-copy">
          <h1>NeuralV для Linux</h1>
          <p>GUI и CLI ставятся одним пакетом. Сначала ставишь NV, потом одной командой подтягиваешь весь NeuralV.</p>
          <div className="hero-actions">
            <a className="nv-button" href="#linux-install">Установить</a>
          </div>
          <span className="hero-support-text">GUI {guiVersion} · CLI {cliVersion}</span>
        </div>
      </section>

      <section id="linux-install" className="section-block">
        <article className="content-card install-card install-card-wide install-card-unified">
          <div className="install-card-head simple-head">
            <div className="install-card-copy">
              <h3>Через NV</h3>
              <p className="install-intro">Главный способ установки: один менеджер, одна команда, GUI и CLI сразу вместе.</p>
            </div>
          </div>

          <div className="command-shell light-shell install-shell">
            <pre>{`# 1. Поставить NV\n${linuxBootstrapCommand}\n\n# 2. Поставить NeuralV\n${linuxInstallCommand}`}</pre>
          </div>
        </article>
      </section>

      <section className="section-block">
        <article className="content-card install-card install-card-wide install-card-unified">
          <div className="install-card-head simple-head">
            <div className="install-card-copy">
              <h3>Прямые пакеты</h3>
              <p className="install-intro">Если не хочешь ставить через NV, можно взять нужный пакет напрямую. CLI в desktop-релиз тоже входит.</p>
            </div>
          </div>

          <div className="install-options-stack install-picker-stack">
            <div className="distro-grid distro-grid-top">
              {directOptions.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  className={`distro-pill${option.key === directKey ? ' is-active' : ''}`}
                  onClick={() => setDirectKey(option.key)}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="command-shell light-shell install-shell">
              <pre>{directCommand}</pre>
            </div>

            <div className="install-card-footer install-download-row">
              {directDownloadUrl ? (
                <a className="nv-button" href={directDownloadUrl} target="_blank" rel="noreferrer">
                  {selectedOption.buttonLabel}
                </a>
              ) : (
                <button className="nv-button is-disabled" type="button" disabled>
                  {selectedOption.buttonLabel}
                </button>
              )}
            </div>
          </div>
        </article>
      </section>
    </div>
  );
}
