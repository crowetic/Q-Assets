// src/qars/compute.ts
import { QarsMetrics, InputsProof } from '../types/qarsTypes';
import { fetchCurrentHeight } from './io';
import { fetchQortToAssetTrades } from '../utils/markets';

// If you have a proper holders endpoint, prefer it over balances paging.
async function fetchHoldersCount(assetId: number): Promise<number> {
  // Try REST: /assets/balances/{assetId}?limit=1000&offset=0
  try {
    let count = 0;
    const page = 1000;
    for (let off = 0; off < 200_000; off += page) {
      const res = await fetch(`/assets/balances/${assetId}?limit=${page}&offset=${off}`);
      if (!res.ok) break;
      const rows: any[] = await res.json();
      if (!rows.length) break;
      count += rows.filter((r) => Number(r?.balance) > 0).length;
      if (rows.length < page) break;
    }
    return count;
  } catch {
    return 0;
  }
}

export async function collectMetrics(params: {
  assetId: number;
  windowBlocks: number;     // e.g., 2880 (≈ 2 days)
}): Promise<{ metrics: QarsMetrics; inputsProof: InputsProof }> {
  const { assetId, windowBlocks } = params;
  const height = await fetchCurrentHeight();
  const now = Date.now();
  const msPerBlock = 60_000; // Qortal ≈ 1 min/block
  const fromMs = now - windowBlocks * msPerBlock;

  // ---- Trades (QORT <-> asset) within window
  // You already use this in your charts
  const envAll = await fetchQortToAssetTrades(assetId, fromMs, 5000, 20_000).catch(() => []);
  // Deduplicate by trade signature if present
  const seen = new Set<string>();
  let tradesCount = 0;
  let volAsset = 0;
  let volQort = 0;
  const traders = new Set<string>();
  const sampleTradeIds: string[] = [];

  for (const env of envAll as any[]) {
    const io = env?.initiatingOrder;
    const tr = env?.trade;
    const sig = String(tr?.signature || tr?.txId || io?.signature || '');
    if (sig && seen.has(sig)) continue;
    if (sig) seen.add(sig);

    const qty = Number(tr?.targetAmount ?? io?.amount ?? 0);
    if (!(qty > 0)) continue;
    // price QORT/asset
    const price = io?.price != null ? Number(io.price) :
      Number(tr?.initiatorAmount ?? 0) / Math.max(1e-12, qty);

    if (!(price > 0)) continue;

    tradesCount += 1;
    volAsset += qty;
    volQort += qty * price;

    const a1 = String(io?.creatorAddress || io?.creator || '');
    const a2 = String(env?.respondingOrder?.creatorAddress || env?.respondingOrder?.creator || '');
    if (a1) traders.add(a1);
    if (a2) traders.add(a2);

    if (sampleTradeIds.length < 5 && sig) sampleTradeIds.push(sig);
  }

  const holdersCount = await fetchHoldersCount(assetId);

  const metrics: QarsMetrics = {
  // Market
  tradesCount,
  volAsset,
  volQort,
  uniqueTraders: traders.size,
  bookDiversity: undefined,      // TODO: compute entropy-like diversity if you want

  // Holders
  holdersCount,
  holdersDelta: 0,               // TODO: compare to previous epoch snapshot
  holderRegularity: 0,           // TODO: EWMA across N epochs

  // Transfers (non-trade)
  userTransfers: 0,              // TODO: non-issuer transfers (issuer->fresh excluded)
  transferRegularity: 0,         // TODO: JS-divergence/capped regularity

  // Dividends
  dividendEvents: 0,             // TODO
  dividendQortTotal: 0,          // TODO

  // Fees / network contribution
  totalFeesQort: 0,              // TODO: sum tx.fee for tx touching this asset
  burnsQort: 0,                  // TODO if burn-to-null is implemented

  // Community/QDN
  newsPosts: 0,                  // TODO: Q-Assets NEWS tagged posts
  newsComments: 0,               // TODO
  paidUpvotes: 0,                // TODO: validated paid upvotes count
  paidUpvotesQort: 0,            // TODO: QORT routed via upvotes
  groupMembers: 0,               // TODO: primary group size under rules
  communityRegularity: 0,        // TODO: cadence of posts/comments

  // Issuer/Admin
  issuerActivityScore: 0,        // TODO: composite issuer/admin/QDN activity

  // Anti-gaming
  selfDealPenalty: 0,            // 0..1 (penalty), fill from heuristics
  sybilPenalty: 0,               // 0..1 (penalty), from address clustering
};

  const inputsProof: InputsProof = {
    nodeInfo: { height, network: 'main' },
    ranges: [{ name: 'trades', fromHeight: height - windowBlocks, toHeight: height }],
    sampleRefs: { trades: sampleTradeIds },
  };

  return { metrics, inputsProof };
}
