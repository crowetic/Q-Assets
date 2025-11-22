import { QARS_SCHEMA_VERSION } from '../constants/qarsConstants';

export type EpochKey = { startHeight: number; endHeight: number };

export type QarsSnapshotSchema = `qars-snapshot@${typeof QARS_SCHEMA_VERSION}`;

export interface QarsMetrics {
  // Market
  tradesCount: number; // # trades in epoch
  volAsset: number; // traded asset units
  volQort: number; // traded QORT
  uniqueTraders: number; // distinct addresses involved in trades
  bookDiversity?: number; // entropy-ish: unique counterparties / traders

  // Holders
  holdersCount: number; // distinct addresses holding >0 at epoch end
  holdersDelta: number; // net new holders in epoch (smoothed, non-negative capped)
  holderRegularity: number; // % holders active in N recent epochs (bounded)

  // Transfers (non-trade)
  userTransfers: number; // # transfers not from issuer to fresh wallets
  transferRegularity: number; // Jensen–Shannon or capped “not bursty” score

  // Dividends
  dividendEvents: number;
  dividendQortTotal: number;

  // Fees / network contribution
  totalFeesQort: number; // sum tx.fee (QORT) involving this asset id
  burnsQort: number; // if you implement burn-to-null

  // Community/QDN
  newsPosts: number; // asset-tagged posts in Q-Assets NEWS
  newsComments: number;
  paidUpvotes: number; // count of valid paid upvotes
  paidUpvotesQort: number; // total QORT routed
  groupMembers: number; // size of asset’s primary group (with rules)
  communityRegularity: number; // posts/comments regularity score

  // Issuer / admins
  issuerActivityScore: number; // composite of issuer/admin tx + QDN activity

  // Anti-gaming features (precomputed penalties/bonuses)
  selfDealPenalty: number; // wash trading / self transfers, 0..1 (as penalty)
  sybilPenalty: number; // cluster suspicion, 0..1
}

export interface QarsWeightsV1 {
  version: 1;
  // 0..n linear weights and saturation settings per metric
  linear: Partial<Record<keyof QarsMetrics, number>>;
  // soft caps (saturating transforms) per metric (e.g., logistic/min-max breakpoints)
  caps: Partial<Record<keyof QarsMetrics, { k: number; x0: number; max: number }>>;
  // global configs
  decayLambda: number; // EWMA decay per epoch, e.g., 0.15
  minConfirmations: number; // confirm depth for counting events
  maxPerAddrPerEpoch: number; // cap for repetitive per-address contributions
  upvote: { minQort: number; splitQassetsPct: number; splitIssuerPct: number };
  groupRules: { mustBeAssetSpecific: boolean; mustBeNewerThanAsset: boolean };
}

export type InputsProof = {
  nodeInfo?: { height?: number; network?: string };
  ranges?: Array<
    | { name: 'trades'; fromHeight?: number; toHeight?: number; sha256?: string }
    | { name: 'holders'; asOfHeight?: number; sha256?: string }
  >;
  sampleRefs?: {
    trades?: string[]; // tx ids
    orders?: string[];
  };
};

export type QarsSnapshot = {
  schema: QarsSnapshotSchema;
  assetId: number;
  asOfHeight: number;
  asOfTimeMs: number;

  windowBlocks: number;
  weightsVersion: number;
  codeVersion: string;

  metrics: QarsMetrics;
  scoreEpoch: number; // publisher’s raw calc (we will recompute anyway)

  inputsProof?: InputsProof;

  publisher: {
    address: string;
    groupVerified: boolean;
    signature?: string; // signature over canonicalized JSON
  };
};

export type AggregatedSnapshot = {
  assetId: number;
  asOfHeight: number;
  metrics: QarsMetrics;
  scoreEpoch: number;
  source: 'ADMIN' | 'COMMUNITY';
  publishersUsed: number;
  confidence: 'high' | 'medium' | 'low';
};

export type RecentSnapshotQuery = {
  assetId: number;
  maxAgeBlocks?: number; // default 1440
  limit?: number; // default 20
};
