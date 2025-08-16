// src/utils/markets.ts
import { getAssetBalances } from '../utils/qortalAssetRequests';
import { useAuth } from 'qapp-core';

// Types you can reuse in the UI
export type BookOrder = {
  orderId: string;
  priceQortPerAsset: number; // QORT/ASSET
  qtyAsset: number;          // ASSET units remaining (approx based on 'fulfilled')
  creator?: string;
  haveAssetId: number;
  wantAssetId: number;
  raw: any;
};

export interface AddressOrderRow {
  orderId: string;
  creatorPublicKey: string;
  haveAssetId: number;
  wantAssetId: number;
  amount: number;          // amount of "amountAssetId"
  price: number;           // price expressed by pricePair
  fulfilled: number;       // fulfilled amount in "amountAssetId" units
  timestamp: number;
  isClosed: boolean;
  isFulfilled: boolean;
  haveAssetName?: string;
  wantAssetName?: string;
  amountAssetId: number;   // which asset "amount" is denominated in
  amountAssetName?: string;
  pricePair?: string;      // e.g. "haveAssetId/wantAssetId" or similar
}

export interface AggregatedOrderbookRow {
  price: number;
  pricePair: string;            // e.g. "0/2" or "QORT/ASSET"
  unfulfilled: number;          // remaining size at this price (denominated in unfulfilledAssetId)
  unfulfilledAssetId: number;
  unfulfilledAssetName?: string;
}

// --- Normalized type the component expects (from previous message) ---
export interface NormalizedOrder {
  orderId: string;
  creator: string;
  timestamp: number;
  haveAssetId: number;
  wantAssetId: number;
  // UI-friendly fields:
  haveAssetName?: string;
  wantAssetName?: string;

  // Amount/price math (see mapper notes below)
  haveAmount: string;  // remaining offer (unfulfilled) in have-asset units
  wantAmount: string;  // remaining desire (unfulfilled) in want-asset units
  price?: number;      // want / have
  status?: 'OPEN' | 'FILLED' | 'CANCELLED';
}


export type OrderSide = 'buy' | 'sell';

// Helpers
const QORT_ID = 0;

export function toBaseUnits(human: number | string, decimals: number): bigint {
  const s = String(human);
  const [i, f = ""] = s.split(".");
  const frac = (f + "0".repeat(decimals)).slice(0, decimals); // truncate (you can round if you want)
  return BigInt(i) * BigInt(10 ** decimals) + BigInt(frac);
}

export function fromBaseUnits(base: bigint | number | string, decimals: number): number {
  const b = typeof base === "bigint" ? base : BigInt(String(base));
  const d = BigInt(10 ** decimals);
  const i = b / d;
  const f = b % d;
  // return as JS number for UI; safe up to 1e15ish given 8 dp. For very large, format string yourself.
  const fracStr = f.toString().padStart(decimals, "0").replace(/0+$/, "");
  return Number(fracStr ? `${i}.${fracStr}` : i.toString());
}

async function getAccountData(address: string) {
  return await qortalRequest({ action: 'GET_ACCOUNT_DATA', address });
}

async function getPublicKeyFor(address: string): Promise<string> {
  const acc = await getAccountData(address);
  const pk = acc?.publicKey;
  if (!pk || typeof pk !== 'string') {
    throw new Error('Unable to obtain public key for authenticated user.');
  }
  return pk;
}

async function getReferenceFor(address: string): Promise<string> {
  const acc = await getAccountData(address);
  const ref = acc?.reference;
  if (!ref || typeof ref !== 'string') {
    throw new Error('Unable to obtain last reference for authenticated user.');
  }
  return ref;
}

export const assertSufficientBalance = async (side: OrderSide, assetId: number, price: number, qtyAsset: number, address: string) => {
  const bals = await getAssetBalances({ addresses: [address] });
  const map = new Map<number, { balance: bigint; decimals: number }>();
  for (const b of bals ?? []) {
    const dec = b.divisible ? 8 : 0; // or b.decimals if present
    map.set(b.assetId, { balance: toBaseUnits(b.balance, dec), decimals: dec }); // adjust if balance already base
  }

  if (side === 'sell') {
    const need = toBaseUnits(qtyAsset, (map.get(assetId)?.decimals ?? 8));
    if (!map.has(assetId) || map.get(assetId)!.balance < need) throw new Error('Insufficient asset balance');
  } else {
    const needQort = toBaseUnits(price * qtyAsset, 8);
    if (!map.has(QORT_ID) || map.get(QORT_ID)!.balance < needQort) throw new Error('Insufficient QORT');
  }
}


// --- Decimals resolver (minimal) ---
const DEC_CACHE = new Map<number, number>();
DEC_CACHE.set(0, 8); // QORT

export async function getDecimals(assetId: number): Promise<number> {
  if (DEC_CACHE.has(assetId)) return DEC_CACHE.get(assetId)!;

  // Option A: skim from getAssetBalances which you're already calling in-app
  // (You might have a global store—adapt accordingly.)
  const balances = await getAssetBalances(/* current user or a generic call */);
  for (const b of balances ?? []) {
    if (typeof b.assetId === "number" && typeof b.divisible === "boolean") {
      DEC_CACHE.set(b.assetId, b.divisible ? 8 : 0); // adjust if your API returns explicit decimals
    }
  }
  if (DEC_CACHE.has(assetId)) return DEC_CACHE.get(assetId)!;

  // Fallback default
  DEC_CACHE.set(assetId, 8);
  return 8;
}


// ------------------------ ORDER BOOK ------------------------

/**
 * Fetch ASKS: people offering ASSET to get QORT (have=assetId, want=0)
 */
export async function fetchAsks(assetId: number, opts?: { limit?: number; offset?: number; reverse?: boolean }): Promise<BookOrder[]> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  if (opts?.reverse != null) params.set('reverse', String(opts.reverse));

  const res = await fetch(`/assets/openorders/${assetId}/${QORT_ID}?${params.toString()}`);
  if (!res.ok) throw new Error(`openorders failed (${assetId}->QORT)`);

  const rows = await res.json();
  return rows.map((r: any): BookOrder => {
    // API semantics:
    // amount = amount of HAVE asset initially; fulfilled = amount filled so far (in HAVE units)
    const amt = Number(r.amount) || 0;
    const ful = Number(r.fulfilled) || 0;
    const haveRemaining = Math.max(0, amt - ful);
    const price = Number(r.price) || 0;
    
    return {
      orderId: String(r.orderId),
      priceQortPerAsset: price,
      qtyAsset: haveRemaining, // since haveAssetId==assetId, remaining qty is asset unit
      creator: r.creatorAddress ?? r.creator ?? undefined,
      haveAssetId: Number(r.haveAssetId),
      wantAssetId: Number(r.wantAssetId),
      raw: r,
    };
  });
}

/**
 * Fetch BIDS: people offering QORT to get ASSET (have=0, want=assetId)
 * API gives 'amount' as QORT amount; we convert to asset qty using qty = amountQORT / priceQORTperASSET
 */
export async function fetchBids(assetId: number, opts?: { limit?: number; offset?: number; reverse?: boolean }): Promise<BookOrder[]> {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  if (opts?.reverse != null) params.set('reverse', String(opts.reverse));

  const res = await fetch(`/assets/openorders/${QORT_ID}/${assetId}?${params.toString()}`);
  if (!res.ok) throw new Error(`openorders failed (QORT->${assetId})`);

  const rows = await res.json();
  return rows.map((r: any): BookOrder => {
    const amtQort = Number(r.amount) || 0;
    const fulQort = Number(r.fulfilled) || 0;
    const qortRemaining = Math.max(0, amtQort - fulQort);
    const price = Number(r.price) || 0;
    const qtyAsset = price > 0 ? qortRemaining / price : 0;
    

    return {
      orderId: String(r.orderId),
      priceQortPerAsset: price,
      qtyAsset,
      creator: r.creatorAddress ?? r.creator ?? undefined,
      haveAssetId: Number(r.haveAssetId), // 0
      wantAssetId: Number(r.wantAssetId), // assetId
      raw: r,
    };
  });
}

export async function fetchOrder(assetOrderId: string) {
  const res = await fetch(`/assets/order/${assetOrderId}`);
  if (!res.ok) throw new Error('order fetch failed');
  return await res.json();
}

export async function fetchOrderTrades(assetOrderId: string, opts?: { limit?: number; offset?: number; reverse?: boolean }) {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  if (opts?.reverse != null) params.set('reverse', String(opts.reverse));
  const res = await fetch(`/assets/order/${assetOrderId}/trades?${params.toString()}`);
  if (!res.ok) throw new Error('order trades fetch failed');
  return await res.json();
}

// ------------------------ CREATE / CANCEL ------------------------

/**
 * Build + sign + broadcast CREATE_ORDER for ASSET/QORT market.
 * - side='sell': have=ASSET, want=QORT, amount = qtyAsset, price = QORT/ASSET
 * - side='buy' : have=QORT, want=ASSET, amount = qtyQORT (= price * qtyAsset), price = QORT/ASSET
 * All values are human units per your prior convention.
 */
export async function createOrderAndBroadcast(params: {
  side: OrderSide;
  assetId: number;
  priceQortPerAsset: number;   // human units, QORT per ASSET
  qtyAsset: number;            // human units of ASSET
  address: string;             // maker address (must match pubkey)
  publicKey?: string;          // optional; will be fetched if absent
  fee?: number;                // default 0.01 (QORT)
  txGroupId?: number;          // default 0
  assetDecimals?: 0 | 8;       // default 8; pass 0 for non-divisible
}): Promise<string> {
  const {
    side,
    assetId,
    priceQortPerAsset,
    qtyAsset,
    address,
    publicKey,
    fee = 0.01,
    txGroupId = 0,
    assetDecimals = 8,
  } = params;

  if (!(priceQortPerAsset > 0) || !(qtyAsset > 0)) {
    throw new Error('Invalid price/qty');
  }

  // NO hooks here. Fetch pubkey if not provided.
  const creatorPublicKey = publicKey ?? (await getPublicKeyFor(address));
  const reference = await getReferenceFor(address);

  // Quantizers
  const q8 = (n: number) => Math.trunc(n * 1e8) / 1e8;
  const qAsset = (n: number) =>
    assetDecimals === 0 ? Math.floor(n) : Math.trunc(n * 1e8) / 1e8;

  // Quantize inputs
  const price = q8(priceQortPerAsset);
  let qty = qAsset(qtyAsset);
  if (!(price > 0) || !(qty > 0)) {
    throw new Error('Invalid price/qty after quantization');
  }

  // Build have/want and amount
  const haveAssetId = side === 'sell' ? assetId : 0;      // QORT=0
  const wantAssetId = side === 'sell' ? 0 : assetId;

  // either side is asset quantity.
  const amount = qAsset(qty);
  if (!(amount > 0)) throw new Error('Invalid amount (rounded to zero)');

  const body = {
    timestamp: Date.now(),
    reference,
    fee,
    txGroupId,
    recipient: null,
    haveAssetId,
    wantAssetId,
    amount,   // ✅ quantized
    price,    // ✅ quantized
    creatorPublicKey,
  };

  // Create
  const res = await fetch('/assets/order', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`Create order failed: ${res.status} ${res.statusText}${txt ? ` — ${txt}` : ''}`);
  }
  const unsignedBase58 = await res.text();

  // Sign
  const signedBytes = await qortalRequest({
    action: 'SIGN_TRANSACTION',
    unsignedBytes: unsignedBase58,
  });

  // Broadcast
  const final = await fetch('/transactions/process', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-API-VERSION': '2' },
    body: signedBytes,
  });
  if (!final.ok) {
    const txt = await final.text().catch(() => '');
    throw new Error(`Broadcast failed: ${final.status} ${final.statusText}${txt ? ` — ${txt}` : ''}`);
  }
  return await final.text();
}


export async function cancelOrderAndBroadcast(params: {
  orderId: string;
  address: string;
  publicKey?: string;
  fee?: number;
  txGroupId?: number;
}): Promise<string> {
  const { orderId, address } = params;
  const creatorPublicKey = params.publicKey || (await getPublicKeyFor(address));
  const reference = await getReferenceFor(address);

  const body = {
    timestamp: Date.now(),
    reference,
    fee: params.fee ?? 0.01,
    txGroupId: params.txGroupId ?? 0,
    recipient: null,
    orderId,
    creatorPublicKey,
  };

  const res = await fetch('/assets/order/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Cancel order failed: ${res.statusText}`);

  const unsignedBase58 = await res.text();

  const signedBytes = await qortalRequest({
    action: 'SIGN_TRANSACTION',
    unsignedBytes: unsignedBase58,
  });

  const final = await fetch('/transactions/process', {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain', 'X-API-VERSION': '2' },
    body: signedBytes,
  });
  if (!final.ok) throw new Error(`Broadcast failed: ${final.statusText}`);
  return await final.text();
}

// — add or replace the earlier helpers with these —


// Replace with your in-house proxy fetcher if you have one
async function fetchApiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Accept: "application/json" } });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/** Returns ONLY this address's orders. Use includeClosed/includeFulfilled flags to widen. */
export async function getAddressOrders(
  address: string,
  opts?: {
    includeClosed?: boolean;
    includeFulfilled?: boolean;
    limit?: number;
    offset?: number;
    reverse?: boolean;
  }
): Promise<NormalizedOrder[]> {
  const q = new URLSearchParams();
  if (opts?.includeClosed) q.set("includeClosed", "true");
  if (opts?.includeFulfilled) q.set("includeFulfilled", "true");
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
  if (opts?.reverse !== undefined) q.set("reverse", String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : "";

  const rows = await fetchApiJSON<AddressOrderRow[]>(`/assets/orders/${address}${qs}`);
  return rows.map(mapAddressOrderRowToNormalized);
}

/** Same as above but limited to one pair server-side. */
export async function getAddressOrdersByPair(
  address: string,
  assetId: number,
  otherAssetId: number,
  opts?: {
    isClosed?: boolean;      // note: the pair endpoint uses isClosed / isFulfilled naming
    isFulfilled?: boolean;
    limit?: number;
    offset?: number;
    reverse?: boolean;
  }
): Promise<NormalizedOrder[]> {
  const q = new URLSearchParams();
  if (opts?.isClosed !== undefined) q.set("isClosed", String(opts.isClosed));
  if (opts?.isFulfilled !== undefined) q.set("isFulfilled", String(opts.isFulfilled));
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
  if (opts?.reverse !== undefined) q.set("reverse", String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : "";

  const rows = await fetchApiJSON<AddressOrderRow[]>(
    `/assets/orders/${address}/${assetId}/${otherAssetId}${qs}`
  );
  return rows.map(mapAddressOrderRowToNormalized);
}

/** Aggregated book (for a depth view on the trading page). */
export async function getAggregatedOrderbook(
  assetId: number,
  otherAssetId: number,
  opts?: { limit?: number; offset?: number; reverse?: boolean }
): Promise<AggregatedOrderbookRow[]> {
  const q = new URLSearchParams();
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
  if (opts?.reverse !== undefined) q.set("reverse", String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : "";
  return fetchApiJSON<AggregatedOrderbookRow[]>(
    `/assets/orderbook/${assetId}/${otherAssetId}${qs}`
  );
}

/** Trades utilities (you can wire these into your Stats page or a mini-ticker). */
export async function getTrades(
  assetId: number,
  otherAssetId: number,
  opts?: { limit?: number; offset?: number; reverse?: boolean }
) {
  const q = new URLSearchParams();
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
  if (opts?.reverse !== undefined) q.set("reverse", String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : "";
  return fetchApiJSON(`/assets/trades/${assetId}/${otherAssetId}${qs}`);
}

export async function getRecentTrades(
  assetIds?: number[],
  otherAssetIds?: number[],
  opts?: { limit?: number; offset?: number; reverse?: boolean }
): Promise<any[]> {  // <-- ensure it's an array
  const q = new URLSearchParams();
  if (assetIds?.length) assetIds.forEach(a => q.append("assetid", String(a)));
  if (otherAssetIds?.length) otherAssetIds.forEach(a => q.append("otherassetid", String(a)));
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
  if (opts?.reverse !== undefined) q.set("reverse", String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : "";
  const res = await fetch(`/assets/trades/recent${qs}`);
  if (!res.ok) throw new Error(`recent trades failed`);
  const data = await res.json();
  return Array.isArray(data) ? data : []; // runtime safety
}


/* -------------------- Mapping Logic -------------------- */
/**
 * The address endpoints return:
 *  - amount, fulfilled, amountAssetId
 *  - haveAssetId, wantAssetId
 *  - price, pricePair
 *
 * In Qortal’s DEX model, "amount" and "fulfilled" are denominated in "amountAssetId".
 * For an ask/offer UI, we want the *remaining* have & want:
 *   remaining = amount - fulfilled  (still in amountAssetId units)
 *
 * If amountAssetId === haveAssetId:
 *   haveRemaining = remaining
 *   wantRemaining = remaining * price
 *
 * If amountAssetId === wantAssetId:
 *   wantRemaining = remaining
 *   haveRemaining = remaining / price
 *
 * If amountAssetId is neither (edge case), we still compute via pricePair if possible.
 * Price 0 is treated safely (no division).
 */
function mapAddressOrderRowToNormalized(r: AddressOrderRow): NormalizedOrder {
  const remaining = Math.max(0, (r.amount ?? 0) - (r.fulfilled ?? 0));
  let haveRemaining = 0;
  let wantRemaining = 0;

  if (r.amountAssetId === r.haveAssetId) {
    haveRemaining = remaining;
    wantRemaining = (r.price ?? 0) * remaining;
  } else if (r.amountAssetId === r.wantAssetId) {
    wantRemaining = remaining;
    haveRemaining = (r.price ?? 0) > 0 ? (remaining / r.price) : 0;
  } else {
    // Fallback: assume price = want / have; try to recover have from pricePair if needed
    if (r.price && r.price > 0) {
      // Bias toward treating the "amount" as have-side when unsure
      haveRemaining = remaining;
      wantRemaining = remaining * r.price;
    } else {
      haveRemaining = remaining;
      wantRemaining = 0;
    }
  }

  return {
    orderId: Array.isArray(r.orderId) ? r.orderId[0] : String(r.orderId),
    creator: r.creatorPublicKey, // address may not be present; we can resolve from pubkey if needed
    timestamp: r.timestamp,
    haveAssetId: r.haveAssetId,
    wantAssetId: r.wantAssetId,
    haveAssetName: r.haveAssetName,
    wantAssetName: r.wantAssetName,
    haveAmount: String(haveRemaining),
    wantAmount: String(wantRemaining),
    price: r.price ?? undefined,
    status: r.isClosed ? "CANCELLED" : (r.isFulfilled ? "FILLED" : "OPEN"),
  };
}

