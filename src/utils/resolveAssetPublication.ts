// utils/resolveAssetPublication.ts
import { ensureAssetMini } from '../bootstrap/assetsBootstrap';
import { getPrimaryAccountName } from '../utils/qortalApi';
import { fetchAssetPublication } from './fetchAssetPublication';
import type { AssetPublication } from '../types/AssetPublicationMetadata';

/**
 * Resolve AssetPublication for a given assetId by:
 *  1) bootstrap -> {name, owner}
 *  2) owner address -> issuer primary name
 *  3) (issuerName, assetName) -> publication
 *
 * Caches issuerName and pub pointer locally for speed.
 */
export async function resolveAssetPublicationById(
  assetId: number
): Promise<{ issuerName: string | null; publication: AssetPublication | null }> {
  // Base assets: skip (by your rule)
  if (assetId === 0 || assetId === 1 || assetId === 2) {
    return { issuerName: null, publication: null };
  }

  const mini = await ensureAssetMini(assetId);
  if (!mini?.name || !mini?.owner) {
    return { issuerName: null, publication: null };
  }

  const cacheIssuerKey = `asset:${assetId}:issuerPrimaryName`;
  const cachePubKey = `asset:${assetId}:pub:lastOkId`;

  // 1) issuer primary name
  let issuerName: string | null = null;
  const cachedIssuer = localStorage.getItem(cacheIssuerKey);
  if (cachedIssuer !== null) {
    issuerName = cachedIssuer || null;
  } else {
    try {
      const nm = await getPrimaryAccountName(mini.owner);
      issuerName = nm || null;
    } catch {
      issuerName = null;
    }
    localStorage.setItem(cacheIssuerKey, issuerName ?? '');
  }

  // 2) fetch publication
  let publication: AssetPublication | null = null;
  if (issuerName) {
    publication = await fetchAssetPublication(issuerName, mini.name);
  }

  if (publication) {
    localStorage.setItem(cachePubKey, '1');
  }

  return { issuerName, publication };
}
