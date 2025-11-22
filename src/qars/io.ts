// src/qars/io.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { QARS_QDN_SERVICE, weightsId, snapshotHeadId } from '../constants/qarsConstants';
import { DEFAULT_WEIGHTS_V1 } from './defaultWeights';
import type { QarsWeightsV1 } from '../types/qarsTypes';
import { base64ToObject, base64ToUtf8 } from '../utils/data';
// import { objectToBase64 } from '../utils/data';
import { QarsSnapshot } from '../types/qarsTypes';
import { RecentSnapshotQuery } from '../types/qarsTypes';
import { findGroupPublishersWithResource } from '../utils/access';

// ---------- Local utils ------------------------------------------------------

type QortalRequestFn = (args: any) => Promise<any>;

function getQortalRequest(): QortalRequestFn {
  // Prefer qapp-core if you use it, else global injected by Q-App runtime.
  // Adjust imports if you have a named import from 'qapp-core'.
  const g = globalThis as any;
  if (typeof g.qortalRequest === 'function') return g.qortalRequest;
  throw new Error(
    'qortalRequest is not available in global scope. Ensure Q-App runtime or export it from qapp-core.'
  );
}

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms));
}

function isTooManyUnconfirmed(err: unknown): boolean {
  const msg = (err && (err as any).message) || String(err || '');
  return /TOO[_\s-]?MANY[_\s-]?UNCONFIRMED/i.test(msg);
}

function isRateLimitedOrTransient(err: unknown): boolean {
  const msg = (err && (err as any).message) || String(err || '');
  return /(rate|429|timeout|temporar|5\d\d|network|fetch failed)/i.test(msg);
}

// ---------- QDN publish (with retries/backoff) -------------------------------

export type QdnMetadata = {
  title?: string;
  description?: string;
  tags?: string[]; // kept simple; reader can use them
  category?: string;
};

export type PublishArgs = {
  name?: string; // QDN name to publish under; undefined => current user
  service: string; // e.g., 'DOCUMENT'
  identifier: string; // our canonical id
  data64: string; // base64 payload
  metadata?: QdnMetadata;
};

export type PublishOptions = {
  maxRetries?: number; // default 5
  baseDelayMs?: number; // default 5000
  backoffFactor?: number; // default 1.8
  // if you want to auto-slow on TOO_MANY_UNCONFIRMED:
  tooManyUnconfirmedDelayMs?: number; // default 120000
};

export async function publishQdnResource(
  args: PublishArgs,
  opts: PublishOptions = {}
): Promise<any> {
  const qortalRequest = getQortalRequest();

  const {
    maxRetries = 5,
    baseDelayMs = 5000,
    backoffFactor = 1.8,
    tooManyUnconfirmedDelayMs = 120000,
  } = opts;

  let attempt = 0;
  let delay = baseDelayMs;

  // Flatten metadata fields to what your backend expects; most QDN UIs accept title/description/tags.
  const { name, service, identifier, data64, metadata } = args;

  // Core payload for PUBLISH_QDN_RESOURCE
  const basePayload: any = {
    action: 'PUBLISH_QDN_RESOURCE',
    service,
    identifier,
    data64,
  };
  if (name) basePayload.name = name;
  if (metadata?.title) basePayload.title = metadata.title;
  if (metadata?.description) basePayload.description = metadata.description;
  if (metadata?.tags) basePayload.tags = metadata.tags;
  if (metadata?.category) basePayload.category = metadata.category;

  // retry loop
  // We publish once, and on select errors we back off and retry.
  // On success, return the raw response (often contains txRef/hash/height).
  // If your environment returns something specific, adapt here.
  /* eslint-disable no-constant-condition */
  while (true) {
    try {
      const res = await qortalRequest(basePayload);
      return res;
    } catch (err) {
      attempt += 1;

      if (isTooManyUnconfirmed(err)) {
        if (attempt > maxRetries) throw err;
        // mempool pressure; slow down hard per your previous Q-Tube batching logic
        await sleep(tooManyUnconfirmedDelayMs);
        continue;
      }

      if (isRateLimitedOrTransient(err)) {
        if (attempt > maxRetries) throw err;
        await sleep(delay);
        delay = Math.floor(delay * backoffFactor);
        continue;
      }

      // Non-retryable
      throw err;
    }
  }
  /* eslint-enable no-constant-condition */
}

// Small convenience wrapper specific to QARS snapshots
export async function publishSnapshotToQdn(
  args: Omit<PublishArgs, 'service'> & { service?: string }
) {
  return publishQdnResource(
    { ...args, service: args.service || QARS_QDN_SERVICE },
    {
      // sensible defaults matching your Q-Tube throttling philosophy
      maxRetries: 6,
      baseDelayMs: 4000,
      backoffFactor: 2.0,
      tooManyUnconfirmedDelayMs: 120000, // 2 minutes
    }
  );
}

// ---------- QDN fetch (weights & generic JSON) -------------------------------

export async function fetchQdnJson<T = unknown>(params: {
  service?: string; // default DOCUMENT
  identifier: string;
  name?: string; // if weights live under a specific QDN name
  expectBase64?: boolean; // set true if your backend returns base64 as data
}): Promise<T> {
  const qortalRequest = getQortalRequest();
  const service = params.service || QARS_QDN_SERVICE;

  // Some environments return raw bytes/strings; others wrap.
  // We try a few common shapes to be resilient.
  const res = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    service,
    identifier: params.identifier,
    name: params.name,
    // If your environment supports it, you could ask for base64 up-front:
    // encoding: 'base64'
  });

  // Try to parse:
  // 1) If it's already an object, assume it's JSON.
  if (res && typeof res === 'object' && !Array.isArray(res)) {
    return res as T;
  }

  // 2) If it looks like a base64 string (common), decode & JSON.parse
  if (typeof res === 'string') {
    try {
      const s = params.expectBase64 ? base64ToObject(res) : res;
      return s as T;
    } catch {
      // maybe the string itself was base64 but expectBase64=false
      try {
        const s2 = base64ToUtf8(res);
        return JSON.parse(s2) as T;
      } catch (e2) {
        throw new Error(
          `FETCH_QDN_RESOURCE returned a string that is not valid JSON${params.expectBase64 ? ' (even after base64 decode)' : ''}.`
        );
      }
    }
  }

  // 3) If it’s a Uint8Array or Buffer-like, decode as UTF-8 JSON
  if (res && typeof (res as any).byteLength === 'number') {
    const bytes = res as Uint8Array;
    const text = new TextDecoder().decode(bytes);
    return JSON.parse(text) as T;
  }

  throw new Error('FETCH_QDN_RESOURCE returned an unsupported format');
}

export async function fetchWeights(
  version?: number,
  opts?: { name?: string }
): Promise<QarsWeightsV1> {
  // If version unspecified, try latest published id you use; else default to local.
  const v = version ?? DEFAULT_WEIGHTS_V1.version;
  const id = weightsId(v);
  try {
    const json = await fetchQdnJson<QarsWeightsV1>({
      service: QARS_QDN_SERVICE,
      identifier: id,
      name: opts?.name,
      // set to true if your QDN returns base64 content by default
      expectBase64: true,
    });

    // Very light sanity
    if (json?.version !== v) {
      // Still allow it, but warn in logs
      // eslint-disable-next-line no-console
      console.warn(`QARS: fetched weights version ${json?.version}, expected ${v}`);
    }
    return json;
  } catch (e) {
    // eslint-disable-next-line no-console
    console.warn(`QARS: failed to fetch weights ${id}, using DEFAULT_WEIGHTS_V1. Reason:`, e);
    return DEFAULT_WEIGHTS_V1;
  }
}

// ---------- Chain height -----------------------------------------------------

export async function fetchCurrentHeight(): Promise<number> {
  const qortalRequest = getQortalRequest();

  // 1) Preferred: direct API action if available in your runtime
  try {
    const h = await qortalRequest({ action: 'GET_BLOCK_HEIGHT' });
    if (typeof h === 'number' && Number.isFinite(h) && h > 0) return h;
  } catch {
    /* ignore, try next */
  }

  // 2) Fallback: admin/status (works on local Core, not in all sandboxes)
  try {
    const res = await fetch('http://127.0.0.1:12391/admin/status', { method: 'GET' });
    if (res.ok) {
      const j = await res.json();
      if (typeof j?.height === 'number') return j.height;
    }
  } catch {
    /* ignore, last fallback */
  }

  throw new Error('Unable to determine current block height via Qortal APIs');
}

async function fetchHeadSnapshotFor(
  assetId: number,
  publisherName: string
): Promise<QarsSnapshot | null> {
  try {
    const id = snapshotHeadId(assetId);
    const snap = await fetchQdnJson<QarsSnapshot>({
      service: QARS_QDN_SERVICE,
      identifier: id,
      name: publisherName,
      expectBase64: true,
    });
    return snap ?? null;
  } catch {
    return null;
  }
}

/**
 * v1: only allow publishers from the Q-Assets-Management group.
 * Admins are fetched first (priority), then members.
 */
export async function listRecentSnapshots(query: RecentSnapshotQuery): Promise<QarsSnapshot[]> {
  const { assetId, maxAgeBlocks = 1440, limit = 20 } = query;
  const identifier = snapshotHeadId(assetId);

  // publishers ordered: admins newest→oldest, then members newest→oldest
  const candidates = await findGroupPublishersWithResource(identifier);
  if (!candidates.length) return [];

  // Pull their HEAD snapshots
  const snaps = await Promise.all(candidates.map((c) => fetchHeadSnapshotFor(assetId, c.name)));
  const defined = snaps.filter((s): s is QarsSnapshot => !!s);
  if (!defined.length) return [];

  const nowHeight = Math.max(...defined.map((s) => s.asOfHeight));
  const recent = defined
    .filter((s) => nowHeight - s.asOfHeight <= maxAgeBlocks)
    .sort((a, b) => b.asOfHeight - a.asOfHeight)
    .slice(0, limit);

  return recent;
}
