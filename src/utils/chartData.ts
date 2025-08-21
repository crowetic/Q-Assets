// --- Candle binning that doesn't guess --- //
export type Trade = { price: number; quantity: number; side: 'buy' | 'sell'; ts: number };

export function toMs(ts: number): number {
  // If ts is in seconds (<= 1e11), convert to ms
  return ts < 1e11 ? ts * 1000 : ts;
}

/**
 * Compute candles from trades (ascending time).
 * volume = sum of trade.quantity (asset units) per bucket
 */
export function computeCandles(
  trades: Trade[],
  opts: { bucketMs: number; lookbackMs: number; now?: number }
) {
  const now = opts.now ?? Date.now();
  const from = now - opts.lookbackMs;
  const bucketMs = opts.bucketMs;

  // Filter to window and normalize timestamps to ms
  const inWindow = trades
    .map(t => ({ ...t, ts: toMs(t.ts) }))
    .filter(t => t.ts >= from && t.ts <= now)
    .sort((a, b) => a.ts - b.ts); // ascending

  if (inWindow.length === 0) return [];

  // Bucket: floor(ts / bucketMs) * bucketMs
  const buckets = new Map<number, { open: number; high: number; low: number; close: number; volume: number }>();

  for (const t of inWindow) {
    const k = Math.floor(t.ts / bucketMs) * bucketMs;
    const b = buckets.get(k);
    if (!b) {
      buckets.set(k, { open: t.price, high: t.price, low: t.price, close: t.price, volume: t.quantity });
    } else {
      if (t.price > b.high) b.high = t.price;
      if (t.price < b.low) b.low = t.price;
      b.close = t.price;
      b.volume += t.quantity;
    }
  }

  // Ensure continuous buckets (for nicer charts), even if empty: create flat candles
  const first = Math.floor(inWindow[0].ts / bucketMs) * bucketMs;
  const last = Math.floor(now / bucketMs) * bucketMs;
  const out: { time: number; open: number; high: number; low: number; close: number; volume: number }[] = [];

  let prevClose = buckets.get(first)?.close ?? inWindow[0].price;
  for (let t = first; t <= last; t += bucketMs) {
    const b = buckets.get(t);
    if (b) {
      out.push({ time: t, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });
      prevClose = b.close;
    } else {
      // flat bar with zero volume
      out.push({ time: t, open: prevClose, high: prevClose, low: prevClose, close: prevClose, volume: 0 });
    }
  }

  return out;
}


export function computeCandlesCompact(
  trades: Trade[],
  opts: { bucketMs: number; lookbackMs: number; now?: number }
) {
  const now = opts.now ?? Date.now();
  const from = now - opts.lookbackMs;
  const bucketMs = opts.bucketMs;

  const inWin = trades
    .map(t => ({ ...t, ts: toMs(t.ts) }))
    .filter(t => t.ts >= from && t.ts <= now)
    .sort((a, b) => a.ts - b.ts);

  const map = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();
  for (const t of inWin) {
    const key = Math.floor(t.ts / bucketMs) * bucketMs;
    const b = map.get(key);
    if (!b) {
      map.set(key, { o: t.price, h: t.price, l: t.price, c: t.price, v: t.quantity });
    } else {
      if (t.price > b.h) b.h = t.price;
      if (t.price < b.l) b.l = t.price;
      b.c = t.price;
      b.v += t.quantity;
    }
  }

  return [...map.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([time, b]) => ({ time, open: b.o, high: b.h, low: b.l, close: b.c, volume: b.v }));
}

// utils/chartBinning.ts (additions)

// Pick a bucket that gives ~targetBars for given lookback
export function pickBucketMs(lookbackMs: number, targetBars = 150) {
  const raw = Math.max(60_000, Math.floor(lookbackMs / targetBars)); // >= 1m
  // snap to friendly buckets
  const choices = [
    60_000,         // 1m
    5 * 60_000,     // 5m
    15 * 60_000,    // 15m
    60 * 60_000,    // 1h
    4 * 60 * 60_000,// 4h
    24 * 60 * 60_000// 1d
  ];
  for (const c of choices) if (raw <= c) return c;
  return choices[choices.length - 1];
}

// If candles come back too few, fall back to "per-trade" bars:
// one trade == one candle (still OHLC, but effectively a dot/line of closes)
export function tradesAsCandlesPerTrade(trades: Trade[], lookbackMs: number, now = Date.now()) {
  const from = now - lookbackMs;
  const asc = trades
    .map(t => ({ ...t, ts: toMs(t.ts) }))
    .filter(t => t.ts >= from && t.ts <= now)
    .sort((a, b) => a.ts - b.ts);

  return asc.map(t => ({
    time: Math.floor(t.ts / 1000) * 1000, // align to ms grid
    open: t.price, high: t.price, low: t.price, close: t.price, volume: t.quantity,
  }));
}
