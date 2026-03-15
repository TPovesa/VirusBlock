export type ReleaseArtifact = {
  platform: 'android' | 'windows' | 'linux' | 'shell' | 'site' | 'nv' | 'linux_shell' | string;
  channel?: string;
  version?: string;
  sha256?: string;
  downloadUrl?: string;
  fileName?: string;
  installCommand?: string;
  notes?: string[];
};

export type ReleaseManifest = {
  generatedAt?: string | number;
  releaseChannel?: string;
  artifacts: ReleaseArtifact[];
};

export const fallbackManifest: ReleaseManifest = {
  generatedAt: 'pending-backend-release',
  releaseChannel: 'main',
  artifacts: [
    {
      platform: 'android',
      channel: 'release',
      version: 'pending',
      notes: ['APK будет подтягиваться автоматически после первого desktop/web release manifest.']
    },
    {
      platform: 'windows',
      channel: 'beta',
      version: 'pending',
      notes: ['Windows GUI готовится, загрузка появится после CI pipeline.']
    },
    {
      platform: 'linux',
      channel: 'beta',
      version: 'pending',
      notes: ['Linux GUI готовится, загрузка появится после CI pipeline.']
    },
    {
      platform: 'nv',
      channel: 'beta',
      version: 'pending',
      installCommand: 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh',
      notes: ['nv bootstrap появится после публикации Linux shell artifacts.']
    },
    {
      platform: 'shell',
      channel: 'beta',
      version: 'pending',
      installCommand: 'curl -fsSL https://sosiskibot.ru/neuralv/install/nv.sh | sh && nv install neuralv@latest',
      notes: ['Shell installer будет доступен после публикации Linux artifact.']
    }
  ]
};

const manifestUrl =
  (import.meta.env.VITE_RELEASE_MANIFEST_URL as string | undefined) || '/basedata/api/releases/manifest';

export async function fetchReleaseManifest(signal?: AbortSignal): Promise<ReleaseManifest> {
  const response = await fetch(manifestUrl, {
    method: 'GET',
    headers: {
      Accept: 'application/json'
    },
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
      const platform =
        platformRaw === 'linux_shell' ? 'shell' :
        platformRaw === 'website' ? 'site' :
        platformRaw;
      return {
        platform,
        channel: typeof item.channel === 'string' ? item.channel : undefined,
        version: typeof item.version === 'string' ? item.version : undefined,
        sha256: typeof item.sha256 === 'string' ? item.sha256 : undefined,
        downloadUrl:
          typeof item.downloadUrl === 'string'
            ? item.downloadUrl
            : (typeof item.download_url === 'string' ? item.download_url : undefined),
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
        notes: Array.isArray(item.notes) ? item.notes.filter((note): note is string => typeof note === 'string') : undefined
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
        : (typeof data.release_channel === 'string' ? (data.release_channel as string) : 'stable'),
    artifacts
  };
}

export function getArtifact(manifest: ReleaseManifest, platform: ReleaseArtifact['platform']): ReleaseArtifact | undefined {
  return manifest.artifacts.find((artifact) => artifact.platform === platform);
}
