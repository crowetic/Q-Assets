// src/explorerStats/fetchers.ts
import { TRADE_FETCH_N } from './types';
import { searchSimpleByIdentifierPrefix } from '../utils/searchSimple';
// import { assetCommentsPrefix } from "../constants/qdnConstants";

// a) Most recent trade ts (fast)
export async function fetchLastTradeTs(assetId: number): Promise<number | null> {
  const url = `/assets/trades/recent?assetid=0&otherassetid=${assetId}&limit=0&reverse=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`recent trades failed (${res.status})`);
  const arr = (await res.json()) as Array<{ timestamp: number }>;
  if (!Array.isArray(arr) || arr.length === 0) return null;
  // API already returns newest-first; be defensive anyway:
  const newest = arr.reduce((m, x) => Math.max(m, Number(x.timestamp) || 0), 0);
  return Number.isFinite(newest) && newest > 0 ? newest : null;
}

// b) Last N trades QORT volume
type TradeEnvelope = {
  trade: {
    initiatorAmount: string;
    initiatorAmountAssetId: number; // expect 0 (QORT) for your base/quote orientation
    timestamp: number;
  };
  // ... other fields exist, not needed here
};

export async function fetchQortVolumeLastN(
  assetId: number,
  N = TRADE_FETCH_N
): Promise<{
  count: number;
  qortSum: number;
  newestTs: number | null; // handy if you want to sanity-check vs (a)
}> {
  const url = `/assets/trades/0/${assetId}?limit=${N}&reverse=true`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`last-N trades failed (${res.status})`);
  const arr = (await res.json()) as TradeEnvelope[];

  if (!Array.isArray(arr) || arr.length === 0) {
    return { count: 0, qortSum: 0, newestTs: null };
  }

  let sum = 0;
  let newest = 0;

  for (const rec of arr) {
    const t = rec?.trade;
    if (!t) continue;

    // We always query /trades/0/{asset}, so initiatorAmountAssetId SHOULD be 0 (QORT).
    // Still, be defensive in case Core flips sides on some edge trades.
    const qort = t.initiatorAmountAssetId === 0 ? Number(t.initiatorAmount) : 0;

    if (Number.isFinite(qort)) sum += qort;

    const ts = Number(t.timestamp) || 0;
    if (ts > newest) newest = ts;
  }

  return { count: arr.length, qortSum: sum, newestTs: newest || null };
}

// ---- GROUP MEMBERS ----------------------------------------------------------

/**
 * Fetches group member/admin counts from REST.
 * - Uses your /groups/members/:id?limit=0 endpoint (no need to page 'members' for counts)
 */
export async function fetchGroupMembersCountFromRest(primaryGroupId: number): Promise<{
  memberCount: number;
  adminCount: number;
  lastJoinTs: number | null; // newest "joined" timestamp we can see (optional UX chip)
}> {
  const res = await fetch(`/groups/members/${primaryGroupId}?limit=0`);
  if (!res.ok) throw new Error(`group members failed (${res.status})`);

  type GroupMembersResponse = {
    memberCount?: number;
    adminCount?: number;
    members?: Array<{ member: string; joined?: number; isAdmin?: boolean }>;
  };

  const data = (await res.json()) as GroupMembersResponse;

  const memberCount = Number(data.memberCount ?? 0);
  const adminCount = Number(data.adminCount ?? 0);

  // Optional: surface "most recent join" for a “growing” signal
  let lastJoinTs: number | null = null;
  if (Array.isArray(data.members)) {
    for (const m of data.members) {
      const js = Number(m?.joined ?? 0);
      if (Number.isFinite(js) && js > (lastJoinTs ?? 0)) lastJoinTs = js;
    }
  }

  return { memberCount, adminCount, lastJoinTs };
}

export async function fetchGroupMembersCountOnly(groupId: number): Promise<number> {
  try {
    const res = await fetch(`/groups/members/${groupId}?limit=0`);
    if (!res.ok) return 0;
    const j = await res.json();
    return Number(j?.memberCount) || 0;
  } catch {
    return 0;
  }
}

/**
 * Fetches comment count + newest timestamp from QDN using your helper.
 * - Your commentsSection already does: searchSimpleByIdentifierPrefix('DOCUMENT', prefix)
 * - We just reuse it and aggregate.
 */
export async function fetchCommentsSummaryForAsset(assetId: number): Promise<{
  total: number;
  lastTs: number | null;
}> {
  try {
    const prefix = `asset_comment__${assetId}__`;
    const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', prefix) // your existing util
      .catch(() => [] as any[]);

    if (!Array.isArray(hits) || hits.length === 0) {
      return { total: 0, lastTs: null };
    }

    const total = hits.length;
    const lastTs = hits.reduce<number | null>((acc, h) => {
      const ts = Number(h.created || h.updated || h.timestamp || 0);
      return ts && (!acc || ts > acc) ? ts : acc;
    }, null);

    return { total, lastTs };
  } catch {
    return { total: 0, lastTs: null };
  }
}

export async function fetchTradesSummary(assetId: number): Promise<{
  total: number; // trades count in last N
  lastTs: number | null; // most recent trade ts (or null)
  approximate?: boolean;
}> {
  try {
    // recent endpoint: 2 most recent trades
    const recent = await fetch(
      `/assets/trades/recent?assetid=0&otherassetid=${assetId}&limit=0&reverse=true`
    ).then((r) => (r.ok ? r.json() : []));
    const lastTs = Array.isArray(recent) && recent.length ? Number(recent[0].timestamp) : null;

    // last N trades full objects (e.g., limit=1000)
    const N = 1000;
    const trades = await fetch(`/assets/trades/0/${assetId}?limit=${N}&reverse=true`).then((r) =>
      r.ok ? r.json() : []
    );

    const total = Array.isArray(trades) ? trades.length : 0;

    return { total, lastTs, approximate: false };
  } catch {
    // hard default: no data but settled
    return { total: 0, lastTs: null, approximate: true };
  }
}
