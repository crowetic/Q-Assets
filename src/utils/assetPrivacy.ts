import { assetPrivacyPrefix } from '../constants/qdnConstants';
import { searchSimpleByIdentifierPrefix } from './searchSimple';
import { ensureAssetMini } from '../bootstrap/assetsBootstrap';
import { getAccountNames } from './qortalApi';

export type AssetPrivacy = { isPrivate: boolean; groupId?: number; publisherName?: string };

const cache = new Map<number, AssetPrivacy>();
const ownerNamesCache = new Map<string, string[]>();
const PRIVACY_INDEX_TTL = 10 * 60_000;

type PrivacyIndexRow = { groupId: number; publisherName?: string };
let privacyIndexCache: { map: Map<number, PrivacyIndexRow>; expires: number } | null = null;
let privacyIndexPromise: Promise<Map<number, PrivacyIndexRow>> | null = null;

async function loadPrivacyIndex(): Promise<Map<number, PrivacyIndexRow>> {
  const now = Date.now();
  if (privacyIndexCache && privacyIndexCache.expires > now) {
    return privacyIndexCache.map;
  }

  if (!privacyIndexPromise) {
    privacyIndexPromise = (async () => {
      const map = new Map<number, PrivacyIndexRow>();
      try {
        const services = ['DOCUMENT', 'DOCUMENT_PRIVATE'];
        for (const service of services) {
          const hits = await searchSimpleByIdentifierPrefix(service, assetPrivacyPrefix, 0);
          for (const hit of hits) {
            const parts = hit.identifier.split('__');
            if (parts.length >= 3) {
              const assetId = Number(parts[1]);
              const groupId = Number(parts[2]);
              if (Number.isFinite(assetId) && Number.isFinite(groupId) && !map.has(assetId)) {
                const publisherName =
                  typeof hit.name === 'string' && hit.name.trim() ? hit.name.trim() : undefined;
                map.set(assetId, { groupId, publisherName });
              }
            }
          }
        }
      } catch (error) {
        console.warn('[assetPrivacy] failed to load privacy index', error);
      } finally {
        privacyIndexCache = {
          map,
          expires: Date.now() + PRIVACY_INDEX_TTL,
        };
        privacyIndexPromise = null;
      }
      return map;
    })();
  }

  return privacyIndexPromise!;
}

async function ensureOwnerNames(address: string): Promise<string[]> {
  if (ownerNamesCache.has(address)) return ownerNamesCache.get(address)!;
  try {
    const namesRes = await getAccountNames(address);
    const names = namesRes.map((n) => n.name).filter(Boolean);
    ownerNamesCache.set(address, names);
    return names;
  } catch {
    ownerNamesCache.set(address, []);
    return [];
  }
}

export async function getAssetPrivacy(
  assetId: number
  // _memberGroupIds: number[] = []
): Promise<AssetPrivacy> {
  if (assetId <= 2) return { isPrivate: false };
  if (cache.has(assetId)) return cache.get(assetId)!;

  const info: AssetPrivacy = { isPrivate: false };
  try {
    const index = await loadPrivacyIndex();
    const candidate = index.get(assetId);
    if (candidate?.groupId) {
      const mini = await ensureAssetMini(assetId);
      const owner = mini?.owner;
      const publisher = candidate.publisherName;
      if (owner && publisher) {
        const normalizedPublisher = publisher.toLowerCase();
        const ownerNames = await ensureOwnerNames(owner);
        const matches =
          ownerNames.some((n) => n.toLowerCase() === normalizedPublisher) ||
          normalizedPublisher === owner.toLowerCase();
        if (matches) {
          info.isPrivate = true;
          info.groupId = candidate.groupId;
          info.publisherName = publisher;
        }
      }
    }
  } catch {
    // Swallow; treat as public on failure
  }

  cache.set(assetId, info);
  return info;
}

export function canViewAsset(privacy: AssetPrivacy, memberGroupIds: number[]) {
  if (!privacy.isPrivate) return true;
  return privacy.groupId != null && memberGroupIds.includes(privacy.groupId);
}
