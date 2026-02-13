import pLimit from 'p-limit';
import { getPrimaryAccountName } from './qortalApi';

// max 6 concurrent lookups (adjust if you want more aggressive/faster)
const limit = pLimit(4);

export type HolderRow = {
  address: string;
  balance: number; // human units
  assetId: number;
  assetName?: string;
  name?: string | null; // resolved account name (optional)
};

export type AssetTx =
  | {
      type: 'ISSUE_ASSET';
      timestamp: number; // ms
      creatorAddress: string;
      assetId: number;
      assetName: string;
      description?: string;
      quantity: number; // human units
      isDivisible: boolean;
      signature: string;
    }
  | {
      type: 'CREATE_ASSET_ORDER';
      timestamp: number; // ms
      creatorAddress: string;
      haveAssetId: number;
      wantAssetId: number;
      amount: number; // human units (amount of haveAsset)
      price: number; // QORT per asset (as string in API; parse to number)
      haveAssetName?: string;
      wantAssetName?: string;
      pricePair?: string;
      signature: string;
    }
  | {
      // Add more types as needed later (TRADE, CANCEL_ASSET_ORDER, etc.)
      type: string;
      timestamp: number; // ms
      creatorAddress?: string;
      signature?: string;
      [k: string]: any;
    };

const toMs = (t: number) => (t < 1e11 ? t * 1000 : t);

async function getJsonOrThrow(where: string, res: Response) {
  const text = await res.text(); // read once
  if (!res.ok) {
    // surface server error body; Qortal nodes return useful messages on 400s
    const msg = text || `${res.status} ${res.statusText}`;
    console.error(`[${where}] HTTP ${res.status}: ${msg}`);
    throw new Error(`${where} failed: ${msg}`);
  }
  try {
    return text ? JSON.parse(text) : null;
  } catch (e) {
    console.error(`[${where}] bad JSON`, e, text?.slice(0, 200));
    throw new Error(`${where} failed: invalid JSON`);
  }
}

// --- Holders ---

export async function fetchAssetHolders(params: {
  assetId: number;
  limit?: number;
  offset?: number;
  excludeZero?: boolean;
  // Valid values per your node — your working curl used ASSET_BALANCE_ACCOUNT
  ordering?: 'ASSET_BALANCE_ACCOUNT' | string;
}): Promise<HolderRow[]> {
  const {
    assetId,
    limit = 200,
    offset = 0,
    excludeZero = true,
    ordering = 'ASSET_BALANCE_ACCOUNT',
  } = params;

  const path =
    `/assets/balances` +
    `?assetid=${encodeURIComponent(String(assetId))}` +
    `&ordering=${encodeURIComponent(ordering)}` +
    `&excludeZero=${excludeZero ? 'true' : 'false'}` +
    `&limit=${encodeURIComponent(String(limit))}` +
    `&offset=${encodeURIComponent(String(offset))}`;

  const res = await fetch(path, { method: 'GET' });
  console.log('asset balances path', path);
  const data = await getJsonOrThrow('fetchAssetHolders', res);
  const arr = Array.isArray(data) ? data : [];

  return arr.map((r: any) => ({
    address: String(r.address),
    assetId: Number(r.assetId),
    balance: Number(r.balance ?? 0),
    assetName: r.assetName ? String(r.assetName) : undefined,
  }));
}

// --- Transactions ---

export async function fetchAssetTransactions(params: {
  assetId: number;
  confirmationStatus?: 'CONFIRMED' | 'UNCONFIRMED' | 'BOTH';
  limit?: number;
  offset?: number;
  reverse?: boolean;
}): Promise<AssetTx[]> {
  const { assetId, confirmationStatus = 'CONFIRMED', limit = 100, offset = 0 } = params;

  const qs = new URLSearchParams();
  qs.set('confirmationStatus', confirmationStatus);
  qs.set('limit', String(limit));
  if (offset) qs.set('offset', String(offset));

  const path = `/assets/transactions/${encodeURIComponent(String(assetId))}?${qs.toString()}`;

  const res = await fetch(path, { method: 'GET' });
  const data = await getJsonOrThrow('fetchAssetTransactions', res);
  const rows: any[] = Array.isArray(data) ? data : [];

  return rows.map((t: any) => {
    const common = {
      type: String(t.type || ''),
      timestamp: toMs(Number(t.timestamp)),
      signature: String(t.signature || ''),
      creatorAddress: t.creatorAddress ? String(t.creatorAddress) : undefined,
    };

    if (t.type === 'ISSUE_ASSET') {
      return {
        ...common,
        type: 'ISSUE_ASSET' as const,
        assetId: Number(t.assetId),
        assetName: String(t.assetName || ''),
        description: t.description ? String(t.description) : undefined,
        quantity: Number(t.quantity ?? 0),
        isDivisible: Boolean(t.isDivisible),
      };
    }

    if (t.type === 'CREATE_ASSET_ORDER') {
      return {
        ...common,
        type: 'CREATE_ASSET_ORDER' as const,
        haveAssetId: Number(t.haveAssetId),
        wantAssetId: Number(t.wantAssetId),
        amount: Number(t.amount ?? 0),
        price: Number(t.price ?? 0),
        haveAssetName: t.haveAssetName ? String(t.haveAssetName) : undefined,
        wantAssetName: t.wantAssetName ? String(t.wantAssetName) : undefined,
        pricePair: t.pricePair ? String(t.pricePair) : undefined,
      };
    }

    return common as AssetTx;
  });
}

// --- Name resolution (address -> account name) ---

/**
 * Small in-memory cache; you can swap for QDN later if you want global shared cache.
 */
const nameCache = new Map<string, string | null>();

export async function resolveNames(addresses: string[]): Promise<Map<string, string | null>> {
  const unique = Array.from(new Set(addresses.filter(Boolean)));
  const out = new Map<string, string | null>();

  // Fill from cache first
  unique.forEach((a) => {
    if (nameCache.has(a)) out.set(a, nameCache.get(a)!);
  });

  // Only fetch missing
  const toFetch = unique.filter((a) => !out.has(a));

  await Promise.all(
    toFetch.map((addr) =>
      limit(async () => {
        try {
          const n = await getPrimaryAccountName(addr);
          nameCache.set(addr, n);
          out.set(addr, n);
        } catch (e) {
          console.warn('[resolveNames] failed for', addr, e);
          nameCache.set(addr, null);
          out.set(addr, null);
        }
      })
    )
  );

  return out;
}
