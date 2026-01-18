import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  fetchLatestAppIndex,
  resolveAllowedAppIndexPublishers,
  type XqloreAppIndex,
} from '../utils/xqloreIndex';
import { buildAppRegistryLookup, type XqloreAppRegistryLookup } from '../utils/xqloreTx';

export function useXqloreAppIndex() {
  const [index, setIndex] = useState<XqloreAppIndex | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allowedPublishers, setAllowedPublishers] = useState<string[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const allowed = await resolveAllowedAppIndexPublishers();
      setAllowedPublishers(allowed);
      const { index: latest } = await fetchLatestAppIndex(allowed);
      setIndex(latest);
    } catch (err: any) {
      console.error('Failed to load Xqlore app index', err);
      setError(err?.message ?? 'Failed to load app index.');
      setIndex(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const registry = useMemo<XqloreAppRegistryLookup>(() => {
    return buildAppRegistryLookup(index?.apps ?? []);
  }, [index]);

  return { index, registry, loading, error, reload: load, allowedPublishers };
}
