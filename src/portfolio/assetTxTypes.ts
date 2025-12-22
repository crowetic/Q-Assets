export type Direction = 'IN' | 'OUT';

const TX_TYPES_SEARCH = [
  'GENESIS',
  'PAYMENT',
  'REGISTER_NAME',
  'UPDATE_NAME',
  'SELL_NAME',
  'CANCEL_SELL_NAME',
  'BUY_NAME',
  'CREATE_POLL',
  'VOTE_ON_POLL',
  'ARBITRARY',
  'MESSAGE',
  'ISSUE_ASSET',
  'TRANSFER_ASSET',
  'CREATE_ASSET_ORDER',
  'CANCEL_ASSET_ORDER',
  'MULTI_PAYMENT',
  'DEPLOY_AT',
  'PUBLICIZE',
  'AIRDROP',
  'AT',
  'CREATE_GROUP',
  'UPDATE_GROUP',
  'ADD_GROUP_ADMIN',
  'REMOVE_GROUP_ADMIN',
  'GROUP_BAN',
  'GROUP_KICK',
  'CANCEL_GROUP_BAN',
  'GROUP_INVITE',
  'CANCEL_GROUP_INVITE',
  'JOIN_GROUP',
  'LEAVE_GROUP',
  'GROUP_APPROVAL',
  'SET_GROUP',
  'UPDATE_ASSET',
  'ACCOUNT_FLAGS',
  'REWARD_SHARE',
  'TRANSFER_PRIVS',
] as const;

// ---------- discriminated union for details (dialog) ----------
export type TxType = (typeof TX_TYPES_SEARCH)[number] | 'UNKNOWN';

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
  blockHeight?: number;
}

interface TxBaseDetail {
  txId: string;
  type: TxType;
  timestamp: number; // ms epoch
  confirmations?: number;
  height?: number;
  feeQort?: number;
  sender?: string;
  recipient?: string;
  raw?: any; // always include raw for "view JSON" and future-proofing
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

export interface MessageDetail extends TxBaseDetail {
  type: 'MESSAGE';
  recipient?: string;
  amountQort?: number;
  isText?: boolean;
  isEncrypted?: boolean;
}

export interface AtDetail extends TxBaseDetail {
  type: 'AT';
  atAddress?: string;
  amountQort?: number;
}

// Assets
export interface TransferAssetDetail extends TxBaseDetail {
  type: 'TRANSFER_ASSET';
  assetId: number;
  amountAsset: number; // human units
  assetName?: string;
  senderPublicKey?: string;
  recipientPublicKey?: string;
}

export interface IssueAssetDetail extends TxBaseDetail {
  type: 'ISSUE_ASSET';
  assetId: number;
  name: string;
  quantity: number; // human units
  isDivisible: boolean;
  description?: string;
  issuerPublicKey?: string;
  data?: string;
  isUnspendable?: boolean;
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
  price?: number;
  haveAssetName?: string;
  wantAssetName?: string;
  pricePair?: string;
  amountAssetId?: number;
  amountAssetName?: string;
  creatorPublicKey?: string;
}

export interface CancelAssetOrderDetail extends TxBaseDetail {
  type: 'CANCEL_ASSET_ORDER';
  orderId?: string;
  creatorPublicKey?: string;
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

type KnownDetailType =
  | PaymentDetail['type']
  | MultiPaymentDetail['type']
  | ArbitraryDetail['type']
  | MessageDetail['type']
  | AtDetail['type']
  | TransferAssetDetail['type']
  | IssueAssetDetail['type']
  | UpdateAssetDetail['type']
  | CreateAssetOrderDetail['type']
  | CancelAssetOrderDetail['type']
  | JoinGroupDetail['type']
  | LeaveGroupDetail['type']
  | CreateGroupDetail['type']
  | UnknownDetail['type'];

type OtherTxType = Exclude<TxType, KnownDetailType>;

interface OtherTxDetail extends TxBaseDetail {
  type: OtherTxType;
}

export type AssetTxDetail =
  | PaymentDetail
  | MultiPaymentDetail
  | ArbitraryDetail
  | MessageDetail
  | AtDetail
  | TransferAssetDetail
  | IssueAssetDetail
  | UpdateAssetDetail
  | CreateAssetOrderDetail
  | CancelAssetOrderDetail
  | JoinGroupDetail
  | LeaveGroupDetail
  | CreateGroupDetail
  | UnknownDetail
  | OtherTxDetail;

export interface AssetTx {
  txId: string; // signature / unique id
  timestamp: number; // ms epoch
  assetId: number;
  amount: number; // human units (e.g., 12.34 QORT)
  sender: string;
  recipient: string;
  blockHeight: number;
  type: string; // PAYMENT, MULTI_PAYMENT, TRANSFER_ASSET, etc.
  confirmations?: number;
}

export interface FetchAssetTxParams {
  address: string; // the wallet we're viewing (auth user)
  assetId: number; // 0 for QORT, >0 for assets
  limit?: number;
  offset?: number;
}

export interface FetchAssetTxResult {
  items: AssetTxSummary[];
  detailsById: Record<string, AssetTxDetail>;
  total?: number;
  consumed: number;
  exhausted: boolean;
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

const extractAssetIds = (tx: any): number[] => {
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
  return Array.from(new Set(ids));
};

const primaryAssetId = (tx: any): number | undefined => {
  const ids = extractAssetIds(tx);
  return ids.length > 0 ? ids[0] : undefined;
};

const hasAssetMention = (tx: any, aid: number) => extractAssetIds(tx).includes(aid);

interface AssetDetailCommon {
  txId: string;
  timestamp: number;
  sender: string;
  recipient: string;
  feeQort?: number;
  height?: number;
  confirmations?: number;
  raw: any;
}

const buildAssetSpecificDetail = (
  type: TxType,
  tx: any,
  common: AssetDetailCommon,
  assetIdOverride?: number
): AssetTxDetail | null => {
  const assetIdValue =
    assetIdOverride ?? nnum(get(tx, 'assetId')) ?? nnum(get(tx, 'targetAssetId'));
  const shared = {
    txId: common.txId,
    timestamp: common.timestamp,
    sender: common.sender,
    recipient: common.recipient,
    feeQort: common.feeQort,
    height: common.height,
    confirmations: common.confirmations,
    raw: common.raw,
  };

  switch (type) {
    case 'TRANSFER_ASSET': {
      const amountAsset = human(nnum(get(tx, 'amount')));
      const assetId = assetIdValue ?? 0;
      return {
        type: 'TRANSFER_ASSET',
        ...shared,
        assetId,
        amountAsset,
        assetName: get(tx, 'assetName') ?? get(tx, 'name'),
        senderPublicKey: String(get(tx, 'senderPublicKey') ?? get(tx, 'senderKey') ?? ''),
        recipientPublicKey: String(get(tx, 'recipientPublicKey') ?? get(tx, 'recipientKey') ?? ''),
      } as TransferAssetDetail;
    }
    case 'ISSUE_ASSET': {
      const assetId = assetIdValue ?? nnum(get(tx, 'assetId')) ?? 0;
      return {
        type: 'ISSUE_ASSET',
        ...shared,
        assetId,
        name: String(get(tx, 'assetName', 'name') ?? ''),
        quantity: human(nnum(get(tx, 'quantity', 'amount'))),
        isDivisible: Boolean(get(tx, 'isDivisible', 'divisible')),
        description: String(get(tx, 'description') ?? '') || undefined,
        issuerPublicKey:
          String(get(tx, 'issuerPublicKey') ?? get(tx, 'creatorPublicKey') ?? '') || undefined,
        data: String(get(tx, 'data') ?? '') || undefined,
        isUnspendable: Boolean(get(tx, 'isUnspendable')),
      } as IssueAssetDetail;
    }
    case 'UPDATE_ASSET': {
      const assetId = assetIdValue ?? nnum(get(tx, 'assetId')) ?? 0;
      return {
        type: 'UPDATE_ASSET',
        ...shared,
        assetId,
        name: String(get(tx, 'assetName', 'name') ?? ''),
        isDivisible: get(tx, 'isDivisible', 'divisible') as boolean | undefined,
      } as UpdateAssetDetail;
    }
    case 'CREATE_ASSET_ORDER': {
      const haveAssetId =
        nnum(get(tx, 'haveAssetId')) ?? nnum(get(tx, 'initiatingOrder')?.haveAssetId) ?? 0;
      const wantAssetId =
        nnum(get(tx, 'wantAssetId')) ?? nnum(get(tx, 'initiatingOrder')?.wantAssetId) ?? 0;
      const amountHave = human(nnum(get(tx, 'amount')) ?? nnum(get(tx, 'initiatingOrder')?.amount));
      const amountAssetId = nnum(get(tx, 'amountAssetId'));
      return {
        type: 'CREATE_ASSET_ORDER',
        ...shared,
        haveAssetId,
        wantAssetId,
        amountHave,
        price: human(nnum(get(tx, 'price')) ?? nnum(get(tx, 'initiatingOrder')?.price)),
        haveAssetName: String(get(tx, 'haveAssetName') ?? get(tx, 'haveName') ?? ''),
        wantAssetName: String(get(tx, 'wantAssetName') ?? get(tx, 'wantName') ?? ''),
        pricePair: String(get(tx, 'pricePair') ?? get(tx, 'assetPair') ?? ''),
        amountAssetId,
        amountAssetName: String(get(tx, 'amountAssetName') ?? ''),
        creatorPublicKey:
          String(get(tx, 'creatorPublicKey') ?? get(tx, 'issuerPublicKey') ?? '') || undefined,
      } as CreateAssetOrderDetail;
    }
    case 'CANCEL_ASSET_ORDER': {
      return {
        type: 'CANCEL_ASSET_ORDER',
        ...shared,
        orderId: String(get(tx, 'orderId') ?? ''),
        creatorPublicKey:
          String(get(tx, 'creatorPublicKey') ?? get(tx, 'issuerPublicKey') ?? '') || undefined,
      } as CancelAssetOrderDetail;
    }
    default:
      return null;
  }
};

export function normalizeTxType(raw: unknown): TxType {
  const t = String(raw ?? '').toUpperCase();
  if ((TX_TYPES_SEARCH as readonly string[]).includes(t)) return t as TxType;
  if (t === 'CHAT' || t === 'PRIVATE_MESSAGE') return 'MESSAGE';
  return 'UNKNOWN';
}

// best-effort field extraction across possible node variants
// function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
//   for (const k of keys) {
//     if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
//   }
//   return undefined;
// }

const searchTransactionsPage = async (params: {
  address: string;
  limit: number;
  offset: number;
}): Promise<any[]> => {
  const { address, limit, offset } = params;
  let raw: any[] = [];
  try {
    if (typeof qortalRequest === 'function') {
      raw = await qortalRequest({
        action: 'SEARCH_TRANSACTIONS',
        address,
        confirmationStatus: 'BOTH',
        limit,
        offset,
        reverse: true,
        txType: [...TX_TYPES_SEARCH],
      });
    }
  } catch (e) {
    console.log(e);
  }

  if (!Array.isArray(raw) || raw.length === 0) {
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
    raw = await res.json();
  }

  return Array.isArray(raw) ? raw : [];
};

export async function fetchAssetTransactions(
  params: FetchAssetTxParams
): Promise<FetchAssetTxResult> {
  const { address, assetId, limit = 20, offset = 0 } = params;

  const items: AssetTxSummary[] = [];
  const detailsById: Record<string, AssetTxDetail> = {};
  const pageSize = assetId === 0 ? limit : Math.max(limit * 2, 50);
  const maxPages = assetId === 0 ? 1 : 8;
  let consumedRaw = 0;
  let exhausted = false;

  const involvesMe = (tx: any) => {
    const s = String(get(tx, 'sender', 'creator', 'creatorAddress') ?? '');
    const r = String(get(tx, 'recipient', 'destination', 'address', 'receiver') ?? '');
    return s === address || r === address;
  };

  for (let pageIndex = 0; pageIndex < maxPages && items.length < limit; pageIndex++) {
    const pageOffset = offset + consumedRaw;
    const raw = await searchTransactionsPage({ address, limit: pageSize, offset: pageOffset });
    if (!raw.length) {
      exhausted = true;
      break;
    }

    let processedThisPage = 0;

    for (const tx of raw) {
      processedThisPage += 1;
      const rawType = String(get(tx, 'type', 'txType') ?? 'UNKNOWN');
      const type = normalizeTxType(rawType);
      const txId = String(get(tx, 'signature', 'txId', 'id') ?? '');
      if (!txId) continue;

      const ts = toMs(get(tx, 'timestamp'));
      const sender = String(get(tx, 'sender', 'creator', 'creatorAddress') ?? '');
      const recipient = String(get(tx, 'recipient', 'destination', 'address', 'receiver') ?? '');
      const height = nnum(get(tx, 'height', 'blockHeight'));
      const confirmations = nnum(get(tx, 'confirmations')) ?? height;
      const feeQort = human(nnum(get(tx, 'fee')));
      const amount = nnum(get(tx, 'amount'));
      const detailCommon: AssetDetailCommon = {
        txId,
        timestamp: ts,
        sender,
        recipient,
        feeQort,
        height,
        confirmations,
        raw: tx,
      };

      // QORT view: show everything that involves me
      if (assetId === 0) {
        if (!involvesMe(tx)) continue;
        const txAssetId = primaryAssetId(tx);
        let detail: AssetTxDetail | null = buildAssetSpecificDetail(
          type,
          tx,
          detailCommon,
          txAssetId
        );

        if (!detail) {
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
              const payments: Array<{ recipient?: string; amount?: number | string }> =
                Array.isArray(tx.payments) ? tx.payments : [];
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
            case 'MESSAGE': {
              detail = {
                type,
                txId,
                timestamp: ts,
                sender,
                recipient,
                amountQort: human(amount),
                isText: Boolean(get(tx, 'isText')),
                isEncrypted: Boolean(get(tx, 'isEncrypted')),
                feeQort,
                height,
                confirmations,
                raw: tx,
              } as MessageDetail;
              break;
            }
            case 'AT': {
              detail = {
                type,
                txId,
                timestamp: ts,
                sender,
                recipient,
                atAddress: String(get(tx, 'atAddress') ?? ''),
                amountQort: human(amount),
                feeQort,
                height,
                confirmations,
                raw: tx,
              } as AtDetail;
              break;
            }
            case 'UNKNOWN': {
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
              break;
            }
            default: {
              const fallbackType = type as OtherTxType;
              detail = {
                type: fallbackType,
                txId,
                timestamp: ts,
                sender,
                recipient,
                feeQort,
                height,
                confirmations,
                raw: tx,
              } as OtherTxDetail;
            }
          }
        }

        if (!detail) continue;

        const direction: Direction = recipient === address ? 'IN' : 'OUT';
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
          assetId: txAssetId ?? 0,
          amount: amountForSummary,
          sender,
          recipient,
          type,
          direction,
          confirmations,
          height,
          feeQort,
          blockHeight: height,
        });
        detailsById[txId] = detail;
      } else {
        if (!hasAssetMention(tx, assetId)) continue;

        let detail: AssetTxDetail | null = buildAssetSpecificDetail(
          type,
          tx,
          detailCommon,
          assetId
        );
        if (!detail) {
          if (type === 'UNKNOWN') {
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
          } else {
            const fallbackType = type as OtherTxType;
            detail = {
              type: fallbackType,
              txId,
              timestamp: ts,
              sender,
              recipient,
              feeQort,
              height,
              confirmations,
              raw: tx,
            } as OtherTxDetail;
          }
        }

        if (!detail) continue;

        if (!involvesMe(tx) && type === 'TRANSFER_ASSET') continue;

        const direction: Direction = recipient === address ? 'IN' : 'OUT';
        const amountForSummary =
          detail.type === 'TRANSFER_ASSET' ? (detail as TransferAssetDetail).amountAsset : 0;

        items.push({
          txId,
          timestamp: ts,
          assetId,
          amount: amountForSummary,
          sender,
          recipient,
          type,
          direction,
          confirmations,
          height,
          feeQort,
          blockHeight: height,
        });
        detailsById[txId] = detail;
      }

      if (items.length >= limit) break;
    }

    consumedRaw += processedThisPage;

    if (items.length >= limit) break;
    if (processedThisPage < raw.length) break;
    if (raw.length < pageSize) {
      exhausted = true;
      break;
    }
  }

  return { items, detailsById, consumed: consumedRaw, exhausted };
}
