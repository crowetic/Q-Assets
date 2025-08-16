// src/utils/chartTransforms.ts
// Transform your Trade and BookOrder arrays into series for charts.

export type Trade = { price: number; quantity: number; side: 'buy' | 'sell'; ts: number };
export type BookOrder = { priceQortPerAsset: number; qtyAsset: number };

export type OhlcPoint = {
  t: number; // bucket start (ms)
  o: number;
  h: number;
  l: number;
  c: number;
  v: number; // total asset volume in bucket
};

export function buildOhlc(
  trades: Trade[],
  { intervalMs = 5 * 60 * 1000, // 5m
    now = Date.now(),
    lookbackMs = 24 * 60 * 60 * 1000 } = {}
): OhlcPoint[] {
  if (!Array.isArray(trades) || trades.length === 0) return [];
  const start = now - lookbackMs;
  const buckets = new Map<number, { o?: number; h?: number; l?: number; c?: number; v: number }>();

  // Seed last-close carry so gaps render flat instead of missing
  const sorted = trades
    .filter(t => t.ts >= start)
    .sort((a, b) => a.ts - b.ts);

  let lastClose: number | undefined = undefined;

  // Create time buckets across range so chart scales nicely even with sparse trades
  const firstBucket = Math.floor(start / intervalMs) * intervalMs;
  const lastBucket = Math.floor(now / intervalMs) * intervalMs;
  for (let t = firstBucket; t <= lastBucket; t += intervalMs) {
    buckets.set(t, { v: 0 });
  }

  for (const tr of sorted) {
    const b = Math.floor(tr.ts / intervalMs) * intervalMs;
    const cell = buckets.get(b)!;
    if (cell.o == null) cell.o = (lastClose ?? tr.price);
    cell.h = cell.h == null ? tr.price : Math.max(cell.h, tr.price);
    cell.l = cell.l == null ? tr.price : Math.min(cell.l, tr.price);
    cell.c = tr.price;
    cell.v += tr.quantity;
    lastClose = tr.price;
  }

  // Fill empty buckets with flat OHLC at lastClose so lines stay continuous
  let carry = lastClose ?? sorted[0]?.price ?? 0;
  const out: OhlcPoint[] = [];
  for (const [t, cell] of [...buckets.entries()].sort((a, b) => a[0] - b[0])) {
    const o = cell.o ?? carry;
    const c = cell.c ?? carry;
    const h = cell.h ?? Math.max(o, c);
    const l = cell.l ?? Math.min(o, c);
    out.push({ t, o, h, l, c, v: cell.v });
    carry = c;
  }
  return out;
}

export type DepthPoint = { price: number; qty: number; cum: number };

export function buildDepth(
  bids: BookOrder[],
  asks: BookOrder[],
  { maxLevels = 50 } = {}
): { bids: DepthPoint[]; asks: DepthPoint[] } {
  const b = [...(bids ?? [])]
    .filter(x => x.priceQortPerAsset > 0 && x.qtyAsset > 0)
    .sort((a, b) => b.priceQortPerAsset - a.priceQortPerAsset)
    .slice(0, maxLevels)
    .map(x => ({ price: x.priceQortPerAsset, qty: x.qtyAsset }));

  const a = [...(asks ?? [])]
    .filter(x => x.priceQortPerAsset > 0 && x.qtyAsset > 0)
    .sort((a, b) => a.priceQortPerAsset - b.priceQortPerAsset)
    .slice(0, maxLevels)
    .map(x => ({ price: x.priceQortPerAsset, qty: x.qtyAsset }));

  let cum = 0;
  const bidsOut = b.map(p => ({ ...p, cum: (cum += p.qty) })); // cumulative from best bid outward

  cum = 0;
  const asksOut = a.map(p => ({ ...p, cum: (cum += p.qty) })); // cumulative from best ask outward

  return { bids: bidsOut, asks: asksOut };
}

// For a simple sparkline (close price series)
export type LinePoint = { t: number; y: number };

export function toCloseLine(ohlc: OhlcPoint[]): LinePoint[] {
  return ohlc.map(row => ({ t: row.t, y: row.c }));
}
