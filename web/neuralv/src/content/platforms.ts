export type PlatformId = 'android' | 'windows' | 'linux';

export type PlatformContent = {
  id: PlatformId;
  route: string;
  title: string;
  kicker: string;
  overview: string;
  audience: string;
  localChecks: string[];
  serverChecks: string[];
  installSteps: string[];
  secondaryInstall?: string[];
  accent: 'indigo' | 'teal' | 'amber';
  ctaLabel: string;
  manifestPlatform: 'android' | 'windows' | 'linux' | 'shell';
};

export const platformContent: PlatformContent[] = [
  {
    id: 'android',
    route: '/android',
    title: 'NeuralV для Android',
    kicker: 'Мобильная защита',
    overview:
      'Локальная быстрая проверка, серверные deep/selective/APK проверки и единая авторизация с desktop-клиентами.',
    audience: 'Для Android-пользователей, которым нужен понятный mobile-first антивирус без перегруженного интерфейса.',
    localChecks: [
      'Быстрая локальная проверка установленных приложений и базовых сигналов.',
      'Проверка пакетов, разрешений, install source и изменений в установленном наборе.',
      'Фоновый мониторинг и уведомления о статусе активной проверки.'
    ],
    serverChecks: [
      'Deep/selective/APK проверки на сервере через hash reputation, VT и статический анализ.',
      'AI post-filter скрывает шумные false positive до показа пользователю.',
      'Полный серверный отчёт доступен для разработческих сценариев и расширенного анализа.'
    ],
    installSteps: [
      'Скачайте актуальный APK с этой страницы.',
      'Разрешите установку из доверенного источника, если Android попросит подтверждение.',
      'Войдите в аккаунт NeuralV, чтобы синхронизировать историю и получить серверные проверки.'
    ],
    accent: 'indigo',
    ctaLabel: 'Скачать Android APK',
    manifestPlatform: 'android'
  },
  {
    id: 'windows',
    route: '/windows',
    title: 'NeuralV для Windows',
    kicker: 'Desktop GUI',
    overview:
      'Compose Desktop клиент для Windows с тем же auth-потоком, историей проверок и локальным анализом исполняемых файлов.',
    audience: 'Для рабочих станций и домашних ПК, где нужны on-demand и resident сценарии проверки EXE/DLL.',
    localChecks: [
      'PE/EXE/DLL metadata, signer validation и репутация издателя.',
      'Section entropy, suspicious imports, packer markers и следы persistence.',
      'Мониторинг новых исполняемых файлов в common download/temp paths.'
    ],
    serverChecks: [
      'Server-side hash reputation, VT и YARA/static PE heuristics.',
      'Publisher allowlist/denylist и дополнительный AI triage перед user-facing отчётом.',
      'Resident события передаются как summary, подробный отчёт хранится на сервере.'
    ],
    installSteps: [
      'Скачайте Windows installer или portable build.',
      'Запустите приложение и войдите в аккаунт NeuralV.',
      'Для resident protection включите фоновый агент в настройках.'
    ],
    secondaryInstall: [
      'Portable build подходит для тестового запуска без системной установки.',
      'Installer build регистрирует background agent и автообновления.'
    ],
    accent: 'teal',
    ctaLabel: 'Скачать Windows build',
    manifestPlatform: 'windows'
  },
  {
    id: 'linux',
    route: '/linux',
    title: 'NeuralV для Linux',
    kicker: 'GUI + shell',
    overview:
      'Linux-линейка состоит из Compose Desktop GUI и shell/TUI клиента с root-assisted daemon для resident protection.',
    audience: 'Для desktop Linux и серверных инсталляций, где нужен либо GUI, либо лёгкий терминальный клиент.',
    localChecks: [
      'ELF/AppImage/shell launcher/.desktop файлы, executable bits, SUID и capabilities.',
      'Проверка provenance через dpkg/rpm/pacman/flatpak/snap, когда менеджер пакетов доступен.',
      'Мониторинг user/systemd autostart units, autorun directories и новых бинарников.'
    ],
    serverChecks: [
      'Hash reputation, VT и статический анализ ELF/AppImage на сервере.',
      'Distro-aware heuristics и server-side triage перед отдачей результата.',
      'Единый backend для GUI, shell и daemon событий.'
    ],
    installSteps: [
      'GUI: скачайте Linux desktop archive или package из release manifest.',
      'Shell: выполните установщик одной командой с сайта.',
      'Для resident protection подтвердите установку systemd service neuralvd.'
    ],
    secondaryInstall: [
      'Shell installer: curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh',
      'После установки доступны команды update, uninstall, start, stop и status.'
    ],
    accent: 'amber',
    ctaLabel: 'Открыть Linux загрузки',
    manifestPlatform: 'linux'
  }
];

export const homeHighlights = [
  {
    title: 'Единый аккаунт',
    text: 'Одна авторизация для Android, Windows, Linux GUI и shell-клиента.'
  },
  {
    title: 'Гибридные проверки',
    text: 'Локальные движки на каждом устройстве плюс серверная перепроверка и AI triage.'
  },
  {
    title: 'Прозрачная доставка',
    text: 'APK, desktop builds и shell installer публикуются через единый release manifest.'
  }
];

export const comparisonRows = [
  {
    label: 'Локальная проверка',
    android: 'Приложения Android',
    windows: 'EXE/DLL и persistence',
    linux: 'ELF/AppImage/.desktop и autorun'
  },
  {
    label: 'Серверная проверка',
    android: 'Deep / Selective / APK',
    windows: 'Hash, YARA, signer, AI filter',
    linux: 'Hash, static ELF/AppImage, AI filter'
  },
  {
    label: 'Resident mode',
    android: 'Foreground/background service',
    windows: 'Background agent/service',
    linux: 'neuralvd + systemd'
  }
];
