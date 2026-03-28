import { useMemo } from 'react';
import { CenteredHeroSection } from '../components/CenteredHeroSection';
import { StoryScene } from '../components/StoryScene';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact, getArtifactSystemRequirements, getArtifactVersion } from '../lib/manifest';
import '../styles/story.css';

export function LinuxPage() {
  const linuxState = useReleaseManifest('linux');
  const linuxArtifact = useMemo(() => getArtifact(linuxState.manifest, 'linux'), [linuxState.manifest]);
  const version = getArtifactVersion(linuxState.manifest, 'linux') || 'pending';
  const requirements = getArtifactSystemRequirements(linuxArtifact, linuxState.manifest);
  const requirement = requirements[0] || 'x86_64 Linux';

  return (
    <div className="page-stack platform-story-shell">
      <CenteredHeroSection
        title="NeuralV для Linux"
        body="Поддерживаемый сценарий один: установка через NV. Так проще ставить клиент, обновлять его и не расползаться по разным пакетам."
        media={{
          kind: 'image',
          src: '/media/story/linux.jpg',
          alt: 'NeuralV Linux'
        }}
        actions={[{ label: 'Скачать', href: '#linux-install' }]}
        meta={[
          { label: 'Версия', value: version },
          { label: 'Требования', value: requirement }
        ]}
      />

      <div className="story-track platform-story-track">
        <StoryScene
          kicker="Linux"
          title="Один поддерживаемый путь вместо нескольких полурабочих"
          body="Linux-страница остаётся предсказуемой: NV ставит клиент, держит его в актуальном состоянии и не плодит лишние ветки установки."
          accent="Одна команда на старт. Дальше всё идёт через тот же путь."
          visual="linux"
          mediaAlign="left"
          chips={['NV', 'x86_64', 'Linux']}
        />
      </div>

      <section className="story-download-section" id="linux-install">
        <h2>Скачать</h2>
        <div className="platform-install-grid platform-install-grid-single platform-install-grid-centered">
          <article className="platform-command-card platform-command-card-wide platform-command-card-centered">
            <h3>Установка через NV</h3>
            <p>{requirement}</p>
            <div className="platform-install-actions">
              <div className="command-card"><pre>{'curl -fsSL https://neuralvv.org/install/nv.sh | sh\nnv install @lvls/neuralv'}</pre></div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
