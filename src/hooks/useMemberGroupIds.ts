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
        const groups = await getAccountGroups(address);
        if (!cancelled) {
          setMemberGroupIds(
            groups.map((g) => Number(g.groupId)).filter((n) => Number.isFinite(n)) as number[]
          );
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
