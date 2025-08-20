import { objectToBase64 } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
import { getAssetIdentifiers } from '../constants/qdnConstants';
import { useAuth } from 'qapp-core';


export const publishAssetPublication = async (owner: string, assetName: string, pub: AssetPublication) => {
  const publishInfo = await getAssetIdentifiers(assetName)
  const identifier = publishInfo.identifiers.genesisPost 
  const service = publishInfo.services.genesisPost
  const data64 = await objectToBase64(pub);
  const { name } = useAuth();

  if (name != owner) return 

  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    name,
    service,
    identifier,
    data64,
  });
}