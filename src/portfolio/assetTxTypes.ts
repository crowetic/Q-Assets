export type Direction = 'IN' | 'OUT';

export interface AssetTxSummary {
  txId: string; // signature / id
  timestamp: number; // ms epoch
  assetId: number; // 0 for QORT
  amount: number; // human units (QORT or asset), aggregated for multi
  sender: string;
  recipient: string;
  type: TxType;
  direction: Direction; // derived wrt "address" param
  confirmations?: number;
  height?: number;
  feeQort?: number; // total fee in QORT (optional)
}

// ---------- discriminated union for details (dialog) ----------
export type TxType =
  | 'PAYMENT'
  | 'MULTI_PAYMENT'
  | 'ARBITRARY'
  | 'TRANSFER_ASSET'
  | 'ISSUE_ASSET'
  | 'UPDATE_ASSET'
  | 'CREATE_ASSET_ORDER'
  | 'CANCEL_ASSET_ORDER'
  | 'JOIN_GROUP'
  | 'LEAVE_GROUP'
  | 'CREATE_GROUP'
  | 'MESSAGE' // if you surface messages
  | 'UNKNOWN';

interface TxBaseDetail {
  txId: string;
  type: TxType;
  timestamp: number; // ms epoch
  confirmations?: number;
  height?: number;
  feeQort?: number;
  sender?: string;
  recipient?: string;
  raw?: any; // always include raw for “view JSON” and future-proofing
}

// QORT coin
export interface PaymentDetail extends TxBaseDetail {
  type: 'PAYMENT';
  amountQort: number;
}

export interface MultiPaymentDetail extends TxBaseDetail {
  type: 'MULTI_PAYMENT';
  payments: Array<{ recipient: string; amountQort: number }>;
  totalQort: number; // sum of payments
}

// QDN / arbitrary data (minimal first; add fields you care about)
export interface ArbitraryDetail extends TxBaseDetail {
  type: 'ARBITRARY';
  service?: string;
  name?: string;
  path?: string;
  dataSize?: number;
}

// Assets
export interface TransferAssetDetail extends TxBaseDetail {
  type: 'TRANSFER_ASSET';
  assetId: number;
  amountAsset: number; // human units
}

export interface IssueAssetDetail extends TxBaseDetail {
  type: 'ISSUE_ASSET';
  assetId: number;
  name: string;
  quantity: number; // human units
  isDivisible: boolean;
}

export interface UpdateAssetDetail extends TxBaseDetail {
  type: 'UPDATE_ASSET';
  assetId: number;
  name?: string;
  isDivisible?: boolean;
}

export interface CreateAssetOrderDetail extends TxBaseDetail {
  type: 'CREATE_ASSET_ORDER';
  haveAssetId: number;
  wantAssetId: number;
  amountHave: number; // human units of haveAssetId
  priceQortPerAsset?: number; // if pair involves QORT you can precompute it
}

export interface CancelAssetOrderDetail extends TxBaseDetail {
  type: 'CANCEL_ASSET_ORDER';
  orderId?: string;
}

// Groups (you can expand later)
export interface JoinGroupDetail extends TxBaseDetail {
  type: 'JOIN_GROUP';
  groupId?: number;
}
export interface LeaveGroupDetail extends TxBaseDetail {
  type: 'LEAVE_GROUP';
  groupId?: number;
}
export interface CreateGroupDetail extends TxBaseDetail {
  type: 'CREATE_GROUP';
  groupId?: number;
  name?: string;
}

// Fallback
export interface UnknownDetail extends TxBaseDetail {
  type: 'UNKNOWN';
}

export type AssetTxDetail =
  | PaymentDetail
  | MultiPaymentDetail
  | ArbitraryDetail
  | TransferAssetDetail
  | IssueAssetDetail
  | UpdateAssetDetail
  | CreateAssetOrderDetail
  | CancelAssetOrderDetail
  | JoinGroupDetail
  | LeaveGroupDetail
  | CreateGroupDetail
  | UnknownDetail;

export interface AssetTx {
  txId: string; // signature / unique id
  timestamp: number; // ms epoch
  assetId: number;
  amount: number; // human units (e.g., 12.34 QORT)
  sender: string;
  recipient: string;
  type: string; // PAYMENT, MULTI_PAYMENT, TRANSFER_ASSET, etc.
  confirmations?: number;
}

export interface FetchAssetTxParams {
  address: string; // the wallet we’re viewing (auth user)
  assetId: number; // 0 for QORT, >0 for assets
  limit?: number;
  offset?: number;
}

export interface FetchAssetTxResult {
  items: AssetTxSummary[];
  detailsById: Record<string, AssetTxDetail>;
  total?: number;
}

// ---------- helpers ----------

// const toNumberSafe = (v: any): number | null => {
//   if (typeof v === 'number' && Number.isFinite(v)) return v;
//   if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
//   return null;
// };

// heuristics: some nodes return atomic amounts; if you ever see integers with huge magnitudes for divisible assets,
// convert by 1e8. We keep it conservative: only convert if it looks *definitely* atomic.
// const normalizeHumanAmount = (n: number): number => {
//   // if absolute value is an integer with >=9 digits, assume atomics and scale down
//   if (Number.isInteger(n) && Math.abs(n) >= 1e9) return n / 1e8;
//   return n;
// };
const toMs = (t: any) => {
  const n = Number(t);
  if (!Number.isFinite(n)) return Date.now();
  return n < 1e12 ? n * 1000 : n;
};

const nnum = (v: any): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return Number.isFinite(n) ? n : undefined;
};

// If an integer looks atomic (>= 1e9), scale down to 1e-8
const human = (n: number | undefined): number => {
  if (!Number.isFinite(n)) return 0;
  const x = n as number;
  return Number.isInteger(x) && Math.abs(x) >= 1e9 ? x / 1e8 : x;
};

const get = (o: any, ...keys: string[]) => {
  for (const k of keys) if (o && o[k] != null) return o[k];
  return undefined;
};

export const CORE_TX_TYPES = [
  'PAYMENT',
  'MULTI_PAYMENT',
  'ARBITRARY',
  'TRANSFER_ASSET',
  'ISSUE_ASSET',
  'UPDATE_ASSET',
  'CREATE_ASSET_ORDER',
  'CANCEL_ASSET_ORDER',
  'JOIN_GROUP',
  'LEAVE_GROUP',
  'CREATE_GROUP',
] as const;

export type StrictTxType = (typeof CORE_TX_TYPES)[number] | 'UNKNOWN';

export function normalizeTxType(raw: unknown): StrictTxType {
  const t = String(raw ?? '').toUpperCase();
  if ((CORE_TX_TYPES as readonly string[]).includes(t)) return t as StrictTxType;
  if (t === 'MESSAGE' || t === 'CHAT' || t === 'PRIVATE_MESSAGE') return 'ARBITRARY';
  return 'UNKNOWN';
}

// best-effort field extraction across possible node variants
// function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
//   for (const k of keys) {
//     if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
//   }
//   return undefined;
// }

// ---------- main fetcher ----------

export async function fetchAssetTransactions(
  params: FetchAssetTxParams
): Promise<FetchAssetTxResult> {
  const { address, assetId, limit = 20, offset = 0 } = params;

  const url = new URL('/transactions/search', window.location.origin);
  url.searchParams.set('address', address);
  url.searchParams.set('confirmationStatus', 'BOTH');
  url.searchParams.set('limit', String(limit));
  url.searchParams.set('offset', String(offset));
  url.searchParams.set('reverse', 'true');

  const res = await fetch(url.toString(), { headers: { accept: 'application/json' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/transactions/search failed: ${res.status} ${res.statusText} ${text}`);
  }

  const raw: any[] = await res.json();
  const items: AssetTxSummary[] = [];
  const detailsById: Record<string, AssetTxDetail> = {};

  const involvesMe = (tx: any) => {
    const s = String(get(tx, 'sender', 'creator', 'creatorAddress') ?? '');
    const r = String(get(tx, 'recipient', 'destination', 'address', 'receiver') ?? '');
    return s === address || r === address;
  };

  const hasAssetMention = (tx: any, aid: number) => {
    const ids = [
      get(tx, 'assetId'),
      get(tx, 'haveAssetId'),
      get(tx, 'wantAssetId'),
      get(tx, 'amountAssetId'),
      get(tx, 'targetAssetId'),
      get(tx?.initiatingOrder ?? {}, 'haveAssetId'),
      get(tx?.initiatingOrder ?? {}, 'wantAssetId'),
    ]
      .map((v) => (v == null ? undefined : Number(v)))
      .filter((n) => Number.isFinite(n)) as number[];
    return ids.includes(aid);
  };

  for (const tx of raw) {
    const type = String(get(tx, 'type', 'txType') ?? 'UNKNOWN') as TxType;
    const txId = String(get(tx, 'signature', 'txId', 'id') ?? '');
    if (!txId) continue;

    const ts = toMs(get(tx, 'timestamp'));
    const sender = String(get(tx, 'sender', 'creator', 'creatorAddress') ?? '');
    const recipient = String(get(tx, 'recipient', 'destination', 'address', 'receiver') ?? '');
    const height = nnum(get(tx, 'height'));
    const confirmations = nnum(get(tx, 'confirmations')) ?? height;
    const feeQort = human(nnum(get(tx, 'fee')));

    // QORT view: show everything that involves me
    if (assetId === 0) {
      if (!involvesMe(tx)) continue;

      let detail: AssetTxDetail;

      switch (type) {
        case 'PAYMENT': {
          const amountQort = human(nnum(tx.amount));
          detail = {
            type,
            txId,
            timestamp: ts,
            sender,
            recipient,
            amountQort,
            feeQort,
            height,
            confirmations,
            raw: tx,
          };
          break;
        }
        case 'MULTI_PAYMENT': {
          const payments: Array<{ recipient?: string; amount?: number | string }> = Array.isArray(
            tx.payments
          )
            ? tx.payments
            : [];
          const parsed = payments.map((p) => ({
            recipient: String(p?.recipient ?? ''),
            amountQort: human(nnum(p?.amount)),
          }));
          const totalQort = parsed.reduce((s, p) => s + (p.amountQort || 0), 0);
          detail = {
            type,
            txId,
            timestamp: ts,
            sender,
            recipient,
            payments: parsed,
            totalQort,
            feeQort,
            height,
            confirmations,
            raw: tx,
          };
          break;
        }
        case 'ARBITRARY': {
          detail = {
            type,
            txId,
            timestamp: ts,
            sender,
            recipient,
            service: get(tx, 'service'),
            name: get(tx, 'name'),
            path: get(tx, 'path'),
            dataSize: nnum(get(tx, 'dataLength', 'dataSize')),
            feeQort,
            height,
            confirmations,
            raw: tx,
          };
          break;
        }
        default: {
          // surface other QORT-using types as UNKNOWN detail
          detail = {
            type: 'UNKNOWN',
            txId,
            timestamp: ts,
            sender,
            recipient,
            feeQort,
            height,
            confirmations,
            raw: tx,
          };
        }
      }

      const direction: Direction = sender === address ? 'OUT' : 'IN';
      const amountForSummary =
        detail.type === 'PAYMENT'
          ? (detail as PaymentDetail).amountQort
          : detail.type === 'MULTI_PAYMENT'
            ? sender === address
              ? (detail as MultiPaymentDetail).totalQort
              : (detail as MultiPaymentDetail).payments
                  .filter((p) => p.recipient === address)
                  .reduce((s, p) => s + (p.amountQort || 0), 0)
            : 0;

      items.push({
        txId,
        timestamp: ts,
        assetId: 0,
        amount: amountForSummary,
        sender,
        recipient,
        type: detail.type,
        direction,
        confirmations,
        height,
        feeQort,
      });
      detailsById[txId] = detail;
      continue;
    }

    // Asset view (aid > 0)
    if (!hasAssetMention(tx, assetId)) continue;

    let detail: AssetTxDetail | null = null;
    switch (type) {
      case 'TRANSFER_ASSET': {
        const amountAsset = human(nnum(tx.amount));
        detail = {
          type,
          txId,
          timestamp: ts,
          sender,
          recipient,
          assetId,
          amountAsset,
          feeQort,
          height,
          confirmations,
          raw: tx,
        } as TransferAssetDetail;
        break;
      }
      case 'ISSUE_ASSET': {
        detail = {
          type,
          txId,
          timestamp: ts,
          sender,
          recipient,
          assetId,
          name: String(get(tx, 'assetName', 'name') ?? ''),
          quantity: human(nnum(get(tx, 'quantity', 'amount'))),
          isDivisible: Boolean(get(tx, 'isDivisible', 'divisible')),
          feeQort,
          height,
          confirmations,
          raw: tx,
        } as IssueAssetDetail;
        break;
      }
      case 'UPDATE_ASSET': {
        detail = {
          type,
          txId,
          timestamp: ts,
          sender,
          recipient,
          assetId,
          name: String(get(tx, 'assetName', 'name') ?? ''),
          isDivisible: get(tx, 'isDivisible', 'divisible') as boolean | undefined,
          feeQort,
          height,
          confirmations,
          raw: tx,
        } as UpdateAssetDetail;
        break;
      }
      case 'CREATE_ASSET_ORDER': {
        const haveAssetId = Number(get(tx, 'haveAssetId', 'initiatingOrder')?.haveAssetId ?? NaN);
        const wantAssetId = Number(get(tx, 'wantAssetId', 'initiatingOrder')?.wantAssetId ?? NaN);
        const amountHave = human(nnum(get(tx, 'amount', 'initiatingOrder')?.amount));
        detail = {
          type,
          txId,
          timestamp: ts,
          sender,
          recipient,
          haveAssetId,
          wantAssetId,
          amountHave,
          feeQort,
          height,
          confirmations,
          raw: tx,
        } as CreateAssetOrderDetail;
        break;
      }
      case 'CANCEL_ASSET_ORDER': {
        detail = {
          type,
          txId,
          timestamp: ts,
          sender,
          recipient,
          orderId: String(get(tx, 'orderId') ?? ''),
          feeQort,
          height,
          confirmations,
          raw: tx,
        } as CancelAssetOrderDetail;
        break;
      }
      default: {
        detail = {
          type: 'UNKNOWN',
          txId,
          timestamp: ts,
          sender,
          recipient,
          feeQort,
          height,
          confirmations,
          raw: tx,
        };
      }
    }

    // only show asset txs that involve me directly (optional: keep if you want all)
    if (!involvesMe(tx) && type === 'TRANSFER_ASSET') continue;

    const direction: Direction = sender === address ? 'OUT' : 'IN';
    const amountForSummary =
      detail.type === 'TRANSFER_ASSET' ? (detail as TransferAssetDetail).amountAsset : 0;

    items.push({
      txId,
      timestamp: ts,
      assetId,
      amount: amountForSummary,
      sender,
      recipient,
      type: detail.type,
      direction,
      confirmations,
      height,
      feeQort,
    });
    detailsById[txId] = detail;
  }

  return { items, detailsById };
}
