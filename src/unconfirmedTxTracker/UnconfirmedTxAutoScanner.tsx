import React, { useEffect, useRef } from 'react';
import { useTxTracker, QortalUnconfirmedTx } from './TxTrackerProvider';
import { useAuth } from 'qapp-core'; // adjust imports if needed

const MONITORED_TX_TYPES = [
  'PAYMENT',
  'ARBITRARY',
  'TRANSFER_ASSET',
  'ISSUE_ASSET',
  'CREATE_ASSET_ORDER',
  'CANCEL_ASSET_ORDER',
  'CREATE_GROUP',
  'JOIN_GROUP',
  'LEAVE_GROUP',
] as const;

const STORAGE_KEY = 'qassets_txtracker_v1';

export const UnconfirmedTxAutoScanner: React.FC<{
  intervalMs?: number; // default 15s
  missGoneThreshold?: number; // scans to wait after disappearance, default 2
  limit?: number; // default 75
}> = ({ intervalMs = 15_000, missGoneThreshold = 2, limit = 75 }) => {
  const { upsertSeen, incrementMissesAndConfirmGone } = useTxTracker();
  const { user } = useAuth() as any;
  const myAddress: string | undefined = user?.address || user?.qortalAddress;
  const lastGoodAddrRef = useRef<string | undefined>(myAddress || undefined);
  const lastGoodAtRef = useRef<number>(myAddress ? Date.now() : 0);

  useEffect(() => {
    const now = Date.now();
    if (myAddress) {
      if (myAddress !== lastGoodAddrRef.current) {
        // Account changed — clear persisted mem only for this component (not provider)
        try {
          localStorage.removeItem(STORAGE_KEY);
        } catch {}
        // and reset miss accounting by forcing a full re-detect naturally next tick
      }
      lastGoodAddrRef.current = myAddress;
      lastGoodAtRef.current = now;
    }
  }, [myAddress]);

  useEffect(() => {
    let cancelled = false;
    let timer: any;

    const tick = async () => {
      const now = Date.now();
      const args: any = {
        action: 'SEARCH_TRANSACTIONS',
        confirmationStatus: 'UNCONFIRMED',
        txType: MONITORED_TX_TYPES as unknown as string[],
        address: myAddress,
        limit,
        offset: 0,
        reverse: true,
      };

      let list: QortalUnconfirmedTx[] = [];
      try {
        const res = await qortalRequest(args);
        if (Array.isArray(res)) list = res as QortalUnconfirmedTx[];
      } catch {
        // ignore network errors; try again later
      }

      // Client-side filter if backend didn't filter by address
      if (myAddress) list = list.filter((tx) => tx.creatorAddress === myAddress);

      const seen = new Set<string>(list.map((t) => t.signature).filter(Boolean));

      if (list.length) upsertSeen(list, now);
      incrementMissesAndConfirmGone(seen, missGoneThreshold, now);

      if (!cancelled) {
        timer = setTimeout(tick, intervalMs + Math.floor(Math.random() * 1000));
      }
    };

    timer = setTimeout(tick, 1200);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [upsertSeen, incrementMissesAndConfirmGone, myAddress, intervalMs, missGoneThreshold, limit]);

  return null;
};
