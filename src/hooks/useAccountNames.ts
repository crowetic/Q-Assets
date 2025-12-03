import { useCallback, useEffect, useState } from 'react';
import { useAuth } from 'qapp-core';
import { useAlert } from '../components/alerts';

export type AccountName = { name: string; owner: string };

/**
 * Fetch all names owned by the authenticated account.
 * Shared between Data Management views so they stay in sync.
 */
export function useAccountNames() {
  const [entries, setEntries] = useState<AccountName[]>([]);
  const [primaryName, setPrimaryName] = useState<string | null>(null);
  const [primaryNameError, setPrimaryNameError] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { address: userAddress, authenticateUser } = useAuth();
  const { alert } = useAlert();

  useEffect(() => {
    (async () => {
      try {
        if (!userAddress) await authenticateUser();
      } catch (e: any) {
        alert(e?.message || 'Authentication failed');
      }
    })();
  }, [userAddress, authenticateUser, alert]);

  const load = useCallback(async () => {
    if (!userAddress) return;
    setLoading(true);
    setError(null);
    try {
      const res = await qortalRequest({ action: 'GET_ACCOUNT_NAMES', address: userAddress });
      const arr = Array.isArray(res) ? res : (res?.names ?? []);
      const normalized: AccountName[] = (arr as any[])
        .map((x) =>
          x && typeof x.name === 'string' && typeof x.owner === 'string'
            ? { name: x.name, owner: x.owner }
            : null
        )
        .filter(Boolean) as AccountName[];
      setEntries(normalized);
    } catch (e: any) {
      setError(e?.message || 'Failed to load names');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  const loadPrimaryName = useCallback(async () => {
    if (!userAddress) {
      setPrimaryName(null);
      setPrimaryNameError(false);
      return;
    }
    setPrimaryName(null);
    setPrimaryNameError(false);
    try {
      const res = await qortalRequest({ action: 'GET_PRIMARY_NAME', address: userAddress });
      const resolved =
        typeof res === 'string'
          ? res
          : res && typeof res === 'object' && typeof (res as any).name === 'string'
            ? (res as any).name
            : null;
      setPrimaryName(resolved && resolved.length > 0 ? resolved : null);
    } catch {
      setPrimaryName(null);
      setPrimaryNameError(true);
    }
  }, [userAddress]);

  useEffect(() => {
    if (userAddress) void load();
  }, [userAddress, load]);

  useEffect(() => {
    void loadPrimaryName();
  }, [loadPrimaryName]);

  return { entries, loading, error, reload: load, primaryName, primaryNameError };
}
