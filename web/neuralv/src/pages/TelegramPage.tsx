import { CenteredHeroSection } from '../components/CenteredHeroSection';
import { StoryScene } from '../components/StoryScene';
import '../styles/story.css';

const telegramAssetVersion = '2.0.20260326';

const telegramArtifacts = [
  {
    title: 'Extera/Ayu',
    description: 'Плагин для ExteraGram и AyuGram.',
    fileName: 'NeuralV-3.plugin',
    downloadUrl: `/downloads/telegram/NeuralV-3.plugin?v=${telegramAssetVersion}`
  },
  {
    title: 'Heroku',
    description: 'Модуль для Heroku.',
    fileName: 'NeuralV.py',
    downloadUrl: `/downloads/telegram/NeuralV.py?v=${telegramAssetVersion}`
  }
];

export function TelegramPage() {
  return (
    <div className="page-stack platform-story-shell telegram-page">
      <CenteredHeroSection
        title="NeuralV для Telegram"
        body="Здесь два отдельных сценария: плагин для Extera/Ayu и модуль для Heroku. Оба остаются локальными и не зависят от внешней AI-проверки."
        media={{
          kind: 'image',
          src: '/media/story/telegram.jpg',
          alt: 'NeuralV Telegram'
        }}
        actions={[
          { label: 'Скачать плагин', href: telegramArtifacts[0].downloadUrl, download: true },
          { label: 'Скачать модуль', href: telegramArtifacts[1].downloadUrl, download: true, variant: 'secondary' }
        ]}
      />

      <div className="story-track platform-story-track">
        <StoryScene
          kicker="Telegram"
          title="Два формата. Один локальный принцип проверки."
          body="И плагин, и модуль проверяют код локально, без удалённого AI-контурa. Разница только в формате установки и окружении."
          accent="Extera/Ayu и Heroku больше не расходятся по логике анализа."
          visual="telegram"
          mediaAlign="right"
          chips={['Extera/Ayu', 'Heroku', 'Local-only']}
        />
      </div>

      <section className="story-download-section">
        <h2>Скачать</h2>
        <div className="platform-install-grid platform-install-grid-centered platform-install-grid-telegram">
          {telegramArtifacts.map((artifact) => (
            <article key={artifact.fileName} className="platform-install-card platform-install-card-centered">
              <h3>{artifact.title}</h3>
              <p>{artifact.description}</p>
              <div className="platform-install-actions">
                <a className="nv-button" href={artifact.downloadUrl} download>Скачать</a>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
