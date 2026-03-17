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
      latest_version: '1.3.3',
      variants: [
        {
          id: 'nv-linux',
          label: 'Linux',
          os: 'linux',
          version: '1.3.3',
          install_command: 'curl -fsSL https://raw.githubusercontent.com/Perdonus/NV/linux-builds/nv.sh | sh',
          download_url: 'https://raw.githubusercontent.com/Perdonus/NV/linux-builds/linux/nv-linux-1.3.3.tar.gz'
        },
        {
          id: 'nv-windows',
          label: 'Windows',
          os: 'windows',
          version: '1.3.3',
          install_command: 'powershell -NoProfile -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/Perdonus/NV/windows-builds/nv.ps1 | iex"',
          download_url: 'https://raw.githubusercontent.com/Perdonus/NV/windows-builds/windows/nv-1.3.3.exe'
        }
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
  page: document.body.dataset.page || 'home',
  registry: fallbackRegistry,
  catalogPackages: [],
  creators: [],
  platformFilter: 'all',
  searchTerm: '',
  downloadPlatform: 'linux',
  auth: {
    loading: true,
    enabled: false,
    botUsername: '',
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

function creatorLink(creator) {
  return `/nv/profile/?creator=${encodeURIComponent(creator)}`;
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
    throw new Error(message);
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
  try {
    const payload = await fetchJson(API.creator(creatorSlug));
    return {
      creator: payload.creator || null,
      packages: safeArray(payload.packages).map(normalizeCatalogPackage)
    };
  } catch (error) {
    console.warn('NV creator fallback', error);
    const slug = String(creatorSlug || '').trim().replace(/^@/, '').toLowerCase();
    const packages = state.catalogPackages.filter((pkg) => pkg.creator.toLowerCase() === slug);
    const creator = state.creators.find((item) => item.slug.toLowerCase() === slug) || null;
    return {
      creator: creator
        ? {
            slug: creator.slug,
            display_name: creator.display_name,
            bio: '',
            avatar_url: creator.avatar_url,
            telegram_username: '',
            links: []
          }
        : null,
      packages
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
    state.auth.user = session.authenticated ? session.user || null : null;
    state.auth.creator = session.authenticated ? session.creator || null : null;
    state.auth.error = null;
  } catch (error) {
    console.warn('NV auth bootstrap failed', error);
    state.auth.enabled = false;
    state.auth.botUsername = '';
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
        <a class="auth-user-link" href="/nv/profile/">
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

  if (!state.auth.enabled) {
    slot.innerHTML = `
      <div class="auth-status-card compact-status">
        <span>Telegram login пока не настроен</span>
      </div>
    `;
    return;
  }

  slot.innerHTML = `
    <div class="auth-widget-card">
      <div>
        <strong>Войти через Telegram</strong>
        <span>Чтобы открыть профиль и публиковать пакеты.</span>
      </div>
      <div id="telegram-widget-slot"></div>
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
  renderAuthSlot();
  if (state.page === 'profile') {
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
  const creatorsEl = document.getElementById('featured-creators');
  const metricPackages = document.getElementById('metric-packages');
  const metricCreators = document.getElementById('metric-creators');
  if (!packagesEl || !creatorsEl) return;

  const featuredPackages = state.catalogPackages.slice(0, 6);
  const featuredCreators = state.creators.slice(0, 4);
  packagesEl.innerHTML = featuredPackages.map(renderPackageCard).join('');
  creatorsEl.innerHTML = featuredCreators.map(renderCreatorCard).join('');
  if (metricPackages) metricPackages.textContent = String(state.catalogPackages.length || 0);
  if (metricCreators) metricCreators.textContent = String(state.creators.length || 0);
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
      await loadCatalog();
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
      await loadCatalog();
      await renderProfile();
    } catch (error) {
      if (releaseStatus) releaseStatus.textContent = error instanceof Error ? error.message : 'Не удалось выложить релиз';
    }
  });
}

async function renderProfile() {
  const root = document.getElementById('profile-content');
  if (!root) return;

  const params = new URLSearchParams(window.location.search);
  const requestedCreator = String(params.get('creator') || state.auth.creator?.slug || state.creators[0]?.slug || 'lvls').trim().replace(/^@/, '');
  const profile = await loadCreatorProfile(requestedCreator);
  const creator = profile.creator || {
    slug: requestedCreator,
    display_name: requestedCreator,
    bio: '',
    avatar_url: '',
    telegram_username: '',
    links: []
  };
  const packages = profile.packages || [];
  const canEdit = Boolean(state.auth.creator?.slug && state.auth.creator.slug.toLowerCase() === creator.slug.toLowerCase());

  root.innerHTML = `
    <section class="section-shell profile-shell">
      <div class="profile-head">
        ${canEdit ? authAvatarMarkup('profile-avatar') : '<span class="profile-avatar"><span class="auth-avatar-fallback">@</span></span>'}
        <div>
          <p class="eyebrow">Creator</p>
          <h1 class="section-title">@${escapeHtml(creator.slug)}</h1>
          <p class="section-copy">${escapeHtml(creator.bio || 'Публичный профиль автора пакетов NV.')}</p>
        </div>
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
          <span class="metric-value">${canEdit ? 'owner' : 'public'}</span>
          <span class="metric-label">статус</span>
        </article>
      </div>
    </section>

    ${canEdit
      ? publishFormMarkup(creator.slug, packages)
      : `
        <section class="section-shell">
          <div class="section-head">
            <div>
              <p class="eyebrow">Публикация</p>
              <h2>Хочешь выкладывать свои пакеты?</h2>
            </div>
          </div>
          <p class="section-copy">Войди через Telegram под своим creator slug, после чего здесь появятся формы публикации.</p>
        </section>`}

    <section class="section-shell">
      <div class="section-head">
        <div>
          <p class="eyebrow">Пакеты автора</p>
          <h2>${packages.length ? 'Опубликованные пакеты' : 'Пока пусто'}</h2>
        </div>
      </div>
      <div class="package-grid package-grid-wide">${packages.map(renderPackageCard).join('')}</div>
      <p class="empty-state" ${packages.length ? 'hidden' : ''}>У этого автора ещё нет пакетов.</p>
    </section>
  `;

  if (canEdit) {
    bindProfileForms(creator.slug);
  }
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
  await loadRegistry();
  await Promise.all([loadCatalog(), loadAuthState()]);

  if (state.page === 'home') {
    renderHome();
    return;
  }
  if (state.page === 'downloads') {
    attachDownloadTabs();
    return;
  }
  if (state.page === 'packages') {
    attachCatalogControls();
    return;
  }
  if (state.page === 'profile') {
    await renderProfile();
  }
}

init();
