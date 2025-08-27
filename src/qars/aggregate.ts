// src/qars/aggregate.ts
import { AggregatedSnapshot, QarsMetrics, QarsSnapshot } from '../types/qarsTypes';
import { fetchWeights, listRecentSnapshots } from './io';
import { scoreEpoch } from './weights';

function median(nums: number[]): number {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

function medianOf(list: QarsMetrics[], key: keyof QarsMetrics): number {
  const vals = list.map((m) => {
    const v = m[key] as any;
    return typeof v === 'number' ? v : 0;
  });
  return median(vals);
}

function medianDefined(nums: Array<number | undefined>): number | undefined {
  const vals = nums.filter((x): x is number => typeof x === 'number' && Number.isFinite(x));
  return vals.length ? median(vals) : undefined;
}

export function aggregateMetrics(list: QarsMetrics[]): QarsMetrics {
  return {
    // Market
    tradesCount:           medianOf(list, 'tradesCount'),
    volAsset:              medianOf(list, 'volAsset'),
    volQort:               medianOf(list, 'volQort'),
    uniqueTraders:         medianOf(list, 'uniqueTraders'),
    bookDiversity:         medianDefined(list.map((m) => m.bookDiversity)),

    // Holders
    holdersCount:          medianOf(list, 'holdersCount'),
    holdersDelta:          medianOf(list, 'holdersDelta'),
    holderRegularity:      medianOf(list, 'holderRegularity'),

    // Transfers
    userTransfers:         medianOf(list, 'userTransfers'),
    transferRegularity:    medianOf(list, 'transferRegularity'),

    // Dividends
    dividendEvents:        medianOf(list, 'dividendEvents'),
    dividendQortTotal:     medianOf(list, 'dividendQortTotal'),

    // Fees / contribution
    totalFeesQort:         medianOf(list, 'totalFeesQort'),
    burnsQort:             medianOf(list, 'burnsQort'),

    // Community/QDN
    newsPosts:             medianOf(list, 'newsPosts'),
    newsComments:          medianOf(list, 'newsComments'),
    paidUpvotes:           medianOf(list, 'paidUpvotes'),
    paidUpvotesQort:       medianOf(list, 'paidUpvotesQort'),
    groupMembers:          medianOf(list, 'groupMembers'),
    communityRegularity:   medianOf(list, 'communityRegularity'),

    // Issuer/Admin
    issuerActivityScore:   medianOf(list, 'issuerActivityScore'),

    // Anti-gaming
    selfDealPenalty:       medianOf(list, 'selfDealPenalty'),
    sybilPenalty:          medianOf(list, 'sybilPenalty'),
  };
}

function dedupeByHashOrContent(s: QarsSnapshot[]): QarsSnapshot[] {
  // If you store QDN content hashes, use them here. As a placeholder, dedupe by (assetId, asOfHeight, publisher.address).
  const seen = new Set<string>();
  const out: QarsSnapshot[] = [];
  for (const x of s) {
    const k = `${x.assetId}|${x.asOfHeight}|${x.publisher.address}`;
    if (!seen.has(k)) {
      seen.add(k);
      out.push(x);
    }
  }
  return out;
}

export async function getAggregatedQars(assetId: number): Promise<AggregatedSnapshot | null> {
  const candidates = await listRecentSnapshots({ assetId, maxAgeBlocks: 1440, limit: 40 });
  if (!candidates.length) return null;

  // Prefer admin within the window
  const admins = candidates.filter((c) => c.publisher.groupVerified);
  if (admins.length) {
    const best = admins.sort((a, b) => b.asOfHeight - a.asOfHeight)[0];
    const weights = await fetchWeights(best.weightsVersion);
    return {
      assetId,
      asOfHeight: best.asOfHeight,
      metrics: best.metrics,
      scoreEpoch: scoreEpoch(best.metrics, weights),
      source: 'ADMIN',
      publishersUsed: 1,
      confidence: 'high',
    };
  }

  // Community aggregate
  const deduped = dedupeByHashOrContent(candidates);
  const metrics = aggregateMetrics(deduped.map((d) => d.metrics));
  const weights = await fetchWeights(deduped[0]?.weightsVersion ?? 1);
  const score = scoreEpoch(metrics, weights);

  const used = deduped.length;
  const confidence = used >= 5 ? 'high' : used >= 3 ? 'medium' : 'low';

  return {
    assetId,
    asOfHeight: Math.max(...deduped.map((d) => d.asOfHeight)),
    metrics,
    scoreEpoch: score,
    source: 'COMMUNITY',
    publishersUsed: used,
    confidence,
  };
}
