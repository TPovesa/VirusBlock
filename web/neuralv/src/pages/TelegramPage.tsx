import '../styles/story.css';
import { TelegramStickerCluster } from '../components/TelegramStickerCluster';

const telegramArtifacts = [
  {
    title: 'ExteraGram plugin',
    kind: 'Plugin',
    fileName: 'NeuralV-3.plugin',
    description: 'Подключает NeuralV прямо к ExteraGram и даёт быстрый вход без отдельного desktop-клиента.',
    version: '1.0',
    minimum: 'ExteraGram 11.12.1+',
    downloadUrl: '/neuralv/telegram/NeuralV-3.plugin',
    stickers: [
      { emoji: '💬', label: 'ExteraGram', tone: 'sky' as const },
      { emoji: '⚡', label: 'Plugin', tone: 'rose' as const }
    ]
  },
  {
    title: 'Heroku module',
    kind: 'Module',
    fileName: 'NeuralV.py',
    description: 'Отдельный модуль для Heroku, если Telegram-часть должна работать внутри сервера и жить своим потоком.',
    version: '1.0',
    minimum: 'Heroku Python runtime',
    downloadUrl: '/neuralv/telegram/NeuralV.py',
    stickers: [
      { emoji: '☁️', label: 'Heroku', tone: 'mint' as const },
      { emoji: '🛡️', label: 'Bridge', tone: 'amber' as const }
    ]
  }
];

const telegramHighlights = [
  'Plugin и модуль разведены по разным сценариям и не конфликтуют друг с другом.',
  'Скачивание идёт напрямую с сайта без витрины и лишних промежуточных шагов.',
  'Обе сборки остаются частью одного Telegram-направления NeuralV.'
];

export function TelegramPage() {
  return (
    <div className="page-stack platform-story-shell telegram-page">
      <section className="platform-hero">
        <div className="platform-hero-center">
          <article className="platform-hero-card platform-hero-card-centered">
            <div className="telegram-hero-shell">
              <div className="platform-hero-copy platform-hero-copy-centered telegram-hero-copy">
                <h1>NeuralV для Telegram</h1>
                <p>Два аккуратных формата для Telegram-направления: быстрый plugin для ExteraGram и отдельный модуль для серверного контура.</p>
                <div className="platform-hero-actions">
                  <a className="nv-button" href={telegramArtifacts[0].downloadUrl} download>Скачать plugin</a>
                  <a className="shell-chip" href={telegramArtifacts[1].downloadUrl} download>Скачать модуль</a>
                </div>
              </div>
              <TelegramStickerCluster
                items={[
                  { emoji: '💬', label: 'чат', tone: 'sky' },
                  { emoji: '🤖', label: 'бот', tone: 'rose' },
                  { emoji: '✨', label: 'сцена', tone: 'amber' },
                  { emoji: '🛡️', label: 'щит', tone: 'mint' }
                ]}
              />
            </div>

            <div className="platform-hero-grid platform-hero-grid-centered">
              <div className="platform-main-stat">
                <strong>ExteraGram и Heroku</strong>
                <p>Два отдельных формата под разные Telegram-сценарии.</p>
              </div>
              <div className="platform-meta-chip">ExteraGram</div>
              <div className="platform-meta-chip">Plugins</div>
              <div className="platform-meta-chip">Heroku</div>
            </div>
          </article>
        </div>
      </section>

      <section className="platform-install-shell">
        <div className="platform-install-grid platform-install-grid-centered">
          {telegramHighlights.map((highlight, index) => (
            <article key={index} className="platform-install-card platform-install-card-centered">
              <h2>Telegram</h2>
              <p>{highlight}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="platform-install-shell">
        <div className="platform-section-heading platform-section-heading-centered">
          <h2>Форматы</h2>
        </div>
        <div className="platform-install-grid platform-install-grid-centered">
          {telegramArtifacts.map((artifact) => (
            <article key={artifact.fileName} className="platform-install-card platform-install-card-centered">
              <TelegramStickerCluster items={artifact.stickers} variant="compact" className="telegram-artifact-stickers" />
              <h2>{artifact.title}</h2>
              <p>{artifact.description}</p>
              <div className="platform-main-stat">
                <strong>{artifact.version}</strong>
                <p>{artifact.minimum}</p>
              </div>
              <div className="platform-meta-chip">{artifact.fileName}</div>
              <div className="platform-hero-actions">
                <a className="nv-button" href={artifact.downloadUrl} download>
                  Скачать
                </a>
              </div>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
