const state = {
  linux: {
    title: 'Linux',
    manifestUrl: 'https://raw.githubusercontent.com/Perdonus/NV/linux-builds/manifest.json',
    fallbackVersion: '1.1.0',
    command: [
      '# 1. Установить NV',
      'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh',
      '',
      '# 2. Добавить NV в PATH для текущего окна',
      'export PATH="$HOME/.local/bin:$PATH"',
      '',
      '# 3. Проверить NV',
      'nv -v'
    ].join('\n'),
    note: 'После этого можно ставить пакеты через nv install <package>@latest'
  },
  windows: {
    title: 'Windows',
    manifestUrl: 'https://raw.githubusercontent.com/Perdonus/NV/windows-builds/manifest.json',
    fallbackVersion: '1.1.0',
    command: [
      'REM 1. Установить NV',
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://sosiskibot.ru/neuralv/install/nv.ps1 | iex"',
      '',
      'REM 2. Добавить NV в PATH для текущего окна',
      'set "PATH=%LOCALAPPDATA%\\NV;%PATH%"',
      '',
      'REM 3. Проверить NV',
      'nv -v'
    ].join('\n'),
    note: 'После этого можно ставить пакеты через nv install <package>@latest'
  }
};

const els = {
  title: document.getElementById('platform-title'),
  version: document.getElementById('platform-version'),
  command: document.getElementById('install-command'),
  note: document.getElementById('download-note'),
  copy: document.getElementById('copy-command'),
  tabs: Array.from(document.querySelectorAll('.tab-button'))
};

async function resolvePlatform(platform) {
  const config = state[platform];
  const fallback = {
    version: config.fallbackVersion
  };

  try {
    const response = await fetch(config.manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    const json = await response.json();
    const artifact = Array.isArray(json.artifacts) ? json.artifacts[0] : null;
    return {
      version: artifact?.version || fallback.version
    };
  } catch (error) {
    console.warn('NV manifest fallback', platform, error);
    return fallback;
  }
}

async function applyPlatform(platform) {
  const config = state[platform];
  els.tabs.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.platform === platform);
  });
  els.title.textContent = config.title;
  els.command.textContent = config.command;
  els.note.textContent = config.note;
  els.version.textContent = 'Загрузка…';

  const resolved = await resolvePlatform(platform);
  els.version.textContent = resolved.version;
}

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => applyPlatform(tab.dataset.platform));
});

els.copy.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(els.command.textContent || '');
    els.copy.textContent = 'Скопировано';
    setTimeout(() => {
      els.copy.textContent = 'Копировать';
    }, 1600);
  } catch (error) {
    console.warn('copy failed', error);
  }
});

applyPlatform('linux');
