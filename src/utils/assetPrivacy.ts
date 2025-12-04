import { resolveAssetPublicationById } from './resolveAssetPublication';

export type AssetPrivacy = { isPrivate: boolean; groupId?: number };

const cache = new Map<number, AssetPrivacy>();

export async function getAssetPrivacy(assetId: number): Promise<AssetPrivacy> {
  if (assetId <= 2) return { isPrivate: false };
  if (cache.has(assetId)) return cache.get(assetId)!;

  try {
    const { publication } = await resolveAssetPublicationById(assetId);
    const rawGroup = publication?.privateGroupId ?? publication?.primaryGroup?.id;
    const groupId =
      rawGroup != null && Number.isFinite(Number(rawGroup)) ? Number(rawGroup) : undefined;
    const info: AssetPrivacy = { isPrivate: Boolean(publication?.privateAsset), groupId };
    cache.set(assetId, info);
    return info;
  } catch {
    const info: AssetPrivacy = { isPrivate: false };
    cache.set(assetId, info);
    return info;
  }
}

export function canViewAsset(privacy: AssetPrivacy, memberGroupIds: number[]) {
  if (!privacy.isPrivate) return true;
  return privacy.groupId != null && memberGroupIds.includes(privacy.groupId);
}
