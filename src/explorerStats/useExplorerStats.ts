// src/explorerStats/useExplorerStats.ts
import { useEffect, useMemo, useState } from 'react';
import { TTL, TRADE_FETCH_N, type ExplorerStats } from './types';
import { loadStats, saveStats } from './storage';

import {
  fetchTradesSummary,
  fetchQortVolumeLastN,
  fetchCommentsSummaryForAsset,
  fetchGroupMembersCountFromRest,
} from './fetchers';

export type AssetMeta = {
  assetId: number;
  // kept for compatibility; ignored by the comments fetcher (it derives from assetId)
  commentsIdPrefix?: string;
  primaryGroupId?: number; // if absent => default members=0
};

type Field = 'trades' | 'comments' | 'members';

const inFlight = new Set<string>();
const key = (id: number) => `k:${id}`;

export function useExplorerStats(meta: AssetMeta) {
  // Seed with cache or sane defaults (never undefined -> prevents “refreshing…” forever)
  const [stats, setStats] = useState<ExplorerStats>(() => {
    const cached = loadStats(meta.assetId);
    if (cached) {
      // Ensure newer fields exist
      return {
        ...cached,
        qortVolLastN: cached.qortVolLastN ?? 0,
        trades: cached.trades ?? 0,
        comments: cached.comments ?? 0,
        groupMembers: cached.groupMembers ?? 0,
        lastTradeTs: cached.lastTradeTs ?? null,
        lastCommentTs: cached.lastCommentTs ?? null,
      };
    }
    return {
      assetId: meta.assetId,
      trades: 0,
      qortVolLastN: 0,
      lastTradeTs: null,
      comments: 0,
      lastCommentTs: null,
      groupMembers: 0,
      updatedAt: 0,
      approximate: false,
      v: 1,
    };
  });

  const [busy, setBusy] = useState(false);

  const shouldFetch = (field: Field, s: ExplorerStats, now: number) => {
    const age = now - (s.updatedAt ?? 0);
    if (field === 'trades') {
      return s.trades == null || s.qortVolLastN == null || age > TTL.trades;
    }
    if (field === 'comments') return age > TTL.comments;
    if (field === 'members') return age > TTL.members;
    return false;
  };

  useEffect(() => {
    let stop = false;

    (async () => {
      const now = Date.now();
      const isBase = meta.assetId === 0 || meta.assetId === 1 || meta.assetId === 2;
      const cur = stats;

      // Base assets: keep defaults, skip network
      if (isBase) {
        if (!stop) {
          const next = { ...cur, updatedAt: now };
          setStats(next);
          saveStats(next);
        }
        return;
      }

      const needTrades = shouldFetch('trades', cur, now);
      const needComments = shouldFetch('comments', cur, now);
      const needMembers = meta.primaryGroupId != null && shouldFetch('members', cur, now);

      if (!needTrades && !needComments && !needMembers) return;

      const lock = `${key(meta.assetId)}:${needTrades ? 1 : 0}${needComments ? 1 : 0}${needMembers ? 1 : 0}`;
      if (inFlight.has(lock)) return;
      inFlight.add(lock);

      setBusy(true);
      try {
        // Fetch trades: count+lastTs AND qort volume in parallel (only if needed)
        const tradesP = needTrades
          ? Promise.all([
              fetchTradesSummary(meta.assetId), // { total, lastTs, approximate? }
              fetchQortVolumeLastN(meta.assetId, TRADE_FETCH_N), // { count, qortSum, newestTs }
            ])
          : Promise.resolve<[null, null]>([null, null]);

        const commentsP = needComments
          ? fetchCommentsSummaryForAsset(meta.assetId) // { total, lastTs }
          : Promise.resolve(null);

        const membersP = needMembers
          ? fetchGroupMembersCountFromRest(meta.primaryGroupId!)
          : Promise.resolve(null);

        const [[tSummary, tVol], c, m] = await Promise.all([tradesP, commentsP, membersP]);

        const next: ExplorerStats = {
          ...cur,

          // TRADES
          trades: tSummary?.total ?? cur.trades ?? 0,
          lastTradeTs: tSummary?.lastTs ?? cur.lastTradeTs ?? null,
          qortVolLastN: tVol?.qortSum ?? cur.qortVolLastN ?? 0,
          approximate: !!tSummary?.approximate,

          // COMMENTS
          comments: c?.total ?? cur.comments ?? 0,
          lastCommentTs: c?.lastTs ?? cur.lastCommentTs ?? null,

          // MEMBERS
          groupMembers:
            typeof m?.memberCount === 'number' ? m.memberCount : (cur.groupMembers ?? 0),

          updatedAt: now,
          v: 1,
        };

        if (!stop) {
          setStats(next);
          saveStats(next);
        }
      } catch {
        // On any failure, settle with known-safe defaults so UI doesn’t spin
        if (!stop) {
          const fallback: ExplorerStats = {
            ...stats,
            trades: stats.trades ?? 0,
            qortVolLastN: stats.qortVolLastN ?? 0,
            lastTradeTs: stats.lastTradeTs ?? null,
            comments: stats.comments ?? 0,
            lastCommentTs: stats.lastCommentTs ?? null,
            groupMembers: meta.primaryGroupId != null ? (stats.groupMembers ?? 0) : 0,
            updatedAt: now,
            approximate: true,
            v: 1,
          };
          setStats(fallback);
          saveStats(fallback);
        }
      } finally {
        inFlight.delete(lock);
        if (!stop) setBusy(false);
      }
    })();

    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [meta.assetId, meta.primaryGroupId]);

  return useMemo(() => ({ stats, busy }), [stats, busy]);
}
