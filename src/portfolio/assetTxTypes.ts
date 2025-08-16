
export type Direction = 'IN' | 'OUT';

export interface AssetTx {
  txId: string;           // signature / unique id
  timestamp: number;      // ms epoch
  assetId: number;
  amount: number;         // human units (e.g., 12.34 QORT)
  sender: string;
  recipient: string;
  type: string;           // PAYMENT, MULTI_PAYMENT, TRANSFER_ASSET, etc.
  confirmations?: number;
}

export interface FetchAssetTxParams {
  address: string;        // the wallet we’re viewing (auth user)
  assetId: number;        // 0 for QORT, >0 for assets
  limit?: number;
  offset?: number;
}

export interface FetchAssetTxResult {
  items: AssetTx[];
  total?: number;         // some nodes return totals; optional
}

// ---------- helpers ----------

const toNumberSafe = (v: any): number | null => {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
  return null;
};

// heuristics: some nodes return atomic amounts; if you ever see integers with huge magnitudes for divisible assets,
// convert by 1e8. We keep it conservative: only convert if it looks *definitely* atomic.
const normalizeHumanAmount = (n: number): number => {
  // if absolute value is an integer with >=9 digits, assume atomics and scale down
  if (Number.isInteger(n) && Math.abs(n) >= 1e9) return n / 1e8;
  return n;
};

// best-effort field extraction across possible node variants
function pick<T = any>(obj: any, ...keys: string[]): T | undefined {
  for (const k of keys) {
    if (obj && Object.prototype.hasOwnProperty.call(obj, k)) return obj[k];
  }
  return undefined;
}

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
  // NOTE: leaving txType unset so we get *all* types and can filter client-side by asset

  const res = await fetch(url.toString(), { headers: { accept: '*/*' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/transactions/search failed: ${res.status} ${res.statusText} ${text}`);
  }

  const raw: any[] = await res.json(); // API returns an array
  const items: AssetTx[] = [];

  for (const tx of raw) {
    // Common fields
    const type = (pick<string>(tx, 'type', 'txType') || '').toString();
    const signature = pick<string>(tx, 'signature', 'txId', 'id') || '';
    const ts = toNumberSafe(pick(tx, 'timestamp')) ?? Date.now();
    const sender =
      (pick<string>(tx, 'sender', 'creator', 'creatorAddress') || '').toString();
    const recipient =
      (pick<string>(tx, 'recipient', 'destination', 'address') || '').toString();
    const confirmations = toNumberSafe(pick(tx, 'confirmations', 'height')) ?? undefined;

    // QORT (assetId 0): PAYMENT, MULTI_PAYMENT
    if (assetId === 0) {
      if (type === 'PAYMENT') {
        const amtRaw = toNumberSafe(pick(tx, 'amount'));
        if (amtRaw == null) continue;

        const amt = normalizeHumanAmount(amtRaw);
        // include only if our address is sender or recipient
        if (sender !== address && recipient !== address) continue;

        items.push({
          txId: signature,
          timestamp: ts,
          assetId: 0,
          amount: amt,
          sender,
          recipient,
          type,
          confirmations,
        });
        continue;
      }

      if (type === 'MULTI_PAYMENT') {
        // expect tx.payments?: Array<{recipient, amount}>
        const payments = Array.isArray(tx.payments) ? tx.payments : [];
        if (sender !== address && !payments.some((p: any) => p?.recipient === address)) {
          // nothing relevant to this address
          continue;
        }

        // If we are the sender, show the *total* we sent; if we are recipient, show only what we received.
        if (sender === address) {
          const totalOut = payments.reduce((sum: number, p: any) => {
            const a = toNumberSafe(p?.amount);
            return a == null ? sum : sum + normalizeHumanAmount(a);
          }, 0);
          items.push({
            txId: signature,
            timestamp: ts,
            assetId: 0,
            amount: totalOut,
            sender,
            recipient: '(multiple)', // multi-output
            type,
            confirmations,
          });
        } else {
          // we’re a recipient—sum only what we received
          const totalIn = payments.reduce((sum: number, p: any) => {
            if (p?.recipient !== address) return sum;
            const a = toNumberSafe(p?.amount);
            return a == null ? sum : sum + normalizeHumanAmount(a);
          }, 0);
          // sender might still be in `sender`; keep recipient as our address
          items.push({
            txId: signature,
            timestamp: ts,
            assetId: 0,
            amount: totalIn,
            sender,
            recipient: address,
            type,
            confirmations,
          });
        }
        continue;
      }

      // Other QORT-affecting types (fees etc.) can be added here if you want to show them as coin flows.
      continue; // skip unrelated types for QORT view
    }

    // ASSET transfers: require TRANSFER_ASSET with the specific assetId
    if (type === 'TRANSFER_ASSET') {
      const txAssetId = toNumberSafe(pick(tx, 'assetId'));
      if (txAssetId !== assetId) continue;

      const amtRaw = toNumberSafe(pick(tx, 'amount'));
      if (amtRaw == null) continue;

      const amt = normalizeHumanAmount(amtRaw);

      // include only if our address is sender or recipient
      if (sender !== address && recipient !== address) continue;

      items.push({
        txId: signature,
        timestamp: ts,
        assetId,
        amount: amt,
        sender,
        recipient,
        type,
        confirmations,
      });
      continue;
    }

    // You can extend here for orders, messages, etc., if you want them in the asset view
    // e.g., UPDATE_ASSET for the same assetId, CREATE_ASSET_ORDER affecting this asset, etc.
  }

  return { items };
}
