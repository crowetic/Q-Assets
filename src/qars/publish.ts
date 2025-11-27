// src/qars/publish.ts
import { publishSnapshotToQdn, fetchWeights, fetchCurrentHeight } from './io';
import { collectMetrics } from './compute';
// import { scoreEpoch } from './weights';
import { buildQarsSnapshot } from './builder';
// import type { QarsSnapshot } from '../types/qarsTypes';
import {
  // qarsSnapshotSchema,
  APP_QARS_CODE_VERSION,
  snapshotHeadId,
  snapshotEpochId,
  QARS_QDN_SERVICE,
  QASSETS_OWNER_NAME, // optional: publish under app-owned name
  QARS_SCHEMA_VERSION, // for tags/metadata
} from '../constants/qarsConstants';
import { objectToBase64 } from '../utils/data';

// --- Optional: plug your own JSON canonicalizer & signer here ---------------
function canonicalizeJson(obj: unknown): string {
  // Simple, stable JSON stringify: sorts object keys recursively.
  // If you already have a canonicalizer in your toolkit, use that instead.
  const seen = new WeakSet();
  const stable = (x: any): any => {
    if (x && typeof x === 'object') {
      if (seen.has(x)) throw new TypeError('Circular structure');
      seen.add(x);

      if (Array.isArray(x)) return x.map(stable);

      const out: Record<string, any> = {};
      for (const k of Object.keys(x).sort()) out[k] = stable(x[k]);
      return out;
    }
    return x;
  };
  return JSON.stringify(stable(obj));
}

// Hook for your local signer. Return a hex/base64 sig or undefined to skip.
async function signJsonIfAvailable(_payloadCanonical: string): Promise<string | undefined> {
  console.log(_payloadCanonical);
  // TODO: wire to your existing local signer (Qortal API Toolkit, etc.)
  return undefined;
}

// ---- Main -------------------------------------------------------------------
export async function computeAndPublishQars(params: {
  assetId: number;
  windowBlocks?: number; // default 2880 (~2 days)
  weightsVersion?: number; // default latest (pass explicitly if you want older)
  publisher: { address: string; groupVerified?: boolean; qdnNameOverride?: string };
  publishHistory?: boolean; // also publish per-epoch record (default true)
}) {
  const { assetId, publisher, publishHistory = true } = params;

  const windowBlocks = params.windowBlocks ?? 2880;
  const weightsVersion = params.weightsVersion ?? 1;

  const asOfHeight = await fetchCurrentHeight();
  const asOfTimeMs = Date.now();

  // Collect + score
  const { metrics, inputsProof } = await collectMetrics({ assetId, windowBlocks });
  const weights = await fetchWeights(weightsVersion);
  // const s = scoreEpoch(metrics, weights);

  const nodeInfo = ensureNodeInfo(inputsProof?.nodeInfo, asOfHeight);

  // // Build snapshot (schema and version are strict via Option B typing)
  // const snapshot: QarsSnapshot = {
  //   schema: qarsSnapshotSchema(),   // e.g. `qars-snapshot@${QARS_SCHEMA_VERSION}`
  //   assetId,
  //   asOfHeight,
  //   asOfTimeMs,
  //   windowBlocks,
  //   weightsVersion,                 // <-- honor the caller / resolved version
  //   codeVersion: APP_QARS_CODE_VERSION,
  //   metrics,
  //   scoreEpoch: s,
  //   inputsProof,
  //   publisher: {
  //     address: publisher.address,
  //     groupVerified: !!publisher.groupVerified,
  //     signature: undefined,
  //   },
  // };

  function ensureNodeInfo(
    candidate: { height?: number; network?: string } | undefined,
    fallbackHeight: number
  ): { height: number; network: string } {
    const height =
      typeof candidate?.height === 'number' && Number.isFinite(candidate.height)
        ? candidate.height
        : fallbackHeight;

    const rawNet = candidate?.network;
    const network = rawNet && typeof rawNet === 'string' && rawNet.trim() ? rawNet : 'main'; // or await fetchNodeInfo().network if you prefer

    return { height, network };
  }

  const snapshot = buildQarsSnapshot(
    {
      assetId,
      asOfHeight,
      asOfTimeMs,
      windowBlocks,
      weightsVersion,
      codeVersion: APP_QARS_CODE_VERSION,
      nodeInfo,
    },
    metrics as any, // MetricsInput aligns with your QarsMetrics keys
    { ranges: inputsProof.ranges, sampleRefs: inputsProof.sampleRefs },
    { address: publisher.address, groupVerified: !!publisher.groupVerified },
    weights // let builder compute scoreEpoch with the same weights
  );

  // Optional signing (over canonical JSON)
  const canonical = canonicalizeJson(snapshot);
  const sig = await signJsonIfAvailable(canonical);
  if (sig) snapshot.publisher.signature = sig;

  // Identifiers
  const headIdentifier = snapshotHeadId(assetId);
  const epochIdentifier = snapshotEpochId(assetId, asOfHeight);

  // Choose publishing name:
  //  - explicit override from caller takes precedence
  //  - else use app-owned name if provided (QASSETS_OWNER_NAME)
  //  - else undefined => publish as current user context
  const publishName = publisher.qdnNameOverride ?? QASSETS_OWNER_NAME ?? undefined;

  // Common metadata (helps discovery & admin/community arbitration logic)
  const metadata = {
    title: `QARS Snapshot for Asset ${assetId} @ h=${asOfHeight}`,
    description: `QARS v${QARS_SCHEMA_VERSION} snapshot | weights v${weightsVersion} | window ${windowBlocks} blocks`,
    tags: [
      'qars',
      `asset:${assetId}`,
      `schema:qars-snapshot@${QARS_SCHEMA_VERSION}`,
      `weights:v${weightsVersion}`,
      publisher.groupVerified ? 'publisher:admin' : 'publisher:community',
    ],
    // optional: category or custom fields if your reader uses them
  };

  // HEAD publish (latest pointer)
  const snapshot64 = await objectToBase64(snapshot);
  const headPublishRef = await publishSnapshotToQdn({
    name: publishName,
    service: QARS_QDN_SERVICE, // 'DOCUMENT'
    identifier: headIdentifier,
    data64: snapshot64,
    metadata,
  });

  // Historical publish (immutable per-epoch record)
  let epochPublishRef: unknown = null;
  if (publishHistory) {
    epochPublishRef = await publishSnapshotToQdn({
      name: publishName,
      service: QARS_QDN_SERVICE,
      identifier: epochIdentifier,
      data64: snapshot64,
      metadata: {
        ...metadata,
        title: `QARS Snapshot (historical) for Asset ${assetId} @ h=${asOfHeight}`,
        tags: [...metadata.tags, 'kind:historical'],
      },
    });
  }

  return {
    assetId,
    asOfHeight,
    headIdentifier,
    epochIdentifier: publishHistory ? epochIdentifier : undefined,
    headPublishRef,
    epochPublishRef,
    snapshot,
  };
}
