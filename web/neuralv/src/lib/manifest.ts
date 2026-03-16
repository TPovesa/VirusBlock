export type ArtifactMetadata = Record<string, unknown> & {
  available?: boolean;
  source_branch?: string;
  source_label?: string;
  daemonUrl?: string;
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
  artifacts: ReleaseArtifact[];
};

function stableArtifactDownloadUrl(
  platform: string,
  metadata: ArtifactMetadata | undefined,
  fallbackUrl: string | undefined
): string | undefined {
  const branch = typeof metadata?.source_branch === 'string' ? metadata.source_branch : '';
  if (!branch) {
    return fallbackUrl;
  }

  const base = `https://raw.githubusercontent.com/Perdonus/fatalerror/${branch}`;
  switch (platform) {
    case 'windows':
      return `${base}/windows/neuralv-windows.zip`;
    case 'linux':
      return `${base}/linux/neuralv-linux.tar.gz`;
    case 'shell':
      return `${base}/shell/neuralv-shell-linux.tar.gz`;
    case 'android':
      return `${base}/android/neuralv-android-release.apk`;
    default:
      return fallbackUrl;
  }
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

export async function fetchReleaseManifest(signal?: AbortSignal): Promise<ReleaseManifest> {
  const response = await fetch(manifestUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
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
      const platformRaw = String(item.platform ?? '').toLowerCase();
      const platform = platformRaw === 'linux_shell' ? 'shell' : platformRaw === 'website' ? 'site' : platformRaw;
      const metadata = item.metadata && typeof item.metadata === 'object'
        ? (item.metadata as ArtifactMetadata)
        : undefined;
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
          typeof item.installCommand === 'string'
            ? item.installCommand
            : (typeof item.install_command === 'string' ? item.install_command : undefined),
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

  return {
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

export function isArtifactReady(artifact?: ReleaseArtifact): boolean {
  if (!artifact?.downloadUrl) {
    return false;
  }

  if (artifact.metadata && typeof artifact.metadata.available === 'boolean') {
    return artifact.metadata.available;
  }

  return artifact.version !== 'pending';
}
