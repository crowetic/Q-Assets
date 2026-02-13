import { useEffect, useMemo, useRef, useState } from 'react';
import { useNotifications } from './NotificationProvider';
import { useAuth } from 'qapp-core';
import { getAccountGroups } from '../utils/qortalApi';

type Props = {
  scopes?: string[];
  intervalMs?: number;
  includeUserGroups?: boolean;
  startDelayMs?: number;
  maxScopesPerCycle?: number;
};

export function NotificationAutoFetcher({
  scopes = ['global'],
  intervalMs = 60_000,
  includeUserGroups = true,
  startDelayMs = 1500,
  maxScopesPerCycle = 2,
}: Props) {
  const { refreshScope } = useNotifications();
  const { address } = useAuth();
  const [groupScopes, setGroupScopes] = useState<string[]>([]);
  const [ready, setReady] = useState(false);
  const scopeCursorRef = useRef(0);

  useEffect(() => {
    if (typeof window === 'undefined') {
      setReady(true);
      return;
    }
    const id = window.setTimeout(() => setReady(true), Math.max(0, startDelayMs));
    return () => window.clearTimeout(id);
  }, [startDelayMs]);

  useEffect(() => {
    let cancelled = false;
    if (!ready || !includeUserGroups || !address) {
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
  }, [address, includeUserGroups, ready]);

  const combinedScopes = useMemo(() => {
    const all = [...(scopes || []), ...groupScopes];
    return Array.from(new Set(all.filter(Boolean)));
  }, [scopes, groupScopes]);

  const scopeKey = combinedScopes.join('|');

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;

    const nextScopeBatch = () => {
      if (!combinedScopes.length) return [] as string[];
      const take = Math.max(1, Math.min(maxScopesPerCycle, combinedScopes.length));
      const start = scopeCursorRef.current % combinedScopes.length;
      const batch: string[] = [];
      for (let i = 0; i < take; i += 1) {
        batch.push(combinedScopes[(start + i) % combinedScopes.length]);
      }
      scopeCursorRef.current = (start + take) % combinedScopes.length;
      return batch;
    };

    const refresh = async () => {
      const batch = nextScopeBatch();
      for (const scope of batch) {
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
  }, [refreshScope, scopeKey, intervalMs, combinedScopes, maxScopesPerCycle, ready]);

  return null;
}
