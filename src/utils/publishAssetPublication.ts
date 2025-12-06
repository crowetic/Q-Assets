import { objectToBase64 } from './data';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
import { getAssetIdentifiers, assetPrivacyId } from '../constants/qdnConstants';

export const publishAssetPublication = async (
  owner: string,
  assetName: string,
  pub: AssetPublication,
  opts?: { privateGroupId?: number; assetId?: number }
) => {
  if (!owner) throw new Error('ownerName is required');
  if (!assetName) throw new Error('assetName is required');

  const publishInfo = await getAssetIdentifiers(assetName);
  const identifier = publishInfo.identifiers.genesisPost;
  const baseService = publishInfo.services.genesisPost;
  const dedupedPublishers = Array.from(new Set([...(pub.publisherNames ?? []), owner]));
  const payload: AssetPublication = {
    ...pub,
    issuerName: pub.issuerName ?? owner,
    publisherNames: dedupedPublishers,
  };

  const data64 = await objectToBase64(payload);

  const isPrivate = Number.isFinite(opts?.privateGroupId);
  const service = baseService; // keep original service (BLOG_POST), encrypted payload carries privacy
  let finalData = data64;

  if (isPrivate && opts?.privateGroupId != null) {
    const encrypted = await qortalRequest({
      action: 'ENCRYPT_QORTAL_GROUP_DATA',
      base64: data64,
      groupId: opts.privateGroupId,
      isAdmins: false,
    });
    finalData = (encrypted as any)?.data64 ?? encrypted;
  }

  try {
    await qortalRequest({
      action: 'PUBLISH_QDN_RESOURCE',
      name: owner,
      service,
      identifier,
      data64: finalData,
    });

    if (isPrivate && opts?.privateGroupId != null && opts?.assetId != null) {
      const privacyIdentifier = assetPrivacyId(opts.assetId, opts.privateGroupId);
      const payload = {
        assetId: opts.assetId,
        assetName,
        private: true,
        groupId: opts.privateGroupId,
        updatedAt: Date.now(),
      };
      const payload64 = await objectToBase64(payload);
      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        name: owner,
        service: 'DOCUMENT',
        identifier: privacyIdentifier,
        data64: payload64,
      });
    }
  } catch (e: any) {
    const msg = e?.message || String(e);
    throw new Error(`PUBLISH_QDN_RESOURCE (publishAssetPublication) failed: ${msg}`);
  }
};
