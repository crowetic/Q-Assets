/** List known assets (optionally with data) */
export async function getAllAssets(includeData = true, limit = 0, offset = 0) {
  const res = await fetch(`/assets?includeData=${includeData}&limit=${limit}&offset=${offset}`);
  if (!res.ok) throw new Error('Failed to fetch asset list');
  return res.json();
}

/** Get info on an asset by ID or name */
export async function getAssetInfo(params: { assetId?: number; assetName?: string }) {
  const q = params.assetId
    ? `assetId=${params.assetId}`
    : `assetName=${encodeURIComponent(params.assetName ?? '')}`;
  const res = await fetch(`/assets/info?${q}`);
  if (!res.ok) throw new Error('Failed to fetch asset info');
  return res.json();
}

/** Fetch balances for addresses or asset IDs */

export async function getAssetBalances(
  options: {
    addresses?: string[];
    assetIds?: number[];
    excludeZero?: boolean;
    limit?: number;
    offset?: number;
  } = {}
) {
  const params = new URLSearchParams();
  options.addresses?.forEach((a) => params.append('address', a));
  options.assetIds?.forEach((id) => params.append('assetid', id.toString()));
  if (options.excludeZero) params.set('excludeZero', 'true');
  if (options.limit != null) params.set('limit', options.limit.toString());
  if (options.offset != null) params.set('offset', options.offset.toString());

  const res = await fetch(`/assets/balances?${params.toString()}`);
  if (!res.ok) throw new Error('Failed to fetch balances');
  const balancesRaw = await res.json();

  // Normalize balances (always divide by 1e8 regardless of divisibility)
  return balancesRaw.map((b: any) => ({
    ...b,
  }));
}

export function formatAssetAmount(amount: number, isDivisible: boolean): string {
  const decimals = isDivisible ? 8 : 0;
  return amount.toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Fetch order book or trades, etc. */
export async function getAssetOrderBook(assetId: number, otherAssetId: number) {
  const res = await fetch(`/assets/orderbook/${assetId}/${otherAssetId}`);
  if (!res.ok) throw new Error('Failed to fetch orderbook');
  return res.json();
}

export async function getAssetTrades(assetId: number, otherAssetId: number) {
  const res = await fetch(`/assets/trades/${assetId}/${otherAssetId}`);
  if (!res.ok) throw new Error('Failed to fetch trades');
  return res.json();
}

export async function getOrdersForAsset(assetId: number, otherAssetId: number) {
  const res = await fetch(`/assets/openorders/${assetId}/${otherAssetId}`);
  if (!res.ok) throw new Error('Failed to fetch open orders');
  return res.json();
}

export async function getOrder(orderId: string) {
  const res = await fetch(`/assets/order/${orderId}`);
  if (!res.ok) throw new Error('Failed to fetch order');
  return res.json();
}

export async function getTradesForOrder(orderId: string) {
  const res = await fetch(`/assets/order/${orderId}/trades`);
  if (!res.ok) throw new Error('Failed to fetch trades for order');
  return res.json();
}
