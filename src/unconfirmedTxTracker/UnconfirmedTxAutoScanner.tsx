import React, { useEffect, useRef, useState } from 'react';
import { useTxTracker, QortalUnconfirmedTx } from './TxTrackerProvider';
import { useAuth } from 'qapp-core';
import { ensureUsableAddress, rememberAuthAddress } from '../utils/address';

// keep: narrow what we ask the node for
const ALLOW_TYPES = [
  'PAYMENT',
  'MULTI_PAYMENT', // include — useful for QORT wallet stream
  'ARBITRARY', // (node may include non-CHAT arbitrary; we still accept it)
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
}> = ({ intervalMs = 1000, missGoneThreshold = 2, limit = 200 }) => {
  const { upsertSeen, incrementMissesAndConfirmGone } = useTxTracker();
  const { address: authAddr, authenticateUser } = useAuth() as any;

  const [scanAddress, setScanAddress] = useState<string | null>(null);
  const authKickoff = useRef(false);

  // 1) Try to authenticate exactly once if we have no address yet
  useEffect(() => {
    if (!authAddr && !authKickoff.current && typeof authenticateUser === 'function') {
      authKickoff.current = true;
      try {
        // fire-and-forget; auth state will flow via context
        authenticateUser();
      } catch (e) {
        if (DEBUG) console.debug('[scanner] authenticateUser err', e);
      }
    }
  }, [authAddr, authenticateUser]);

  // 2) Track/remember a usable address (auth or last-known-good)
  useEffect(() => {
    let alive = true;
    if (authAddr) rememberAuthAddress(authAddr);
    (async () => {
      const addr = await ensureUsableAddress({ authAddress: authAddr, skipValidate: true });
      if (alive) setScanAddress(addr);
    })();
    return () => {
      alive = false;
    };
  }, [authAddr]);

  // Small helper – best-effort filter by address if server-side filter isn’t honored
  const involvesAddress = (tx: any, address?: string | null) => {
    const A = (address || '').trim();
    if (!A) return false;
    const f = (v?: string) => (v || '').trim();
    if (A === f(tx.creatorAddress) || A === f(tx.creator)) return true;
    if (A === f(tx.sender) || A === f(tx.senderAddress)) return true;
    if (A === f(tx.recipient) || A === f(tx.recipientAddress)) return true;
    if (Array.isArray(tx?.payments)) {
      for (const p of tx.payments) if (f(p?.recipient) === A) return true;
    }
    if (tx?.initiatingOrder) {
      const io = tx.initiatingOrder;
      if (A === f(io.creatorAddress) || A === f(io.creator)) return true;
    }
    return false;
  };

  // 3) Robust search that probes multiple address parameter spellings, with fallback
  async function searchUnconfirmed(
    addr: string | null,
    max: number
  ): Promise<QortalUnconfirmedTx[]> {
    const base = {
      action: 'SEARCH_TRANSACTIONS',
      confirmationStatus: 'UNCONFIRMED' as const,
      txType: [...ALLOW_TYPES] as unknown as string[],
      limit: max,
      offset: 0,
      reverse: true,
    };

    const tryShapes: Array<Record<string, any>> = addr
      ? [
          { involvingAddresses: [addr] },
          { address: addr },
          { addresses: [addr] },
          { involvingAddress: addr },
        ]
      : [{}];

    for (const shape of tryShapes) {
      try {
        const req: any = { ...base, ...shape };
        const res = await qortalRequest(req);
        if (Array.isArray(res)) {
          // When we pass an address, some nodes still ignore it — guard by client-filter.
          return addr ? (res as any[]).filter((t) => involvesAddress(t, addr)) : (res as any[]);
        }
      } catch (e) {
        if (DEBUG) console.debug('[scanner] probe failed for shape', shape, e);
        // keep trying other shapes
      }
    }

    // Last resort: unscoped tiny pull + client filter
    try {
      const tiny: any = { ...base, limit: Math.min(20, max) };
      const res = await qortalRequest(tiny);
      const arr = Array.isArray(res) ? (res as any[]) : [];
      return addr ? arr.filter((t) => involvesAddress(t, addr)) : arr;
    } catch {
      return [];
    }
  }

  // 4) The polling loop
  useEffect(() => {
    let cancelled = false;
    let t: ReturnType<typeof setTimeout> | null = null;

    const loop = async () => {
      const now = Date.now();
      // nodes often allow larger limits only when address-scoped
      const HARD_CAP_NO_ADDR = 20;
      const serverLimit = scanAddress
        ? Math.min(limit ?? 200, 200)
        : Math.min(limit ?? HARD_CAP_NO_ADDR, HARD_CAP_NO_ADDR);

      const list = await searchUnconfirmed(scanAddress, serverLimit);

      if (DEBUG) console.debug('[scanner] got', list.length, 'unconfirmed for', scanAddress);

      const seen = new Set<string>(list.map((t: any) => t.signature).filter(Boolean));
      if (list.length) upsertSeen(list, now);
      incrementMissesAndConfirmGone(seen, missGoneThreshold, now);

      if (!cancelled) {
        t = setTimeout(loop, intervalMs + Math.floor(Math.random() * 1000));
      }
    };

    t = setTimeout(loop, 400);
    return () => {
      cancelled = true;
      if (t) clearTimeout(t);
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
