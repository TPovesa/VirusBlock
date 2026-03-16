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

const registryUrl = (import.meta.env.VITE_PACKAGE_REGISTRY_URL as string | undefined) || '/basedata/api/packages';

export async function fetchPackageCatalog(signal?: AbortSignal): Promise<PackageCatalog> {
  const response = await fetch(registryUrl, {
    method: 'GET',
    headers: { Accept: 'application/json' },
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
              download_url: String(entry.download_url ?? ''),
              install_command: String(entry.install_command ?? ''),
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
