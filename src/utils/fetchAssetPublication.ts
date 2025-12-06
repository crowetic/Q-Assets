import { getAssetIdentifiers } from '../constants/qdnConstants';
import { base64ToObject } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
// Note: private publications are encrypted payloads on the same service (e.g., BLOG_POST)

export const fetchAssetPublication = async (
  name: string,
  assetName: string,
  assetId?: number,
  opts?: { privateGroupId?: number }
): Promise<AssetPublication | null> => {
  const publishInfo = await getAssetIdentifiers(assetName, assetId);

  const decryptGroupId =
    opts?.privateGroupId != null && Number.isFinite(opts.privateGroupId)
      ? Number(opts.privateGroupId)
      : undefined;

  const fetchRaw = async (service: any, identifier: string) => {
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name,
      service,
      identifier,
      encoding: 'base64',
    });
    return res?.data64 ?? res;
  };

  const tryDecode = async (payload: any) => {
    if (!payload) return null;
    const parsed = await base64ToObject(payload).catch(() => null);
    if (parsed?.description || parsed?.issuerName || parsed?.publisherNames) {
      return {
        ...(parsed as AssetPublication),
        issuerName: (parsed as AssetPublication).issuerName ?? name,
        publisherNames: (parsed as AssetPublication).publisherNames ?? [name],
      };
    }

    if (decryptGroupId != null) {
      try {
        const decrypted = await qortalRequest({
          action: 'DECRYPT_QORTAL_GROUP_DATA',
          base64: payload,
          groupId: decryptGroupId,
          isAdmins: false,
        });
        const pub = await base64ToObject(decrypted).catch(() => null);
        if (pub) {
          return {
            ...(pub as AssetPublication),
            issuerName: (pub as AssetPublication).issuerName ?? name,
            publisherNames: (pub as AssetPublication).publisherNames ?? [name],
          };
        }
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  const order: any[] = [publishInfo.services.genesisPost];

  for (const svc of order) {
    try {
      const raw = await fetchRaw(svc, publishInfo.identifiers.genesisPost);
      const pub = await tryDecode(raw);
      if (pub) return pub;
    } catch {
      /* try next */
    }
  }

  console.warn(`No publication for correct ID ${assetId}. Trying fallback search...`);

  // Fallback: search for anything resembling the asset name
  const results = await qortalRequest({
    action: 'SEARCH_QDN_RESOURCES',
    service: publishInfo.services.genesisPost,
    name,
    query: 'asset',
    default: false,
    includeStatus: false,
    includeMetadata: false,
    followedOnly: false,
    excludeBlocked: false,
    limit: 20,
    offset: 0,
    reverse: true,
    names: [],
    keywords: [],
    exactMatchNames: true,
    prefix: true,
  });

  // Optional: try to find something that at least matches the asset name in the identifier
  const match = results.find(
    (r: any) => typeof r.identifier === 'string' && r.identifier.includes(`_${assetName}_`)
  );

  if (match) {
    console.warn(`Found possible wrong-ID match: ${match.identifier}`);
    try {
      const response = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name,
        service: match.service,
        identifier: match.identifier,
        encoding: 'base64',
      });

      const parsed = await base64ToObject(response);
      if (parsed) {
        return {
          ...(parsed as AssetPublication),
          issuerName: (parsed as AssetPublication).issuerName ?? name,
          publisherNames: (parsed as AssetPublication).publisherNames ?? [name],
        };
      }
      return null;
    } catch {
      console.warn(`Fallback match failed to fetch.`);
      return null;
    }
  }

  return null;
};
