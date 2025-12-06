import { assetPrivacyPrefix } from '../constants/qdnConstants';
import { searchSimpleNameIdPrefix } from './searchSimple';
import { ensureAssetMini } from '../bootstrap/assetsBootstrap';
import { getAccountNames } from './qortalApi';

export type AssetPrivacy = { isPrivate: boolean; groupId?: number; publisherName?: string };

const cache = new Map<string, AssetPrivacy>();

export async function getAssetPrivacy(
  assetId: number,
  memberGroupIds: number[] = []
): Promise<AssetPrivacy> {
  if (assetId <= 2) return { isPrivate: false };
  const key = `${assetId}:${memberGroupIds
    .slice()
    .sort((a, b) => a - b)
    .join(',')}`;
  if (cache.has(key)) return cache.get(key)!;

  try {
    const mini = await ensureAssetMini(assetId);
    let groupId: number | undefined;

    if (mini?.owner) {
      try {
        const namesRes = await getAccountNames(mini.owner);
        const names: string[] = namesRes.map((n) => n.name).filter(Boolean);
        for (const nm of names) {
          try {
            const hits = await searchSimpleNameIdPrefix(`${assetPrivacyPrefix}${assetId}__`, nm);
            const hit = hits.find(
              (h) => typeof h.identifier === 'string' && names.includes(h.name)
            );
            if (hit) {
              const parts = hit.identifier.split('__');
              const gid = Number(parts[2]);
              if (Number.isFinite(gid)) {
                groupId = gid;
                break;
              }
            }
          } catch {
            /* ignore and continue */
          }
        }
      } catch {
        /* ignore */
      }
    }

    const isPrivate = groupId != null;
    const info: AssetPrivacy = { isPrivate, groupId };
    cache.set(key, info);
    return info;
  } catch {
    const info: AssetPrivacy = { isPrivate: false };
    cache.set(key, info);
    return info;
  }
}

export function canViewAsset(privacy: AssetPrivacy, memberGroupIds: number[]) {
  if (!privacy.isPrivate) return true;
  return privacy.groupId != null && memberGroupIds.includes(privacy.groupId);
}
