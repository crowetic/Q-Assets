import {  getAssetIdentifiers } from '../constants/qdnConstants';
import { base64ToObject } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';


export const fetchAssetPublication = async (name: string, assetName: string, assetId?: number): Promise<AssetPublication | null> => {
  const publishInfo = await getAssetIdentifiers(assetName, assetId);

  // Try correct, ID-based identifier first
  try {
    const pub = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name,
      service: publishInfo.services.genesisPost,
      identifier: publishInfo.identifiers.genesisPost,
    });

    return await base64ToObject(pub);
  } catch {
    console.warn(`No publication for correct ID ${assetId}. Trying fallback search...`);
  }

  // Fallback: search for anything resembling the asset name
  const results = await qortalRequest({
    action: "SEARCH_QDN_RESOURCES",
    service: publishInfo.services.genesisPost,
    name,
    query: "asset", 
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
  const match = results.find((r: any) =>
    typeof r.identifier === 'string' &&
    r.identifier.includes(`_${assetName}_`)
  );

  if (match) {
    console.warn(`Found possible wrong-ID match: ${match.identifier}`);
    try {
      const response = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name,
        service: match.service,
        identifier: match.identifier,
        encoding: 'base64'
      });

      return await base64ToObject(response)
    } catch {
      console.warn(`Fallback match failed to fetch.`);
      return null;
    }
  }

  return null;
}


