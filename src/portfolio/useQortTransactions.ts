import { useCallback, useEffect, useRef, useState } from 'react';

const DEFAULT_PAGE_SIZE = 50;

type QortalTransaction = Record<string, any>;

export function useQortTransactions(address: string, pageSize = DEFAULT_PAGE_SIZE) {
  const [items, setItems] = useState<QortalTransaction[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [initialized, setInitialized] = useState(false);

  const offsetRef = useRef(0);
  const seenSignatures = useRef(new Set<string>());

  const reset = useCallback(() => {
    setItems([]);
    setLoading(false);
    setError(null);
    setHasMore(true);
    setInitialized(false);
    seenSignatures.current.clear();
    offsetRef.current = 0;
  }, []);

  useEffect(() => {
    reset();
  }, [address, reset]);

  const loadMore = useCallback(async () => {
    if (!address?.trim() || loading || !hasMore) return;
    setLoading(true);
    setError(null);

    try {
      const req: QortalRequestOptions = {
        action: 'SEARCH_TRANSACTIONS',
        address,
        confirmationStatus: 'BOTH',
        limit: pageSize,
        offset: offsetRef.current,
        reverse: true,
      };

      const res = await qortalRequest(req);
      const rows = Array.isArray(res) ? res : res && typeof res === 'object' ? [res] : [];
      if (!rows.length) {
        setHasMore(false);
        setInitialized(true);
        return;
      }

      const deduped = rows.filter((tx) => {
        const key = String(tx?.signature ?? tx?.txId ?? tx?.txSignature ?? '');
        if (!key) return false;
        if (seenSignatures.current.has(key)) return false;
        seenSignatures.current.add(key);
        return true;
      });

      if (deduped.length) {
        setItems((prev) => [...prev, ...deduped]);
      }

      offsetRef.current += rows.length;
      setHasMore(rows.length >= pageSize);
      setInitialized(true);
    } catch (err: any) {
      console.error('useQortTransactions failed', err);
      setError(err?.message ?? 'Failed to load transactions.');
    } finally {
      setLoading(false);
    }
  }, [address, pageSize, loading, hasMore]);

  return { items, loading, error, hasMore, loadMore, initialized, reset };
}
