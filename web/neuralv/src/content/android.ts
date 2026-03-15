export type AndroidHeroMetric = {
  value: string;
  label: string;
};

export type AndroidCapabilityTier = {
  id: 'guest' | 'regular' | 'developer';
  title: string;
  badge: string;
  summary: string;
  bullets: string[];
  accent: 'glacier' | 'mint' | 'sun';
};

export type AndroidPreviewScreen = {
  eyebrow: string;
  title: string;
  text: string;
  chips: string[];
  footer: string;
};

export type AndroidFlowStep = {
  title: string;
  text: string;
};

export type AndroidInstallStep = {
  title: string;
  text: string;
  helper: string;
};

export type AndroidUpdateMode = {
  title: string;
  text: string;
  helper: string;
};

export const androidHeroMetrics: AndroidHeroMetric[] = [
  {
    value: '24/7',
    label: 'защита новых установок и уже установленных приложений'
  },
  {
    value: 'Быстро + Глубоко',
    label: 'локальная проверка на телефоне и серверная перепроверка'
  },
  {
    value: '3 режима',
    label: 'гость, обычный аккаунт и режим разработчика'
  }
];

export const androidLocalChecks: string[] = [
  'Проверка уже установленных приложений прямо на телефоне.',
  'Контроль новых APK и обновлений приложений.',
  'Фоновая защита без лишнего шума в интерфейсе.'
];

export const androidServerChecks: string[] = [
  'Глубокая, выборочная и APK-проверка на сервере.',
  'Спорные находки перепроверяются до показа пользователю.',
  'Тяжёлый анализ не грузит телефон и батарею.'
];

export const androidProtectionLoop: AndroidFlowStep[] = [
  {
    title: 'Ловит событие',
    text: 'NeuralV замечает новую установку, обновление пакета или необычный permission drift.'
  },
  {
    title: 'Собирает локальный сигнал',
    text: 'На устройстве оцениваются package metadata, install source, подпись и быстрые эвристики.'
  },
  {
    title: 'Эскалирует на сервер',
    text: 'Подозрительный APK уходит в deep/selective/APK pipeline без ручного вмешательства.'
  },
  {
    title: 'Отдаёт понятный вердикт',
    text: 'Пользователь видит чистый итог, а developer при необходимости может развернуть полный отчёт.'
  }
];

export const androidCapabilityTiers: AndroidCapabilityTier[] = [
  {
    id: 'guest',
    title: 'Guest mode',
    badge: 'Быстрый старт',
    summary: 'Подходит, если хочешь просто установить приложение и сразу проверить телефон.',
    bullets: [
      'быстрая локальная проверка',
      'понятный базовый статус',
      'без обязательной регистрации'
    ],
    accent: 'glacier'
  },
  {
    id: 'regular',
    title: 'Regular account',
    badge: 'Повседневная защита',
    summary: 'Основной режим для постоянного использования с историей и серверными проверками.',
    bullets: [
      'история проверок',
      'серверные deep/selective/APK проверки',
      'единый аккаунт для Android и ПК'
    ],
    accent: 'mint'
  },
  {
    id: 'developer',
    title: 'Developer view',
    badge: 'Расширенный triage',
    summary: 'Нужен тем, кому важны расширенные отчёты и больше технических деталей.',
    bullets: [
      'полный серверный отчёт',
      'расширенные детали проверки',
      'удобно для QA и отладки'
    ],
    accent: 'sun'
  }
];

export const androidPreviewScreens: AndroidPreviewScreen[] = [
  {
    eyebrow: 'Scan pulse',
    title: 'Экран быстрой проверки',
    text: 'Одна поверхность показывает install source, уровень риска и моментальный результат без лишних переходов.',
    chips: ['resident shield', 'permission drift', 'package diff'],
    footer: 'Подходит для регулярной быстрой проверки в дороге.'
  },
  {
    eyebrow: 'Cloud escalation',
    title: 'Серверный escalation flow',
    text: 'Если локальный сигнал не уверен, приложение спокойно отправляет объект в серверный deep/selective/APK pipeline.',
    chips: ['deep scan', 'selective scan', 'apk report'],
    footer: 'Батарея не тратится на тяжёлый анализ на самом телефоне.'
  },
  {
    eyebrow: 'Clear verdict',
    title: 'Финальный user-facing отчёт',
    text: 'AI post-filter оставляет только actionable-сигналы, а developer может раскрыть технический слой поверх финального verdict.',
    chips: ['ai post-filter', 'reason codes', 'history sync'],
    footer: 'Обычный пользователь видит чистый результат, а не поток шумных тревог.'
  }
];

export const androidInstallSteps: AndroidInstallStep[] = [
  {
    title: 'Скачай актуальный APK',
    text: 'На странице сразу видны версия, файл и SHA256 перед установкой.',
    helper: 'Можно быстро проверить, что скачивается именно нужный релиз.'
  },
  {
    title: 'Разреши установку из доверенного источника',
    text: 'Если Android попросит разрешение, подтверди установку APK из браузера или файлового менеджера.',
    helper: 'После установки это разрешение можно отключить.'
  },
  {
    title: 'Запусти NeuralV и выбери глубину режима',
    text: 'После запуска можно остаться в гостевом режиме или войти в аккаунт.',
    helper: 'Аккаунт нужен для серверных проверок, истории и синхронизации.'
  }
];

export const androidUpdateModes: AndroidUpdateMode[] = [
  {
    title: 'Актуальная версия на странице',
    text: 'Страница всегда показывает свежий APK из release manifest.',
    helper: 'Не нужно искать версию вручную.'
  },
  {
    title: 'Понятное обновление',
    text: 'Перед установкой можно увидеть файл и SHA256.',
    helper: 'Подходит и для обычного пользователя, и для ручной проверки.'
  }
];
