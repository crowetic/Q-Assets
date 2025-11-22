import type { QarsWeightsV1 } from '../types/qarsTypes';
import { QARS_WEIGHTS_VERSION } from '../constants/qarsConstants';

export const DEFAULT_WEIGHTS_V1: QarsWeightsV1 = {
  version: QARS_WEIGHTS_VERSION,
  linear: {
    tradesCount: 1.0,
    volQort: 1.2,
    volAsset: 0.3,
    uniqueTraders: 1.5,
    holdersCount: 1.4,
    totalFeesQort: 0.6,

    // keep the rest neutral in v1 or tune later:
    // holdersDelta: 0, holderRegularity: 0, ...
  },
  caps: {
    // Example saturations (logistic-ish): score = max / (1 + exp(-k*(x-x0)))
    tradesCount: { k: 0.03, x0: 30, max: 1.0 },
    uniqueTraders: { k: 0.05, x0: 12, max: 1.0 },
    holdersCount: { k: 0.01, x0: 60, max: 1.0 },
  },
  decayLambda: 0.15,
  minConfirmations: 10,
  maxPerAddrPerEpoch: 5,
  upvote: { minQort: 0.25, splitQassetsPct: 40, splitIssuerPct: 10 },
  groupRules: { mustBeAssetSpecific: true, mustBeNewerThanAsset: true },
};
