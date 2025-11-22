import { useEffect, useMemo, useState } from 'react';
import { useNotifications } from './NotificationProvider';
import { useAuth } from 'qapp-core';
import { getAccountGroups } from '../utils/qortalApi';

type Props = {
  scopes?: string[];
  intervalMs?: number;
  includeUserGroups?: boolean;
};

export function NotificationAutoFetcher({
  scopes = ['global'],
  intervalMs = 60_000,
  includeUserGroups = true,
}: Props) {
  const { refreshScope } = useNotifications();
  const { address } = useAuth();
  const [groupScopes, setGroupScopes] = useState<string[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!includeUserGroups || !address) {
      setGroupScopes([]);
      return () => {
        cancelled = true;
      };
    }

    (async () => {
      try {
        const groups = await getAccountGroups(address);
        if (!cancelled) {
          const scopeKeys = groups.map((g) => `group:${g.groupId}`);
          setGroupScopes(scopeKeys);
        }
      } catch {
        if (!cancelled) setGroupScopes([]);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [address, includeUserGroups]);

  const combinedScopes = useMemo(() => {
    const all = [...(scopes || []), ...groupScopes];
    return Array.from(new Set(all.filter(Boolean)));
  }, [scopes, groupScopes]);

  const scopeKey = combinedScopes.join('|');

  useEffect(() => {
    let cancelled = false;
    const refresh = async () => {
      for (const scope of combinedScopes) {
        await refreshScope(scope);
      }
    };

    refresh();
    const id = setInterval(() => {
      if (!cancelled) refresh();
    }, intervalMs);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [refreshScope, scopeKey, intervalMs, combinedScopes]);

  return null;
}
