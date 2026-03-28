import { CenteredHeroSection } from '../components/CenteredHeroSection';
import { StoryScene } from '../components/StoryScene';
import '../styles/story.css';

const telegramAssetVersion = '3.1.20260329.4';

const telegramArtifacts = [
  {
    title: 'Extera/Ayu',
    description: 'Файл NeuralV.plugin для ExteraGram и AyuGram.',
    fileName: 'NeuralV.plugin',
    downloadUrl: `/downloads/telegram/NeuralV.plugin?v=${telegramAssetVersion}`
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
        body="Здесь два отдельных сценария: файл NeuralV.plugin для Extera/Ayu и модуль NeuralV.py для Heroku. В обоих локальный анализ идёт первым, а серверный AI подключается как второй короткий ревьюер."
        media={{
          kind: 'image',
          src: '/media/story/telegram.jpg',
          alt: 'NeuralV Telegram'
        }}
        actions={[
          { label: 'Скачать NeuralV.plugin', href: telegramArtifacts[0].downloadUrl, download: true },
          { label: 'Скачать NeuralV.py', href: telegramArtifacts[1].downloadUrl, download: true, variant: 'secondary' }
        ]}
      />

      <div className="story-track platform-story-track">
        <StoryScene
          kicker="Telegram"
          title="Два формата. Одна логика проверки."
          body="И файл NeuralV.plugin, и модуль NeuralV.py сначала прогоняют код локально, а затем подключают короткий серверный разбор через NeuralV. Пользователю не нужен никакой API-ключ."
          accent="Extera/Ayu и Heroku проверяют NeuralV.plugin и NeuralV.py по одному и тому же правилу."
          visual="telegram"
          mediaAlign="right"
          chips={['Extera/Ayu', 'Heroku', 'Local + AI']}
        />
      </div>

      <section className="story-download-section">
        <h2>Скачать NeuralV</h2>
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
