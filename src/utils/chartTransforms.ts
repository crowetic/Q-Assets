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

export type TradeT = { ts: number; price: number; qty?: number };

export function buildOhlc(
  trades: Trade[],
  { intervalMs = 5 * 60 * 1000, now = Date.now(), lookbackMs = 24 * 60 * 60 * 1000 } = {}
): OhlcPoint[] {
  if (!Array.isArray(trades) || trades.length === 0) return [];

  const start = now - lookbackMs;
  const sorted = trades.filter(t => t.ts >= start).sort((a, b) => a.ts - b.ts);

  // Map of buckets that had trades
  const buckets = new Map<number, { o: number; h: number; l: number; c: number; v: number }>();

  for (const tr of sorted) {
    const b = Math.floor(tr.ts / intervalMs) * intervalMs;
    let cell = buckets.get(b);
    if (!cell) {
      cell = { o: tr.price, h: tr.price, l: tr.price, c: tr.price, v: 0 };
      buckets.set(b, cell);
    }
    cell.h = Math.max(cell.h, tr.price);
    cell.l = Math.min(cell.l, tr.price);
    cell.c = tr.price;
    cell.v += tr.quantity;
  }

  return [...buckets.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([t, { o, h, l, c, v }]) => ({ t, o, h, l, c, v }));
}

export function buildOhlcStrict(
  trades: TradeT[],
  opts: { intervalMs: number; lookbackMs?: number; now?: number }
): OhlcPoint[] {
  const { intervalMs, lookbackMs = 24*60*60*1000, now = Date.now() } = opts;
  if (!intervalMs || !Number.isFinite(intervalMs)) return [];
  const start = now - lookbackMs;

  // keep only trades in window
  const rows = (trades ?? [])
    .filter(t => Number.isFinite(t.ts) && Number.isFinite(t.price) && t.ts >= start)
    .sort((a, b) => a.ts - b.ts); // ascending

  if (!rows.length) return [];

  // bucket index function
  // const b0 = Math.floor(rows[0].ts / intervalMs);
  const bucketOf = (ts: number) => Math.floor(ts / intervalMs);

  const out: OhlcPoint[] = [];
  let curIdx = bucketOf(rows[0].ts);
  let o = rows[0].price, h = rows[0].price, l = rows[0].price, v = rows[0].qty ?? 0;
  // let first = rows[0].price;
  let last  = rows[0].price;

  const flush = (idx: number) => {
    out.push({
      t: idx * intervalMs,         // ms (your CandleChart converts to seconds)
      o,
      h,
      l,
      c: last,
      v,
    });
  };

  for (let i = 1; i < rows.length; i++) {
    const r = rows[i];
    const bi = bucketOf(r.ts);

    if (bi !== curIdx) {
      // finish old bucket
      flush(curIdx);

      // fill true gaps with NO bucket (candlestick whitespace)
      // (do NOT synthesize carry-forward candles here)

      // start new bucket
      curIdx = bi;
      o = h = l = last = r.price;
      v = r.qty ?? 0;
    } else {
      // same bucket → update stats
      if (r.price > h) h = r.price;
      if (r.price < l) l = r.price;
      last = r.price;
      v += r.qty ?? 0;
    }
  }
  flush(curIdx);
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
