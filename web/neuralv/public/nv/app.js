const API_BASE = '/basedata/api';
const API = {
  registry: `${API_BASE}/packages/registry`,
  catalog: `${API_BASE}/packages/catalog`,
  creator: (slug) => `${API_BASE}/packages/creators/${encodeURIComponent(slug)}`,
  authConfig: `${API_BASE}/nv/auth/config`,
  authMe: `${API_BASE}/nv/auth/me`,
  authLogin: `${API_BASE}/nv/auth/telegram`,
  authLogout: `${API_BASE}/nv/auth/logout`,
  publishPackage: `${API_BASE}/packages/publish`,
  publishRelease: (creator, name) => `${API_BASE}/packages/${encodeURIComponent(creator)}/${encodeURIComponent(name)}/releases`
};

const fallbackRegistry = {
  packages: [
    {
      name: '@lvls/nv',
      title: 'NV',
      description: 'Пакетный менеджер для Windows и Linux.',
      homepage: '/nv/',
      latest_version: '1.3.4',
      variants: [
        {
          id: 'nv-linux',
          label: 'Linux',
          os: 'linux',
          version: '1.3.4',
          install_command: 'curl -fsSL https://raw.githubusercontent.com/Perdonus/NV/linux-builds/nv.sh | sh',
          download_url: 'https://raw.githubusercontent.com/Perdonus/NV/linux-builds/linux/nv-linux-1.3.4.tar.gz'
        },
        {
          id: 'nv-windows',
          label: 'Windows',
          os: 'windows',
          version: '1.3.4',
          install_command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Perdonus/NV/windows-builds/nv.ps1 | iex"',
          download_url: 'https://raw.githubusercontent.com/Perdonus/NV/windows-builds/windows/nv-1.3.4.exe'
        }
      ]
    },
    {
      name: '@lvls/neuralv',
      title: 'NeuralV',
      description: 'Клиент защиты для Windows и Linux.',
      homepage: '/neuralv/',
      latest_version: '1.5.6',
      variants: [
        { id: 'windows', label: 'Windows', os: 'windows', version: '1.5.6' },
        { id: 'linux', label: 'Linux', os: 'linux', version: '1.4.0' }
      ]
    }
  ]
};

const state = {
  page: document.body.dataset.page || 'home',
  registry: fallbackRegistry,
  catalogPackages: [],
  creators: [],
  platformFilter: 'all',
  searchTerm: '',
  downloadPlatform: 'linux',
  profileRequestId: 0,
  auth: {
    loading: true,
    enabled: false,
    botUsername: '',
    issues: null,
    user: null,
    creator: null,
    error: null
  }
};

function escapeHtml(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function safeArray(value) {
  return Array.isArray(value) ? value : [];
}

function platformLabel(os) {
  if (os === 'windows') return 'Windows';
  if (os === 'linux') return 'Linux';
  return os || 'Платформа';
}

function parsePackageName(rawName) {
  const matched = /^@([^/]+)\/(.+)$/.exec(String(rawName || '').trim());
  if (!matched) {
    return { creator: 'unknown', packageName: String(rawName || '').trim() || 'package', canonicalName: String(rawName || '').trim() || 'package' };
  }
  return {
    creator: matched[1],
    packageName: matched[2],
    canonicalName: `@${matched[1]}/${matched[2]}`
  };
}

function normalizeCreatorSlug(value) {
  return String(value || '').trim().replace(/^@+/, '').toLowerCase();
}

function isTelegramDomainError(message) {
  return /bot domain invalid|domain invalid|origin invalid/i.test(String(message || ''));
}

function authConfigStatus() {
  const issues = state.auth.issues || {};
  if (issues.missing_bot_username || issues.missing_bot_token) {
    return {
      title: 'Telegram login ещё не настроен',
      body: 'Вход для авторов появится после привязки бота к сайту.',
      hint: 'Для виджета должен быть разрешён домен sosiskibot.ru.'
    };
  }
  if (issues.missing_session_secret) {
    return {
      title: 'Авторизация временно недоступна',
      body: 'Сайт не может открыть сессию автора.',
      hint: 'Проверь конфиг NV сайта и секрет сессии.'
    };
  }
  return {
    title: 'Вход временно недоступен',
    body: 'Telegram login сейчас отключён.',
    hint: 'Попробуй позже.'
  };
}

function authErrorStatus(rawMessage) {
  const message = String(rawMessage || '').trim();
  if (!message) {
    return {
      title: 'Вход временно недоступен',
      body: 'Telegram login сейчас не отвечает.',
      hint: 'Попробуй позже.'
    };
  }
  if (isTelegramDomainError(message)) {
    return {
      title: 'Telegram login настроен не до конца',
      body: 'Виджет отклонил домен сайта.',
      hint: 'Для бота должен быть разрешён домен sosiskibot.ru в BotFather.'
    };
  }
  if (/not configured|не настро/i.test(message)) {
    return {
      title: 'Telegram login ещё не настроен',
      body: 'Сайт пока не может открыть вход для авторов.',
      hint: 'Проверь токен бота, username и домен сайта.'
    };
  }
  if (/telegram/i.test(message)) {
    return {
      title: 'Не удалось завершить вход через Telegram',
      body: 'Telegram не подтвердил логин для сайта.',
      hint: 'Проверь домен бота и попробуй открыть вход снова.'
    };
  }
  return {
    title: 'Вход временно недоступен',
    body: message,
    hint: 'Попробуй ещё раз чуть позже.'
  };
}

function renderTelegramLoginButton(slotId, label = 'Войти') {
  return `
    <div class="auth-widget-shell">
      <div class="auth-widget-button" aria-hidden="true">
        <span class="auth-widget-button-mark">TG</span>
        <span class="auth-widget-button-copy">${escapeHtml(label)}</span>
      </div>
      <div class="auth-widget-overlay" id="${escapeHtml(slotId)}"></div>
    </div>
  `;
}

function ownerProfileLink() {
  return '/nv/profile/owner/';
}

function creatorLink(creator) {
  const slug = normalizeCreatorSlug(creator);
  return slug ? `/nv/profile/creator/?slug=${encodeURIComponent(slug)}` : '/nv/profile/creator/';
}

function normalizeVariant(variant) {
  return {
    id: String(variant.id || '').trim(),
    label: String(variant.label || platformLabel(variant.os)).trim(),
    os: String(variant.os || 'unknown').trim().toLowerCase(),
    version: String(variant.version || '').trim(),
    downloadUrl: String(variant.download_url || '').trim(),
    installCommand: String(
      variant.install_command ||
      variant.metadata?.commands?.powershell?.install ||
      variant.metadata?.commands?.cmd?.install ||
      ''
    ).trim(),
    metadata: variant.metadata || {}
  };
}

function normalizeRegistryPackage(pkg) {
  const identity = parsePackageName(pkg.name);
  const variants = safeArray(pkg.variants).map(normalizeVariant);
  const platforms = [...new Set(variants.map((variant) => variant.os).filter(Boolean))];
  return {
    name: identity.canonicalName,
    creator: identity.creator,
    packageName: identity.packageName,
    title: String(pkg.title || identity.packageName).trim(),
    description: String(pkg.description || '').trim(),
    homepage: String(pkg.homepage || '').trim(),
    latestVersion: String(pkg.latest_version || variants[0]?.version || '—').trim(),
    variants,
    platforms
  };
}

function normalizeCatalogPackage(pkg) {
  const identity = parsePackageName(pkg.name);
  const platforms = safeArray(pkg.platforms).map((item) => String(item || '').trim().toLowerCase()).filter(Boolean);
  return {
    name: identity.canonicalName,
    creator: identity.creator,
    packageName: identity.packageName,
    title: String(pkg.title || identity.packageName).trim(),
    description: String(pkg.description || '').trim(),
    homepage: String(pkg.homepage || '').trim(),
    latestVersion: String(pkg.latest_version || '—').trim(),
    platforms,
    installCommand: String(pkg.install_command || `nv install ${identity.canonicalName}`).trim(),
    source: String(pkg.source || '').trim()
  };
}

function deriveCatalogFromRegistry() {
  const packages = safeArray(state.registry.packages).map(normalizeRegistryPackage).map((pkg) => ({
    ...pkg,
    installCommand: `nv install ${pkg.name}`,
    source: 'registry'
  }));
  const creatorsMap = new Map();
  for (const pkg of packages) {
    const current = creatorsMap.get(pkg.creator) || {
      slug: pkg.creator,
      display_name: pkg.creator,
      avatar_url: '',
      package_count: 0
    };
    current.package_count += 1;
    creatorsMap.set(pkg.creator, current);
  }
  state.catalogPackages = packages;
  state.creators = [...creatorsMap.values()].sort((left, right) => left.slug.localeCompare(right.slug, 'ru'));
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    cache: 'no-store',
    credentials: 'include',
    headers: {
      Accept: 'application/json',
      ...(options.headers || {})
    },
    ...options
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = payload?.error || `HTTP ${response.status}`;
    const error = new Error(message);
    error.status = response.status;
    error.code = payload?.code || '';
    error.payload = payload;
    throw error;
  }
  return payload;
}

async function loadRegistry() {
  try {
    const payload = await fetchJson(API.registry);
    if (!Array.isArray(payload.packages)) {
      throw new Error('Registry payload is invalid');
    }
    state.registry = payload;
  } catch (error) {
    console.warn('NV registry fallback', error);
    state.registry = fallbackRegistry;
  }
}

async function loadCatalog() {
  try {
    const payload = await fetchJson(API.catalog);
    state.catalogPackages = safeArray(payload.packages).map(normalizeCatalogPackage);
    state.creators = safeArray(payload.creators).map((creator) => ({
      slug: String(creator.slug || '').trim(),
      display_name: String(creator.display_name || creator.slug || '').trim(),
      avatar_url: String(creator.avatar_url || '').trim(),
      package_count: Number(creator.package_count || 0)
    }));
    if (!state.catalogPackages.length) {
      deriveCatalogFromRegistry();
    }
  } catch (error) {
    console.warn('NV catalog fallback', error);
    deriveCatalogFromRegistry();
  }
}

async function loadCreatorProfile(creatorSlug) {
  const slug = normalizeCreatorSlug(creatorSlug);
  if (!slug) {
    return {
      status: 'empty',
      creator: null,
      packages: [],
      viewer: { authenticated: Boolean(state.auth.creator?.slug), can_edit: false }
    };
  }
  try {
    const payload = await fetchJson(API.creator(slug));
    return {
      status: 'success',
      creator: payload.creator || null,
      packages: safeArray(payload.packages).map(normalizeCatalogPackage),
      viewer: payload.viewer || { authenticated: false, can_edit: false }
    };
  } catch (error) {
    if (error.status === 404) {
      return {
        status: 'not-found',
        creator: null,
        creatorSlug: slug,
        packages: [],
        viewer: { authenticated: Boolean(state.auth.creator?.slug), can_edit: false },
        error
      };
    }
    console.warn('NV creator profile request failed', error);
    return {
      status: 'error',
      creator: null,
      creatorSlug: slug,
      packages: [],
      viewer: { authenticated: Boolean(state.auth.creator?.slug), can_edit: false },
      error
    };
  }
}

async function loadAuthState() {
  state.auth.loading = true;
  renderAuthSlot();
  try {
    const [config, session] = await Promise.all([
      fetchJson(API.authConfig).catch(() => ({ enabled: false, bot_username: '' })),
      fetchJson(API.authMe).catch(() => ({ authenticated: false, user: null, creator: null }))
    ]);

    state.auth.enabled = Boolean(config.enabled);
    state.auth.botUsername = String(config.bot_username || '').trim();
    state.auth.issues = config.issues || null;
    state.auth.user = session.authenticated ? session.user || null : null;
    state.auth.creator = session.authenticated ? session.creator || null : null;
    state.auth.error = null;
  } catch (error) {
    console.warn('NV auth bootstrap failed', error);
    state.auth.enabled = false;
    state.auth.botUsername = '';
    state.auth.issues = null;
    state.auth.user = null;
    state.auth.creator = null;
    state.auth.error = error instanceof Error ? error.message : 'Не удалось загрузить вход';
  } finally {
    state.auth.loading = false;
    renderAuthSlot();
  }
}

function authDisplayName() {
  if (!state.auth.user) return 'NV user';
  return state.auth.user.display_name || [state.auth.user.first_name, state.auth.user.last_name].filter(Boolean).join(' ').trim() || state.auth.user.username || 'NV user';
}

function authHandle() {
  if (state.auth.creator?.slug) return `@${state.auth.creator.slug}`;
  if (state.auth.user?.username) return `@${state.auth.user.username}`;
  return 'Telegram';
}

function authAvatarMarkup(sizeClass = 'auth-avatar') {
  if (state.auth.user?.photo_url) {
    return `<span class="${sizeClass}"><img class="auth-avatar-image" src="${escapeHtml(state.auth.user.photo_url)}" alt="${escapeHtml(authDisplayName())}" /></span>`;
  }
  const letter = authDisplayName().charAt(0).toUpperCase() || 'N';
  return `<span class="${sizeClass}"><span class="auth-avatar-fallback">${escapeHtml(letter)}</span></span>`;
}

function mountTelegramWidget(container) {
  if (!container || !state.auth.enabled || !state.auth.botUsername) return;
  container.innerHTML = '';
  const host = document.createElement('div');
  host.className = 'telegram-widget-host';
  const script = document.createElement('script');
  script.async = true;
  script.src = 'https://telegram.org/js/telegram-widget.js?22';
  script.setAttribute('data-telegram-login', state.auth.botUsername);
  script.setAttribute('data-size', 'large');
  script.setAttribute('data-userpic', 'false');
  script.setAttribute('data-radius', '999');
  script.setAttribute('data-request-access', 'write');
  script.setAttribute('data-onauth', 'window.NVTelegramAuth(user)');
  script.addEventListener('error', () => {
    state.auth.error = 'Telegram login сейчас не загружается';
    renderAuthSlot();
    if (state.page === 'profile') {
      renderProfile();
    }
  });
  host.appendChild(script);
  container.appendChild(host);
}

function renderAuthSlot() {
  const slot = document.getElementById('auth-slot');
  if (!slot) return;

  if (state.auth.loading) {
    slot.innerHTML = '<div class="auth-status-card">Проверяем вход…</div>';
    return;
  }

  if (state.auth.user && state.auth.creator) {
    slot.innerHTML = `
      <div class="auth-user-card">
        <a class="auth-user-link" href="${ownerProfileLink()}">
          ${authAvatarMarkup('auth-avatar')}
          <span class="auth-meta">
            <strong>${escapeHtml(authDisplayName())}</strong>
            <span>${escapeHtml(authHandle())}</span>
          </span>
        </a>
        <button class="ghost-button ghost-button-compact" type="button" id="nv-logout-button">Выйти</button>
      </div>
    `;
    document.getElementById('nv-logout-button')?.addEventListener('click', logoutSiteUser);
    return;
  }

  if (state.auth.error) {
    const status = authErrorStatus(state.auth.error);
    slot.innerHTML = `
      <div class="auth-widget-card auth-widget-card-error">
        <div class="auth-widget-copy">
          <strong>${escapeHtml(status.title)}</strong>
          <span>${escapeHtml(status.body)}</span>
          <span class="auth-widget-hint">${escapeHtml(status.hint)}</span>
        </div>
        ${state.auth.enabled ? renderTelegramLoginButton('telegram-widget-slot', 'Попробовать ещё раз') : ''}
      </div>
    `;
    if (state.auth.enabled) {
      mountTelegramWidget(document.getElementById('telegram-widget-slot'));
    }
    return;
  }

  if (!state.auth.enabled) {
    const status = authConfigStatus();
    slot.innerHTML = `
      <div class="auth-status-card compact-status">
        <span>${escapeHtml(status.title)}</span>
      </div>
    `;
    return;
  }

  slot.innerHTML = `
    <div class="auth-widget-card auth-widget-card-login">
      ${renderTelegramLoginButton('telegram-widget-slot', 'Войти через Telegram')}
    </div>
  `;
  mountTelegramWidget(document.getElementById('telegram-widget-slot'));
}

async function handleTelegramWidgetAuth(user) {
  try {
    const payload = await fetchJson(API.authLogin, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ telegram_auth: user })
    });
    state.auth.user = payload.user || null;
    state.auth.creator = payload.creator || null;
    state.auth.error = null;
    renderAuthSlot();
    if (state.page === 'profile') {
      const route = readProfileRoute();
      if (route.view === 'landing' || route.view === 'owner') {
        window.location.assign(ownerProfileLink());
        return;
      }
      await renderProfile();
    }
  } catch (error) {
    console.warn('NV Telegram login failed', error);
    state.auth.error = error instanceof Error ? error.message : 'Не удалось завершить вход';
    renderAuthSlot();
  }
}

async function logoutSiteUser() {
  try {
    await fetchJson(API.authLogout, { method: 'POST' });
  } catch (error) {
    console.warn('NV logout failed', error);
  }
  state.auth.user = null;
  state.auth.creator = null;
  state.auth.error = null;
  renderAuthSlot();
  if (state.page === 'profile') {
    const route = readProfileRoute();
    if (route.view === 'owner') {
      window.location.assign('/nv/profile/');
      return;
    }
    await renderProfile();
  }
}

function renderPlatformBadges(platforms) {
  return safeArray(platforms)
    .map((platform) => `<span class="badge">${escapeHtml(platformLabel(platform))}</span>`)
    .join('');
}

function renderPackageCard(pkg) {
  return `
    <article class="package-card">
      <div class="package-head">
        <div>
          <p class="package-title">${escapeHtml(pkg.title)}</p>
          <div class="package-ref">
            <a class="package-name" href="${creatorLink(pkg.creator)}">@${escapeHtml(pkg.creator)}</a>
            <span>/</span>
            <span class="package-leaf">${escapeHtml(pkg.packageName)}</span>
          </div>
        </div>
        <span class="version-pill">${escapeHtml(pkg.latestVersion || '—')}</span>
      </div>
      <p class="package-description">${escapeHtml(pkg.description || 'Пакет для NV.')}</p>
      <div class="badge-row">${renderPlatformBadges(pkg.platforms)}</div>
      <div class="command-inline">
        <code>${escapeHtml(pkg.installCommand || `nv install ${pkg.name}`)}</code>
        <button class="text-button" type="button" data-copy="${escapeHtml(pkg.installCommand || `nv install ${pkg.name}`)}">Копировать</button>
      </div>
      <div class="package-actions">
        <a class="ghost-button ghost-button-compact" href="${creatorLink(pkg.creator)}">Профиль</a>
        ${pkg.homepage ? `<a class="ghost-button ghost-button-compact" href="${escapeHtml(pkg.homepage)}">Сайт</a>` : ''}
      </div>
    </article>
  `;
}

function renderCreatorCard(creator) {
  return `
    <article class="creator-card">
      <div>
        <p class="creator-title">@${escapeHtml(creator.slug)}</p>
        <p class="creator-meta">${escapeHtml(String(creator.package_count || 0))} пакета</p>
      </div>
      <a class="ghost-button ghost-button-compact" href="${creatorLink(creator.slug)}">Открыть</a>
    </article>
  `;
}

function renderHome() {
  const packagesEl = document.getElementById('featured-packages');
  if (!packagesEl) return;

  const featuredPackages = state.catalogPackages.slice(0, 4);
  packagesEl.innerHTML = featuredPackages.length
    ? featuredPackages.map(renderPackageCard).join('')
    : '<p class="empty-state">Пакеты появятся здесь сразу после первой публикации.</p>';
}

function resolveNvVariant(platform) {
  const nvPackage = safeArray(state.registry.packages)
    .map(normalizeRegistryPackage)
    .find((pkg) => pkg.packageName === 'nv');
  return nvPackage?.variants.find((variant) => variant.os === platform) || null;
}

function applyDownloadPlatform(platform) {
  state.downloadPlatform = platform;
  const variant = resolveNvVariant(platform);
  const title = document.getElementById('platform-title');
  const version = document.getElementById('platform-version');
  const command = document.getElementById('install-command');
  const note = document.getElementById('download-note');
  const actions = document.getElementById('platform-actions');
  const tabs = Array.from(document.querySelectorAll('.tab-button'));

  tabs.forEach((tab) => tab.classList.toggle('is-active', tab.dataset.platform === platform));
  if (title) title.textContent = platformLabel(platform);
  if (version) version.textContent = variant?.version || '—';
  if (command) {
    command.textContent = platform === 'windows'
      ? String(variant?.metadata?.commands?.powershell?.install || variant?.installCommand || '')
      : String(variant?.installCommand || '');
  }
  if (actions) {
    const buttons = [];
    if (variant?.downloadUrl) {
      buttons.push(`<a class="primary-button" href="${escapeHtml(variant.downloadUrl)}">Скачать бинарник</a>`);
    }
    const extraCommand = platform === 'windows'
      ? String(variant?.metadata?.commands?.cmd?.install || '')
      : '';
    if (extraCommand) {
      buttons.push(`<button class="ghost-button" type="button" data-copy="${escapeHtml(extraCommand)}">Копировать CMD</button>`);
    }
    actions.innerHTML = buttons.join('');
  }
  if (note) {
    note.textContent = platform === 'windows'
      ? 'Windows версия ставится в профиль пользователя, после чего NV можно использовать сразу из PowerShell или CMD.'
      : 'Linux версия ставится в пользовательский bin, после чего команды nv install @creator/package работают сразу.';
  }
}

function attachDownloadTabs() {
  const tabs = Array.from(document.querySelectorAll('.tab-button'));
  const copyButton = document.getElementById('copy-command');
  const command = document.getElementById('install-command');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => applyDownloadPlatform(tab.dataset.platform || 'linux'));
  });

  copyButton?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(command?.textContent || '');
      copyButton.textContent = 'Скопировано';
      setTimeout(() => {
        copyButton.textContent = 'Копировать';
      }, 1400);
    } catch (error) {
      console.warn('Copy command failed', error);
    }
  });

  applyDownloadPlatform(state.downloadPlatform);
}

function packageMatchesFilters(pkg) {
  if (state.platformFilter !== 'all' && !safeArray(pkg.platforms).includes(state.platformFilter)) {
    return false;
  }
  if (!state.searchTerm) return true;
  const haystack = [pkg.name, pkg.title, pkg.description, pkg.latestVersion, ...safeArray(pkg.platforms)].join(' ').toLowerCase();
  return haystack.includes(state.searchTerm);
}

function renderCatalog() {
  const list = document.getElementById('package-list');
  const empty = document.getElementById('package-empty');
  const meta = document.getElementById('catalog-meta');
  if (!list || !empty || !meta) return;

  const filtered = state.catalogPackages.filter(packageMatchesFilters);
  list.innerHTML = filtered.map(renderPackageCard).join('');
  empty.hidden = filtered.length > 0;
  meta.textContent = `${filtered.length} пакета · ${state.creators.length} создателя`;
}

function attachCatalogControls() {
  const buttons = Array.from(document.querySelectorAll('.filter-button'));
  const search = document.getElementById('package-search');
  const params = new URLSearchParams(window.location.search);
  const creatorFilter = normalizeCreatorSlug(params.get('creator'));
  const initialSearch = String(params.get('q') || params.get('search') || (creatorFilter ? `@${creatorFilter}/` : '')).trim();

  if (initialSearch) {
    state.searchTerm = initialSearch.toLowerCase();
    if (search) {
      search.value = initialSearch;
    }
  }

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      state.platformFilter = button.dataset.filter || 'all';
      buttons.forEach((item) => item.classList.toggle('is-active', item === button));
      renderCatalog();
    });
  });

  search?.addEventListener('input', () => {
    state.searchTerm = String(search.value || '').trim().toLowerCase();
    renderCatalog();
  });

  renderCatalog();
}

function publishFormMarkup(creatorSlug, packages) {
  const packageOptions = packages.length
    ? packages.map((pkg) => `<option value="${escapeHtml(pkg.packageName)}">${escapeHtml(pkg.title)} (${escapeHtml(pkg.name)})</option>`).join('')
    : '<option value="neuralv-addon">Новый пакет</option>';

  return `
    <section class="section-shell publish-shell">
      <div class="section-head">
        <div>
          <p class="eyebrow">Публикация</p>
          <h2>Выложить пакет</h2>
        </div>
      </div>
      <div class="publish-grid">
        <form class="publish-form" id="package-form">
          <h3>Карточка пакета</h3>
          <label><span>Slug</span><input name="package_slug" type="text" placeholder="my-tool" required /></label>
          <label><span>Название</span><input name="title" type="text" placeholder="Мой пакет" required /></label>
          <label><span>Описание</span><textarea name="description" rows="4" placeholder="Коротко: что это за пакет"></textarea></label>
          <label><span>Сайт</span><input name="homepage" type="url" placeholder="https://example.com" /></label>
          <label><span>Теги</span><input name="tags" type="text" placeholder="cli, tools" /></label>
          <div class="checkbox-row">
            <label><input type="checkbox" name="platforms" value="windows" /> Windows</label>
            <label><input type="checkbox" name="platforms" value="linux" /> Linux</label>
          </div>
          <button class="primary-button" type="submit">Сохранить пакет</button>
          <p class="form-status" id="package-form-status"></p>
        </form>

        <form class="publish-form" id="release-form">
          <h3>Выложить релиз</h3>
          <label><span>Пакет</span>
            <select name="package_slug">${packageOptions}</select>
          </label>
          <label><span>Версия</span><input name="version" type="text" placeholder="1.0.0" required /></label>
          <label><span>Платформа</span>
            <select name="os">
              <option value="windows">Windows</option>
              <option value="linux">Linux</option>
            </select>
          </label>
          <label><span>Файл</span><input name="file_name" type="text" placeholder="tool-1.0.0.zip" /></label>
          <label><span>Ссылка</span><input name="download_url" type="url" placeholder="https://..." required /></label>
          <label><span>Команда install</span><input name="install_command" type="text" placeholder="nv install @${escapeHtml(creatorSlug)}/package" /></label>
          <label><span>Команда update</span><input name="update_command" type="text" placeholder="nv install @${escapeHtml(creatorSlug)}/package" /></label>
          <label><span>SHA256</span><input name="sha256" type="text" placeholder="optional" /></label>
          <button class="primary-button" type="submit">Опубликовать релиз</button>
          <p class="form-status" id="release-form-status"></p>
        </form>
      </div>
    </section>
  `;
}

async function submitPackageForm(form, creatorSlug) {
  const formData = new FormData(form);
  const platforms = formData.getAll('platforms').map((entry) => String(entry));
  const tags = String(formData.get('tags') || '')
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean);

  return fetchJson(API.publishPackage, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      creator_slug: creatorSlug,
      package_slug: String(formData.get('package_slug') || '').trim(),
      title: String(formData.get('title') || '').trim(),
      description: String(formData.get('description') || '').trim(),
      homepage: String(formData.get('homepage') || '').trim(),
      platforms,
      tags,
      visibility: 'public'
    })
  });
}

async function submitReleaseForm(form, creatorSlug) {
  const formData = new FormData(form);
  const packageSlug = String(formData.get('package_slug') || '').trim();
  return fetchJson(API.publishRelease(creatorSlug, packageSlug), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      version: String(formData.get('version') || '').trim(),
      os: String(formData.get('os') || '').trim(),
      file_name: String(formData.get('file_name') || '').trim(),
      download_url: String(formData.get('download_url') || '').trim(),
      install_command: String(formData.get('install_command') || '').trim(),
      update_command: String(formData.get('update_command') || '').trim(),
      sha256: String(formData.get('sha256') || '').trim(),
      channel: 'community'
    })
  });
}

function bindProfileForms(creatorSlug) {
  const packageForm = document.getElementById('package-form');
  const releaseForm = document.getElementById('release-form');
  const packageStatus = document.getElementById('package-form-status');
  const releaseStatus = document.getElementById('release-form-status');

  packageForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (packageStatus) packageStatus.textContent = 'Сохраняем пакет…';
    try {
      await submitPackageForm(packageForm, creatorSlug);
      if (packageStatus) packageStatus.textContent = 'Пакет сохранён.';
      await renderProfile();
    } catch (error) {
      if (packageStatus) packageStatus.textContent = error instanceof Error ? error.message : 'Не удалось сохранить пакет';
    }
  });

  releaseForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (releaseStatus) releaseStatus.textContent = 'Публикуем релиз…';
    try {
      await submitReleaseForm(releaseForm, creatorSlug);
      if (releaseStatus) releaseStatus.textContent = 'Релиз опубликован.';
      await renderProfile();
    } catch (error) {
      if (releaseStatus) releaseStatus.textContent = error instanceof Error ? error.message : 'Не удалось выложить релиз';
    }
  });
}

function readProfileRoute() {
  const url = new URL(window.location.href);
  const normalizedPath = url.pathname.endsWith('/') ? url.pathname : `${url.pathname}/`;
  const profilePrefix = '/nv/profile/';
  const relativePath = normalizedPath.startsWith(profilePrefix) ? normalizedPath.slice(profilePrefix.length) : '';
  const segments = relativePath.split('/').filter(Boolean);
  const legacyCreator = normalizeCreatorSlug(url.searchParams.get('creator'));
  const slugParam = normalizeCreatorSlug(url.searchParams.get('slug')) || legacyCreator;
  const firstSegment = segments[0] || '';

  if (firstSegment === 'owner') {
    return {
      view: 'owner',
      creatorSlug: normalizeCreatorSlug(state.auth.creator?.slug),
      legacyQuery: false
    };
  }
  if (firstSegment === 'creator') {
    return {
      view: 'creator',
      creatorSlug: slugParam,
      legacyQuery: Boolean(legacyCreator)
    };
  }
  if (firstSegment && firstSegment !== 'index.html') {
    return {
      view: 'creator',
      creatorSlug: normalizeCreatorSlug(firstSegment),
      legacyQuery: false
    };
  }
  if (slugParam) {
    return {
      view: 'creator',
      creatorSlug: slugParam,
      legacyQuery: true
    };
  }
  return { view: 'landing', creatorSlug: '', legacyQuery: false };
}

function syncLegacyProfileRoute(route) {
  if (state.page !== 'profile') return route;
  if (route.view === 'creator' && route.creatorSlug && route.legacyQuery) {
    window.history.replaceState({}, '', creatorLink(route.creatorSlug));
    return readProfileRoute();
  }
  return route;
}

function profileStateMarkup({ eyebrow = 'Профиль', title, copy, actions = '', extra = '' }) {
  return `
    <section class="section-shell state-shell">
      <p class="eyebrow">${escapeHtml(eyebrow)}</p>
      <div class="state-card">
        <div class="state-copy-block">
          <h1 class="section-title state-title">${escapeHtml(title)}</h1>
          <p class="section-copy state-copy">${escapeHtml(copy)}</p>
        </div>
        ${extra}
        ${actions ? `<div class="state-actions">${actions}</div>` : ''}
      </div>
    </section>
  `;
}

function profileAvatarMarkup(creator, { preferAuthAvatar = false } = {}) {
  if (preferAuthAvatar && state.auth.user?.photo_url) {
    return authAvatarMarkup('profile-avatar');
  }
  if (creator?.avatar_url) {
    return `<span class="profile-avatar"><img class="auth-avatar-image" src="${escapeHtml(creator.avatar_url)}" alt="${escapeHtml(creator.display_name || creator.slug || 'Автор')}" /></span>`;
  }
  const letter = String(creator?.display_name || creator?.slug || '@').trim().charAt(0).toUpperCase() || '@';
  return `<span class="profile-avatar"><span class="auth-avatar-fallback">${escapeHtml(letter)}</span></span>`;
}

function renderProfileHeader({ creator, packages, statusLabel, statusNote = '', actions = '', preferAuthAvatar = false }) {
  const subtitle = creator.display_name && creator.display_name !== creator.slug
    ? `<p class="profile-subtitle">${escapeHtml(creator.display_name)}</p>`
    : '';

  return `
    <section class="section-shell profile-shell">
      <div class="profile-head">
        <div class="profile-head-main">
          ${profileAvatarMarkup(creator, { preferAuthAvatar })}
          <div class="profile-head-copy">
            <p class="eyebrow">Профиль автора</p>
            <h1 class="section-title">@${escapeHtml(creator.slug)}</h1>
            ${subtitle}
            <p class="section-copy">${escapeHtml(creator.bio || 'Публичный профиль автора пакетов NV.')}</p>
          </div>
        </div>
        ${actions ? `<div class="profile-head-actions">${actions}</div>` : ''}
      </div>
      <div class="profile-metrics">
        <article class="metric-card">
          <span class="metric-value">${escapeHtml(String(packages.length))}</span>
          <span class="metric-label">пакетов</span>
        </article>
        <article class="metric-card">
          <span class="metric-value">${escapeHtml(`@${creator.slug}`)}</span>
          <span class="metric-label">namespace</span>
        </article>
        <article class="metric-card">
          <span class="metric-value">${escapeHtml(statusLabel)}</span>
          <span class="metric-label">режим</span>
          ${statusNote ? `<p class="metric-note">${escapeHtml(statusNote)}</p>` : ''}
        </article>
      </div>
    </section>
  `;
}

function renderProfilePackagesSection(packages, { eyebrow = 'Пакеты', title = 'Опубликованные пакеты', emptyTitle = 'Пока пусто', emptyCopy = 'Пакеты появятся после первой публикации.' } = {}) {
  return `
    <section class="section-shell">
      <div class="section-head">
        <div>
          <p class="eyebrow">${escapeHtml(eyebrow)}</p>
          <h2>${escapeHtml(packages.length ? title : emptyTitle)}</h2>
        </div>
      </div>
      ${packages.length
        ? `<div class="package-grid package-grid-wide">${packages.map(renderPackageCard).join('')}</div>`
        : `<p class="empty-state">${escapeHtml(emptyCopy)}</p>`}
    </section>
  `;
}

function renderLandingProfile(root) {
  const authenticated = Boolean(state.auth.user && state.auth.creator);
  const canLogin = !authenticated && state.auth.enabled && !state.auth.error;
  const authStatus = state.auth.error ? authErrorStatus(state.auth.error) : null;
  const actions = authenticated
    ? `
      <a class="primary-button" href="${ownerProfileLink()}">Открыть owner-зону</a>
      <a class="ghost-button" href="${creatorLink(state.auth.creator.slug)}">Публичный профиль</a>
      <a class="ghost-button" href="/nv/packages/">Каталог пакетов</a>
    `
    : `
      <a class="primary-button" href="/nv/packages/">Смотреть пакеты</a>
      <a class="ghost-button" href="/nv/downloads/">Установить NV</a>
    `;
  const note = authenticated
    ? `<p class="state-note">Ты уже вошёл как ${escapeHtml(authHandle())}. Дальше можно открыть owner-зону или публичный профиль.</p>`
    : `<p class="state-note">Публичные страницы доступны всем. Вход нужен только для публикации пакетов и релизов.</p>`;
  const widgetHost = canLogin
    ? `<div class="state-login-shell">${renderTelegramLoginButton('profile-telegram-widget-slot', 'Войти через Telegram')}</div>`
    : '';
  const authNote = authStatus && !authenticated
    ? `<p class="state-note">${escapeHtml(authStatus.title)}. ${escapeHtml(authStatus.hint)}</p>`
    : '';

  root.innerHTML = profileStateMarkup({
    eyebrow: 'Профиль',
    title: authenticated ? 'Профиль автора готов' : 'Профили NV',
    copy: authenticated
      ? 'Стартовая страница остаётся точкой входа, а публикация живёт в owner-зоне.'
      : 'Открывай публичные профили авторов или входи, чтобы публиковать свои пакеты.',
    actions,
    extra: `${note}${authNote}${widgetHost}`
  });

  if (widgetHost) {
    mountTelegramWidget(document.getElementById('profile-telegram-widget-slot'));
  }
}

function renderOwnerAccessState(root) {
  const hasWidget = state.auth.enabled && !state.auth.error;
  const authStatus = state.auth.error ? authErrorStatus(state.auth.error) : null;
  root.innerHTML = profileStateMarkup({
    eyebrow: 'Owner',
    title: 'Owner-зона требует вход',
    copy: hasWidget
      ? (authStatus
          ? `${authStatus.title}. ${authStatus.hint}`
          : 'Войди через Telegram, чтобы открыть публикацию пакетов и релизов.')
      : authConfigStatus().body,
    actions: `
      <a class="ghost-button" href="/nv/profile/">Вернуться к профилям</a>
      <a class="ghost-button" href="/nv/packages/">Открыть каталог</a>
    `,
    extra: hasWidget
      ? `<div class="state-login-shell">${renderTelegramLoginButton('profile-telegram-widget-slot', 'Войти через Telegram')}</div>`
      : ''
  });

  if (hasWidget) {
    mountTelegramWidget(document.getElementById('profile-telegram-widget-slot'));
  }
}

function renderProfileErrorState(root, { eyebrow = 'Профиль', title, copy, actions = '' }) {
  root.innerHTML = profileStateMarkup({ eyebrow, title, copy, actions });
}

function renderOwnerProfile(root, profile) {
  const creator = profile.creator || state.auth.creator || {
    slug: normalizeCreatorSlug(state.auth.creator?.slug),
    display_name: state.auth.creator?.display_name || state.auth.creator?.slug || '',
    bio: '',
    avatar_url: state.auth.creator?.avatar_url || '',
    telegram_username: '',
    links: []
  };
  const packages = profile.packages || [];

  root.innerHTML = `
    ${renderProfileHeader({
      creator,
      packages,
      statusLabel: 'owner',
      statusNote: 'Публикация пакетов и релизов доступна только здесь.',
      actions: `<a class="ghost-button" href="${creatorLink(creator.slug)}">Открыть публичную страницу</a>`,
      preferAuthAvatar: true
    })}
    ${publishFormMarkup(creator.slug, packages)}
    ${renderProfilePackagesSection(packages, {
      eyebrow: 'Пакеты автора',
      title: 'Опубликованные пакеты',
      emptyTitle: 'Пакетов ещё нет',
      emptyCopy: 'Namespace уже создан. Следующий шаг: сохранить карточку первого пакета и затем выложить релиз.'
    })}
  `;

  bindProfileForms(creator.slug);
}

function renderPublicCreatorProfile(root, profile) {
  const creator = profile.creator;
  const packages = profile.packages || [];
  const viewerCanEdit = Boolean(profile.viewer?.can_edit);
  const actions = viewerCanEdit
    ? `
      <a class="primary-button" href="${ownerProfileLink()}">Перейти в owner-зону</a>
      <a class="ghost-button" href="/nv/packages/?creator=${encodeURIComponent(creator.slug)}">Все пакеты</a>
    `
    : `<a class="ghost-button" href="/nv/packages/?creator=${encodeURIComponent(creator.slug)}">Все пакеты</a>`;

  root.innerHTML = `
    ${renderProfileHeader({
      creator,
      packages,
      statusLabel: 'public',
      statusNote: viewerCanEdit ? 'Это твой публичный creator profile.' : 'Эта страница только для чтения.',
      actions
    })}
    ${viewerCanEdit
      ? `
        <section class="section-shell section-shell-tight">
          <p class="state-note">Для редактирования карточек пакетов и публикации релизов используй owner-зону, а не публичную страницу.</p>
        </section>
      `
      : ''}
    ${renderProfilePackagesSection(packages, {
      eyebrow: 'Пакеты автора',
      title: 'Опубликованные пакеты',
      emptyTitle: 'Публичных пакетов пока нет',
      emptyCopy: 'У этого creator ещё нет опубликованных пакетов.'
    })}
  `;
}

async function renderProfile() {
  const root = document.getElementById('profile-content');
  if (!root) return;

  const requestId = ++state.profileRequestId;
  const route = syncLegacyProfileRoute(readProfileRoute());

  if (route.view === 'landing') {
    if (requestId !== state.profileRequestId) return;
    renderLandingProfile(root);
    return;
  }

  if (route.view === 'owner') {
    if (!state.auth.creator?.slug) {
      if (requestId !== state.profileRequestId) return;
      renderOwnerAccessState(root);
      return;
    }

    root.innerHTML = profileStateMarkup({
      eyebrow: 'Owner',
      title: 'Открываем creator-зону',
      copy: `Загружаем профиль @${state.auth.creator.slug} и формы публикации.`
    });

    const profile = await loadCreatorProfile(state.auth.creator.slug);
    if (requestId !== state.profileRequestId) return;

    if (profile.status === 'success') {
      renderOwnerProfile(root, profile);
      return;
    }

    if (profile.status === 'not-found') {
      renderProfileErrorState(root, {
        eyebrow: 'Owner',
        title: 'Профиль автора не найден',
        copy: `Профиль @${state.auth.creator.slug} не найден в каталоге. Попробуй выйти и войти снова через Telegram.`,
        actions: `<a class="ghost-button" href="/nv/profile/">Вернуться к профилям</a>`
      });
      return;
    }

    renderProfileErrorState(root, {
      eyebrow: 'Owner',
      title: 'Не удалось открыть owner-зону',
      copy: profile.error?.message || 'Профиль временно недоступен. Попробуй обновить страницу позже.',
      actions: `<a class="ghost-button" href="/nv/profile/">Вернуться к профилям</a>`
    });
    return;
  }

  if (!route.creatorSlug) {
    if (requestId !== state.profileRequestId) return;
    renderProfileErrorState(root, {
      eyebrow: 'Публичный профиль',
      title: 'Не указан slug автора',
      copy: 'Открой публичный профиль автора через каталог пакетов или передай slug в URL.',
      actions: `
        <a class="primary-button" href="/nv/packages/">Открыть каталог</a>
        <a class="ghost-button" href="/nv/profile/">Вернуться к профилям</a>
      `
    });
    return;
  }

  root.innerHTML = profileStateMarkup({
    eyebrow: 'Публичный профиль',
    title: `Загружаем @${route.creatorSlug}`,
    copy: 'Читаем публичный профиль автора и опубликованные пакеты.'
  });

  const profile = await loadCreatorProfile(route.creatorSlug);
  if (requestId !== state.profileRequestId) return;

  if (profile.status === 'success' && profile.creator) {
    renderPublicCreatorProfile(root, profile);
    return;
  }

  if (profile.status === 'not-found') {
    renderProfileErrorState(root, {
      eyebrow: 'Публичный профиль',
      title: 'Профиль не найден',
      copy: `У creator @${route.creatorSlug} пока нет публичной страницы или такой slug не существует.`,
      actions: `
        <a class="primary-button" href="/nv/packages/">Открыть каталог</a>
        <a class="ghost-button" href="/nv/profile/">Вернуться к профилям</a>
      `
    });
    return;
  }

  renderProfileErrorState(root, {
    eyebrow: 'Публичный профиль',
    title: 'Не удалось загрузить профиль',
    copy: profile.error?.message || 'Публичный профиль временно недоступен. Попробуй позже.',
    actions: `
      <a class="ghost-button" href="/nv/packages/">Открыть каталог</a>
      <a class="ghost-button" href="/nv/profile/">Вернуться к профилям</a>
    `
  });
}

async function copyFromData(button) {
  const payload = button.dataset.copy || '';
  try {
    await navigator.clipboard.writeText(payload);
    const original = button.textContent;
    button.textContent = 'Скопировано';
    setTimeout(() => {
      button.textContent = original;
    }, 1400);
  } catch (error) {
    console.warn('Clipboard write failed', error);
  }
}

function attachCopyDelegation() {
  document.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    const button = target.closest('[data-copy]');
    if (!(button instanceof HTMLButtonElement)) return;
    copyFromData(button);
  });
}

async function init() {
  window.NVTelegramAuth = handleTelegramWidgetAuth;
  attachCopyDelegation();

  if (state.page === 'home') {
    await loadRegistry();
    await Promise.all([loadCatalog(), loadAuthState()]);
    renderHome();
    return;
  }

  if (state.page === 'downloads') {
    await Promise.all([loadRegistry(), loadAuthState()]);
    attachDownloadTabs();
    return;
  }

  if (state.page === 'packages') {
    await Promise.all([loadCatalog(), loadAuthState()]);
    attachCatalogControls();
    return;
  }

  if (state.page === 'profile') {
    await loadAuthState();
    await renderProfile();
    return;
  }

  await loadAuthState();
}

init();
