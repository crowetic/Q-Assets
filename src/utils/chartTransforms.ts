export type Trade = { price: number; quantity: number; side: 'buy' | 'sell'; ts: number };
export type BookOrder = { priceQortPerAsset: number; qtyAsset: number };


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

