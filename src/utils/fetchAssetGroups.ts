import { getAssetIdentifiers } from '../constants/qdnConstants';
import { AssetGroupMetadata } from '../types/AssetPublicationMetadata';

export async function fetchAssetGroupMetadata(issuerName: string, assetName: string): Promise<AssetGroupMetadata | null> {

  const [groupsId] = (await getAssetIdentifiers(assetName)).identifiers.groupMeta
  try {
    const result = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: issuerName,
      service: 'JSON',
      identifier: groupsId,
    });

    return typeof result === 'string' ? JSON.parse(result) : result;
  } catch (err) {
    console.warn('Group metadata not found or failed to load:', err);
    return null;
  }
}
