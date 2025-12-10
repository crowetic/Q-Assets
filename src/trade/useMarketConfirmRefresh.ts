import { useEffect, useRef } from 'react';

export interface UseMarketConfirmRefreshOpts {
  assetId: number; // the non-QORT asset for the pair
  onConfirm: () => void;
  intervalMs?: number; // base refresh interval while visible
  hiddenMs?: number; // base refresh interval while hidden
  jitterMs?: number;
}

export function useMarketConfirmRefresh(opts: UseMarketConfirmRefreshOpts) {
  const { assetId, onConfirm, intervalMs = 15_000, hiddenMs = 60_000, jitterMs = 1000 } = opts;
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const pickDelay = () => {
      const base = document.visibilityState === 'hidden' ? hiddenMs : intervalMs;
      return base + Math.floor(Math.random() * Math.max(0, jitterMs));
    };

    const scheduleNext = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(() => {
        if (!cancelledRef.current) runCycle();
      }, pickDelay());
    };

    const runCycle = () => {
      onConfirm();
      scheduleNext();
    };

    const onVisibilityChange = () => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      scheduleNext();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);

    scheduleNext();

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      document.removeEventListener('visibilitychange', onVisibilityChange);
    };
  }, [assetId, onConfirm, intervalMs, hiddenMs, jitterMs]);
}
