// src/qars/builder.ts
import type { InputsProof, QarsMetrics, QarsSnapshot, QarsWeightsV1 } from '../types/qarsTypes';
import { scoreEpoch } from './weights';

export interface BuildContext {
  assetId: number;
  asOfHeight: number;
  asOfTimeMs?: number;
  windowBlocks: number;
  weightsVersion: number;
  codeVersion: string;
  nodeInfo?: { height: number; network: string };
}

export interface MetricsInput {
  tradesCount: number;
  volAsset: number;
  volQort: number;
  uniqueTraders: number;
  bookDiversity?: number; // optional matches your QarsMetrics
  holdersCount: number;
  holdersDelta: number;
  totalFeesQort: number;
  paidUpvotes: number;
  paidUpvotesQort: number;
  issuerActivityScore: number;
  dividendEvents: number;
  dividendQortTotal: number;
  selfDealPenalty: number;
  sybilPenalty: number;
}

// export interface InputsProofInput {
//   ranges?: QarsSnapshot["inputsProof"] extends { ranges: infer R } ? R : QarsSnapshot["inputsProof"];
//   sampleRefs?: QarsSnapshot["inputsProof"] extends { sampleRefs: infer S } ? S : QarsSnapshot["inputsProof"];
// }

export type InputsProofInput = {
  ranges?: InputsProof['ranges']; // Array<...> | undefined
  sampleRefs?: InputsProof['sampleRefs']; // { trades?: string[]; orders?: string[] } | undefined
};

export interface PublisherInput {
  address: string;
  groupVerified: boolean;
  signature?: string;
}

const ZERO_METRICS: QarsMetrics = {
  // Market
  tradesCount: 0,
  volAsset: 0,
  volQort: 0,
  uniqueTraders: 0,
  bookDiversity: 0,

  // Holders
  holdersCount: 0,
  holdersDelta: 0,
  holderRegularity: 0,

  // Transfers
  userTransfers: 0,
  transferRegularity: 0,

  // Dividends
  dividendEvents: 0,
  dividendQortTotal: 0,

  // Fees / contribution
  totalFeesQort: 0,
  burnsQort: 0,

  // Community/QDN
  newsPosts: 0,
  newsComments: 0,
  paidUpvotes: 0,
  paidUpvotesQort: 0,
  groupMembers: 0,
  communityRegularity: 0,

  // Issuer/Admin
  issuerActivityScore: 0,

  // Anti-gaming
  selfDealPenalty: 0,
  sybilPenalty: 0,
};

function toFullMetrics(p: MetricsInput): QarsMetrics {
  // explicitly coalesce the one optional in your type
  return {
    ...ZERO_METRICS,
    ...p,
    bookDiversity: p.bookDiversity ?? 0,
  };
}

// ---- builder ---------------------------------------------------------------
export function buildQarsSnapshot(
  ctx: BuildContext,
  metricsPartial: MetricsInput,
  proof: InputsProofInput | undefined,
  publisher: PublisherInput,
  weights?: QarsWeightsV1
): QarsSnapshot {
  const metrics = toFullMetrics(metricsPartial);
  const score = weights ? scoreEpoch(metrics, weights) : 0;

  return {
    schema: `qars-snapshot@1`,
    assetId: ctx.assetId,
    asOfHeight: ctx.asOfHeight,
    asOfTimeMs: ctx.asOfTimeMs ?? Date.now(),
    windowBlocks: ctx.windowBlocks,
    weightsVersion: ctx.weightsVersion,
    codeVersion: ctx.codeVersion,
    metrics,
    scoreEpoch: score,
    inputsProof: {
      nodeInfo: ctx.nodeInfo,
      ranges: proof?.ranges,
      sampleRefs: proof?.sampleRefs,
    },
    publisher,
  };
}
