// src/explorerStats/sorters.ts
import type { ExplorerStats } from "./types";

export type WithStats<T> = T & { _stats?: ExplorerStats | null; _qarsScore?: number | null };

export function attachStats<T>(rows: T[], lookup: (row: T) => ExplorerStats | null): WithStats<T>[] {
  return rows.map(r => ({ ...r, _stats: lookup(r) }));
}

// Primary: QARS score desc (if present)
// Fallbacks: lastTradeTs desc → trades desc → comments desc
export function compareAssets(a: WithStats<any>, b: WithStats<any>) {
  const sa = a._qarsScore ?? -1;
  const sb = b._qarsScore ?? -1;
  if (sa !== sb) return sb - sa;

  const la = a._stats?.lastTradeTs ?? 0;
  const lb = b._stats?.lastTradeTs ?? 0;
  if (la !== lb) return lb - la;

  const ta = a._stats?.trades ?? 0;
  const tb = b._stats?.trades ?? 0;
  if (ta !== tb) return tb - ta;

  const ca = a._stats?.comments ?? 0;
  const cb = b._stats?.comments ?? 0;
  return cb - ca;
}
