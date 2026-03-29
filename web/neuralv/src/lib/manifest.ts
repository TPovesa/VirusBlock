export type ArtifactMetadata = Record<string, unknown> & {
  available?: boolean;
  source_branch?: string;
  source_label?: string;
  daemonUrl?: string;
  setupUrl?: string;
  portableUrl?: string;
  installScriptPs1?: string;
  installScriptCmd?: string;
  stableArtifactUrl?: string;
  stableCliArtifactUrl?: string;
};

export type ReleaseArtifact = {
  platform: 'android' | 'windows' | 'linux' | 'shell' | 'site' | 'nv' | 'linux_shell' | string;
  channel?: string;
  version?: string;
  sha256?: string;
  downloadUrl?: string;
  fileName?: string;
  installCommand?: string;
  notes?: string[];
  metadata?: ArtifactMetadata;
};

export type ReleaseManifest = {
  generatedAt?: string | number;
  releaseChannel?: string;
  platform?: string;
  version?: string;
  downloadUrl?: string;
  setupUrl?: string;
  portableUrl?: string;
  installCommand?: string;
  artifacts: ReleaseArtifact[];
};

const PUBLIC_WEB_BASE = 'https://neuralvv.org';
const RELEASE_DOWNLOAD_ENDPOINT = `${PUBLIC_WEB_BASE}/basedata/api/releases/download`;

function cleanText(value: unknown): string | null {
  if (typeof value === 'string') {
    const normalized = value.trim().replace(/\s+/g, ' ');
    return normalized.length > 0 ? normalized : null;
  }

  if (typeof value === 'number') {
    return String(value);
  }

  return null;
}

function pushRequirement(lines: string[], value: unknown, label?: string) {
  const text = cleanText(value);
  if (!text) {
    return;
  }

  lines.push(label ? `${label}: ${text}` : text);
}

function readRequirementObject(value: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const knownFields: Array<[string, string]> = [
    ['os', 'Система'],
    ['platform', 'Система'],
    ['minimumOs', 'Минимум'],
    ['minimum_os', 'Минимум'],
    ['minOs', 'Минимум'],
    ['min_os', 'Минимум'],
    ['minimumAndroid', 'Android'],
    ['minimum_android', 'Android'],
    ['minSdk', 'Android'],
    ['min_sdk', 'Android'],
    ['minimumWindows', 'Windows'],
    ['minimum_windows', 'Windows'],
    ['minimumLinux', 'Linux'],
    ['minimum_linux', 'Linux'],
    ['architecture', 'Архитектура'],
    ['architectures', 'Архитектура'],
    ['runtime', 'Runtime'],
    ['desktopEnvironment', 'Desktop'],
    ['desktop_environment', 'Desktop'],
    ['ram', 'RAM'],
    ['storage', 'Диск']
  ];

  for (const [field, label] of knownFields) {
    const raw = value[field];
    if (Array.isArray(raw)) {
      const parts = raw
        .map((item) => cleanText(item))
        .filter((item): item is string => Boolean(item));
      if (parts.length > 0) {
        lines.push(`${label}: ${parts.join(', ')}`);
      }
      continue;
    }

    pushRequirement(lines, raw, label);
  }

  return lines;
}

function readRequirementCandidate(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value
      .flatMap((entry) => readRequirementCandidate(entry))
      .filter((entry, index, list) => list.indexOf(entry) === index);
  }

  const text = cleanText(value);
  if (text) {
    return [text];
  }

  if (value && typeof value === 'object') {
    return readRequirementObject(value as Record<string, unknown>);
  }

  return [];
}

function normalizeArtifactPlatform(value: string): string {
  const normalized = value.trim().toLowerCase();
  switch (normalized) {
    case 'linux_shell':
    case 'linux-shell':
    case 'linux-cli':
    case 'cli':
      return 'shell';
    case 'website':
      return 'site';
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

function publicArtifactDownloadUrl(platform: string, kind = ''): string | undefined {
  const normalizedPlatform = normalizeArtifactPlatform(platform);
  switch (normalizedPlatform) {
    case 'windows':
      return buildPublicReleaseDownloadUrl('windows', kind || 'portable');
    case 'linux':
      return buildPublicReleaseDownloadUrl('linux', kind);
    case 'shell':
      return buildPublicReleaseDownloadUrl('shell', kind);
    case 'nv-windows':
      return buildPublicReleaseDownloadUrl('nv-windows', kind);
    case 'nv-linux':
      return buildPublicReleaseDownloadUrl('nv-linux', kind);
    default:
      return undefined;
  }
}

function stableArtifactSupplementaryUrl(
  platform: string,
  kind: string,
  fallbackUrl: string | undefined
): string | undefined {
  const normalizedFallback = cleanText(fallbackUrl);
  if (normalizedFallback && isPublicServerUrl(normalizedFallback)) {
    return normalizedFallback;
  }

  const publicUrl = publicArtifactDownloadUrl(platform, kind);
  if (publicUrl) {
    return publicUrl;
  }

  return normalizedFallback ?? undefined;
}

function normalizePublicInstallCommand(command: string | undefined): string | undefined {
  const raw = cleanText(command);
  if (!raw) {
    return undefined;
  }

  return raw
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

function normalizeArtifactMetadata(
  platform: string,
  metadata: ArtifactMetadata | undefined
): ArtifactMetadata | undefined {
  if (!metadata) {
    return metadata;
  }

  const next = { ...metadata } as ArtifactMetadata;
  if (platform === 'windows' || typeof next.setupUrl === 'string') {
    next.setupUrl = stableArtifactSupplementaryUrl('windows', 'setup', cleanText(next.setupUrl) ?? undefined);
  }
  if (platform === 'windows' || typeof next.portableUrl === 'string') {
    next.portableUrl = stableArtifactSupplementaryUrl('windows', 'portable', cleanText(next.portableUrl) ?? undefined);
  }
  if (platform === 'windows' || typeof next.installScriptPs1 === 'string') {
    next.installScriptPs1 = buildPublicInstallUrl('windows.ps1');
  }
  if (platform === 'windows' || typeof next.installScriptCmd === 'string') {
    next.installScriptCmd = buildPublicInstallUrl('windows.cmd');
  }
  if (platform === 'linux' || typeof next.stableArtifactUrl === 'string') {
    next.stableArtifactUrl = stableArtifactSupplementaryUrl('linux', '', cleanText(next.stableArtifactUrl) ?? undefined);
  }
  if (platform === 'shell' || typeof next.stableArtifactUrl === 'string') {
    next.stableArtifactUrl = stableArtifactSupplementaryUrl('shell', '', cleanText(next.stableArtifactUrl) ?? undefined);
  }
  if (platform === 'linux' || typeof next.stableCliArtifactUrl === 'string') {
    next.stableCliArtifactUrl = stableArtifactSupplementaryUrl('shell', '', cleanText(next.stableCliArtifactUrl) ?? undefined);
  }
  if (platform === 'linux' || platform === 'shell' || typeof next.daemonUrl === 'string') {
    next.daemonUrl = stableArtifactSupplementaryUrl('shell', 'daemon', cleanText(next.daemonUrl) ?? undefined);
  }

  return next;
}

function stableArtifactDownloadUrl(
  platform: string,
  _metadata: ArtifactMetadata | undefined,
  fallbackUrl: string | undefined
): string | undefined {
  const normalizedFallback = cleanText(fallbackUrl);
  if (normalizedFallback && isPublicServerUrl(normalizedFallback)) {
    return normalizedFallback;
  }

  const publicUrl = publicArtifactDownloadUrl(platform);
  if (publicUrl) {
    return publicUrl;
  }

  return normalizedFallback ?? undefined;
}

export const fallbackManifest: ReleaseManifest = {
  generatedAt: 'pending',
  releaseChannel: 'main',
  artifacts: [
    { platform: 'android', channel: 'release', version: 'pending' },
    { platform: 'windows', channel: 'beta', version: 'pending' },
    { platform: 'linux', channel: 'beta', version: 'pending' },
    { platform: 'nv', channel: 'beta', version: 'pending' },
    { platform: 'shell', channel: 'beta', version: 'pending' }
  ]
};

const manifestUrl =
  (import.meta.env.VITE_RELEASE_MANIFEST_URL as string | undefined) || '/basedata/api/releases/manifest';

export async function fetchReleaseManifest(signal?: AbortSignal, platform?: string): Promise<ReleaseManifest> {
  const manifestRequestUrl = platform
    ? `${manifestUrl}${manifestUrl.includes('?') ? '&' : '?'}platform=${encodeURIComponent(platform)}`
    : manifestUrl;

  const response = await fetch(manifestRequestUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
    cache: 'no-store',
    signal
  });

  if (!response.ok) {
    throw new Error(`Manifest request failed: ${response.status}`);
  }

  const data = (await response.json()) as Record<string, unknown>;
  const nestedManifest = (data.manifest as Record<string, unknown> | undefined) ?? undefined;
  const nestedArtifacts =
    nestedManifest && typeof nestedManifest === 'object' && 'artifacts' in nestedManifest
      ? (nestedManifest.artifacts as unknown)
      : undefined;

  const rawArtifacts =
    (Array.isArray(data.artifacts) ? data.artifacts : undefined) ??
    (Array.isArray(nestedArtifacts)
      ? nestedArtifacts
      : (nestedArtifacts && typeof nestedArtifacts === 'object'
          ? Object.values(nestedArtifacts as Record<string, unknown>)
          : []));

  const artifacts = rawArtifacts
    .filter((item): item is Record<string, unknown> => typeof item === 'object' && item !== null)
    .map((item) => {
      const platform = normalizeArtifactPlatform(String(item.platform ?? ''));
      const rawMetadata = item.metadata && typeof item.metadata === 'object'
        ? (item.metadata as ArtifactMetadata)
        : undefined;
      const metadata = normalizeArtifactMetadata(platform, rawMetadata);
      const versionedDownloadUrl =
        typeof item.downloadUrl === 'string'
          ? item.downloadUrl
          : (typeof item.download_url === 'string' ? item.download_url : undefined);
      const downloadUrl = stableArtifactDownloadUrl(platform, metadata, versionedDownloadUrl);

      return {
        platform,
        channel: typeof item.channel === 'string' ? item.channel : undefined,
        version: typeof item.version === 'string' ? item.version : undefined,
        sha256: typeof item.sha256 === 'string' ? item.sha256 : undefined,
        downloadUrl,
        fileName:
          typeof item.fileName === 'string'
            ? item.fileName
            : (typeof item.file_name === 'string'
                ? item.file_name
                : (typeof item.artifact_name === 'string' ? item.artifact_name : undefined)),
        installCommand:
          normalizePublicInstallCommand(
            typeof item.installCommand === 'string'
              ? item.installCommand
              : (typeof item.install_command === 'string' ? item.install_command : undefined)
          ),
        notes: Array.isArray(item.notes)
          ? item.notes.filter((note): note is string => typeof note === 'string')
          : undefined,
        metadata: metadata
          ? {
              ...metadata,
              versioned_download_url: versionedDownloadUrl
            }
          : undefined
      } satisfies ReleaseArtifact;
    });

  const manifestPlatform = typeof data.platform === 'string'
    ? normalizeArtifactPlatform(data.platform)
    : undefined;
  const selectedArtifact = manifestPlatform
    ? artifacts.find((artifact) => artifact.platform === manifestPlatform)
    : undefined;

  return {
    platform: manifestPlatform,
    version: typeof data.version === 'string' ? data.version : undefined,
    downloadUrl:
      stableArtifactDownloadUrl(
        manifestPlatform ?? '',
        selectedArtifact?.metadata,
        typeof data.download_url === 'string' ? data.download_url : undefined
      ) ?? selectedArtifact?.downloadUrl,
    setupUrl:
      stableArtifactSupplementaryUrl(
        manifestPlatform ?? '',
        'setup',
        typeof data.setupUrl === 'string' ? data.setupUrl : undefined
      ) ?? (typeof selectedArtifact?.metadata?.setupUrl === 'string' ? selectedArtifact.metadata.setupUrl : undefined),
    portableUrl:
      stableArtifactSupplementaryUrl(
        manifestPlatform ?? '',
        'portable',
        typeof data.portableUrl === 'string' ? data.portableUrl : undefined
      ) ?? (typeof selectedArtifact?.metadata?.portableUrl === 'string' ? selectedArtifact.metadata.portableUrl : undefined),
    installCommand:
      normalizePublicInstallCommand(
        typeof data.install_command === 'string'
          ? data.install_command
          : (typeof data.installCommand === 'string' ? data.installCommand : undefined)
      ) ?? selectedArtifact?.installCommand,
    generatedAt:
      (typeof data.generatedAt === 'string' || typeof data.generatedAt === 'number')
        ? data.generatedAt
        : ((typeof data.generated_at === 'string' || typeof data.generated_at === 'number')
            ? (data.generated_at as string | number)
            : (nestedManifest?.generated_at as string | number | undefined)),
    releaseChannel:
      typeof data.releaseChannel === 'string'
        ? data.releaseChannel
        : (typeof data.release_channel === 'string' ? (data.release_channel as string) : 'main'),
    artifacts
  };
}

export function getArtifact(manifest: ReleaseManifest, platform: ReleaseArtifact['platform']): ReleaseArtifact | undefined {
  return manifest.artifacts.find((artifact) => artifact.platform === platform);
}

export function getArtifactVersion(manifest: ReleaseManifest, platform: ReleaseArtifact['platform']): string | null {
  const artifact = getArtifact(manifest, platform);
  const direct = cleanText(artifact?.version);
  if (direct) {
    return direct;
  }

  if (manifest.platform === platform) {
    return cleanText(manifest.version);
  }

  return null;
}

export function getArtifactSystemRequirements(
  artifact?: ReleaseArtifact,
  manifest?: ReleaseManifest
): string[] {
  const metadata = artifact?.metadata && typeof artifact.metadata === 'object'
    ? (artifact.metadata as Record<string, unknown>)
    : undefined;

  const preferredCandidates: unknown[] = [
    metadata?.system_requirements,
    metadata?.systemRequirements
  ];
  const preferred = preferredCandidates
    .flatMap((candidate) => readRequirementCandidate(candidate))
    .map((entry) => entry.trim())
    .filter((entry): entry is string => entry.length > 0);

  if (preferred.length > 0) {
    return preferred.filter((entry, index, list) => list.indexOf(entry) === index);
  }

  const candidates: unknown[] = [
    metadata?.requirements,
    metadata?.minimumRequirements,
    metadata?.minimum_requirements,
    metadata?.supportedSystems,
    metadata?.supported_systems,
    metadata?.minimumOs,
    metadata?.minimum_os,
    metadata?.minOs,
    metadata?.min_os,
    metadata?.minimumAndroid,
    metadata?.minimum_android,
    metadata?.minSdk,
    metadata?.min_sdk,
    metadata?.minimumWindows,
    metadata?.minimum_windows,
    metadata?.minimumLinux,
    metadata?.minimum_linux,
    metadata?.architecture,
    metadata?.architectures,
    metadata?.runtime,
    metadata?.desktopEnvironment,
    metadata?.desktop_environment
  ];

  if (manifest?.platform && manifest.platform === artifact?.platform) {
    candidates.push(
      (manifest as unknown as Record<string, unknown>).systemRequirements,
      (manifest as unknown as Record<string, unknown>).system_requirements,
      (manifest as unknown as Record<string, unknown>).requirements
    );
  }

  const lines = candidates
    .flatMap((candidate) => readRequirementCandidate(candidate))
    .map((entry) => entry.trim())
    .filter((entry): entry is string => entry.length > 0);

  return lines.filter((entry, index, list) => list.indexOf(entry) === index);
}

export function isArtifactReady(artifact?: ReleaseArtifact): boolean {
  if (!artifact?.downloadUrl) {
    return false;
  }

  if (artifact.metadata && typeof artifact.metadata.available === 'boolean') {
    return artifact.metadata.available;
  }

  return artifact.version !== 'pending';
}
