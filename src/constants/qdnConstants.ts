import { getAssetInfo } from "../utils/qortalAssetRequests";
import type { Service } from "qapp-core"; // or your local types

export async function getAssetIdentifiers(assetName: string): Promise<{
  assetId: number;
  assetName: string;
  identifiers: {
    avatar: string;
    genesisPost: string;
    groupMeta: string;
    structuredMeta: string;
  };
  services: {
    avatar: Service;
    genesisPost: Service;
    groupMeta: Service;
    structuredMeta: Service;
  };
}> {
  const { assetId } = await getAssetInfo({ assetName });
  const prefix = `asset${assetId}_${assetName}`;

  return {
    assetId,
    assetName,
    identifiers: {
      avatar: `${prefix}_aavatar`,
      genesisPost: `${prefix}_genesisPub`,
      groupMeta: `${prefix}_groups`,
      structuredMeta: `${prefix}`,
    },
    services: {
      avatar: 'IMAGE',
      genesisPost: 'BLOG_POST',
      groupMeta: 'JSON',
      structuredMeta: 'JSON',
    },
  };
}
