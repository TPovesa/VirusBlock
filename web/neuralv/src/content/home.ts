export type HomeMetric = {
  value: string;
  label: string;
  detail: string;
};

export type HomePlatformCard = {
  id: 'android' | 'windows' | 'linux';
  route: '/android' | '/windows' | '/linux';
  eyebrow: string;
  title: string;
  summary: string;
  bullets: string[];
  primaryLabel: string;
  secondaryLabel: string;
  manifestPlatform: 'android' | 'windows' | 'linux';
  tone: 'android' | 'windows' | 'linux';
};

export type HomeAdvantage = {
  eyebrow: string;
  title: string;
  text: string;
  size: 'normal' | 'wide';
};

export type HomeArchitectureCard = {
  eyebrow: string;
  title: string;
  text: string;
  bullets: string[];
  tone: 'local' | 'server' | 'sync';
};

export type HomeInstallStep = {
  title: string;
  text: string;
};

export const homeMetrics: HomeMetric[] = [
  {
    value: '3',
    label: 'версии',
    detail: 'Android, Windows и Linux в одном аккаунте.'
  },
  {
    value: '1',
    label: 'аккаунт',
    detail: 'Одна история и одна авторизация на всех устройствах.'
  },
  {
    value: '24/7',
    label: 'защита',
    detail: 'Быстрая локальная проверка и серверная перепроверка там, где это нужно.'
  }
];

export const homePlatformCards: HomePlatformCard[] = [
  {
    id: 'android',
    route: '/android',
    eyebrow: 'Мобильный контур',
    title: 'Android',
    summary:
      'Проверка установленных приложений, фоновая защита и серверная перепроверка прямо на телефоне.',
    bullets: [
      'быстрая проверка сразу после установки',
      'фоновый контроль новых приложений',
      'серверные проверки для сложных случаев'
    ],
    primaryLabel: 'Открыть Android',
    secondaryLabel: 'Скачать APK',
    manifestPlatform: 'android',
    tone: 'android'
  },
  {
    id: 'windows',
    route: '/windows',
    eyebrow: 'Рабочая станция',
    title: 'Windows',
    summary:
      'Отдельная версия для проверки `.exe` и других исполняемых файлов Windows.',
    bullets: [
      'простая установка и вход в тот же аккаунт',
      'локальные проверки подозрительных файлов',
      'серверная перепроверка спорных находок'
    ],
    primaryLabel: 'Открыть Windows',
    secondaryLabel: 'Скачать build',
    manifestPlatform: 'windows',
    tone: 'windows'
  },
  {
    id: 'linux',
    route: '/linux',
    eyebrow: 'GUI + shell',
    title: 'Linux',
    summary:
      'GUI для рабочего стола и shell-версия для тех, кому удобнее терминал.',
    bullets: [
      'подходит для популярных Linux-дистрибутивов',
      'можно ставить через терминал одной командой',
      'GUI и shell используют один backend и один аккаунт'
    ],
    primaryLabel: 'Открыть Linux',
    secondaryLabel: 'Скачать GUI',
    manifestPlatform: 'linux',
    tone: 'linux'
  }
];

export const homeAdvantages: HomeAdvantage[] = [
  {
    eyebrow: 'Единый контур',
    title: 'Один аккаунт и одна история проверки для всех устройств.',
    text:
      'Пользователь не собирает продукт из независимых клиентов. Android, Windows и Linux подчиняются одному auth-потоку и одному back-office.',
    size: 'wide'
  },
  {
    eyebrow: 'Локальная скорость',
    title: 'Быстрый первый ответ приходит с устройства.',
    text:
      'Каждый клиент умеет давать первичный сигнал без ожидания сети: от приложений Android до EXE/DLL и ELF/AppImage.',
    size: 'normal'
  },
  {
    eyebrow: 'Серверная глубина',
    title: 'Сложный анализ остаётся на backend, а не в UI.',
    text:
      'Hash reputation, VT, статические эвристики и AI triage сглаживают шум, не перегружая интерфейс деталями.',
    size: 'normal'
  },
  {
    eyebrow: 'Manifest-first',
    title: 'Главная страница не хардкодит релизы, она читает контракт публикации.',
    text:
      'Версия, канал, SHA256, download URL и install command попадают на сайт из одного источника, поэтому витрина и релиз не расходятся.',
    size: 'wide'
  },
  {
    eyebrow: 'Shell как часть продукта',
    title: 'Linux shell не спрятан в документации.',
    text:
      'Команда установки и lifecycle daemon видны рядом с GUI-потоком, поэтому ops-сценарии живут в том же ритме, что и desktop.',
    size: 'normal'
  },
  {
    eyebrow: 'Чистая подача',
    title: 'Пользователь видит решение, а не сырые события.',
    text:
      'Сайт и клиенты показывают понятные CTA, а расширенная техническая детализация остаётся там, где она действительно нужна.',
    size: 'normal'
  }
];

export const homeArchitectureCards: HomeArchitectureCard[] = [
  {
    eyebrow: 'Local layer',
    title: 'На устройстве собираются быстрые и platform-aware сигналы.',
    text:
      'Каждая поверхность стартует с локального контекста: приложения, исполняемые файлы, provenance, autorun и resident события.',
    bullets: [
      'Android: apps, permissions, install source и фоновый статус',
      'Windows: PE metadata, signer, imports, packer markers и новые бинарники',
      'Linux: ELF/AppImage, capabilities, package manager provenance и systemd hooks'
    ],
    tone: 'local'
  },
  {
    eyebrow: 'Server layer',
    title: 'Backend усиливает локальный сигнал репутацией и статическим triage.',
    text:
      'Серверная часть получает summary и артефакты, прогоняет их через hash reputation, VT, правила и AI post-filter, а затем нормализует результат.',
    bullets: [
      'deep/selective/APK сценарии для Android',
      'YARA/static PE heuristics и publisher rules для Windows',
      'ELF/AppImage static analysis и distro-aware контекст для Linux'
    ],
    tone: 'server'
  },
  {
    eyebrow: 'Sync layer',
    title: 'Manifest и история проверок связывают доставку, установку и итоговый UX.',
    text:
      'Тот же backend публикует артефакты и install-команды, а клиенты после входа синхронизируют историю, чтобы продукт чувствовался единым.',
    bullets: [
      'release manifest синхронизирует сайт и артефакты',
      'desktop, mobile и shell читают один ритм релиза',
      'отчёты и статусы остаются согласованными между поверхностями'
    ],
    tone: 'sync'
  }
];

export const homeInstallSteps: HomeInstallStep[] = [
  {
    title: 'Выбери свою платформу.',
    text:
      'На главной сразу видно, есть ли версия для Android, Windows или Linux.'
  },
  {
    title: 'Скачай актуальный релиз.',
    text:
      'Кнопки загрузки берут версию и файл из release manifest, без ручных ссылок на странице.'
  },
  {
    title: 'Установи и войди в аккаунт.',
    text:
      'После входа история и статус защиты синхронизируются между устройствами.'
  }
];

export const homeManifestFacts = [
  'Версия и файл подтягиваются автоматически.',
  'Ссылки на скачивание не захардкожены в тексте.',
  'SHA256 можно проверить до установки.'
];

export const homeShellFallbackCommand =
  'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh';
