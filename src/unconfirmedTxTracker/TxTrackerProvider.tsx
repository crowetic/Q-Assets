import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

export type TxStatus = 'unconfirmed' | 'confirmed';

export type QortalUnconfirmedTx = {
  signature: string;
  type: string;
  creatorAddress?: string;
  service?: number;
  identifier?: string;
  name?: string;
  method?: string;
  // add more fields if you plan to render them
};

export type TrackedTx = {
  tx: QortalUnconfirmedTx;
  firstSeen: number;
  lastSeen: number;
  missCount: number;
  status: TxStatus; // 'unconfirmed' (in mempool) or 'confirmed' (no longer in mempool)
};

type State = { byId: Record<string, TrackedTx> };

type Ctx = {
  state: State;
  upsertSeen: (txs: QortalUnconfirmedTx[], now: number) => void;
  incrementMissesAndConfirmGone: (
    seenSignatures: Set<string>,
    missGoneThreshold: number,
    now: number
  ) => void;
  clearConfirmed: () => void;
  dismiss: (signature: string) => void;
  resetAll: () => void;
};

const STORAGE_KEY = 'qassets_txtracker_v1';

function migrateState(raw: unknown): State | null {
  try {
    const parsed = raw as State;
    if (!parsed?.byId) return null;
    const byId: Record<string, TrackedTx> = {};
    for (const [sig, t] of Object.entries(parsed.byId)) {
      // migrate older “pending” -> “unconfirmed”
      const status = (t as any).status === 'pending' ? 'unconfirmed' : (t as any).status;
      byId[sig] = { ...t, status: status as TxStatus };
    }
    return { byId };
  } catch {
    return null;
  }
}

const TxTrackerContext = createContext<Ctx | null>(null);

export const TxTrackerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [state, setState] = useState<State>(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return { byId: {} };
      const migrated = migrateState(JSON.parse(raw));
      return migrated ?? { byId: {} };
    } catch {
      return { byId: {} };
    }
  });

  const persist = useCallback((updater: (prev: State) => State) => {
    setState((prev) => {
      const next = updater(prev);
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        /* empty */
      }
      return next;
    });
  }, []);

  const upsertSeen = useCallback<Ctx['upsertSeen']>(
    (txs, now) => {
      persist((prev) => {
        const byId = { ...prev.byId };
        for (const tx of txs) {
          if (!tx.signature) continue;
          const existing = byId[tx.signature];
          if (existing) {
            byId[tx.signature] = {
              ...existing,
              tx,
              lastSeen: now,
              missCount: 0,
              status: 'unconfirmed',
            };
          } else {
            byId[tx.signature] = {
              tx,
              firstSeen: now,
              lastSeen: now,
              missCount: 0,
              status: 'unconfirmed',
            };
          }
        }
        return { byId };
      });
    },
    [persist]
  );

  const incrementMissesAndConfirmGone = useCallback<Ctx['incrementMissesAndConfirmGone']>(
    (seen, threshold, now) => {
      persist((prev) => {
        const byId = { ...prev.byId };
        for (const sig of Object.keys(byId)) {
          if (seen.has(sig)) continue;
          const t = byId[sig];
          if (t.status === 'unconfirmed') {
            const nextMiss = (t.missCount ?? 0) + 1;
            if (nextMiss >= threshold) {
              byId[sig] = { ...t, missCount: nextMiss, status: 'confirmed', lastSeen: now };
            } else {
              byId[sig] = { ...t, missCount: nextMiss };
            }
          }
        }
        return { byId };
      });
    },
    [persist]
  );

  const clearConfirmed = useCallback(() => {
    persist((prev) => {
      const byId: Record<string, TrackedTx> = {};
      for (const [sig, t] of Object.entries(prev.byId)) {
        if (t.status === 'unconfirmed') byId[sig] = t;
      }
      return { byId };
    });
  }, [persist]);

  const dismiss = useCallback<Ctx['dismiss']>(
    (signature) => {
      persist((prev) => {
        const byId = { ...prev.byId };
        delete byId[signature];
        return { byId };
      });
    },
    [persist]
  );

  const resetAll: Ctx['resetAll'] = useCallback(() => {
    persist(() => ({ byId: {} }));
  }, [persist]);

  const value = useMemo<Ctx>(
    () => ({
      state,
      upsertSeen,
      incrementMissesAndConfirmGone,
      clearConfirmed,
      dismiss,
      resetAll,
    }),
    [state, upsertSeen, incrementMissesAndConfirmGone, clearConfirmed, dismiss, resetAll]
  );

  return <TxTrackerContext.Provider value={value}>{children}</TxTrackerContext.Provider>;
};

export function useTxTracker() {
  const ctx = useContext(TxTrackerContext);
  if (!ctx) throw new Error('useTxTracker must be used within TxTrackerProvider');
  return ctx;
}
