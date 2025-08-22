
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

// const toNumberSafe = (v: any): number | null => {
//   if (typeof v === 'number' && Number.isFinite(v)) return v;
//   if (typeof v === 'string' && v.trim() !== '' && !Number.isNaN(Number(v))) return Number(v);
//   return null;
// };

// heuristics: some nodes return atomic amounts; if you ever see integers with huge magnitudes for divisible assets,
// convert by 1e8. We keep it conservative: only convert if it looks *definitely* atomic.
const normalizeHumanAmount = (n: number): number => {
  // if absolute value is an integer with >=9 digits, assume atomics and scale down
  if (Number.isInteger(n) && Math.abs(n) >= 1e9) return n / 1e8;
  return n;
};

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
  // Leave txType unset → get everything; we’ll filter client-side.

  const res = await fetch(url.toString(), { headers: { accept: '*/*' } });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`/transactions/search failed: ${res.status} ${res.statusText} ${text}`);
  }

  const raw: any[] = await res.json();
  const items: AssetTx[] = [];

  const involvesMe = (tx: any) => {
    const s = (tx.sender ?? tx.creator ?? tx.creatorAddress ?? '').toString();
    const r =
      (tx.recipient ?? tx.destination ?? tx.address ?? tx.receiver ?? '').toString();
    return s === address || r === address;
  };

  const hasAssetMention = (tx: any, aid: number) => {
    const ids = [
      tx.assetId,
      tx.haveAssetId,
      tx.wantAssetId,
      tx.amountAssetId,
      tx.targetAssetId,
      tx?.initiatingOrder?.haveAssetId,
      tx?.initiatingOrder?.wantAssetId,
    ]
      .map((n) => (n == null ? undefined : Number(n)))
      .filter((n) => Number.isFinite(n)) as number[];
    return ids.includes(aid);
  };

  for (const tx of raw) {
    const type: string = (tx.type ?? tx.txType ?? '').toString();
    const signature: string = (tx.signature ?? tx.txId ?? tx.id ?? '').toString();
    if (!signature) continue;

    const ts = Number(tx.timestamp) || Date.now();
    const sender = (tx.sender ?? tx.creator ?? tx.creatorAddress ?? '').toString();
    const recipient = (
      tx.recipient ??
      tx.destination ??
      tx.address ??
      tx.receiver ??
      ''
    ).toString();
    const confirmations =
      tx.confirmations != null
        ? Number(tx.confirmations)
        : tx.height != null
        ? Number(tx.height)
        : undefined;

    // QORT view → show everything that involves this address
    if (assetId === 0) {
      if (!involvesMe(tx)) continue;

      if (type === 'PAYMENT') {
        const amt = Number(tx.amount);
        if (!Number.isFinite(amt)) continue;
        items.push({
          txId: signature,
          timestamp: ts,
          assetId: 0,
          amount: normalizeHumanAmount(amt),
          sender,
          recipient,
          type,
          confirmations,
        });
        continue;
      }

      if (type === 'MULTI_PAYMENT') {
        // Light, permissive typing for payments array
        const payments: Array<{ recipient?: string; amount?: number | string }> =
          Array.isArray(tx.payments) ? tx.payments : [];

        if (sender === address) {
          // We are the sender => sum everything we sent
          const totalOut = payments.reduce<number>((sum, p) => {
            const aRaw = p?.amount;
            const aNum = typeof aRaw === 'string' ? Number(aRaw) : aRaw;
            return Number.isFinite(aNum as number) ? sum + normalizeHumanAmount(aNum as number) : sum;
          }, 0);

          items.push({
            txId: signature,
            timestamp: ts,
            assetId: 0,
            amount: totalOut,
            sender,
            recipient: '(multiple)',
            type,
            confirmations,
          });
        } else {
          // We're a recipient => sum only what we received
          const totalIn = payments.reduce<number>((sum, p) => {
            if (p?.recipient !== address) return sum;
            const aRaw = p?.amount;
            const aNum = typeof aRaw === 'string' ? Number(aRaw) : aRaw;
            return Number.isFinite(aNum as number) ? sum + normalizeHumanAmount(aNum as number) : sum;
          }, 0);

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


      // Generic catch-all entry for other QORT-using types (fees, messages, orders, etc.)
      items.push({
        txId: signature,
        timestamp: ts,
        assetId: 0,
        amount: 0, // unknown/NA for non-payment types
        sender,
        recipient,
        type,
        confirmations,
      });
      continue;
    }

    // Asset view (assetId > 0) → include only tx referencing that asset
    if (!hasAssetMention(tx, assetId)) continue;

    if (type === 'TRANSFER_ASSET') {
      const amt = Number(tx.amount);
      if (!Number.isFinite(amt)) continue;
      // include only if the address is directly involved
      if (!involvesMe(tx)) continue;
      items.push({
        txId: signature,
        timestamp: ts,
        assetId,
        amount: normalizeHumanAmount(amt),
        sender,
        recipient,
        type,
        confirmations,
      });
      continue;
    }

    if (type === 'ISSUE_ASSET' || type === 'UPDATE_ASSET') {
      // Meta actions for this asset – show with amount 0
      items.push({
        txId: signature,
        timestamp: ts,
        assetId,
        amount: 0,
        sender,
        recipient,
        type,
        confirmations,
      });
      continue;
    }

    if (type === 'CREATE_ASSET_ORDER') {
      // Show the amount of THIS asset being offered (if any)
      const haveAid =
        Number(tx.haveAssetId ?? tx?.initiatingOrder?.haveAssetId ?? NaN) || NaN;
      const wantAid =
        Number(tx.wantAssetId ?? tx?.initiatingOrder?.wantAssetId ?? NaN) || NaN;
      let amtForThisAsset = 0;
      const amount = Number(tx.amount ?? tx?.initiatingOrder?.amount);
      if (Number.isFinite(amount) && haveAid === assetId) {
        amtForThisAsset = normalizeHumanAmount(amount);
      }
      items.push({
        txId: signature,
        timestamp: ts,
        assetId,
        amount: amtForThisAsset, // 0 if our asset is on the "want" side
        sender,
        recipient,
        type,
        confirmations,
      });
      continue;
    }

    if (type === 'CANCEL_ASSET_ORDER') {
      items.push({
        txId: signature,
        timestamp: ts,
        assetId,
        amount: 0,
        sender,
        recipient,
        type,
        confirmations,
      });
      continue;
    }

    // Fallback for any other ASSET-* flavored tx that mentions our assetId
    items.push({
      txId: signature,
      timestamp: ts,
      assetId,
      amount: 0,
      sender,
      recipient,
      type,
      confirmations,
    });
  }

  return { items };
}
