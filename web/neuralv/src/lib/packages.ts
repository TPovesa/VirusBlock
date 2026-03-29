export type PackageVariant = {
  id: string;
  label: string;
  os: string;
  is_default: boolean;
  version: string;
  channel: string;
  file_name: string;
  download_url: string;
  install_command: string;
  sha256: string;
  install_strategy: string;
  uninstall_strategy: string;
  install_root: string;
  binary_name: string;
  wrapper_name: string;
  launcher_path: string;
  notes?: string[];
  metadata?: Record<string, unknown>;
};

export type PackageRecord = {
  name: string;
  title: string;
  description: string;
  homepage: string;
  latest_version: string;
  variants: PackageVariant[];
};

export type PackageCatalog = {
  packages: PackageRecord[];
};

const PUBLIC_WEB_BASE = 'https://neuralvv.org';
const RELEASE_DOWNLOAD_ENDPOINT = `${PUBLIC_WEB_BASE}/basedata/api/releases/download`;
const registryUrl = (import.meta.env.VITE_PACKAGE_REGISTRY_URL as string | undefined) || '/basedata/api/packages';

function canonicalPackageName(name: string): string {
  const normalized = name.trim().toLowerCase();
  if (normalized === 'neuralv' || normalized === '@lvls/neuralv') return '@lvls/neuralv';
  if (normalized === 'nv' || normalized === '@lvls/nv') return '@lvls/nv';
  return normalized;
}

function normalizeVariantPlatform(value: string): string {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'linux-shell':
    case 'linux_shell':
    case 'linux-cli':
    case 'cli':
      return 'shell';
    default:
      return normalized;
  }
}

function buildPublicReleaseDownloadUrl(platform: string, kind?: string): string {
  const params = new URLSearchParams({ platform });
  if (kind) {
    params.set('kind', kind);
  }
  return `${RELEASE_DOWNLOAD_ENDPOINT}?${params.toString()}`;
}

function buildPublicInstallUrl(scriptName: string): string {
  return `${PUBLIC_WEB_BASE}/install/${scriptName}`;
}

function isPublicServerUrl(value: string): boolean {
  return value.startsWith('/') || value.startsWith(PUBLIC_WEB_BASE);
}

function normalizePublicInstallCommand(command: string): string {
  return command
    .replace(
      /https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^"'\s|]+\/(?:install\/)?nv\.sh/gi,
      buildPublicInstallUrl('nv.sh')
    )
    .replace(
      /https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^"'\s|]+\/(?:install\/)?nv\.ps1/gi,
      buildPublicInstallUrl('nv.ps1')
    )
    .replace(
      /https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^"'\s|]+\/(?:install\/)?nv\.cmd/gi,
      buildPublicInstallUrl('nv.cmd')
    )
    .replace(
      /https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^"'\s|]+\/install\/windows\.ps1/gi,
      buildPublicInstallUrl('windows.ps1')
    )
    .replace(
      /https:\/\/raw\.githubusercontent\.com\/[^/]+\/[^/]+\/[^"'\s|]+\/install\/windows\.cmd/gi,
      buildPublicInstallUrl('windows.cmd')
    );
}

function resolveManagedVariantPlatform(entry: Record<string, unknown>, packageName: string): string {
  const metadata = entry.metadata && typeof entry.metadata === 'object'
    ? (entry.metadata as Record<string, unknown>)
    : undefined;
  const source = metadata?.source && typeof metadata.source === 'object'
    ? (metadata.source as Record<string, unknown>)
    : undefined;
  const canonicalName = canonicalPackageName(packageName);
  const repo = String(source?.repo ?? metadata?.source_repo ?? '').trim().toLowerCase();
  const managedRepo = repo === 'tpovesa/virusblock' || repo === 'perdonus/fatalerror' || repo === 'perdonus/nv';
  const declaredPlatform = normalizeVariantPlatform(
    String(source?.platform ?? metadata?.artifactPlatform ?? metadata?.artifact_platform ?? '').trim()
  );
  const os = normalizeVariantPlatform(String(entry.os ?? '').trim());

  if (canonicalName === '@lvls/nv') {
    if (declaredPlatform === 'nv-windows' || os === 'windows') return 'nv-windows';
    if (declaredPlatform === 'nv-linux' || os === 'linux') return 'nv-linux';
  }

  if (canonicalName === '@lvls/neuralv') {
    if (declaredPlatform === 'windows' || os === 'windows') return 'windows';
    if (declaredPlatform === 'linux' || os === 'linux') return 'linux';
    if (declaredPlatform === 'shell') return 'shell';
  }

  if (!managedRepo) {
    return '';
  }

  if (declaredPlatform === 'nv-windows' || declaredPlatform === 'nv-linux') {
    return declaredPlatform;
  }
  if (declaredPlatform === 'windows' || declaredPlatform === 'linux' || declaredPlatform === 'shell') {
    return declaredPlatform;
  }

  return '';
}

function publicVariantDownloadUrl(platform: string): string | undefined {
  switch (platform) {
    case 'windows':
      return buildPublicReleaseDownloadUrl('windows', 'portable');
    case 'linux':
      return buildPublicReleaseDownloadUrl('linux');
    case 'shell':
      return buildPublicReleaseDownloadUrl('shell');
    case 'nv-windows':
      return buildPublicReleaseDownloadUrl('nv-windows');
    case 'nv-linux':
      return buildPublicReleaseDownloadUrl('nv-linux');
    default:
      return undefined;
  }
}

function stableVariantDownloadUrl(entry: Record<string, unknown>, fallbackUrl: string, packageName: string): string {
  if (fallbackUrl && isPublicServerUrl(fallbackUrl)) {
    return fallbackUrl;
  }

  const publicUrl = publicVariantDownloadUrl(resolveManagedVariantPlatform(entry, packageName));
  if (publicUrl) {
    return publicUrl;
  }

  return fallbackUrl;
}

export async function fetchPackageCatalog(signal?: AbortSignal): Promise<PackageCatalog> {
  const response = await fetch(registryUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal
  });

  if (!response.ok) {
    throw new Error(`Package registry request failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const rawPackages = Array.isArray(data.packages) ? data.packages : [];
  const packages = rawPackages
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => ({
      name: String(item.name ?? ''),
      title: String(item.title ?? item.name ?? ''),
      description: String(item.description ?? ''),
      homepage: String(item.homepage ?? ''),
      latest_version: String(item.latest_version ?? ''),
      variants: Array.isArray(item.variants)
        ? item.variants
            .filter((entry): entry is Record<string, unknown> => typeof entry === 'object' && entry !== null)
            .map((entry) => ({
              id: String(entry.id ?? ''),
              label: String(entry.label ?? entry.id ?? ''),
              os: String(entry.os ?? ''),
              is_default: Boolean(entry.is_default),
              version: String(entry.version ?? ''),
              channel: String(entry.channel ?? ''),
              file_name: String(entry.file_name ?? ''),
              download_url: stableVariantDownloadUrl(entry, String(entry.download_url ?? ''), String(item.name ?? '')),
              install_command: normalizePublicInstallCommand(String(entry.install_command ?? '')),
              sha256: String(entry.sha256 ?? ''),
              install_strategy: String(entry.install_strategy ?? ''),
              uninstall_strategy: String(entry.uninstall_strategy ?? ''),
              install_root: String(entry.install_root ?? ''),
              binary_name: String(entry.binary_name ?? ''),
              wrapper_name: String(entry.wrapper_name ?? ''),
              launcher_path: String(entry.launcher_path ?? ''),
              notes: Array.isArray(entry.notes) ? entry.notes.map((note) => String(note)) : [],
              metadata: entry.metadata && typeof entry.metadata === 'object' ? (entry.metadata as Record<string, unknown>) : undefined
            }))
        : []
    }));

  return { packages };
}

export function getPackage(catalog: PackageCatalog, packageName: string): PackageRecord | undefined {
  const canonical = canonicalPackageName(packageName);
  return catalog.packages.find((item) => canonicalPackageName(item.name) === canonical);
}

export function getPackageVariant(pkg: PackageRecord | undefined, variantId: string): PackageVariant | undefined {
  return pkg?.variants.find((variant) => variant.id === variantId);
}

export function getDefaultVariant(pkg: PackageRecord | undefined, os?: string): PackageVariant | undefined {
  const variants = os ? (pkg?.variants.filter((variant) => variant.os === os) ?? []) : (pkg?.variants ?? []);
  return variants.find((variant) => variant.is_default) ?? variants.find((variant) => Boolean(variant.download_url)) ?? variants[0];
}
