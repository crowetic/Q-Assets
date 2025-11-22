// hooks/usePrimaryGroupId.ts
import { useEffect, useState } from 'react';
import { resolvePrimaryGroupId } from '../utils/resolvePrimaryGroupId';

export function usePrimaryGroupId(assetId: number) {
  const [groupId, setGroupId] = useState<number | null>(null);
  useEffect(() => {
    let alive = true;
    if (assetId === 0 || assetId === 1 || assetId === 2) {
      setGroupId(null);
      return;
    }
    (async () => {
      const n = await resolvePrimaryGroupId(assetId);
      if (alive) setGroupId(n);
    })();
    return () => {
      alive = false;
    };
  }, [assetId]);
  return groupId;
}
