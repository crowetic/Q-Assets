// src/qars/schema.ts
import { z } from "zod";

export const QarsSnapshotSchema = z.object({
  schema: z.literal("qars-snapshot@1"),
  assetId: z.number().int().nonnegative(),
  asOfHeight: z.number().int().nonnegative(),
  asOfTimeMs: z.number().int().nonnegative(),

  windowBlocks: z.number().int().positive(),
  weightsVersion: z.number().int().nonnegative(),
  codeVersion: z.string(),

  metrics: z.object({
    tradesCount: z.number().int().nonnegative(),
    volAsset: z.number().nonnegative(),
    volQort: z.number().nonnegative(),
    uniqueTraders: z.number().int().nonnegative(),
    bookDiversity: z.number().min(0).max(1),
    holdersCount: z.number().int().nonnegative(),
    holdersDelta: z.number().int(), // can be negative
    totalFeesQort: z.number().nonnegative(),
    paidUpvotes: z.number().int().nonnegative(),
    paidUpvotesQort: z.number().nonnegative(),
    issuerActivityScore: z.number().nonnegative(),
    dividendEvents: z.number().int().nonnegative(),
    dividendQortTotal: z.number().nonnegative(),
    selfDealPenalty: z.number().min(0),
    sybilPenalty: z.number().min(0),
  }),

  scoreEpoch: z.number(), // keep float per your example

  inputsProof: z.object({
    nodeInfo: z.object({
      height: z.number().int().nonnegative(),
      network: z.string(),
    }),
    ranges: z.array(
      z.union([
        z.object({
          name: z.literal("trades"),
          fromHeight: z.number().int().nonnegative(),
          toHeight: z.number().int().nonnegative(),
          sha256: z.string(),
        }),
        z.object({
          name: z.literal("holders"),
          asOfHeight: z.number().int().nonnegative(),
          sha256: z.string(),
        }),
        z.object({
          name: z.string(), // future-proof
          sha256: z.string(),
        }),
      ])
    ),
    sampleRefs: z.object({
      trades: z.array(z.string()).optional(),
      orders: z.array(z.string()).optional(),
    }).partial(),
  }),

  publisher: z.object({
    address: z.string(),
    groupVerified: z.boolean(),
    signature: z.string(),
  }),
});

export type QarsSnapshot = z.infer<typeof QarsSnapshotSchema>;
