import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAssetTransactions, AssetTxDetail, AssetTxSummary } from './assetTxTypes';

export function useAssetTx(address: string, assetId: number, pageSize = 20) {
  const [items, setItems] = useState<AssetTxSummary[]>([]);
  const [detailsById, setDetailsById] = useState<Record<string, AssetTxDetail>>({});
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const offsetRef = useRef(0);

  const reset = useCallback(() => {
    setItems([]);
    setDetailsById({});
    setError(null);
    setHasMore(true);
    offsetRef.current = 0;
    setInitialized(false);
  }, []);

  const loadMore = useCallback(async () => {
    if (loading || !hasMore) return;
    try {
      setLoading(true);
      setError(null);
      const {
        items: batch,
        detailsById: detailsBatch,
        total,
        consumed,
        exhausted,
      } = await fetchAssetTransactions({
        address,
        assetId,
        limit: pageSize,
        offset: offsetRef.current,
      });
      setItems((prev) => [...prev, ...batch]);
      if (detailsBatch && Object.keys(detailsBatch).length) {
        setDetailsById((prev) => ({ ...prev, ...detailsBatch }));
      }
      const advanced = typeof consumed === 'number' ? consumed : batch.length;
      offsetRef.current += advanced;
      const canContinue = advanced > 0 && !exhausted;
      if (typeof total === 'number' && offsetRef.current >= total) {
        setHasMore(false);
      } else {
        setHasMore(canContinue);
      }
      setInitialized(true);
    } catch (e: any) {
      setError(String(e?.message || e));
    } finally {
      setLoading(false);
    }
  }, [address, assetId, pageSize, loading, hasMore]);

  // When address/asset change, reset state
  useEffect(() => {
    reset();
  }, [address, assetId, reset]);

  return { items, detailsById, loading, error, hasMore, loadMore, reset, initialized };
}
