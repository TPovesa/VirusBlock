const REGISTRY_URL = '/basedata/api/packages/registry';

const fallbackRegistry = {
  packages: [
    {
      name: '@lvls/nv',
      title: 'NV',
      description: 'Пакетный менеджер для установки, обновления и удаления приложений.',
      homepage: '/nv/',
      latest_version: '1.3.3',
      variants: [
        { id: 'nv-linux', label: 'Linux', os: 'linux', version: '1.3.3', install_command: 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh' },
        { id: 'nv-windows', label: 'Windows', os: 'windows', version: '1.3.3', install_command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://sosiskibot.ru/neuralv/install/nv.ps1 | iex"' }
      ]
    },
    {
      name: '@lvls/neuralv',
      title: 'NeuralV',
      description: 'Клиент защиты для Windows и Linux.',
      homepage: '/neuralv/',
      latest_version: '1.5.0',
      variants: [
        { id: 'windows', label: 'Windows', os: 'windows', version: '1.5.0' },
        { id: 'linux', label: 'Linux', os: 'linux', version: '1.4.0' }
      ]
    }
  ]
};

const state = {
  registry: fallbackRegistry,
  packageFilter: 'all',
  downloadPlatform: 'linux'
};

const page = document.body.dataset.page;

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function normalizeVariant(variant) {
  return {
    id: variant.id || '',
    label: variant.label || variant.os || 'Пакет',
    os: (variant.os || 'unknown').toLowerCase(),
    version: variant.version || '',
    installCommand:
      variant.install_command ||
      variant.metadata?.commands?.powershell?.install ||
      variant.metadata?.commands?.cmd?.install ||
      '',
    notes: Array.isArray(variant.notes) ? variant.notes : []
  };
}

function normalizePackage(pkg) {
  const variants = Array.isArray(pkg.variants) ? pkg.variants.map(normalizeVariant) : [];
  const platforms = [...new Set(variants.map((variant) => variant.os).filter(Boolean))];
  return {
    name: pkg.name || 'package',
    title: pkg.title || pkg.name || 'Package',
    description: pkg.description || 'Пакет для NV.',
    homepage: pkg.homepage || '',
    latestVersion: pkg.latest_version || variants[0]?.version || '—',
    variants,
    platforms
  };
}

async function loadRegistry() {
  try {
    const response = await fetch(REGISTRY_URL, { cache: 'no-store' });
    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }
    const json = await response.json();
    if (!Array.isArray(json.packages) || !json.packages.length) {
      throw new Error('Empty registry');
    }
    state.registry = { packages: json.packages };
  } catch (error) {
    console.warn('NV registry fallback', error);
    state.registry = fallbackRegistry;
  }
}

function getPackages() {
  return (state.registry.packages || []).map(normalizePackage);
}

function packageCommand(pkg) {
  return `nv install ${pkg.name}`;
}

function platformBadge(os) {
  if (os === 'windows') return 'Windows';
  if (os === 'linux') return 'Linux';
  return os;
}

function renderPackageCard(pkg) {
  const badges = pkg.platforms
    .map((os) => `<span class="badge">${escapeHtml(platformBadge(os))}</span>`)
    .join('');
  return `
    <article class="package-card">
      <div class="package-card-head">
        <div>
          <h3>${escapeHtml(pkg.title)}</h3>
          <p class="package-name">${escapeHtml(pkg.name)}</p>
        </div>
        <span class="version-pill">${escapeHtml(pkg.latestVersion)}</span>
      </div>
      <p>${escapeHtml(pkg.description)}</p>
      <div class="badge-row">${badges}</div>
      <pre>${escapeHtml(packageCommand(pkg))}</pre>
    </article>
  `;
}

function renderFeaturedPackages() {
  const container = document.getElementById('featured-packages');
  if (!container) return;
  const packages = getPackages().slice(0, 4);
  container.innerHTML = packages.map(renderPackageCard).join('');
}

function packageMatchesFilter(pkg, filter) {
  if (filter === 'all') return true;
  return pkg.platforms.includes(filter);
}

function renderCatalog() {
  const container = document.getElementById('package-list');
  const empty = document.getElementById('package-empty');
  if (!container || !empty) return;

  const packages = getPackages().filter((pkg) => packageMatchesFilter(pkg, state.packageFilter));
  container.innerHTML = packages.map(renderPackageCard).join('');
  empty.hidden = packages.length > 0;
}

function attachPackageFilters() {
  const buttons = Array.from(document.querySelectorAll('.filter-button'));
  if (!buttons.length) return;

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      state.packageFilter = button.dataset.filter || 'all';
      buttons.forEach((item) => item.classList.toggle('is-active', item === button));
      renderCatalog();
    });
  });
}

function resolveNvVariant(platform) {
  const packages = getPackages();
  const nvPackage = packages.find((pkg) => pkg.name === '@lvls/nv');
  return nvPackage?.variants.find((variant) => variant.os === platform) || null;
}

function platformCommand(platform) {
  if (platform === 'windows') {
    return [
      'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://sosiskibot.ru/neuralv/install/nv.ps1 | iex"',
      'nv -v'
    ].join('\n');
  }

  return [
    'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh',
    'export PATH="$HOME/.local/bin:$PATH"',
    'nv -v'
  ].join('\n');
}

function applyDownloadPlatform(platform) {
  state.downloadPlatform = platform;

  const title = document.getElementById('platform-title');
  const version = document.getElementById('platform-version');
  const command = document.getElementById('install-command');
  const note = document.getElementById('download-note');
  const tabs = Array.from(document.querySelectorAll('.tab-button'));
  const variant = resolveNvVariant(platform);

  tabs.forEach((button) => {
    button.classList.toggle('is-active', button.dataset.platform === platform);
  });

  if (title) title.textContent = platform === 'windows' ? 'Windows' : 'Linux';
  if (version) version.textContent = variant?.version || '—';
  if (command) command.textContent = platformCommand(platform);
  if (note) note.textContent =
    platform === 'windows'
      ? 'Для Windows доступна готовая команда, которая ставит NV и подготавливает среду для дальнейшей установки пакетов.'
      : 'Для Linux достаточно одной команды. После установки NV можно сразу ставить пакеты из каталога.';
}

function attachDownloadTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab-button'));
  if (!tabs.length) return;

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => applyDownloadPlatform(tab.dataset.platform || 'linux'));
  });

  const copyButton = document.getElementById('copy-command');
  const command = document.getElementById('install-command');
  if (copyButton && command) {
    copyButton.addEventListener('click', async () => {
      try {
        await navigator.clipboard.writeText(command.textContent || '');
        copyButton.textContent = 'Скопировано';
        setTimeout(() => {
          copyButton.textContent = 'Копировать';
        }, 1600);
      } catch (error) {
        console.warn('NV command copy failed', error);
      }
    });
  }

  applyDownloadPlatform(state.downloadPlatform);
}

async function init() {
  await loadRegistry();

  if (page === 'home') {
    renderFeaturedPackages();
    return;
  }

  if (page === 'downloads') {
    attachDownloadTabs();
    return;
  }

  if (page === 'packages') {
    attachPackageFilters();
    renderCatalog();
  }
}

init();
