import { Link } from 'react-router-dom';
import { useReleaseManifest } from '../hooks/useReleaseManifest';
import { getArtifact, getArtifactSystemRequirements, getArtifactVersion } from '../lib/manifest';

const trustPoints = [
  {
    title: 'Не одна проверка, а несколько слоёв',
    text: 'Быстрая локальная оценка, серверная перепроверка, история сессий и отдельные потоки анализа под разные платформы.'
  },
  {
    title: 'Один аккаунт и общий журнал',
    text: 'Вход и история проверок живут в одном аккаунте, а не расползаются по отдельным версиям.'
  },
  {
    title: 'Проверка не только файла, но и контекста',
    text: 'Desktop и Android проходят через собственные пайплайны анализа, а не только через один статический шаблон.'
  }
] as const;

const verificationStages = [
  { step: '01', title: 'Локальный старт', text: 'Клиент быстро собирает первичную картину и не ждёт тяжёлые серверные этапы.' },
  { step: '02', title: 'Отправка артефактов', text: 'Если нужен глубокий анализ, поднимается полный серверный маршрут со своими артефактами.' },
  { step: '03', title: 'Перепроверка и нормализация', text: 'Промежуточные сигналы не отдаются как есть: они проходят отдельную нормализацию и фильтрацию.' },
  { step: '04', title: 'Итоговый вердикт', text: 'На выходе остаются уже приведённые угрозы, история проверки и понятный итог для пользователя.' }
] as const;

const faqItems = [
  {
    q: 'Можно ли доверять NeuralV?',
    a: 'Да, если смотреть на него как на обычный потребительский продукт: с открытым сайтом, понятными клиентами, собственным backend-потоком и разделением локальной и серверной проверки.'
  },
  {
    q: 'Это только оболочка над одним сканером?',
    a: 'Нет. У Android, Windows и Linux разные install flows и разные режимы проверки. Быстрый режим не равен глубокой серверной перепроверке.'
  },
  {
    q: 'Что видно на сайте?',
    a: 'Только понятная информация: что ставится, на что рассчитывать, какие системные требования и как устроен доступ к аккаунту.'
  }
] as const;

function usePlatformSummary(platform: 'android' | 'windows' | 'linux' | 'shell') {
  const manifestState = useReleaseManifest(platform);
  const artifact = getArtifact(manifestState.manifest, platform === 'shell' ? 'shell' : platform);
  return {
    version: getArtifactVersion(manifestState.manifest, platform) || 'pending',
    requirement: getArtifactSystemRequirements(artifact, manifestState.manifest)[0] || 'ожидает manifest',
    downloadUrl: artifact?.downloadUrl || manifestState.manifest.downloadUrl
  };
}

export function HomePage() {
  const android = usePlatformSummary('android');
  const windows = usePlatformSummary('windows');
  const linux = usePlatformSummary('linux');
  const shell = usePlatformSummary('shell');

  return (
    <div className="page-stack home-stack">
      <section className="hero-shell home-hero-shell">
        <div className="hero-copy hero-copy-wide">
          <span className="eyebrow">NeuralV antivirus</span>
          <h1>Антивирус с разными степенями проверки, общим аккаунтом и отдельными клиентами под каждую платформу.</h1>
          <p>
            NeuralV не делает вид, что одна кнопка решает всё. Быстрая проверка идёт отдельно,
            глубокая — отдельно, а сайт объясняет, как это устроено и что именно ты ставишь.
          </p>
          <div className="hero-actions">
            <a className="nv-button" href="#downloads">Скачать</a>
            <Link className="shell-chip" to="/register">Создать аккаунт</Link>
          </div>
        </div>

        <div className="hero-matrix">
          <article className="hero-stat-card accent-card">
            <span className="hero-stat-kicker">Платформы</span>
            <strong>Android / Windows / Linux</strong>
            <p>Один продукт, но не одна и та же оболочка везде.</p>
          </article>
          <article className="hero-stat-card">
            <span className="hero-stat-kicker">Проверки</span>
            <strong>Локальные и серверные</strong>
            <p>Быстрые сценарии не мешают глубокой перепроверке и отдельным desktop-артефактам.</p>
          </article>
          <article className="hero-stat-card">
            <span className="hero-stat-kicker">Аккаунт</span>
            <strong>Один вход</strong>
            <p>История, сессии и профиль собраны в одном месте, а не разложены по клиентам.</p>
          </article>
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <span className="section-kicker">Почему этому можно доверять</span>
          <h2>Не витрина ради витрины, а понятная схема работы.</h2>
        </div>
        <div className="info-grid info-grid-trust">
          {trustPoints.map((item) => (
            <article key={item.title} className="surface-card info-card">
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <span className="section-kicker">Как идёт проверка</span>
          <h2>Каждый этап отвечает за свою часть риска.</h2>
        </div>
        <div className="stage-grid">
          {verificationStages.map((item) => (
            <article key={item.step} className="surface-card stage-card">
              <span className="stage-step">{item.step}</span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="section-block">
        <div className="section-heading">
          <span className="section-kicker">Версии и требования</span>
          <h2>Перед установкой сразу видно, что именно доступно.</h2>
        </div>
        <div className="download-grid" id="downloads">
          <article className="surface-card download-card">
            <div className="download-head"><h3>Android</h3><span>{android.version}</span></div>
            <p className="download-requirement">{android.requirement}</p>
            <div className="download-actions">
              <Link className="nv-button" to="/android">Открыть страницу</Link>
            </div>
          </article>
          <article className="surface-card download-card accent-card">
            <div className="download-head"><h3>Windows</h3><span>{windows.version}</span></div>
            <p className="download-requirement">{windows.requirement}</p>
            <div className="download-actions">
              <Link className="nv-button" to="/windows">Открыть страницу</Link>
            </div>
          </article>
          <article className="surface-card download-card">
            <div className="download-head"><h3>Linux</h3><span>{linux.version}</span></div>
            <p className="download-requirement">{linux.requirement}</p>
            <div className="download-actions">
              <Link className="nv-button" to="/linux">Открыть страницу</Link>
            </div>
          </article>
          <article className="surface-card download-card subtle-card">
            <div className="download-head"><h3>Linux CLI</h3><span>{shell.version}</span></div>
            <p className="download-requirement">{shell.requirement}</p>
            <div className="download-actions">
              <Link className="shell-chip" to="/linux">Команды и пакеты</Link>
            </div>
          </article>
        </div>
      </section>

      <section className="section-block faq-block">
        <div className="section-heading">
          <span className="section-kicker">Коротко по сути</span>
          <h2>Без кринжатины и маркетингового шума.</h2>
        </div>
        <div className="faq-grid">
          {faqItems.map((item) => (
            <article key={item.q} className="surface-card faq-card">
              <h3>{item.q}</h3>
              <p>{item.a}</p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
