const state = {
  linux: {
    title: 'Linux',
    manifestUrl: 'https://raw.githubusercontent.com/Perdonus/NV/linux-builds/manifest.json',
    fallbackVersion: '1.1.0',
    fallbackDownload: 'https://raw.githubusercontent.com/Perdonus/NV/linux-builds/linux/nv-linux-1.1.0.tar.gz',
    command: 'curl -fsSL https://raw.githubusercontent.com/Perdonus/NV/linux-builds/nv.sh | sh',
    note: 'Linux build branch: Perdonus/NV/linux-builds'
  },
  windows: {
    title: 'Windows',
    manifestUrl: 'https://raw.githubusercontent.com/Perdonus/NV/windows-builds/manifest.json',
    fallbackVersion: '1.1.0',
    fallbackDownload: 'https://raw.githubusercontent.com/Perdonus/NV/windows-builds/windows/nv-1.1.0.exe',
    command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Perdonus/NV/windows-builds/nv.ps1 | iex"',
    note: 'Windows build branch: Perdonus/NV/windows-builds'
  }
};

const els = {
  title: document.getElementById('platform-title'),
  version: document.getElementById('platform-version'),
  command: document.getElementById('install-command'),
  download: document.getElementById('download-link'),
  note: document.getElementById('download-note'),
  copy: document.getElementById('copy-command'),
  tabs: Array.from(document.querySelectorAll('.tab-button'))
};

async function resolvePlatform(platform) {
  const config = state[platform];
  const fallback = {
    version: config.fallbackVersion,
    downloadUrl: config.fallbackDownload
  };

  try {
    const response = await fetch(config.manifestUrl, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`manifest ${response.status}`);
    }

    const json = await response.json();
    const artifact = Array.isArray(json.artifacts) ? json.artifacts[0] : null;
    return {
      version: artifact?.version || fallback.version,
      downloadUrl: artifact?.download_url || fallback.downloadUrl
    };
  } catch (error) {
    console.warn('NV manifest fallback', platform, error);
    return fallback;
  }
}

async function applyPlatform(platform) {
  const config = state[platform];
  els.tabs.forEach((tab) => {
    tab.classList.toggle('is-active', tab.dataset.platform === platform);
  });

  els.title.textContent = config.title;
  els.command.textContent = config.command;
  els.note.textContent = config.note;
  els.version.textContent = 'Загрузка…';
  els.download.href = config.fallbackDownload;

  const resolved = await resolvePlatform(platform);
  els.version.textContent = resolved.version;
  els.download.href = resolved.downloadUrl;
  els.download.textContent = `Скачать ${config.title} build`;
}

els.tabs.forEach((tab) => {
  tab.addEventListener('click', () => applyPlatform(tab.dataset.platform));
});

els.copy.addEventListener('click', async () => {
  const text = els.command.textContent || '';
  try {
    await navigator.clipboard.writeText(text);
    const prev = els.copy.textContent;
    els.copy.textContent = 'Скопировано';
    setTimeout(() => {
      els.copy.textContent = prev;
    }, 1400);
  } catch (error) {
    console.warn('clipboard error', error);
  }
});

applyPlatform('linux');
