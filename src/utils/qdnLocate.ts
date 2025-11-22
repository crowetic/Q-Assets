// src/utils/qdnLocate.ts
import { getAssetIdentifiers } from '../constants/qdnConstants';
import type { Service } from 'qapp-core';

// If your qapp-core Service type doesn’t include 'BLOG_POST', add it there;
// or keep a local augmentation somewhere central:
// type Service = 'BLOG_POST' | 'IMAGE' | 'JSON' | 'ARBITRARY_DATA' | 'ARBITRARY' | /* ... */ string;

type Kind = 'genesisPost' | 'avatar' | 'groupMeta' | 'structuredMeta';

type Located = {
  service: Service;
  identifier: string;
  source: 'canonical' | 'legacySearch';
};

const locateCache = new Map<string, Located>(); // key: `${assetId}:${kind}`

function cacheKey(assetId: number | undefined, kind: Kind) {
  return `${assetId ?? -1}:${kind}`;
}

/** Search legacy services you’ve used before for this kind. */
function legacyServicesFor(kind: Kind): Service[] {
  if (kind === 'genesisPost') return ['ARBITRARY_DATA']; // historical mis-publish
  return [];
}

/** Heuristic to match a wrong identifier that still smells like the asset. */
function matchesAssetish(id: string, assetName: string, canonicalIdentifier: string) {
  return id !== canonicalIdentifier && id.includes(`_${assetName}_`);
}

/** Resolve the correct service+identifier to fetch, with caching. */
export async function locateQdnResource(
  issuerName: string,
  assetName: string,
  assetId: number | undefined,
  kind: Kind
): Promise<Located | null> {
  const key = cacheKey(assetId, kind);
  const cached = locateCache.get(key);
  if (cached) return cached;

  const info = await getAssetIdentifiers(assetName, assetId);
  const canonicalIdentifier = info.identifiers[kind];
  const canonicalService = info.services[kind];

  // 1) Try canonical
  try {
    await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: issuerName,
      service: canonicalService,
      identifier: canonicalIdentifier,
      encoding: 'base64',
    });
    const located: Located = {
      service: canonicalService,
      identifier: canonicalIdentifier,
      source: 'canonical',
    };
    locateCache.set(key, located);
    return located;
  } catch {
    // fall through
  }

  // 2) Try legacy services (search + fetch first hit that matches)
  for (const svc of legacyServicesFor(kind)) {
    try {
      const results: any[] = await qortalRequest({
        action: 'SEARCH_QDN_RESOURCES',
        service: svc,
        name: issuerName,
        query: 'asset',
        default: false,
        includeStatus: false,
        includeMetadata: false,
        followedOnly: false,
        excludeBlocked: false,
        limit: 50,
        offset: 0,
        reverse: true,
        names: [],
        keywords: [],
        exactMatchNames: true,
        prefix: true,
      });

      const candidate = results.find(
        (r) =>
          typeof r?.identifier === 'string' &&
          matchesAssetish(r.identifier, assetName, canonicalIdentifier)
      );

      if (candidate) {
        // Verify it’s actually fetchable
        await qortalRequest({
          action: 'FETCH_QDN_RESOURCE',
          name: issuerName,
          service: svc,
          identifier: candidate.identifier,
          encoding: 'base64',
        });
        const located: Located = {
          service: svc,
          identifier: candidate.identifier,
          source: 'legacySearch',
        };
        locateCache.set(key, located);
        console.warn(`[qdnLocate] Using legacy ${svc}/${candidate.identifier} for ${key}`);
        return located;
      }
    } catch {
      // ignore and keep searching
    }
  }

  return null;
}
