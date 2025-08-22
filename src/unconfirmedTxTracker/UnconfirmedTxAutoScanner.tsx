import React, { useEffect, useState } from 'react';
import { useTxTracker, QortalUnconfirmedTx } from './TxTrackerProvider';
import { useAuth } from 'qapp-core';
import { ensureUsableAddress, rememberAuthAddress } from '../utils/address';

// node-accepted types; we still pass them to narrow results
const ALLOW_TYPES = [
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

const DEBUG = false;

export const UnconfirmedTxAutoScanner: React.FC<{
  intervalMs?: number;
  missGoneThreshold?: number;
  limit?: number;
}> = ({ intervalMs = 5_000, missGoneThreshold = 2, limit = 200 }) => {
  const { upsertSeen, incrementMissesAndConfirmGone } = useTxTracker();
  const { user } = (useAuth() as any) ?? {};
  const authAddr: string | undefined = user?.address || user?.qortalAddress;

  // resolve a usable address (auth or LKG fallback)
  const [scanAddress, setScanAddress] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    // remember current auth for next time, then compute usable
    if (authAddr) rememberAuthAddress(authAddr);
    (async () => {
      const addr = await ensureUsableAddress({ authAddress: authAddr, skipValidate: true });
      if (alive) setScanAddress(addr);
    })();
    return () => {
      alive = false;
    };
  }, [authAddr]);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const tick = async () => {
      const now = Date.now();

      // If we don't have an address, many nodes cap at 20 — respect that.
      const HARD_CAP_NO_ADDR = 20;
      const serverLimit = scanAddress
        ? Math.min(limit ?? 200, 200)
        : Math.min(limit ?? HARD_CAP_NO_ADDR, HARD_CAP_NO_ADDR);

      let list: QortalUnconfirmedTx[] = [];
      try {
        const res = await qortalRequest({
          action: 'SEARCH_TRANSACTIONS',
          confirmationStatus: 'UNCONFIRMED',
          // pass address so the node filters + allows higher limit
          address: scanAddress ?? undefined,
          txType: [...ALLOW_TYPES], // widen to string[]
          limit: serverLimit,
          offset: 0,
          reverse: true,
        });
        if (Array.isArray(res)) list = res as QortalUnconfirmedTx[];
      } catch (e) {
        if (DEBUG) console.debug('[scanner] fetch error', e);
      }

      // no client-side filtering — node already scoped by address + types
      const seen = new Set<string>(list.map((t: any) => t.signature).filter(Boolean));
      if (list.length) upsertSeen(list, now);
      incrementMissesAndConfirmGone(seen, missGoneThreshold, now);

      if (!cancelled) timer = setTimeout(tick, intervalMs + Math.floor(Math.random() * 1000));
    };

    timer = setTimeout(tick, 500);
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [
    scanAddress,
    intervalMs,
    missGoneThreshold,
    limit,
    upsertSeen,
    incrementMissesAndConfirmGone,
  ]);

  return null;
};
