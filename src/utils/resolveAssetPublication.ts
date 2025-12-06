import { ensureAssetMini } from '../bootstrap/assetsBootstrap';
import { fetchAssetPublication } from './fetchAssetPublication';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
import { searchSimpleByIdentifierPrefix } from './searchSimple';

export type ResolvedPublication = {
  issuerName: string | null;
  publication: AssetPublication | null;
  privateGroupId?: number;
  isPrivate: boolean;
};

/**
 * Resolve asset publication by:
 * 1) loading mini (name/owner)
 * 2) finding publication by identifier prefix (BLOG_POST + assetId)
 * 3) matching privacy hint docs by the same publisher name to get groupId
 * 4) fetching the publication with that publisher and optional groupId
 */
export async function resolveAssetPublicationById(assetId: number): Promise<ResolvedPublication> {
  if (assetId <= 2) return { issuerName: null, publication: null, isPrivate: false };

  const mini = await ensureAssetMini(assetId);
  if (!mini?.name) return { issuerName: null, publication: null, isPrivate: false };

  let issuerName: string | null = null;
  let publisherNames: string[] = [];
  let privateGroupId: number | undefined;

  // Find publication hit by prefix
  const pubHits =
    (await searchSimpleByIdentifierPrefix('BLOG_POST', `asset${assetId}_`, 0).catch(() => [])) ||
    [];
  const pubHit = pubHits.find((h: any) => typeof h?.name === 'string');
  if (pubHit) issuerName = pubHit.name;
  publisherNames = Array.from(
    new Set(pubHits.map((h: any) => (typeof h?.name === 'string' ? h.name : null)).filter(Boolean))
  ) as string[];

  // Find privacy hint doc under same publisher
  if (issuerName) {
    try {
      const privHits = await searchSimpleByIdentifierPrefix(
        'DOCUMENT',
        `asset_privacy__${assetId}__`,
        0
      );
      const match = privHits.find(
        (h: any) => h?.name === issuerName && typeof h?.identifier === 'string'
      );
      if (match) {
        const parts = match.identifier.split('__');
        const gid = Number(parts[2]);
        if (Number.isFinite(gid)) privateGroupId = gid;
      }
    } catch {
      /* ignore */
    }
  }

  let publication: AssetPublication | null = null;
  if (issuerName) {
    publication = await fetchAssetPublication(issuerName, mini.name, assetId, {
      privateGroupId,
    }).catch(() => null);
  }
  if (publication) {
    publication = {
      ...publication,
      issuerName: publication.issuerName ?? issuerName ?? undefined,
      publisherNames:
        publication.publisherNames && publication.publisherNames.length
          ? Array.from(new Set([...(publication.publisherNames ?? []), ...publisherNames]))
          : publisherNames,
    };
  }

  return { issuerName, publication, privateGroupId, isPrivate: privateGroupId != null };
}
