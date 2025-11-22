import { useEffect, useRef } from 'react';

const TRADE_TX_TYPES = [
  'CREATE_ASSET_ORDER',
  'CANCEL_ASSET_ORDER',
  // keep TRANSFER_ASSET optional; uncomment if you want balance-settlement to also trigger
  // 'TRANSFER_ASSET',
] as const;

type UnconfirmedTx = {
  signature: string;
  type: string;
  // authoritative for CREATE_ASSET_ORDER; often present for CANCEL as well on recent nodes
  haveAssetId?: number;
  wantAssetId?: number;
  // some nodes encode the ids under initiatingOrder; we’ll read those too just in case
  initiatingOrder?: { haveAssetId?: number; wantAssetId?: number };
};

export interface UseMarketConfirmRefreshOpts {
  assetId: number; // the non-QORT asset for the pair
  onConfirm: () => void; // called when any market trade tx confirms (disappears)
  intervalMs?: number; // default 3000
  hiddenMs?: number; // default 12000
  jitterMs?: number; // default 1000
}

function isThisMarket(tx: UnconfirmedTx, assetId: number): boolean {
  // prefer top-level (your sample shows these present)
  let have = tx.haveAssetId;
  let want = tx.wantAssetId;

  // fallback: grab from initiatingOrder if top-level missing
  if (typeof have !== 'number' || typeof want !== 'number') {
    have = tx.initiatingOrder?.haveAssetId ?? have;
    want = tx.initiatingOrder?.wantAssetId ?? want;
  }

  // If we still don't know, conservatively include it (better to refresh than miss)
  if (typeof have !== 'number' || typeof want !== 'number') return true;

  // Our markets are QORT(0) <-> assetId (either direction)
  return (have === 0 && want === assetId) || (have === assetId && want === 0);
}

/**
 * Polls UNCONFIRMED for trade txs in this market. When any previously-seen
 * signature disappears (confirmed/dropped), fires onConfirm() once per burst.
 */
export function useMarketConfirmRefresh(opts: UseMarketConfirmRefreshOpts) {
  const { assetId, onConfirm, intervalMs = 3000, hiddenMs = 12000, jitterMs = 1000 } = opts;

  const prevSigsRef = useRef<Set<string>>(new Set());
  const debounceRef = useRef<number | null>(null);
  const timerRef = useRef<number | null>(null);
  const cancelledRef = useRef(false);

  useEffect(() => {
    cancelledRef.current = false;

    const pickDelay = () => {
      const base = document.visibilityState === 'hidden' ? hiddenMs : intervalMs;
      return base + Math.floor(Math.random() * Math.max(0, jitterMs));
    };

    const schedule = (ms: number) => {
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(tick, ms);
    };

    const tick = async () => {
      let list: UnconfirmedTx[] = [];
      try {
        const res = await qortalRequest({
          action: 'SEARCH_TRANSACTIONS',
          confirmationStatus: 'UNCONFIRMED',
          txType: TRADE_TX_TYPES as unknown as [],
          limit: 200,
          offset: 0,
          reverse: true,
        });
        if (Array.isArray(res)) list = res as UnconfirmedTx[];
      } catch {
        // swallow and retry next tick
      }

      const marketTxs = list.filter((tx) => isThisMarket(tx, assetId));
      const current = new Set(marketTxs.map((tx) => tx.signature).filter(Boolean));

      // detection: anything that was there last tick but not now -> confirmed/gone
      const disappeared: string[] = [];
      for (const sig of prevSigsRef.current) {
        if (!current.has(sig)) disappeared.push(sig);
      }

      prevSigsRef.current = current;

      if (!cancelledRef.current) {
        if (disappeared.length > 0) {
          // debounce coalesces multiple confirms in a short burst
          if (debounceRef.current) window.clearTimeout(debounceRef.current);
          debounceRef.current = window.setTimeout(() => onConfirm(), 200);
        }
        schedule(pickDelay());
      }
    };

    // fire immediately
    schedule(0);

    const onVis = () => {
      // retune quickly on visibility flip
      if (timerRef.current) window.clearTimeout(timerRef.current);
      schedule(100);
    };
    document.addEventListener('visibilitychange', onVis);

    return () => {
      cancelledRef.current = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      if (debounceRef.current) window.clearTimeout(debounceRef.current);
      document.removeEventListener('visibilitychange', onVis);
    };
  }, [assetId, onConfirm, intervalMs, hiddenMs, jitterMs]);
}
