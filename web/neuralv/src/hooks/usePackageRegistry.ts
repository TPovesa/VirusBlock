import { useEffect, useMemo, useState } from 'react';
import { fetchPackageCatalog, PackageCatalog } from '../lib/packages';

const fallbackCatalog: PackageCatalog = {
  packages: []
};

export function usePackageRegistry() {
  const [state, setState] = useState({
    catalog: fallbackCatalog,
    loading: true,
    error: null as string | null
  });

  useEffect(() => {
    const controller = new AbortController();

    fetchPackageCatalog(controller.signal)
      .then((catalog) => {
        setState({ catalog, loading: false, error: null });
      })
      .catch((error: unknown) => {
        setState({
          catalog: fallbackCatalog,
          loading: false,
          error: error instanceof Error ? error.message : 'Не удалось загрузить registry пакетов.'
        });
      });

    return () => controller.abort();
  }, []);

  return useMemo(() => state, [state]);
}
