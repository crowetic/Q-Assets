// src/utils/markets.ts
import { getAssetBalances } from '../utils/qortalAssetRequests';

/* =========================
    Types
   ========================= */

export type BookOrder = {
  orderId: string;
  priceQortPerAsset: number; // QORT/ASSET
  qtyAsset: number;          // ASSET units remaining (approx based on 'fulfilled')
  creator?: string;
  haveAssetId: number;
  wantAssetId: number;
  raw: any;
};

type DecStr = string;

export interface AddressOrderRow {
  orderId: string;
  creatorPublicKey: string;
  haveAssetId: number;      // 0 = QORT
  wantAssetId: number;      // the other asset in the pair
  amount: DecStr;           // in units of amountAssetId (human)
  price: DecStr;            // QORT per 1 unit of amountAssetId (human)
  fulfilled: DecStr;        // fulfilled in units of amountAssetId (human)
  timestamp: number;        // ms (older nodes might use sec; we guard)
  isClosed: boolean;
  isFulfilled: boolean;
  haveAssetName?: string;
  wantAssetName?: string;
  amountAssetId: number;    // which asset "amount" is denominated in
  amountAssetName?: string;
  pricePair?: string;       // e.g. "QORT/Q-Asset"
}

type Side = 'buy' | 'sell';

export interface UiMyOrder {
  orderId: string;
  side: Side;                // relative to the non-zero pair asset
  priceQortPerAsset: number; // QORT per 1 pair asset
  qtyAssetTotal: number;
  qtyAssetOpen: number;      // remaining amount in pair asset units
  ts: number;                // ms
  raw: AddressOrderRow;      // keep for debugging
}

export interface AggregatedOrderbookRow {
  price: number;
  pricePair: string;         // e.g. "0/2" or "QORT/ASSET"
  unfulfilled: number;       // remaining size at this price (denominated in unfulfilledAssetId)
  unfulfilledAssetId: number;
  unfulfilledAssetName?: string;
}

export interface OrderTradeRow {
  orderId: string;
  price: number;        // QORT per ASSET
  amount: number;       // ASSET units (for Qortal endpoints this is *usually* asset)
  otherAmount: number;  // QORT units
  timestamp: number;
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

export type ChartTrade = { price: number; quantity: number; side: 'buy' | 'sell'; ts: number };

/* =========================
    Helpers
   ========================= */

const QORT_ID = 0;

const toNum = (x: unknown) => {
  const n = typeof x === 'number' ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
};

const quant = (n: number, dp: number) => {
  const f = Math.pow(10, dp);
  return Math.trunc(n * f) / f;
};

export function toBaseUnits(human: number | string, decimals: number): bigint {
  const s = String(human);
  const [i, f = ''] = s.split('.');
  const frac = (f + '0'.repeat(decimals)).slice(0, decimals); // truncate
  return BigInt(i) * BigInt(10 ** decimals) + BigInt(frac);
}

export function fromBaseUnits(base: bigint | number | string, decimals: number): number {
  const b = typeof base === 'bigint' ? base : BigInt(String(base));
  const d = BigInt(10 ** decimals);
  const i = b / d;
  const f = b % d;
  const fracStr = f.toString().padStart(decimals, '0').replace(/0+$/, '');
  return Number(fracStr ? `${i}.${fracStr}` : i.toString());
}

async function getAccountData(address: string) {
  return await qortalRequest({ action: 'GET_ACCOUNT_DATA', address });
}

async function getPublicKeyFor(address: string): Promise<string> {
  const acc = await getAccountData(address);
  const pk = acc?.publicKey;
  if (!pk || typeof pk !== 'string') throw new Error('Unable to obtain public key for authenticated user.');
  return pk;
}

async function getReferenceFor(address: string): Promise<string> {
  const acc = await getAccountData(address);
  const ref = acc?.reference;
  if (!ref || typeof ref !== 'string') throw new Error('Unable to obtain last reference for authenticated user.');
  return ref;
}

export const assertSufficientBalance = async (
  side: Side,
  assetId: number,
  price: number,
  qtyAsset: number,
  address: string
) => {
  const bals = await getAssetBalances({ addresses: [address] });
  const map = new Map<number, { balance: bigint; decimals: number }>();
  for (const b of bals ?? []) {
    const dec = b.divisible ? 8 : 0;
    map.set(b.assetId, { balance: toBaseUnits(b.balance, dec), decimals: dec }); // adjust if balances already base
  }

  if (side === 'sell') {
    const need = toBaseUnits(qtyAsset, map.get(assetId)?.decimals ?? 8);
    if (!map.has(assetId) || map.get(assetId)!.balance < need) throw new Error('Insufficient asset balance');
  } else {
    const needQort = toBaseUnits(price * qtyAsset, 8);
    if (!map.has(QORT_ID) || map.get(QORT_ID)!.balance < needQort) throw new Error('Insufficient QORT');
  }
};

/* =========================
    Decimals cache (minimal)
   ========================= */

const DEC_CACHE = new Map<number, number>();
DEC_CACHE.set(0, 8); // QORT

export async function getDecimals(assetId: number): Promise<number> {
  if (DEC_CACHE.has(assetId)) return DEC_CACHE.get(assetId)!;

  const balances = await getAssetBalances();
  for (const b of balances ?? []) {
    if (typeof b.assetId === 'number' && typeof b.divisible === 'boolean') {
      DEC_CACHE.set(b.assetId, b.divisible ? 8 : 0);
    }
  }
  if (DEC_CACHE.has(assetId)) return DEC_CACHE.get(assetId)!;

  DEC_CACHE.set(assetId, 8);
  return 8;
}

/* =========================
    Order book
   ========================= */

// function openQtyInAssetUnits(
//   row: { amount: any; fulfilled: any; amountAssetId: number | string; price: any },
//   pairAssetId: number // the non-QORT id on this screen
// ): number {
//   const amt  = toNum(row.amount);
//   const ful  = toNum(row.fulfilled);
//   const open = Math.max(0, amt - ful);            // units of amountAssetId
//   const aId  = Number(row.amountAssetId);
//   // const px   = toNum(row.price);                   // QORT per 1 asset

//   if (aId === pairAssetId) return open;            // already in asset units
//   return open;// unexpected: best effort
// }

function openQtyInAssetUnits(
  row: { amount: any; fulfilled: any; amountAssetId: number | string; price: any },
  pairAssetId: number // the non-QORT id on this screen
): number {
  const amt  = toNum(row.amount);
  const ful  = toNum(row.fulfilled);
  const open = Math.max(0, amt - ful);             // units of amountAssetId
  const aId  = Number(row.amountAssetId);
  const px   = toNum(row.price);                    // QORT per 1 asset

  if (aId === pairAssetId) return open;             // already in asset units
  if (aId === QORT_ID) {                            // in QORT -> convert to asset
    return px > 0 ? open / px : 0;
  }
  // Unknown denomination: best effort (don’t lie)
  return 0;
}


export async function fetchAsks(assetId: number, opts?: {limit?: number; offset?: number; reverse?: boolean }): Promise<BookOrder[]> {
  const qs = new URLSearchParams();
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  if (opts?.offset != null) qs.set('offset', String(opts.offset));
  if (opts?.reverse != null) qs.set('reverse', String(opts.reverse));

  const res = await fetch(`/assets/openorders/${assetId}/0?${qs.toString()}`);
  if (!res.ok) throw new Error(`openorders failed (${assetId}->QORT)`);
  const rows = await res.json();

  return (rows as any[]).map((r) => ({
    orderId: String(r.orderId),
    priceQortPerAsset: toNum(r.price),
    qtyAsset: openQtyInAssetUnits(r, assetId),
    creator: r.creatorAddress ?? r.creator ?? undefined,
    haveAssetId: Number(r.haveAssetId),
    wantAssetId: Number(r.wantAssetId),
    raw: r,
  }));
}

export async function fetchBids(assetId: number, opts?: {limit?: number; offset?: number; reverse?: boolean }): Promise<BookOrder[]> {
  const qs = new URLSearchParams();
  if (opts?.limit != null) qs.set('limit', String(opts.limit));
  if (opts?.offset != null) qs.set('offset', String(opts.offset));
  if (opts?.reverse != null) qs.set('reverse', String(opts.reverse));

  // QORT first, then asset (endpoint requirement)
  const res = await fetch(`/assets/openorders/0/${assetId}?${qs.toString()}`);
  if (!res.ok) throw new Error(`openorders failed (QORT->${assetId})`);
  const rows = await res.json();

  return (rows as any[]).map((r) => ({
    orderId: String(r.orderId),
    priceQortPerAsset: toNum(r.price),
    qtyAsset: openQtyInAssetUnits(r, assetId),
    creator: r.creatorAddress ?? r.creator ?? undefined,
    haveAssetId: Number(r.haveAssetId),
    wantAssetId: Number(r.wantAssetId),
    raw: r,
  }));
}

export async function fetchOrder(assetOrderId: string) {
  const res = await fetch(`/assets/order/${assetOrderId}`);
  if (!res.ok) throw new Error('order fetch failed');
  return await res.json();
}

export async function fetchOrderTrades(
  assetOrderId: string,
  opts?: { limit?: number; offset?: number; reverse?: boolean }
) {
  const params = new URLSearchParams();
  if (opts?.limit != null) params.set('limit', String(opts.limit));
  if (opts?.offset != null) params.set('offset', String(opts.offset));
  if (opts?.reverse != null) params.set('reverse', String(opts.reverse));
  const res = await fetch(`/assets/order/${assetOrderId}/trades?${params.toString()}`);
  if (!res.ok) throw new Error('order trades fetch failed');
  return await res.json();
}

/* =========================
    Create / Cancel orders
   ========================= */

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

  const creatorPublicKey = publicKey ?? (await getPublicKeyFor(address));
  const reference = await getReferenceFor(address);

  const q8 = (n: number) => Math.trunc(n * 1e8) / 1e8;                         // QORT 8dp
  const qAsset = (n: number) => (assetDecimals === 0 ? Math.floor(n) : q8(n)); // asset dp

  const price = q8(priceQortPerAsset);
  const qty   = qAsset(qtyAsset);
  const feeQ  = q8(fee);
  if (!(price > 0) || !(qty > 0)) throw new Error('Invalid price/qty after quantization');

  const haveAssetId = side === 'sell' ? assetId : 0; // QORT=0
  const wantAssetId = side === 'sell' ? 0 : assetId;

  // amount is in units of wantAssetId - have changed the below and it seems to be working, I'm not going to mess with it. 
  // const amount = side === 'sell' ? qAsset(qty) : q8(price * qty);
  const amount = qAsset(qty)
  if (!(amount > 0)) throw new Error('Invalid amount (rounded to zero)');

  const body = {
    timestamp: Date.now(),
    reference,
    fee: feeQ,
    txGroupId,
    recipient: null,
    haveAssetId,
    wantAssetId,
    amount,
    price, // QORT per ASSET (8dp)
    creatorPublicKey,
  };

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

  const signedBytes = await qortalRequest({
    action: 'SIGN_TRANSACTION',
    unsignedBytes: unsignedBase58,
  });

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

/* =========================
    Generic fetch helper
   ========================= */

async function fetchApiJSON<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(path, { ...init, headers: { Accept: 'application/json' } });
  if (!res.ok) throw new Error(`API ${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

/* =========================
    Address → Orders
   ========================= */

/** Returns ONLY this address's orders (pair-agnostic raw rows). */
export async function getAddressOrders(
  address: string,
  opts?: {
    includeClosed?: boolean;
    includeFulfilled?: boolean;
    limit?: number;
    offset?: number;
    reverse?: boolean;
  }
): Promise<AddressOrderRow[]> {
  const q = new URLSearchParams();
  if (opts?.includeClosed) q.set('includeClosed', 'true');
  if (opts?.includeFulfilled) q.set('includeFulfilled', 'true');
  if (opts?.limit !== undefined) q.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) q.set('offset', String(opts.offset));
  if (opts?.reverse !== undefined) q.set('reverse', String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : '';

  return fetchApiJSON<AddressOrderRow[]>(`/assets/orders/${address}${qs}`);
}

/** Get *this address's* orders for a single ASSET/QORT pair by filtering the pair-agnostic list. */
export async function getMyOrdersForAssetUi(
  address: string,
  assetId: number,
  opts: {
    divisible: boolean;
    includeClosed?: boolean;
    includeFulfilled?: boolean;
    limit?: number;
    offset?: number;
    reverse?: boolean;
  } = { divisible: true }
): Promise<UiMyOrder[]> {
  const rows = await getAddressOrders(address, {
    includeClosed: opts.includeClosed,
    includeFulfilled: opts.includeFulfilled,
    limit: opts.limit,
    offset: opts.offset,
    reverse: opts.reverse,
  });

  const pairRows = (rows ?? []).filter(
    (r) =>
      (r.haveAssetId === 0 && r.wantAssetId === assetId) ||
      (r.haveAssetId === assetId && r.wantAssetId === 0)
  );

  const mapped = pairRows.map((r) => mapAddressOrderRowToUi(r, assetId, 0, !!opts.divisible));

  // Dedupe
  const byId = new Map<string, UiMyOrder>();
  for (const m of mapped) byId.set(m.orderId, m);

  const deduped = Array.from(byId.values());

  // Sort like books: asks lowest→highest, bids highest→lowest
  const asks = deduped.filter((o) => o.side === 'sell').sort((a, b) => a.priceQortPerAsset - b.priceQortPerAsset);
  const bids = deduped.filter((o) => o.side === 'buy').sort((a, b) => b.priceQortPerAsset - a.priceQortPerAsset);

  return [...asks, ...bids];
}


/**
 * Pair-scoped. Returns **UI-ready** orders for the given pair.
 * Backwards-compatible signature: you can omit `divisible` (defaults true).
 */
export async function getAddressOrdersByPair(
  address: string,
  assetId: number,
  otherAssetId: number,
  opts?: {
    isClosed?: boolean;
    isFulfilled?: boolean;
    limit?: number;
    offset?: number;
    reverse?: boolean;
    divisible?: boolean; // optional for qty clamping; default true
  }
): Promise<UiMyOrder[]> {
  const q = new URLSearchParams();
  if (opts?.isClosed !== undefined) q.set('isClosed', String(opts.isClosed));
  if (opts?.isFulfilled !== undefined) q.set('isFulfilled', String(opts.isFulfilled));
  if (opts?.limit !== undefined) q.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) q.set('offset', String(opts.offset));
  if (opts?.reverse !== undefined) q.set('reverse', String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : '';

  const rows = await fetchApiJSON<AddressOrderRow[]>(
    `/assets/orders/${address}/${assetId}/${otherAssetId}${qs}`
  );
  const divisible = opts?.divisible ?? true;
  return rows.map((r) => mapAddressOrderRowToUi(r, assetId, otherAssetId, divisible));
}

/** Map one AddressOrderRow → UiMyOrder for a given pair (assetId vs otherAssetId). */
export function mapAddressOrderRowToUi(
  row: AddressOrderRow,
  assetId: number,
  otherAssetId: number, 
  divisible: boolean
): UiMyOrder {
  const side: Side = row.haveAssetId === QORT_ID ? 'buy' : 'sell';

  const amt = toNum(row.amount);
  const filled = toNum(row.fulfilled);
  const price = toNum(row.price);

  // Open amount still in amountAssetId units
  const openAmtInAmountAsset = Math.max(0, amt - filled);

  // Convert open amount into the pair's non-zero asset units
  let qtyAssetOpen: number;
  if (row.amountAssetId === assetId) {
    qtyAssetOpen = openAmtInAmountAsset;
  } else if (row.amountAssetId === otherAssetId) {
    qtyAssetOpen = openAmtInAmountAsset;
  } else {
    qtyAssetOpen = 0; // not our pair
  }

  const priceQortPerAsset = quant(price, 8);
  const qtyClamped = divisible ? quant(qtyAssetOpen, 8) : Math.floor(qtyAssetOpen);

  const tsRaw = toNum(row.timestamp);
  const ts = tsRaw < 2e10 ? tsRaw * 1000 : tsRaw;

  return {
    orderId: row.orderId,
    side,
    priceQortPerAsset,
    qtyAssetTotal: amt,
    qtyAssetOpen: qtyClamped,
    ts,
    raw: row,
  };
}

/* =========================
    Orderbook aggregates
   ========================= */

export async function getAggregatedOrderbook(
  assetId: number,
  otherAssetId: number,
  opts?: { limit?: number; offset?: number; reverse?: boolean }
): Promise<AggregatedOrderbookRow[]> {
  const q = new URLSearchParams();
  if (opts?.limit !== undefined) q.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) q.set('offset', String(opts.offset));
  if (opts?.reverse !== undefined) q.set('reverse', String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : '';
  return fetchApiJSON<AggregatedOrderbookRow[]>(
    `/assets/orderbook/${assetId}/${otherAssetId}${qs}`
  );
}

/* =========================
    Trades
   ========================= */

export async function getTrades(
  assetId: number,
  otherAssetId: number,
  opts?: { limit?: number; offset?: number; reverse?: boolean }
): Promise<any[]> {
  const q = new URLSearchParams();
  if (opts?.limit !== undefined) q.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) q.set('offset', String(opts.offset));
  if (opts?.reverse !== undefined) q.set('reverse', String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : '';
  const data = await fetchApiJSON<any>(`/assets/trades/${assetId}/${otherAssetId}${qs}`);
  return Array.isArray(data) ? data : (Array.isArray((data as any)?.trades) ? (data as any).trades : []);
}

// Fetch newest-first pages until we reach windowStart or a safety cap.
export async function fetchTradesPaged(a: number, b: number, windowStartMs: number) {
  const PAGE = 500;
  const MAX_ROWS = 10000;
  const MAX_PAGES = Math.ceil(MAX_ROWS / PAGE);

  const all: any[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const batch = await getTrades(a, b, {
      limit: PAGE,
      offset: page * PAGE,
      reverse: true, // newest first
    });

    if (!Array.isArray(batch) || batch.length === 0) break;

    all.push(...batch);

    const last = batch[batch.length - 1];
    const lastTsMs = Number(last?.trade?.timestamp ?? last?.timestamp ?? 0);
    if (lastTsMs && lastTsMs < windowStartMs) break;

    if (batch.length < PAGE) break;
  }
  return all;
}

// Helper: get timestamp (ms) from trade envelope
function tradeTs(row: any): number {
  const t = row?.trade;
  const raw = Number(t?.timestamp ?? row?.timestamp ?? 0);
  return raw && raw < 2e10 ? raw : raw; // your node already ms; keep simple
}

// Helper: stable de-dupe key across both directions
function tradeKey(row: any): string {
  const t = row?.trade ?? {};
  const ts = tradeTs(row);
  const io = t.initiatingOrderId ?? row?.initiatingOrder?.orderId ?? '';
  const to = t.targetOrderId ?? row?.targetOrder?.orderId ?? '';
  // include amounts to be extra safe across nodes
  const ia = t.initiatorAmount ?? '';
  const ta = t.targetAmount ?? '';
  return `${io}|${to}|${ts}|${ia}|${ta}`;
}

// Page one direction newest->older until untilMs or caps
async function fetchTradesOneDirection(
  a: number,
  b: number,
  untilMs: number,
  pageSize: number,
  hardCap: number
): Promise<any[]> {
  const pages = Math.ceil(hardCap / pageSize);
  const out: any[] = [];

  for (let page = 0; page < pages; page++) {
    const batch = await getTrades(a, b, {
      limit: pageSize,
      offset: page * pageSize,
      reverse: true, // newest first
    });

    if (!Array.isArray(batch) || batch.length === 0) break;

    out.push(...batch);

    const last = batch[batch.length - 1];
    const lastTs = tradeTs(last);
    if (lastTs && untilMs && lastTs < untilMs) break;
    if (out.length >= hardCap) break;
    if (batch.length < pageSize) break;
  }
  return out;
}

/**
 * Pull /assets/trades/0/{assetId} AND /assets/trades/{assetId}/0,
 * merge, de-dupe, and return newest-first.
 */
export async function fetchQortToAssetTrades(
  assetId: number,
  untilMs: number,
  pageSize = 500,
  hardCap = 20000
) {
  const [qortToAsset, assetToQort] = await Promise.all([
    fetchTradesOneDirection(0, assetId, untilMs, pageSize, hardCap),
    fetchTradesOneDirection(assetId, 0, untilMs, pageSize, hardCap),
  ]);

  // Merge + de-dupe
  const seen = new Map<string, any>();
  for (const row of qortToAsset) seen.set(tradeKey(row), row);
  for (const row of assetToQort) seen.set(tradeKey(row), row);

  const merged = Array.from(seen.values());

  // Newest-first
  merged.sort((a, b) => tradeTs(b) - tradeTs(a));

  // Enforce overall cap (optional)
  if (merged.length > hardCap) merged.length = hardCap;

  return merged;
}


export async function getRecentTrades(
  assetIds?: number[],
  otherAssetIds?: number[],
  opts?: { limit?: number; offset?: number; reverse?: boolean }
): Promise<any[]> {
  const q = new URLSearchParams();
  if (assetIds?.length) assetIds.forEach((a) => { q.append('assetId', String(a)); q.append('assetid', String(a)); });
  if (otherAssetIds?.length) otherAssetIds.forEach((a) => { q.append('otherAssetId', String(a)); q.append('otherassetid', String(a)); });
  if (opts?.limit !== undefined) q.set('limit', String(opts.limit));
  if (opts?.offset !== undefined) q.set('offset', String(opts.offset));
  if (opts?.reverse !== undefined) q.set('reverse', String(opts.reverse));
  const qs = q.toString() ? `?${q.toString()}` : '';

  const res = await fetch(`/assets/trades/recent${qs}`);
  if (!res.ok) throw new Error(`recent trades failed: ${res.status} ${res.statusText}`);
  const data = await res.json();
  return Array.isArray(data) ? data : (Array.isArray((data as any)?.trades) ? (data as any).trades : []);
}

/* =========================
    Trade row decoders
   ========================= */

/** Decode a row from /assets/trades/<assetId>/<otherAssetId> envelope. */
// export function decodePairTradeEnvelope(
//   row: any,
//   pairAssetId: number
// ): { assetAmt: number; qortAmt: number; price: number; ts: number } | null {
//   const t = row?.trade;
//   if (!t) return null;

//   const iaId = Number(t.initiatorAmountAssetId);
//   const taId = Number(t.targetAmountAssetId);
//   const ia   = toNum(t.initiatorAmount);
//   const ta = toNum(t.targetAmount);

//   let assetAmt = 0;
//   let qortAmt  = 0;

//   if (taId === pairAssetId) {      // initiator=QORT -> BUY asset
//     qortAmt = ia; assetAmt = ta;
//   } else if (iaId === pairAssetId) { // initiator=ASSET -> SELL
//     assetAmt = ia; qortAmt = ta;
//   } else {
//     assetAmt = ta > 0 ? ta : ia;
//   }

//   const o1p = toNum(row?.initiatingOrder?.price);
//   const o2p = toNum(row?.targetOrder?.price);
//   const price = o2p > 0 ? o2p : (o1p > 0 ? o1p : (assetAmt > 0 ? qortAmt / assetAmt : 0));

//   const ts = toNum(t.timestamp);

//   if (!(assetAmt > 0) || !(qortAmt > 0) || !(price > 0) || !(ts > 0)) return null;
//   return { assetAmt, qortAmt, price, ts };
// }

/** Decode a row from /assets/trades/<assetId>/<otherAssetId> envelope. */
export function decodePairTradeEnvelope(
  row: any,
  pairAssetId: number
): { assetAmt: number; qortAmt: number; price: number; ts: number } | null {
  const t = row?.trade;
  if (!t) return null;

  const tsRaw = toNum(t.timestamp);
  const ts    = tsRaw > 0 && tsRaw < 2e10 ? tsRaw * 1000 : tsRaw;
  if (!(ts > 0)) return null;

  const iOrd = row?.initiatingOrder ?? {};
  const tOrd = row?.targetOrder ?? {};

  // 1) Maker is the older order (resting on book)
  const ti = toNum(iOrd.timestamp);
  const tt = toNum(tOrd.timestamp);
  const maker = (tt && ti) ? (tt <= ti ? tOrd : iOrd) : (tOrd || iOrd);
  const makerPrice = toNum(maker?.price);

  // 2) Prefer the order that expresses amount in *pair asset* units
  const iAmt = toNum(iOrd.amount);
  const tAmt = toNum(tOrd.amount);

  const iAmtIsPair = Number(iOrd.amountAssetId) === pairAssetId;
  const tAmtIsPair = Number(tOrd.amountAssetId) === pairAssetId;

  // Prefer the one that’s marked fulfilled (common for the smaller/resting side when it completes)
  let assetAmt = 0;
  if (iAmtIsPair && iOrd.isFulfilled === true) assetAmt = iAmt;
  else if (tAmtIsPair && tOrd.isFulfilled === true) assetAmt = tAmt;

  // If neither is flagged fulfilled here, pick the pair-denominated one, and if both are, take the smaller
  if (!(assetAmt > 0)) {
    const candidates: number[] = [];
    if (iAmtIsPair && iAmt > 0) candidates.push(iAmt);
    if (tAmtIsPair && tAmt > 0) candidates.push(tAmt);
    if (candidates.length) assetAmt = Math.min(...candidates);
  }

  // As an absolute last resort, fall back to trade fields *only* if they match the pair asset id
  if (!(assetAmt > 0)) {
    const iaId = Number(iOrd.haveAssetId);
    const taId = Number(tOrd.haveAssetId);
    const ia   = toNum(t.initiatorAmount);
    const ta   = toNum(t.targetAmount);
    if (iaId === pairAssetId) assetAmt = ia;
    else if (taId === pairAssetId) assetAmt = ta;
  }

  // 3) Price = maker price (maker-price execution)
  const price = makerPrice > 0 ? makerPrice : 0;

  // 4) QORT notional from price
  const qortAmt = (assetAmt > 0 && price > 0) ? (assetAmt * price) : 0;

  if (!(assetAmt > 0) || !(qortAmt > 0) || !(price > 0)) return null;
  return { assetAmt, qortAmt, price, ts };
}



/** Recent trades row (flat). */
export function decodeTradeRowRecent(row: any, pairAssetId: number) {
  const rowAssetId  = Number(row?.assetId);
  const rowOtherId  = Number(row?.otherAssetId);
  const amount      = toNum(row?.amount);       // here: QORT 
  const otherAmount = toNum(row?.otherAmount);  // here: ASSET

  let assetAmt = 0, qortAmt = 0;

  if (rowAssetId === 0 && rowOtherId === pairAssetId) {
    qortAmt = amount; assetAmt = otherAmount;
  } else if (rowAssetId === pairAssetId && rowOtherId === 0) {
    assetAmt = amount; qortAmt = otherAmount;
  } else {
    assetAmt = otherAmount > 0 ? otherAmount : amount;
    qortAmt  = otherAmount > 0 ? amount : otherAmount;
  }

  const price = assetAmt > 0 ? qortAmt / assetAmt : 0;   // QORT / ASSET
  const tsRaw = toNum(row?.timestamp ?? row?.ts ?? 0);
  const ts    = tsRaw < 2e10 ? tsRaw * 1000 : tsRaw;

  return { assetAmt, qortAmt, price, ts };
}

/** Build fills directly from pair trades by matching your identity. */
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

function sideForMe(row: any, address: string, publicKey?: string | null): 'buy' | 'sell' {
  const init = row?.initiatingOrder;
  const targ = row?.targetOrder;
  const mine =
    (init?.creator === address || init?.creatorPublicKey === publicKey) ? init :
    (targ?.creator === address || targ?.creatorPublicKey === publicKey) ? targ : null;
  return (mine?.haveAssetId === 0) ? 'buy' : 'sell';
}

// export function envelopesToFills(
//   envelopes: any[],
//   address: string,
//   publicKey: string | undefined,
//   pairAssetId: number
// ): FillEvent[] {
//   return (Array.isArray(envelopes) ? envelopes : [])
//     .filter((row) => rowHasMe(row, address, publicKey))
//     .map((row) => {
//       const base = decodePairTradeEnvelope(row, pairAssetId);
//       const side = sideForMe(row, address, publicKey);
//       return {
//         orderId: String(row?.initiatingOrder?.orderId ?? row?.targetOrder?.orderId ?? ''),
//         side,
//         qtyAsset: base?.assetAmt ?? 0,
//         qort: base?.qortAmt ?? 0,
//         price: base?.price ?? 0,
//         ts: base?.ts ?? 0,
//       } as FillEvent;
//     })
//     .filter((f) => f.qtyAsset > 0 && f.qort > 0 && f.price > 0 && f.ts > 0)
//     .sort((a, b) => b.ts - a.ts);
// }

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
        qtyAsset: base?.assetAmt ?? 0,   // non-QORT amount
        qort: base?.qortAmt ?? 0,        // QORT amount
        price: base?.price ?? 0,         // QORT / asset
        ts: base?.ts ?? 0,
      } as FillEvent;
    })
    .filter((f) => f.qtyAsset > 0 && f.qort > 0 && f.price > 0 && f.ts > 0)
    .sort((a, b) => b.ts - a.ts);
}


/** Decode a single row from /assets/order/{orderId}/trades (flat or envelope). */
export function rowToFill(r: any, side: 'buy' | 'sell', pairAssetId: number): FillEvent {
  if (r?.trade) {
    const t = decodePairTradeEnvelope(r, pairAssetId);
    return {
      orderId: String(r?.initiatingOrder?.orderId ?? r?.targetOrder?.orderId ?? ''),
      side,
      qtyAsset: t?.assetAmt ?? 0,
      qort: t?.qortAmt ?? 0,
      price: t?.price ?? 0,
      ts: t?.ts ?? 0,
    };
  }

  const amountAssetId = Number(r?.amountAssetId);
  const amount        = toNum(r?.amount);
  const otherAmount   = toNum(r?.otherAmount);

  let assetAmt = 0, qortAmt = 0;
  if (Number.isFinite(amountAssetId)) {
    if (amountAssetId === 0) { qortAmt = amount; assetAmt = otherAmount; }
    else if (amountAssetId === pairAssetId) { assetAmt = amount; qortAmt = otherAmount; }
    else { assetAmt = otherAmount > 0 ? otherAmount : amount; qortAmt = otherAmount > 0 ? amount : otherAmount; }
  } else {
    const aId = Number(r?.assetId), oId = Number(r?.otherAssetId);
    if (aId === 0 && oId === pairAssetId) { qortAmt = amount; assetAmt = otherAmount; }
    else { assetAmt = otherAmount > 0 ? otherAmount : amount; qortAmt = otherAmount > 0 ? amount : otherAmount; }
  }

  const price = (toNum(r?.price) > 0) ? toNum(r?.price) : (assetAmt > 0 ? qortAmt / assetAmt : 0);
  const tsRaw = toNum(r?.timestamp ?? r?.ts ?? 0);
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

/* =========================
    My fills (pair)
   ========================= */

export async function getMyFillsForPair(
  address: string,
  pairAssetId: number,
  opts?: {
    limitOrders?: number;
    concurrency?: number;
  }
): Promise<FillEvent[]> {
  const limit = opts?.limitOrders ?? 60;

  // Pull user's orders for this pair (open/closed/fulfilled)
  const [open, closed, fulfilled] = await Promise.all([
    getAddressOrdersByPair(address, pairAssetId, 0, { isClosed: false, isFulfilled: false, limit, reverse: true }),
    getAddressOrdersByPair(address, pairAssetId, 0, { isClosed: true, limit, reverse: true }),
    getAddressOrdersByPair(address, pairAssetId, 0, { isFulfilled: true, limit, reverse: true }),
  ]);

  // Dedupe by orderId
  const seen = new Set<string>();
  const mine = ([] as UiMyOrder[])
    .concat(open ?? [], closed ?? [], fulfilled ?? [])
    .filter((o) => {
      if (seen.has(o.orderId)) return false;
      seen.add(o.orderId);
      return true;
    });

  if (!mine.length) {
    // Fallback: scan pair trades and filter by address
    const envs = await getTrades(0, pairAssetId, { limit: 60, reverse: true });
    return (Array.isArray(envs) ? envs : [])
      .filter((row: any) => {
        const iC = row?.initiatingOrder?.creator;
        const tC = row?.targetOrder?.creator;
        return iC === address || tC === address;
      })
      .map((row: any) => {
        const base = decodePairTradeEnvelope(row, pairAssetId);
        const side = sideForMe(row, address, undefined);
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

  // For each order, fetch its trades and map using the order's side
  const conc = Math.max(1, Math.min(opts?.concurrency ?? 4, 8));
  const out: FillEvent[] = [];
  let i = 0;

  while (i < mine.length) {
    const batch = mine.slice(i, i + conc);
    i += conc;

    const group = await Promise.all(
      batch.map(async (o) => {
        try {
          const rows = await fetchOrderTrades(o.orderId, { limit: 100, reverse: true });
          const side: Side = o.side;
          return Array.isArray(rows) ? rows.map((r) => rowToFill(r, side, pairAssetId)) : [];
        } catch {
          return [];
        }
      })
    );

    out.push(...group.flat());
  }

  return out
    .filter((f) => f && f.qtyAsset > 0 && f.qort > 0 && f.price > 0 && f.ts > 0)
    .sort((a, b) => b.ts - a.ts);
}

/* =========================
    Chart trades
   ========================= */

export function envelopesToChartTrades(envelopes: any[], pairAssetId: number): ChartTrade[] {
  const rows = Array.isArray(envelopes) ? envelopes : [];
  const out: ChartTrade[] = [];

  for (const row of rows) {
    const t = row?.trade;
    if (!t) continue;

    const iaId = Number(t.initiatorAmountAssetId);
    const taId = Number(t.targetAmountAssetId);
    const ia   = toNum(t.initiatorAmount);
    const ta   = toNum(t.targetAmount);

    let assetAmt = 0, qortAmt = 0, side: 'buy' | 'sell' = 'buy';
    if (iaId === 0 && taId === pairAssetId) { qortAmt = ia; assetAmt = ta; side = 'buy'; }
    else if (taId === 0 && iaId === pairAssetId) { assetAmt = ia; qortAmt = ta; side = 'sell'; }
    else {
      assetAmt = ta > 0 ? ta : ia;
      qortAmt  = ta > 0 ? ia : ta;
      side     = qortAmt === ia ? 'buy' : 'sell';
    }

    const p1 = toNum(row?.initiatingOrder?.price);
    const p2 = toNum(row?.targetOrder?.price);
    const price = p1 > 0 ? p1 : (p2 > 0 ? p2 : (assetAmt > 0 ? qortAmt / assetAmt : 0));
    const tsRaw = toNum(t.timestamp);
    const ts = tsRaw > 0 && tsRaw < 2e10 ? tsRaw * 1000 : tsRaw;

    if (assetAmt > 0 && price > 0 && ts > 0) out.push({ price, quantity: assetAmt, side, ts });
  }

  out.sort((a, b) => a.ts - b.ts);
  return out;
}
