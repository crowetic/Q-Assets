import { getAssetIdentifiers } from '../constants/qdnConstants';
import { base64ToObject } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
import { Service } from 'qapp-core';

/**
 * Fetch an asset publication. If privateGroupId is provided, we decrypt before parsing.
 * We first try the canonical identifier from getAssetIdentifiers(assetName, assetId).
 * If that fails, we do a fallback SEARCH_QDN_RESOURCES for identifiers containing the asset name.
 */
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

  const normalize = (pub: any): AssetPublication | null =>
    pub
      ? {
          ...(pub as AssetPublication),
          issuerName: (pub as AssetPublication).issuerName ?? name,
          publisherNames: (pub as AssetPublication).publisherNames ?? [name],
        }
      : null;

  const safeBase64ToObject = async (b64: string) => {
    try {
      return await base64ToObject(b64);
    } catch {
      try {
        const padded = b64.padEnd(b64.length + ((4 - (b64.length % 4)) % 4), '=');
        return await base64ToObject(padded);
      } catch {
        return null;
      }
    }
  };

  const decode = async (base64: string) => {
    const parsed = await safeBase64ToObject(base64);
    const direct = normalize(parsed);
    if (direct) return direct;

    if (decryptGroupId != null) {
      try {
        const decrypted = await qortalRequest({
          action: 'DECRYPT_QORTAL_GROUP_DATA',
          base64,
          groupId: decryptGroupId,
          isAdmins: false,
        });
        const decryptedParsed = await safeBase64ToObject(decrypted);
        const fromDecrypt = normalize(decryptedParsed);
        if (fromDecrypt) return fromDecrypt;
      } catch {
        /* ignore */
      }
    }
    return null;
  };

  const fetchAndDecode = async (service: Service, identifier: string) => {
    // console.log(
    //   'passed to fetchAndDecode in fetchAssetPublication',
    //   service,
    //   'identifier',
    //   identifier
    // );
    const raw = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name,
      service,
      identifier,
      encoding: 'base64',
    });
    const base64Payload =
      typeof raw === 'string'
        ? raw
        : raw && typeof raw === 'object' && typeof (raw as any).data64 === 'string'
          ? (raw as any).data64
          : null;
    // console.log('base64Payload', base64Payload);
    if (!base64Payload) return null;
    return decode(base64Payload);
  };

  // 1) Try canonical identifier
  const primary = await fetchAndDecode(
    publishInfo.services.genesisPost,
    publishInfo.identifiers.genesisPost
  );
  if (primary) return primary;

  console.warn(`No publication for ${assetName} (id ${assetId}). Trying fallback search...`);

  // 2) Fallback: search for anything resembling the asset name
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

  const match = results.find(
    (r: any) => typeof r.identifier === 'string' && r.identifier.includes(`_${assetName}_`)
  );

  if (match) {
    console.warn(`Found possible wrong-ID match: ${match.identifier}`);
    try {
      return await fetchAndDecode(match.service, match.identifier);
    } catch {
      console.warn(`Fallback match failed to fetch/decode.`);
      return null;
    }
  }

  return null;
};
