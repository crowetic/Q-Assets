// hooks/useMyOrders.ts
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  getAddressOrders,
  getAddressOrdersByPair,
  type UiMyOrder,
  type AddressOrderRow,
} from '../utils/markets';
import { useAuth } from 'qapp-core';

export interface UseMyOrdersOptionsBase {
  pollMs?: number; // default 20000
  limit?: number;
  includeClosed?: boolean;
  includeFulfilled?: boolean;
}

export interface UseMyOrdersOptionsPair extends UseMyOrdersOptionsBase {
  assetId: number;
  otherAssetId: number;
}

export interface UseMyOrdersOptionsAll extends UseMyOrdersOptionsBase {
  assetId?: undefined;
  otherAssetId?: undefined;
}

// Overloads: with a pair → UiMyOrder[]; without a pair → AddressOrderRow[]
export function useMyOrders(opts: UseMyOrdersOptionsPair): {
  orders: UiMyOrder[] | null;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};
export function useMyOrders(opts?: UseMyOrdersOptionsAll): {
  orders: AddressOrderRow[] | null;
  isFetching: boolean;
  error: Error | null;
  refetch: () => Promise<void>;
};

// Impl
export function useMyOrders(opts: UseMyOrdersOptionsPair | UseMyOrdersOptionsAll = {}) {
  const {
    pollMs = 20000,
    assetId,
    otherAssetId,
    limit = 100,
    includeClosed = false,
    includeFulfilled = false,
  } = opts as UseMyOrdersOptionsPair & UseMyOrdersOptionsAll;

  const { address } = useAuth() as { address?: string | null };
  const [orders, setOrders] = useState<(UiMyOrder | AddressOrderRow)[] | null>(null);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      if (assetId !== undefined && otherAssetId !== undefined) {
        // Pair-scoped UI orders (already filtered by flags)
        const data = await getAddressOrdersByPair(address!, assetId, otherAssetId, {
          isClosed: includeClosed,
          isFulfilled: includeFulfilled,
          limit,
          // divisible is optional; defaults to true inside markets.ts
        });
        setOrders(data); // UiMyOrder[]
      } else {
        // Raw address orders (pair-agnostic)
        const data = await getAddressOrders(address!, {
          includeClosed,
          includeFulfilled,
          limit,
        });
        setOrders(data); // AddressOrderRow[]
      }
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

  // Narrow the return type for callers via the overloads
  return { orders: orders as any, isFetching, error, refetch };
}
