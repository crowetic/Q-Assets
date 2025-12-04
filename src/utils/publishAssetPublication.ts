import { objectToBase64 } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
import { getAssetIdentifiers } from '../constants/qdnConstants';
import { addPrivateMagic } from '../constants/qdeckIdentifiers';

export const publishAssetPublication = async (
  owner: string,
  assetName: string,
  pub: AssetPublication,
  opts?: { privateGroupId?: number }
) => {
  if (!owner) throw new Error('ownerName is required');
  if (!assetName) throw new Error('assetName is required');

  const publishInfo = await getAssetIdentifiers(assetName);
  const identifier = publishInfo.identifiers.genesisPost;
  const baseService = publishInfo.services.genesisPost;
  const data64 = await objectToBase64(pub);

  const isPrivate = Number.isFinite(opts?.privateGroupId);
  const service = isPrivate ? ('DOCUMENT_PRIVATE' as const) : baseService;
  let finalData = data64;

  if (isPrivate && opts?.privateGroupId != null) {
    const encrypted = await qortalRequest({
      action: 'ENCRYPT_QORTAL_GROUP_DATA',
      base64: data64,
      groupId: opts.privateGroupId,
      isAdmins: false,
    });
    finalData = addPrivateMagic(encrypted);
  }

  try {
    await qortalRequest({
      action: 'PUBLISH_QDN_RESOURCE',
      name: owner,
      service,
      identifier,
      data64: finalData,
    });
  } catch (e: any) {
    const msg = e?.message || String(e);
    throw new Error(`PUBLISH_QDN_RESOURCE (publishAssetPublication) failed: ${msg}`);
  }
};
