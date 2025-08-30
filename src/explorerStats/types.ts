

export interface ExplorerStats {
  assetId: number;

  // Trades
  trades: number | null;
  lastTradeTs: number | null;       // from /assets/trades/recent
  qortVolLastN: number | null;      // Σ QORT over last N trades

  // Community / Group (unchanged, fill if you already had these)
  comments: number | null;
  lastCommentTs: number | null;
  groupMembers: number | null;

  updatedAt: number;
  approximate: boolean;             // keep for future (not needed with these endpoints)
  v: 1;
}

export const TRADE_FETCH_N = 100;    // control knob for “last N trades”
export const TTL = {
  trades:   2 * 60_000,   // 2m – trades move fast
  comments: 10 * 60_000,
  members:  30 * 60_000,
} as const;
