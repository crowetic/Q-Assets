import { useEffect, useMemo, useState } from 'react';
import { useAuth } from 'qapp-core';
import { useAccountNames } from './useAccountNames';

const LS_KEY = 'qassets:activeName';
const ACTIVE_NAME_EVENT = 'qassets:active-name-change';

export function useActiveAccountName(options?: { autoAuth?: boolean }) {
  const { name: authName } = useAuth();
  const { entries, primaryName, loading: namesLoading, error, reload } = useAccountNames(options);
  const [activeName, setActiveName] = useState<string | null>(null);

  // initialize from cache/auth/primary
  useEffect(() => {
    const cached = localStorage.getItem(LS_KEY);
    if (cached) {
      setActiveName(cached);
      return;
    }
    if (primaryName) {
      setActiveName(primaryName);
      return;
    }
    if (authName) {
      setActiveName(authName);
    }
  }, [primaryName, authName]);

  // ensure activeName exists in entries; if not, fall back
  useEffect(() => {
    if (!entries.length) return;
    if (activeName && entries.some((e) => e.name === activeName)) return;
    if (primaryName && entries.some((e) => e.name === primaryName)) {
      setActiveName(primaryName);
      localStorage.setItem(LS_KEY, primaryName);
      return;
    }
    const first = entries[0]?.name;
    if (first) {
      setActiveName(first);
      localStorage.setItem(LS_KEY, first);
    }
  }, [entries, activeName, primaryName]);

  const handleSetActive = (name: string | null) => {
    setActiveName(name);
    if (name) localStorage.setItem(LS_KEY, name);
    else localStorage.removeItem(LS_KEY);
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new Event(ACTIVE_NAME_EVENT));
    }
  };

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const refresh = () => {
      const cached = localStorage.getItem(LS_KEY);
      setActiveName(cached || null);
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === LS_KEY) refresh();
    };
    window.addEventListener('storage', handleStorage);
    window.addEventListener(ACTIVE_NAME_EVENT, refresh);
    return () => {
      window.removeEventListener('storage', handleStorage);
      window.removeEventListener(ACTIVE_NAME_EVENT, refresh);
    };
  }, []);

  const availableNames = useMemo(() => entries.map((e) => e.name), [entries]);

  return {
    activeName,
    setActiveName: handleSetActive,
    namesLoading,
    namesError: error,
    reloadNames: reload,
    availableNames,
  };
}
