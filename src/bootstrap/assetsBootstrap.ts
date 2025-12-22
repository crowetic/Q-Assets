// Lightweight bootstrap for assets metadata used across pages (Portfolio, etc.)

import { getAllAssets, getAssetInfo } from '../utils/qortalAssetRequests';
import type { Asset } from '../pages/AssetExplorer';
import { ASSETS_KEY, Q_ASSET_APP_VERSION } from '../constants/qdnConstants';

export type AssetsIndex = Record<number, Asset>;

interface CacheShape {
  v: number; // schema version
  t: number; // updatedAt (ms)
  index: AssetsIndex;
}

const LS_KEY = ASSETS_KEY;
const SCHEMA_VERSION = Q_ASSET_APP_VERSION;
const MIN_INDEX_ASSET_COUNT = 10;

// Reasonable default TTL - tweak as you like.
const DEFAULT_TTL_MS = 10 * 60 * 1000; // 10 minutes

function now() {
  return Date.now();
}

function readCache(): CacheShape | null {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CacheShape;
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.v !== SCHEMA_VERSION) return null;
    if (!parsed.index || typeof parsed.index !== 'object') return null;
    if (Object.keys(parsed.index).length < MIN_INDEX_ASSET_COUNT) {
      localStorage.removeItem(LS_KEY);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

function writeCache(index: AssetsIndex) {
  const payload: CacheShape = { v: SCHEMA_VERSION, t: now(), index };
  localStorage.setItem(LS_KEY, JSON.stringify(payload));
}

function isFresh(cache: CacheShape, ttlMs: number) {
  return now() - cache.t < ttlMs;
}

/**
 * Build AssetsIndex from getAllAssets()
 */
async function fetchAssetsIndex(): Promise<AssetsIndex> {
  const raw = await getAllAssets(true, 0, 0); // your existing helper (full list)
  const index: AssetsIndex = {};
  for (const a of raw) {
    index[a.assetId] = {
      assetId: a.assetId,
      name: a.name,
      quantity: a.quantity,
      isDivisible: a.isDivisible,
      isUnspendable: a.isUnspendable,
      owner: a.owner,
      description: a.description,
    };
  }
  return index;
}

/**
 * Ensure AssetsIndex is available quickly:
 * - Return cache immediately if fresh.
 * - Otherwise do a network fetch; if cache exists but stale, return cache and refresh in background.
 */
export async function ensureAssetsIndexLoaded(opts?: {
  ttlMs?: number;
  force?: boolean;
}): Promise<AssetsIndex> {
  const ttl = opts?.ttlMs ?? DEFAULT_TTL_MS;
  const force = !!opts?.force;

  const cached = readCache();

  if (!force && cached && isFresh(cached, ttl)) {
    return cached.index;
  }

  if (!force && cached) {
    // Stale-but-present: kick off background refresh, return stale immediately
    void fetchAssetsIndex()
      .then((idx) => writeCache(idx))
      .catch(() => {
        /* ignore background errors */
      });
    return cached.index;
  }

  // No cache or force refresh
  const idx = await fetchAssetsIndex();
  writeCache(idx);
  return idx;
}

/** Synchronous read (best-effort) so components can render instantly */
export function readAssetsIndexSync(): AssetsIndex | null {
  const c = readCache();
  return c?.index ?? null;
}

export async function ensureAssetMini(assetId: number): Promise<Asset | null> {
  const cached = readCache();
  if (cached?.index?.[assetId]) return cached.index[assetId];

  try {
    const a = await getAssetInfo({ assetId });
    const mini: Asset = {
      assetId: a.assetId,
      name: a.name,
      owner: a.owner,
      description: a.description,
      isDivisible: a.isDivisible,
      isUnspendable: a.isUnspendable,
      quantity: a.quantity,
    };
    const next = { ...(cached?.index ?? {}), [assetId]: mini };
    writeCache(next);
    return mini;
  } catch {
    return null;
  }
}
