import { useCallback, useEffect, useRef, useState } from 'react';
import { fetchAssetTransactions, AssetTx } from './assetTxTypes'

export function useAssetTx(address: string, assetId: number, pageSize = 20) {
  const [items, setItems] = useState<AssetTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [initialized, setInitialized] = useState(false);
  const offsetRef = useRef(0);

  const reset = useCallback(() => {
    setItems([]);
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
      const { items: batch, total } = await fetchAssetTransactions({
        address,
        assetId,
        limit: pageSize,
        offset: offsetRef.current
      });
      setItems((prev) => [...prev, ...batch]);
      offsetRef.current += batch.length;
      if (batch.length < pageSize) setHasMore(false);
      if (typeof total === 'number' && offsetRef.current >= total) setHasMore(false);
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

  return { items, loading, error, hasMore, loadMore, reset, initialized };
}
