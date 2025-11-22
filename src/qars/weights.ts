// src/qars/weights.ts
import type { QarsMetrics, QarsWeightsV1 } from '../types/qarsTypes';

// Penalties: linear weights *subtract* from score
const PENALTY_KEYS: (keyof QarsMetrics)[] = ['selfDealPenalty', 'sybilPenalty'];

type Contribution = {
  key: keyof QarsMetrics;
  raw: number;
  norm: number; // normalized 0..1
  weight: number;
  contrib: number; // weight * norm
  type: 'positive' | 'penalty';
};

export interface ScoreExplanation {
  score: number; // final 0..100
  posScore: number; // average positives 0..1
  penScore: number; // average penalties 0..1
  contributions: Contribution[];
}

// Smooth saturations
function logistic(x: number, { k, x0, max }: { k: number; x0: number; max: number }): number {
  // classic: y = max / (1 + e^{-k (x - x0)})
  return max / (1 + Math.exp(-k * (x - x0)));
}

function softcap(x: number, capMax: number): number {
  // monotonic, concave, approaches capMax as x → ∞
  // y = x / (1 + x/capMax)
  if (capMax <= 0) return 0;
  return x / (1 + x / capMax);
}

function normalizeMetric(key: keyof QarsMetrics, value: number, weights: QarsWeightsV1): number {
  const cap = weights.caps?.[key];
  if (cap && cap.max > 0) {
    const y = cap.k && cap.x0 != null ? logistic(value, cap) : softcap(value, cap.max);
    return Math.max(0, Math.min(1, y / cap.max));
  }
  if (PENALTY_KEYS.includes(key)) {
    return Math.max(0, Math.min(1, value));
  }
  const autoMax = Math.max(1, value || 0) * 2;
  const y = softcap(value, autoMax);
  return Math.max(0, Math.min(1, y / autoMax));
}

export function explainScore(metrics: QarsMetrics, weights: QarsWeightsV1): ScoreExplanation {
  const linear = weights.linear || {};
  let posWeighted = 0,
    posW = 0;
  let negWeighted = 0,
    negW = 0;
  const contributions: Contribution[] = [];

  (Object.keys(linear) as (keyof QarsMetrics)[]).forEach((key) => {
    const w = linear[key];
    if (!w || w === 0) return;

    const raw = (metrics[key] as number) ?? 0;
    const norm = normalizeMetric(key, raw, weights);
    const contrib = w * norm;

    if (PENALTY_KEYS.includes(key)) {
      negWeighted += contrib;
      negW += w;
      contributions.push({ key, raw, norm, weight: w, contrib, type: 'penalty' });
    } else {
      posWeighted += contrib;
      posW += w;
      contributions.push({ key, raw, norm, weight: w, contrib, type: 'positive' });
    }
  });

  const posScore = posW > 0 ? posWeighted / posW : 0;
  const penScore = negW > 0 ? negWeighted / negW : 0;
  const combined = Math.max(0, Math.min(1, posScore * (1 - penScore)));
  const score = Math.round(combined * 1000) / 10;

  return { score, posScore, penScore, contributions };
}

/**
 * Score an epoch on 0..100 using generic weights.
 * - Positive metrics are averaged: posScore = Σ(w_i * norm_i) / Σ(w_i)
 * - Penalties are averaged:       penScore = Σ(w_j * pen_j) / Σ(w_j)
 * - Final = clamp01( posScore * (1 - penScore) ) * 100
 */
export function scoreEpoch(metrics: QarsMetrics, weights: QarsWeightsV1): number {
  const linear = weights.linear || {};
  let posWeighted = 0;
  let posW = 0;
  let negWeighted = 0;
  let negW = 0;

  (Object.keys(linear) as (keyof QarsMetrics)[]).forEach((key) => {
    const w = linear[key];
    if (!w || w === 0) return;

    // pull metric (absent -> 0)
    const raw = (metrics[key] as number) ?? 0;
    const norm = normalizeMetric(key, raw, weights);

    if (PENALTY_KEYS.includes(key)) {
      negWeighted += w * norm;
      negW += w;
    } else {
      posWeighted += w * norm;
      posW += w;
    }
  });

  const posScore = posW > 0 ? posWeighted / posW : 0;
  const penScore = negW > 0 ? negWeighted / negW : 0;

  const combined = Math.max(0, Math.min(1, posScore * (1 - penScore)));
  return Math.round(combined * 1000) / 10; // 0.1 precision
}

export const DEFAULT_WEIGHTS_V1: QarsWeightsV1 = {
  version: 1,
  linear: {
    // Market
    tradesCount: 0.25,
    uniqueTraders: 0.25,
    volQort: 0.2,
    volAsset: 0.1,
    totalFeesQort: 0.05,

    // Holders
    holdersCount: 0.15,
    // holdersDelta: 0.05,              // enable once you compute it well
    // holderRegularity: 0.05,

    // Community/QDN (turn on gradually as collectors mature)
    // newsPosts: 0.03,
    // newsComments: 0.02,
    // communityRegularity: 0.03,
    // paidUpvotes: 0.00,
    // paidUpvotesQort: 0.00,
    // groupMembers: 0.00,

    // Dividends: pick the monetary impact over the event count
    // dividendEvents: 0.00,
    // dividendQortTotal: 0.05,

    // Issuer/Admin
    // issuerActivityScore: 0.00,

    // Penalties (kept separate)
    selfDealPenalty: 0.12,
    sybilPenalty: 0.12,
  },
  caps: {
    // Keep caps conservative—these are *pre*-normalization maxes.
    tradesCount: { k: 0.03, x0: 30, max: 3000 },
    uniqueTraders: { k: 0.05, x0: 12, max: 1000 },
    volQort: { k: 0.01, x0: 500, max: 10000 },
    volAsset: { k: 0.01, x0: 500, max: 50000 },
    holdersCount: { k: 0.01, x0: 60, max: 10000 },
    totalFeesQort: { k: 0.02, x0: 5, max: 1000 },

    // If you enable these weights later, predefine caps now:
    // dividendQortTotal: { k: 0.02, x0: 5, max: 1000 },
    // newsPosts:         { k: 0.10, x0: 2, max: 100 },
    // newsComments:      { k: 0.10, x0: 4, max: 400 },
    // communityRegularity:{ k: 0.20, x0: 0.5, max: 1 },
    // groupMembers:      { k: 0.01, x0: 25, max: 5000 },
  },
  decayLambda: 0.15, // used in your time-decay combiner across epochs
  minConfirmations: 10,
  maxPerAddrPerEpoch: 5,
  upvote: { minQort: 0.25, splitQassetsPct: 40, splitIssuerPct: 10 },
  groupRules: { mustBeAssetSpecific: true, mustBeNewerThanAsset: true },
};
