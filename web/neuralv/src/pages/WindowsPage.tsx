import { useMemo } from 'react';
import { getArtifact, getArtifactSystemRequirements, getArtifactVersion } from '../lib/manifest';
import { useReleaseManifest } from '../hooks/useReleaseManifest';

const installModes = [
  {
    title: 'Setup',
    text: 'Обычная установка с ярлыками, updater-цепочкой и обновлением установленной папки.',
    button: 'Скачать setup',
    key: 'setup'
  },
  {
    title: 'Portable',
    text: 'Ручной запуск без инсталляции. Подходит, если ты сам контролируешь директорию клиента.',
    button: 'Скачать portable',
    key: 'portable'
  },
  {
    title: 'NV',
    text: 'NV ставит bundle одной командой и ведёт обновление через тот же install root.',
    button: 'Открыть команды',
    key: 'nv'
  }
] as const;

export function WindowsPage() {
  const manifestState = useReleaseManifest('windows');
  const artifact = useMemo(() => getArtifact(manifestState.manifest, 'windows'), [manifestState.manifest]);
  const version = getArtifactVersion(manifestState.manifest, 'windows') || 'pending';
  const requirements = getArtifactSystemRequirements(artifact, manifestState.manifest);
  const setupUrl = manifestState.manifest.setupUrl || artifact?.downloadUrl || manifestState.manifest.downloadUrl;
  const portableUrl = manifestState.manifest.portableUrl || artifact?.downloadUrl || manifestState.manifest.downloadUrl;

  return (
    <div className="page-stack">
      <section className="hero-shell platform-shell">
        <div className="hero-copy hero-copy-tight">
          <span className="eyebrow">Windows client</span>
          <h1>NeuralV для Windows</h1>
          <p>Нативный Windows-клиент с отдельным launcher, updater, GUI и CLI внутри одного bundle.</p>
          <div className="hero-actions">
            {setupUrl ? <a className="nv-button" href={setupUrl} target="_blank" rel="noreferrer">Скачать setup</a> : null}
            <a className="shell-chip" href="#windows-install">Все способы установки</a>
          </div>
        </div>

        <article className="surface-card platform-summary-card accent-card">
          <span className="summary-kicker">Актуальная версия</span>
          <strong>{version}</strong>
          <span>{requirements[0] || 'Требования ещё не дошли в manifest.'}</span>
        </article>
      </section>

      <section className="section-grid section-grid-platform" id="windows-install">
        {installModes.map((item) => (
          <article key={item.key} className="surface-card platform-install-card">
            <div className="card-heading">
              <h2>{item.title}</h2>
            </div>
            <p>{item.text}</p>
            {item.key === 'setup' ? (
              setupUrl ? <a className="nv-button" href={setupUrl} target="_blank" rel="noreferrer">{item.button}</a> : <button className="nv-button is-disabled" type="button" disabled>{item.button}</button>
            ) : item.key === 'portable' ? (
              portableUrl ? <a className="nv-button" href={portableUrl} target="_blank" rel="noreferrer">{item.button}</a> : <button className="nv-button is-disabled" type="button" disabled>{item.button}</button>
            ) : (
              <div className="command-card"><pre>irm https://sosiskibot.ru/neuralv/install/nv.ps1 | iex{`\n`}nv install @lvls/neuralv</pre></div>
            )}
          </article>
        ))}
      </section>
    </div>
  );
}
