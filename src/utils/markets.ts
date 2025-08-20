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


export interface OrderTradeRow {
  orderId: string;
  price: number;        // QORT per ASSET
  amount: number;       // ASSET units (for Qortal endpoints this is *usually* asset)
  otherAmount: number;  // QORT units
  timestamp: number;
  // creator/counterparty may or may not be present depending on endpoint
  creatorPublicKey?: string;
  creatorAddress?: string;
  counterpartyAddress?: string;
}

export interface FillEvent {
  orderId: string;
  side: 'buy' | 'sell';
  price: number;        // QORT / ASSET
  qtyAsset: number;     // ASSET units filled in this trade row
  qort: number;         // QORT paid/received in this trade row
  ts: number;           // ms
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

// --- Keep this util robust to field name drift ---
/** Decode a single row from /assets/order/{orderId}/trades
 * Supports both flat shape: {amount, otherAmount, amountAssetId, price, timestamp}
 * and envelope shape (same as decodePairTradeEnvelope).
 */
export function rowToFill(
  r: any,
  side: 'buy' | 'sell',
  pairAssetId: number
): FillEvent {
  // Envelope path
  if (r?.trade) {
    const t = decodePairTradeEnvelope(r, pairAssetId);
    return {
      orderId: String(
        r?.initiatingOrder?.orderId ??
        r?.targetOrder?.orderId ?? ''
      ),
      side,
      qtyAsset: t?.assetAmt ?? 0,
      qort: t?.qortAmt ?? 0,
      price: t?.price ?? 0,
      ts: t?.ts ?? 0,
    };
  }

  // Flat path
  const amountAssetId = Number(r?.amountAssetId);
  const amount        = n(r?.amount);
  const otherAmount   = n(r?.otherAmount);

  let assetAmt = 0, qortAmt = 0;
  if (Number.isFinite(amountAssetId)) {
    if (amountAssetId === 0) { qortAmt = amount; assetAmt = otherAmount; }
    else if (amountAssetId === pairAssetId) { assetAmt = amount; qortAmt = otherAmount; }
    else { assetAmt = otherAmount > 0 ? otherAmount : amount; qortAmt = otherAmount > 0 ? amount : otherAmount; }
  } else {
    // rare: infer like recent
    const aId = Number(r?.assetId), oId = Number(r?.otherAssetId);
    if (aId === 0 && oId === pairAssetId) { qortAmt = amount; assetAmt = otherAmount; }
    else { assetAmt = otherAmount > 0 ? otherAmount : amount; qortAmt = otherAmount > 0 ? amount : otherAmount; }
  }

  const price = (n(r?.price) > 0) ? n(r?.price) : (assetAmt > 0 ? qortAmt / assetAmt : 0);
  const tsRaw = n(r?.timestamp ?? r?.ts ?? 0);
  const ts    = tsRaw > 0 && tsRaw < 2e10 ? tsRaw * 1000 : tsRaw;

  return {
    orderId: String(r?.orderId ?? r?.orderid ?? ''),
    side,
    qtyAsset: assetAmt,
    qort: qortAmt,
    price,
    ts,
  };
}


// Limit concurrency so we don't blast the node
async function pMap<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  let i = 0;
  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]);
    }
  });
  await Promise.all(workers);
  return out;
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
 * - BUY : have=QORT, want=ASSET, amount = qtyAsset (other=ASSET),  price = QORT/ASSET
 * - SELL: have=ASSET, want=QORT, amount = qtyAsset * price (other=QORT), price = QORT/ASSET
 * All values are human units.
 */
export async function createOrderAndBroadcast(params: {
  side: 'buy' | 'sell';
  assetId: number;
  priceQortPerAsset: number;   // QORT per 1 ASSET
  qtyAsset: number;            // ASSET units
  address: string;
  publicKey?: string;
  fee?: number;                // default 0.01 QORT
  txGroupId?: number;          // default 0
  assetDecimals?: 0 | 8;       // default 8; pass 0 if non-divisible
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

  // Fetch keys/refs
  const creatorPublicKey = publicKey ?? (await getPublicKeyFor(address));
  const reference = await getReferenceFor(address);

  // Quantizers
  const q8 = (n: number) => Math.trunc(n * 1e8) / 1e8;                     // QORT 8dp
  const qAsset = (n: number) => (assetDecimals === 0 ? Math.floor(n) : q8(n)); // asset dp

  // Quantize inputs
  const price = q8(priceQortPerAsset);
  const qty   = qAsset(qtyAsset);
  const feeQ  = q8(fee);
  if (!(price > 0) || !(qty > 0)) {
    throw new Error('Invalid price/qty after quantization');
  }

  // Pair tuple
  const haveAssetId = side === 'sell' ? assetId : 0; // QORT=0
  const wantAssetId = side === 'sell' ? 0 : assetId;

  // ✅ Correct Qortal semantics for amount (units of otherAssetId / wantAssetId):
  const amount = side === 'buy'
    ? qAsset(qty)              // other = asset → amount in asset units
    : q8(price * qty);         // other = QORT → amount in QORT

  if (!(amount > 0)) throw new Error('Invalid amount (rounded to zero)');

  const body = {
    timestamp: Date.now(),
    reference,
    fee: feeQ,
    txGroupId,
    recipient: null,
    haveAssetId,
    wantAssetId,
    amount,   // in units of wantAssetId
    price,    // QORT per ASSET (8dp)
    creatorPublicKey,
  };

  // Create unsigned
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
): Promise<any[]> {
  const q = new URLSearchParams();
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
  if (opts?.reverse !== undefined) q.set("reverse", String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : "";
  const data = await fetchApiJSON<any>(`/assets/trades/${assetId}/${otherAssetId}${qs}`);
  // Your endpoint returns an array of envelopes already; be tolerant anyway.
  return Array.isArray(data) ? data : (Array.isArray((data as any)?.trades) ? (data as any).trades : []);
}

// Fetch newest-first pages until we reach windowStart or a safety cap.
export async function fetchTradesPaged(a: number, b: number, windowStartMs: number) {
  const PAGE = 500;               // page size
  const MAX_ROWS = 10000;         // safety
  const MAX_PAGES = Math.ceil(MAX_ROWS / PAGE);

  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await getTrades(a, b, {
      limit: PAGE,
      offset: page * PAGE,        // walk older pages
      reverse: true,              // newest first
    });

    if (!Array.isArray(batch) || batch.length === 0) break;

    all.push(...batch);

    // If the last (oldest within this page) trade is older than the window, we can stop.
    const last = batch[batch.length - 1];
    const lastTsMs = (last?.trade?.timestamp ?? last?.timestamp ?? 0);
    if (lastTsMs && lastTsMs < windowStartMs) break;

    // If we got fewer than PAGE items, we hit the end.
    if (batch.length < PAGE) break;
  }
  return all;
}

// Pull newest-first pages from /assets/trades/0/{assetId} until we cross windowStartMs or run out.
// utils/markets.ts
export async function fetchQortToAssetTrades(
  assetId: number,
  untilMs: number,                      // fetch until we cross this timestamp
  pageSize = 500,
  hardCap = 20000                       // safety cap
) {
  const pages = Math.ceil(hardCap / pageSize);
  const out: any[] = [];

  for (let page = 0; page < pages; page++) {
    const batch = await getTrades(0, assetId, {
      limit: pageSize,
      offset: page * pageSize,          // <-- walk older pages
      reverse: true,                    // newest first in each page
    });

    if (!Array.isArray(batch) || batch.length === 0) break;

    out.push(...batch);

    const last = batch[batch.length - 1];
    const lastTs = Number(last?.trade?.timestamp ?? last?.timestamp ?? 0); // already ms per your sample
    if (lastTs && lastTs < untilMs) break; // we crossed the window start

    if (batch.length < pageSize) break; // end reached
  }

  return out;
}




export async function getRecentTrades(
  assetIds?: number[],
  otherAssetIds?: number[],
  opts?: { limit?: number; offset?: number; reverse?: boolean }
): Promise<any[]> {
  const q = new URLSearchParams();
  if (assetIds?.length) assetIds.forEach(a => { q.append("assetId", String(a)); q.append("assetid", String(a)); });
  if (otherAssetIds?.length) otherAssetIds.forEach(a => { q.append("otherAssetId", String(a)); q.append("otherassetid", String(a)); });
  if (opts?.limit !== undefined) q.set("limit", String(opts.limit));
  if (opts?.offset !== undefined) q.set("offset", String(opts.offset));
  if (opts?.reverse !== undefined) q.set("reverse", String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : "";

  const res = await fetch(`/assets/trades/recent${qs}`);
  if (!res.ok) throw new Error(`recent trades failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (Array.isArray((data as any)?.trades) ? (data as any).trades : []);
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


// ------------------------ COMPLETED TRADES --------------------------------------------

// ---------- Types ----------



const isStr = (x: any): x is string => typeof x === 'string' && x.length > 0;



/** Determine user's side from an envelope by comparing creators to user's address. */
function sideFromEnvelopeForUser(row: any, userAddress: string, pairAssetId: number): 'buy' | 'sell' {
  const init = row?.initiatingOrder;
  const targ = row?.targetOrder;
  const mine =
    (isStr(init?.creator) && init.creator === userAddress) ? init :
    (isStr(targ?.creator) && targ.creator === userAddress) ? targ : null;

  if (!mine) {
    // best-effort fallback: if user not found on envelope, prefer the initiator's side
    return (init?.haveAssetId === 0) ? 'buy' : 'sell';
  }
  return mine.haveAssetId === 0 ? 'buy' : 'sell';
}

/** Merge orders by id (dedupe) */
function uniqOrders(orders: NormalizedOrder[]): NormalizedOrder[] {
  const seen = new Set<string>();
  const out: NormalizedOrder[] = [];
  for (const o of orders) {
    const k = String(o.orderId);
    if (!seen.has(k)) { seen.add(k); out.push(o); }
  }
  return out;
}

/** Get all fills for a user on ASSET/QORT pair. */
export async function getMyFillsForPair(
  address: string,
  pairAssetId: number,
  opts?: {
    limitOrders?: number;
    concurrency?: number;
  }
): Promise<FillEvent[]> {
  const limit = opts?.limitOrders ?? 60;

  // 1) Pull user's orders for this pair, both OPEN and CLOSED/FULFILLED
  const [open, closed, fulfilled] = await Promise.all([
    getAddressOrdersByPair(address, pairAssetId, 0, { isClosed: false, isFulfilled: false, limit, reverse: true }),
    getAddressOrdersByPair(address, pairAssetId, 0, { isClosed: true, limit, reverse: true }),
    getAddressOrdersByPair(address, pairAssetId, 0, { isFulfilled: true, limit, reverse: true }),
  ]);

  const mine = uniqOrders([...(open ?? []), ...(closed ?? []), ...(fulfilled ?? [])]);
  if (!mine.length) {
    // 1b) Fallback: scan pair trades and filter by your address
    const envs = await getTrades(0, pairAssetId, { limit: 60, reverse: true });
    const mineFromEnvelopes: FillEvent[] = (Array.isArray(envs) ? envs : [])
      .filter((row: any) => {
        const iC = row?.initiatingOrder?.creator;
        const tC = row?.targetOrder?.creator;
        return iC === address || tC === address;
      })
      .map((row: any) => {
        const base = decodePairTradeEnvelope(row, pairAssetId);
        const side = sideFromEnvelopeForUser(row, address, pairAssetId);
        return {
          orderId: String(row?.initiatingOrder?.orderId ?? row?.targetOrder?.orderId ?? ''),
          side,
          qtyAsset: base?.assetAmt ?? 0,
          qort: base?.qortAmt ?? 0,
          price: base?.price ?? 0,
          ts: base?.ts ?? 0,
        } as FillEvent;
      })
      .filter(f => f.qtyAsset > 0 && f.qort > 0 && f.price > 0 && f.ts > 0)
      .sort((a, b) => b.ts - a.ts);

    return mineFromEnvelopes;
  }

  // 2) For each order, fetch its trades and map
  const conc = Math.max(1, Math.min(opts?.concurrency ?? 4, 8));
  const groups: FillEvent[][] = [];
  let idx = 0;

  while (idx < mine.length) {
    const batch = mine.slice(idx, idx + conc);
    idx += conc;

    const rowsArr = await Promise.all(batch.map(async (o) => {
      try {
        const rows = await fetchOrderTrades(o.orderId, { limit: 100, reverse: true });
        const side: 'buy' | 'sell' = o.haveAssetId === 0 ? 'buy' : 'sell';
        const fills = Array.isArray(rows)
          ? rows.map(r => rowToFill(r, side, pairAssetId))
          : [];
        return fills;
      } catch {
        return [];
      }
    }));

    groups.push(...rowsArr);
  }

  // 3) Flatten, filter, sort
  return groups.flat()
    .filter(f => f && f.qtyAsset > 0 && f.qort > 0 && f.price > 0 && f.ts > 0)
    .sort((a, b) => b.ts - a.ts);
}



function num(x: any) { const n = Number(x); return Number.isFinite(n) ? n : 0; }

export function decodeTradeRowRecent(row: any, pairAssetId: number) {
  const rowAssetId  = Number(row?.assetId);
  const rowOtherId  = Number(row?.otherAssetId);
  let amount        = num(row?.amount);       // here: QORT for your node
  let otherAmount   = num(row?.otherAmount);  // here: ASSET

  // Map so that assetAmt = non-QORT (pair asset), qortAmt = QORT
  let assetAmt = 0, qortAmt = 0;

  if (rowAssetId === 0 && rowOtherId === pairAssetId) {
    // recent?assetId=0&otherAssetId=ASSET  -> amount=QORT, otherAmount=ASSET
    qortAmt  = amount;
    assetAmt = otherAmount;
  } else if (rowAssetId === pairAssetId && rowOtherId === 0) {
    // (other servers might return the flipped order)
    assetAmt = amount;
    qortAmt  = otherAmount;
  } else {
    // fallbacks if IDs aren’t present
    assetAmt = otherAmount > 0 ? otherAmount : amount;
    qortAmt  = otherAmount > 0 ? amount : otherAmount;
  }

  const price = assetAmt > 0 ? qortAmt / assetAmt : 0;   // QORT / ASSET
  const tsRaw = num(row?.timestamp ?? row?.ts ?? 0);
  const ts    = tsRaw < 2e10 ? tsRaw * 1000 : tsRaw;

  return { assetAmt, qortAmt, price, ts };
}


function n(x: any): number {
  const v = Number(x);
  return Number.isFinite(v) ? v : 0;
}

/** Decode a row from /assets/trades/<assetId>/<otherAssetId>.
 *  The row shape is { trade: {...}, initiatingOrder: {...}, targetOrder: {...} }.
 *  We want assetAmt = non-QORT amount, qortAmt = QORT amount, price = QORT/ASSET.
 */
export function decodePairTradeEnvelope(
  row: any,
  pairAssetId: number
): { assetAmt: number; qortAmt: number; price: number; ts: number } | null {
  const t = row?.trade;
  if (!t) return null;

  const iaId = Number(t.initiatorAmountAssetId);
  const taId = Number(t.targetAmountAssetId);
  const ia   = n(t.initiatorAmount);
  const ta   = n(t.targetAmount);

  let assetAmt = 0;
  let qortAmt  = 0;

  // Map amounts by asset id
  if (iaId === 0 && taId === pairAssetId) {
    // initiator=QORT, target=ASSET
    qortAmt  = ia;
    assetAmt = ta;
  } else if (taId === 0 && iaId === pairAssetId) {
    // initiator=ASSET, target=QORT (not expected for 0/ASSET path, but be safe)
    assetAmt = ia;
    qortAmt  = ta;
  } else {
    // Fallback: assume target is the non-QORT side
    assetAmt = ta > 0 ? ta : ia;
    qortAmt  = ta > 0 ? ia : ta;
  }

  // Prefer price from either order if present, else compute
  const o1p = n(row?.initiatingOrder?.price);
  const o2p = n(row?.targetOrder?.price);
  let price = o1p > 0 ? o1p : (o2p > 0 ? o2p : (assetAmt > 0 ? qortAmt / assetAmt : 0));

  // Timestamp is in ms already
  const ts = n(t.timestamp);

  if (!(assetAmt > 0) || !(qortAmt > 0) || !(price > 0) || !(ts > 0)) return null;
  return { assetAmt, qortAmt, price, ts };
}


function rowHasMe(row: any, address: string, publicKey?: string | null): boolean {
  const iC  = row?.initiatingOrder?.creator;
  const tC  = row?.targetOrder?.creator;
  const iPK = row?.initiatingOrder?.creatorPublicKey;
  const tPK = row?.targetOrder?.creatorPublicKey;
  return (
    (typeof iC === 'string' && iC === address) ||
    (typeof tC === 'string' && tC === address) ||
    (!!publicKey && (iPK === publicKey || tPK === publicKey))
  );
}

function sideForMe(row: any, address: string, publicKey?: string | null): 'buy'|'sell' {
  const init = row?.initiatingOrder;
  const targ = row?.targetOrder;
  const mine =
    (init?.creator === address || init?.creatorPublicKey === publicKey) ? init :
    (targ?.creator === address || targ?.creatorPublicKey === publicKey) ? targ : null;
  // haveAssetId === 0 => you offered QORT => you're BUYING the asset
  return (mine?.haveAssetId === 0) ? 'buy' : 'sell';
}

/** Build fills directly from pair trades by matching your identity. */
export function envelopesToFills(
  envelopes: any[],
  address: string,
  publicKey: string | undefined,
  pairAssetId: number
): FillEvent[] {
  return (Array.isArray(envelopes) ? envelopes : [])
    .filter((row) => rowHasMe(row, address, publicKey))
    .map((row) => {
      const base = decodePairTradeEnvelope(row, pairAssetId);
      const side = sideForMe(row, address, publicKey);
      return {
        orderId: String(row?.initiatingOrder?.orderId ?? row?.targetOrder?.orderId ?? ''),
        side,
        qtyAsset: base?.assetAmt ?? 0,
        qort: base?.qortAmt ?? 0,
        price: base?.price ?? 0,
        ts: base?.ts ?? 0,
      } as FillEvent;
    })
    .filter((f) => f.qtyAsset > 0 && f.qort > 0 && f.price > 0 && f.ts > 0)
    .sort((a, b) => b.ts - a.ts);
}



// -------------------------CHART TRADES --------------------------------------

// Good for both charts and the “Recent” list.
export type ChartTrade = { price: number; quantity: number; side: 'buy' | 'sell'; ts: number };

// const num = (x: any) => {
//   const n = Number(x);
//   return Number.isFinite(n) ? n : 0;
// };

// Re-uses the envelope fields you showed.
export function envelopesToChartTrades(
  envelopes: any[],
  pairAssetId: number
): ChartTrade[] {
  const rows = Array.isArray(envelopes) ? envelopes : [];
  const out: ChartTrade[] = [];

  for (const row of rows) {
    const t = row?.trade;
    if (!t) continue;

    const iaId = Number(t.initiatorAmountAssetId);
    const taId = Number(t.targetAmountAssetId);
    const ia   = num(t.initiatorAmount);
    const ta   = num(t.targetAmount);

    // amounts by asset
    let assetAmt = 0, qortAmt = 0, side: 'buy' | 'sell' = 'buy';
    if (iaId === 0 && taId === pairAssetId) { // initiator offered QORT -> BUY asset
      qortAmt = ia; assetAmt = ta; side = 'buy';
    } else if (taId === 0 && iaId === pairAssetId) { // initiator offered asset -> SELL
      assetAmt = ia; qortAmt = ta; side = 'sell';
    } else {
      // fallback – should not really trigger
      assetAmt = ta > 0 ? ta : ia;
      qortAmt  = ta > 0 ? ia : ta;
      side     = qortAmt === ia ? 'buy' : 'sell';
    }

    // prefer price fields, fallback to implied price
    const p1 = num(row?.initiatingOrder?.price);
    const p2 = num(row?.targetOrder?.price);
    const price = p1 > 0 ? p1 : (p2 > 0 ? p2 : (assetAmt > 0 ? qortAmt / assetAmt : 0));
    const tsRaw = num(t.timestamp);
    const ts = tsRaw > 0 && tsRaw < 2e10 ? tsRaw * 1000 : tsRaw;

    if (assetAmt > 0 && price > 0 && ts > 0) {
      out.push({ price, quantity: assetAmt, side, ts });
    }
  }

  // sort new -> old (your ohlc util can handle either, but consistent is nice)
  out.sort((a, b) => a.ts - b.ts);
  return out;
}
