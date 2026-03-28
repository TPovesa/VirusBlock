import { useMemo } from 'react';
import { CenteredHeroSection } from '../components/CenteredHeroSection';
import { StoryScene } from '../components/StoryScene';
import { getArtifact, getArtifactSystemRequirements, getArtifactVersion } from '../lib/manifest';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import '../styles/story.css';

export function WindowsPage() {
  const manifestState = useReleaseManifest('windows');
  const artifact = useMemo(() => getArtifact(manifestState.manifest, 'windows'), [manifestState.manifest]);
  const version = getArtifactVersion(manifestState.manifest, 'windows') || 'pending';
  const requirement = getArtifactSystemRequirements(artifact, manifestState.manifest)[0] || 'Windows 10/11 x64';
  const setupUrl = manifestState.manifest.setupUrl || artifact?.downloadUrl || manifestState.manifest.downloadUrl;
  const portableUrl = manifestState.manifest.portableUrl || artifact?.downloadUrl || manifestState.manifest.downloadUrl;

  return (
    <div className="page-stack platform-story-shell">
      <CenteredHeroSection
        title="NeuralV для Windows"
        body="Setup, portable и NV остаются частью одного клиента. Выбор зависит только от того, как тебе удобнее ставить и обновлять приложение."
        media={{
          kind: 'video',
          src: '/media/story/windows-loop.mp4',
          poster: '/media/story/windows.jpg',
          alt: 'NeuralV Windows'
        }}
        actions={[
          setupUrl ? { label: 'Скачать setup', href: setupUrl, external: true } : { label: 'Setup скоро', disabled: true },
          portableUrl ? { label: 'Portable', href: portableUrl, external: true, variant: 'secondary' } : { label: 'Portable скоро', disabled: true, variant: 'secondary' }
        ]}
        meta={[
          { label: 'Версия', value: version },
          { label: 'Требования', value: requirement }
        ]}
      />

      <div className="story-track platform-story-track">
        <StoryScene
          kicker="Windows"
          title="Обычная desktop-установка без лишней возни"
          body="На Windows у тебя остаётся нормальный выбор: обычный setup, portable-сборка или NV для короткой установки и следующих обновлений."
          accent="Один клиент. Три понятных сценария."
          visual="windows"
          mediaAlign="right"
          chips={['Setup', 'Portable', 'NV']}
        />
      </div>

      <section className="story-download-section" id="windows-install">
        <h2>Скачать</h2>
        <div className="platform-install-grid platform-install-grid-centered">
          <article className="platform-install-card platform-install-card-centered">
            <h3>Setup</h3>
            <p>Обычная установка с ярлыками и готовым запуском.</p>
            <div className="platform-install-actions">
              {setupUrl ? <a className="nv-button" href={setupUrl} target="_blank" rel="noreferrer">Скачать</a> : <button className="nv-button is-disabled" type="button" disabled>Скоро</button>}
            </div>
          </article>
          <article className="platform-install-card platform-install-card-centered">
            <h3>Portable</h3>
            <p>Подходит, если директория и запуск должны оставаться под твоим контролем.</p>
            <div className="platform-install-actions">
              {portableUrl ? <a className="nv-button" href={portableUrl} target="_blank" rel="noreferrer">Скачать</a> : <button className="nv-button is-disabled" type="button" disabled>Скоро</button>}
            </div>
          </article>
          <article className="platform-command-card platform-command-card-centered">
            <h3>NV</h3>
            <p>Короткий путь для первой установки и следующих обновлений.</p>
            <div className="platform-install-actions">
              <div className="command-card"><pre>irm https://neuralvv.org/install/nv.ps1 | iex{`\n`}nv install @lvls/neuralv</pre></div>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
