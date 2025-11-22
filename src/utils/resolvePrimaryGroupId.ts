// utils/resolvePrimaryGroupId.ts
import { resolveAssetPublicationById } from './resolveAssetPublication';

export async function resolvePrimaryGroupId(assetId: number): Promise<number | null> {
  // base assets are skipped
  if (assetId === 0 || assetId === 1 || assetId === 2) return null;

  const cacheKey = `asset:${assetId}:primaryGroupId`;
  const cached = localStorage.getItem(cacheKey);
  if (cached != null) {
    const n = Number(cached);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  const { publication } = await resolveAssetPublicationById(assetId);
  const raw = publication?.primaryGroup?.id;
  const n = Number(raw);
  if (Number.isFinite(n) && n > 0) {
    localStorage.setItem(cacheKey, String(n));
    return n;
  }

  localStorage.setItem(cacheKey, '');
  return null;
}
