import { useMemo } from 'react';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact, getArtifactSystemRequirements, getArtifactVersion } from '../lib/manifest';

const linuxVariants = [
  { title: 'NV', description: 'Основной путь установки: ставит продукт через менеджер пакетов NV.', body: 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh\nnv install @lvls/neuralv' },
  { title: '.deb / .rpm / AppImage / .tar.gz', description: 'Если нужен прямой пакет, он доступен отдельно ниже на странице или через release-ветки.', body: 'Прямые пакеты идут как вторичный путь, когда NV не подходит под окружение.' }
] as const;

export function LinuxPage() {
  const linuxState = useReleaseManifest('linux');
  const shellState = useReleaseManifest('shell');
  const linuxArtifact = useMemo(() => getArtifact(linuxState.manifest, 'linux'), [linuxState.manifest]);
  const shellArtifact = useMemo(() => getArtifact(shellState.manifest, 'shell'), [shellState.manifest]);
  const version = getArtifactVersion(linuxState.manifest, 'linux') || 'pending';
  const shellVersion = getArtifactVersion(shellState.manifest, 'shell') || 'pending';
  const requirements = [
    ...getArtifactSystemRequirements(linuxArtifact, linuxState.manifest),
    ...getArtifactSystemRequirements(shellArtifact, shellState.manifest)
  ].filter((item, index, list) => list.indexOf(item) === index);

  return (
    <div className="page-stack">
      <section className="hero-shell platform-shell">
        <div className="hero-copy hero-copy-tight">
          <span className="eyebrow">Linux client</span>
          <h1>NeuralV для Linux</h1>
          <p>GUI и CLI остаются одним продуктом, но install flow остаётся прямолинейным.</p>
          <div className="hero-actions">
            <a className="nv-button" href="#linux-install">Открыть установку</a>
          </div>
        </div>

        <article className="surface-card platform-summary-card accent-card">
          <span className="summary-kicker">Актуальные версии</span>
          <strong>GUI {version}</strong>
          <span>CLI {shellVersion}</span>
          <span>{requirements[0] || 'Требования ещё не дошли в manifest.'}</span>
        </article>
      </section>

      <section className="section-grid section-grid-platform" id="linux-install">
        {linuxVariants.map((item) => (
          <article key={item.title} className="surface-card platform-install-card">
            <div className="card-heading"><h2>{item.title}</h2></div>
            <p>{item.description}</p>
            <div className="command-card"><pre>{item.body}</pre></div>
          </article>
        ))}
      </section>
    </div>
  );
}
