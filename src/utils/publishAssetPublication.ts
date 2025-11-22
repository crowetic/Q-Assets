import { objectToBase64 } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
import { getAssetIdentifiers } from '../constants/qdnConstants';
// import { useAuth } from 'qapp-core';

export const publishAssetPublication = async (
  owner: string,
  assetName: string,
  pub: AssetPublication
) => {
  if (!owner) throw new Error('ownerName is required');
  if (!assetName) throw new Error('assetName is required');

  const publishInfo = await getAssetIdentifiers(assetName);
  const identifier = publishInfo.identifiers.genesisPost;
  const service = publishInfo.services.genesisPost;
  const data64 = await objectToBase64(pub);

  try {
    await qortalRequest({
      action: 'PUBLISH_QDN_RESOURCE',
      name: owner,
      service,
      identifier,
      data64,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    throw new Error(`PUBLISH_QDN_RESOURCE (publishAssetPublication) failed: ${msg}`);
  }
};
