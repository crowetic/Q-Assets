import { useEffect, useState } from 'react';
import { useAuth } from 'qapp-core';
import { getAccountGroups } from '../utils/qortalApi';

export function useMemberGroupIds() {
  const { address } = useAuth();
  const [memberGroupIds, setMemberGroupIds] = useState<number[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!address) {
      setMemberGroupIds([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        const cacheKey = `memberGroups:${address}`;
        const cached = localStorage.getItem(cacheKey);
        if (cached) {
          try {
            const parsed = JSON.parse(cached);
            if (Array.isArray(parsed) && !cancelled) {
              setMemberGroupIds(parsed as number[]);
            }
          } catch {
            /* ignore cache parse */
          }
        }
        const groups = await getAccountGroups(address);
        if (!cancelled) {
          const next = groups
            .map((g) => Number(g.groupId))
            .filter((n) => Number.isFinite(n)) as number[];
          setMemberGroupIds(next);
          localStorage.setItem(cacheKey, JSON.stringify(next));
        }
      } catch {
        if (!cancelled) setMemberGroupIds([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [address]);

  return { memberGroupIds, loading };
}
