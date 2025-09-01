// utils/resolveAssetName.ts
import { readAssetsIndexSync, ensureAssetMini } from '../bootstrap/assetsBootstrap';

/**
 * Resolve an asset's display name *via* the bootstrap cache first,
 * then a single-asset fetch fallback that also refreshes the cache.
 */
export async function resolveAssetName(assetId: number): Promise<string | null> {
  // 1) synchronous cache read for fast path
  const idx = readAssetsIndexSync();
  if (idx?.[assetId]?.name) return idx[assetId].name;

  // 2) background mini fetch; this updates the bootstrap cache itself
  const mini = await ensureAssetMini(assetId);
  return mini?.name ?? null;
}
