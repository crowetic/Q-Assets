import {  getAssetIdentifiers } from '../constants/qdnConstants';
import { base64ToObject } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';


export async function fetchAssetPublication(issuerName: string, assetName: string): Promise<AssetPublication | null> {
  const [genesisId] = (await getAssetIdentifiers(assetName)).identifiers.genesisPost
  try {
    const response = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: issuerName,
      service: 'JSON',
      identifier: genesisId, // or `ASSET_META_${assetId}` if that’s your convention
      encoding: 'base64',
    });

    return base64ToObject(response.data) as AssetPublication;
  } catch (err) {
    console.warn(`[fetchAssetPublication] No structured metadata found for ${issuerName}/${assetName}`);
    return null;
  }
}