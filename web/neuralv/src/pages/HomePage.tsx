import { Link } from 'react-router-dom';
import { StoryScene } from '../components/StoryScene';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact, getArtifactSystemRequirements, getArtifactVersion } from '../lib/manifest';
import '../styles/story.css';

const scenes = [
  {
    title: 'Проверка начинается раньше тревоги',
    body: 'NeuralV сначала смотрит быстро и спокойно. Если системе есть за что зацепиться, дальше включается более строгий разбор.',
    accent: 'Быстрый ответ там, где он нужен. Глубокий разбор там, где он оправдан.',
    visual: 'route' as const
  },
  {
    title: 'Один продукт. Разные клиенты.',
    body: 'Android, Windows и Linux не копируют друг друга. Каждая версия подстраивается под свою систему и остаётся частью одного продукта.',
    accent: 'Общий аккаунт, общая логика и разный ритм под реальные устройства.',
    visual: 'platforms' as const
  },
  {
    title: 'Спокойный интерфейс. Чёткий результат.',
    body: 'Хорошая защита не должна утомлять. Нам важнее понятные действия, ясный итог и нормальная подача без лишнего шума.',
    accent: 'Когда проверка становится серьёзнее, интерфейс должен оставаться спокойным.',
    visual: 'privacy' as const
  }
] as const;

const faqItems = [
  {
    question: 'Что такое NeuralV',
    answer:
      'Это семейство клиентов для Android, Windows и Linux с одной логикой защиты и общим аккаунтом.'
  },
  {
    question: 'Можно ли ему доверять',
    answer:
      'Доверие строится на понятной модели работы. NeuralV старается объяснять проверку и её итог без громких обещаний и без лишнего шума.'
  },
  {
    question: 'Как проходит проверка',
    answer:
      'Проверка начинается с базового локального этапа. Если нужен более строгий разбор, подключается следующий уровень.'
  },
  {
    question: 'Что остаётся локально',
    answer:
      'На устройстве сначала собирается базовая картина. Дальше объём проверки зависит от выбранного режима и самой системы.'
  },
  {
    question: 'Чем отличаются версии',
    answer:
      'Android ставится одним APK. На Windows есть setup, portable и установка через NV. На Linux основной путь идёт через NV.'
  },
  {
    question: 'Что видно на сайте',
    answer:
      'На сайте доступны вход, профиль, история действий, поддержка и страницы клиентов.'
  }
] as const;

function usePlatformSummary(platform: 'android' | 'windows' | 'linux' | 'shell') {
  const manifestState = useReleaseManifest(platform);
  const artifact = getArtifact(manifestState.manifest, platform === 'shell' ? 'shell' : platform);
  return {
    version: getArtifactVersion(manifestState.manifest, platform) || 'pending',
    requirement: getArtifactSystemRequirements(artifact, manifestState.manifest)[0] || '',
    downloadUrl: artifact?.downloadUrl || manifestState.manifest.downloadUrl
  };
}

export function HomePage() {
  const android = usePlatformSummary('android');
  const windows = usePlatformSummary('windows');
  const linux = usePlatformSummary('linux');

  return (
    <div className="page-stack story-page-shell">
      <section className="story-hero">
        <div className="story-hero-center">
          <article className="story-hero-card">
            <h1>Базовые технологии ушли в прошлое. Встречайте новый стандарт безопасности.</h1>
            <div className="story-hero-actions">
              <a className="nv-button" href="#downloads">Скачать</a>
              <Link className="shell-chip" to="/register">Аккаунт</Link>
            </div>
          </article>

          <div className="story-scroll-cue" aria-hidden="true">
            <div className="story-scroll-arrow" />
          </div>
        </div>
      </section>

      <div className="story-track">
        {scenes.map((scene) => (
          <StoryScene
            key={scene.title}
            title={scene.title}
            body={scene.body}
            accent={scene.accent}
            visual={scene.visual}
          />
        ))}
      </div>

      <section className="story-faq-section">
        <div className="story-faq-grid">
          <article className="story-faq-intro">
            <h2>Частые вопросы</h2>
          </article>
          <div className="story-faq-list">
            {faqItems.map((item) => (
              <details key={item.question} className="story-faq-item">
                <summary className="story-faq-question">{item.question}</summary>
                <div className="story-faq-answer">
                  <p>{item.answer}</p>
                </div>
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="story-download-section" id="downloads">
        <h2>Загрузки</h2>
        <div className="story-download-grid">
          <article className="story-download-card">
            <h3>Android</h3>
            <p>{android.requirement || 'Android 8.0+ (API 26)'}</p>
            <div className="story-download-actions">
              <Link className="nv-button" to="/android">Открыть страницу</Link>
            </div>
          </article>
          <article className="story-download-card">
            <h3>Windows</h3>
            <p>{windows.requirement || 'Windows 10/11 x64'}</p>
            <div className="story-download-actions">
              <Link className="nv-button" to="/windows">Открыть страницу</Link>
            </div>
          </article>
          <article className="story-download-card">
            <h3>Linux</h3>
            <p>{linux.requirement || 'x86_64 Linux'}</p>
            <div className="story-download-actions">
              <Link className="nv-button" to="/linux">Открыть страницу</Link>
            </div>
          </article>
          <article className="story-download-card">
            <h3>Extera plugin</h3>
            <p>Плагин для ExteraGram.</p>
            <div className="story-download-actions">
              <a className="nv-button" href="/neuralv/telegram/NeuralV-3.plugin" download>Скачать</a>
            </div>
          </article>
          <article className="story-download-card">
            <h3>Heroku module</h3>
            <p>Модуль для Heroku.</p>
            <div className="story-download-actions">
              <a className="nv-button" href="/neuralv/telegram/NeuralV.py" download>Скачать</a>
            </div>
          </article>
        </div>
      </section>
    </div>
  );
}
