
import { getAssetIdentifiers } from '../constants/qdnConstants';

export async function fetchAssetAvatar(issuerName: string, assetName: string): Promise<string | null> {
  const [avatarId] = (await getAssetIdentifiers(assetName)).identifiers.avatar
  try {
    const result = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: issuerName,
      service: 'IMAGE',
      identifier: avatarId,
      encoding: 'base64',
    });

    return `data:image/png;base64,${result}`;
  } catch (err) {
    console.warn(`No avatar found for ${issuerName}`, err);
    return null;
  }
}
