import { useEffect, useState } from 'react';
import { AggregatedSnapshot } from '../types/qarsTypes';
import { getAggregatedQars } from './aggregate';

export function useQars(assetId: number) {
  const [data, setData] = useState<AggregatedSnapshot | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      setLoading(true);
      setErr(null);
      try {
        const s = await getAggregatedQars(assetId);
        if (alive) setData(s);
      } catch (e: any) {
        if (alive) setErr(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [assetId]);

  return { data, loading, error: err };
}
