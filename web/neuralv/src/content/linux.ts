export type LinuxFact = {
  label: string;
  value: string;
  detail: string;
};

export type LinuxStep = {
  title: string;
  description: string;
  command: string;
};

export type LinuxFeature = {
  title: string;
  description: string;
  bullets: string[];
};

export type LinuxCommandRow = {
  label: string;
  command: string;
  note?: string;
};

export const linuxBootstrapCommand = 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh';
export const linuxInstallCommand = 'nv install neuralv@latest';

export function linuxVersionInstallCommand(version?: string) {
  if (!version || version === 'pending' || version === 'latest') {
    return linuxInstallCommand;
  }

  return `nv install neuralv@${version}`;
}

export const linuxPageContent = {
  kicker: 'NeuralV / Linux',
  title: 'Один Linux flow: ставишь nv, потом одной командой ставишь NeuralV.',
  summary:
    'GUI, shell и daemon остаются в одном маршруте, но вход теперь проще: сначала bootstrap nv, потом install нужной версии NeuralV.',
  chips: ['GUI для Linux', 'Shell / TUI', 'Daemon opt-in', 'Общая авторизация'],
  facts: [
    {
      label: 'Установка',
      value: '2 шага',
      detail: 'Сначала nv, потом NeuralV.'
    },
    {
      label: 'Shell flow',
      value: 'nv',
      detail: 'Один инструмент для install, uninstall и версии.'
    },
    {
      label: 'Daemon',
      value: 'opt-in',
      detail: 'Resident слой включается отдельно, когда он реально нужен.'
    }
  ] satisfies LinuxFact[],
  installSteps: [
    {
      title: 'Поставить nv',
      description: 'Bootstrap ставит только менеджер nv. Он нужен, чтобы дальше подтягивать NeuralV без ручной возни.',
      command: linuxBootstrapCommand
    },
    {
      title: 'Поставить последнюю версию NeuralV',
      description: 'Стандартный путь для большинства пользователей Linux.',
      command: linuxInstallCommand
    },
    {
      title: 'При необходимости зафиксировать версию',
      description: 'Если знаешь номер релиза, можно поставить конкретную версию вместо latest.',
      command: 'nv install neuralv@<версия>'
    }
  ] satisfies LinuxStep[],
  features: [
    {
      title: 'Linux GUI',
      description: 'Графическая версия для тех, кому нужен обычный desktop-интерфейс.',
      bullets: ['Вход и история', 'Серверные проверки', 'Обычный install через страницу загрузки']
    },
    {
      title: 'Shell / TUI',
      description: 'Удобный путь для терминала, VPS и SSH-сессий.',
      bullets: ['Команды через nv', 'Один login backend', 'Подходит для headless машин']
    },
    {
      title: 'Daemon',
      description: 'Постоянный мониторинг включается отдельно, чтобы не перегружать базовую установку.',
      bullets: ['systemd-путь', 'Resident monitoring', 'Отдельное включение только когда надо']
    }
  ] satisfies LinuxFeature[],
  checks: [
    {
      title: 'Локально на Linux',
      description: 'Быстрые сигналы прямо на устройстве.',
      bullets: ['ELF и AppImage', '.desktop и shell launchers', 'Autostart, permissions и provenance']
    },
    {
      title: 'Серверно',
      description: 'Глубокая перепроверка без лишнего шума в выдаче.',
      bullets: ['Hash / reputation', 'Статический анализ бинарников', 'AI-фильтр перед итоговым отчётом']
    }
  ] satisfies LinuxFeature[],
  commands: [
    {
      label: 'Установить',
      command: linuxInstallCommand
    },
    {
      label: 'Удалить',
      command: 'nv uninstall neuralv'
    },
    {
      label: 'Версия nv',
      command: 'nv -v'
    }
  ] satisfies LinuxCommandRow[]
};
