// hooks/useMyOrders.ts
import { useEffect, useMemo, useRef, useState } from 'react';
import { NormalizedOrder } from '../utils/markets';
import { getAddressOrders, getAddressOrdersByPair } from '../utils/markets';
import { useAuth } from 'qapp-core';

export interface UseMyOrdersOptions {
  pollMs?: number; // default 20000
  assetId?: number;
  otherAssetId?: number;
  limit?: number;
  includeClosed?: boolean;
  includeFulfilled?: boolean;
}

export function useMyOrders(opts: UseMyOrdersOptions = {}) {
  const {
    pollMs = 20000,
    assetId,
    otherAssetId,
    limit = 100,
    includeClosed = false,
    includeFulfilled = false,
  } = opts;
  const { address } = useAuth();
  const [orders, setOrders] = useState<NormalizedOrder[] | null>(null);
  const [isFetching, setIsFetching] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const timerRef = useRef<number | null>(null);
  const hiddenRef = useRef<boolean>(document.visibilityState === 'hidden');

  const canRun = useMemo(() => !!address, [address]);

  useEffect(() => {
    const onVis = () => {
      hiddenRef.current = document.visibilityState === 'hidden';
      if (!hiddenRef.current) void refetch();
    };
    document.addEventListener('visibilitychange', onVis);
    return () => document.removeEventListener('visibilitychange', onVis);
  }, []);

  const schedule = () => {
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => void tick(), pollMs);
  };

  const tick = async () => {
    if (!canRun || hiddenRef.current) return schedule();
    abortRef.current?.abort();
    abortRef.current = new AbortController();

    setIsFetching(true);
    setError(null);
    try {
      let data: NormalizedOrder[];
      if (assetId !== undefined && otherAssetId !== undefined) {
        data = await getAddressOrdersByPair(address!, assetId, otherAssetId, {
          isClosed: includeClosed,
          isFulfilled: includeFulfilled,
          limit,
        });
      } else {
        data = await getAddressOrders(address!, {
          includeClosed,
          includeFulfilled,
          limit,
        });
      }
      setOrders(data.filter((o) => o.status === 'OPEN')); // strip closed/filled for the strip
    } catch (e: any) {
      setError(e);
    } finally {
      setIsFetching(false);
      schedule();
    }
  };

  const refetch = async () => {
    if (!canRun) return;
    abortRef.current?.abort();
    await tick();
  };

  useEffect(() => {
    void tick();
    return () => {
      abortRef.current?.abort();
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canRun, assetId, otherAssetId, limit, includeClosed, includeFulfilled, pollMs]);

  return { orders, isFetching, error, refetch };
}
