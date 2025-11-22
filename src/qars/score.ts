import { QarsMetrics, QarsWeightsV1 } from '../types/qarsTypes';

const logistic = (x: number, { k, x0, max }: { k: number; x0: number; max: number }) =>
  max / (1 + Math.exp(-k * (x - x0)));

export function scoreEpoch(metrics: QarsMetrics, W: QarsWeightsV1): number {
  let s = 0;
  for (const [key, w] of Object.entries(W.linear) as Array<[keyof QarsMetrics, number]>) {
    const val = metrics[key] ?? 0;
    const cap = W.caps[key];
    const norm = cap ? logistic(val, cap) : val;
    s += w * norm;
  }
  // penalties: treat as fractions 0..1 and scale with a global penalty weight (or include in linear with negative weights)
  const penalty = (metrics.selfDealPenalty ?? 0) + (metrics.sybilPenalty ?? 0);
  return Math.max(0, s * (1 - Math.min(0.9, penalty))); // keep ≥0; clamp penalty impact
}

export function ewma(prev: number | null, current: number, lambda: number): number {
  if (prev == null) return current;
  return (1 - lambda) * prev + lambda * current;
}
