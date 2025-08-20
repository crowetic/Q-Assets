import { getAssetInfo } from "../utils/qortalAssetRequests";
import type { Service } from "qapp-core"; // or your local types

export const Q_ASSET_APP_PUBLISHER: string = 'Q-Assets'
export const Q_ASSET_APP_VERSION: number = 0.11
export const isBeta: boolean = true

export const Q_ASSET_VERSION: string = isBeta ? Q_ASSET_APP_VERSION + "b" : Q_ASSET_APP_VERSION.toString() 
export const ASSETS_KEY = "qa_assets_index" + Q_ASSET_APP_VERSION


export async function getAssetIdentifiers(assetName: string, assetId?: number): Promise<{
  assetId?: number;
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
  
  if (assetId == null) {
    const assetInfo = await getAssetInfo({ assetName });
    assetId = assetInfo.assetId; 
  }
  
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
