import { objectToBase64 } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
import { getAssetIdentifiers } from '../constants/qdnConstants';
import { useAuth } from 'qapp-core';

export async function publishAssetPublication(owner: string, assetName: string, pub: AssetPublication) {
  const [genPubId] = (await getAssetIdentifiers(assetName)).identifiers.genesisPost
  const data64 = await objectToBase64(pub);
  const { name: userName } = useAuth();

  if (userName != owner) return 

  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    name: userName,
    service: 'JSON',
    identifier: genPubId,
    data64,
  });
}