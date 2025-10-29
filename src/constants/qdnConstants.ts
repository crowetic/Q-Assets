import { getAssetInfo } from "../utils/qortalAssetRequests";
import type { Service } from "qapp-core"; // or your local types

export const Q_ASSETS_OWNER_ADDRESS = 'QWZDZBKafP19Hin4HivuV6WXgWaBaWUMrN'
export const Q_ASSET_APP_PUBLISHER: string = 'Q-Assets'
export const Q_ASSET_APP_VERSION: number = 0.51
export const isBeta: boolean = true

export const Q_ASSETS_VERSION: string = isBeta ? Q_ASSET_APP_VERSION + "b" : Q_ASSET_APP_VERSION.toString() 
export const ASSETS_KEY = "qa_assets_index" + Q_ASSET_APP_VERSION

export const MINTER_GROUP_ID = 694
export const DEV_GROUP_ID = 1

export const assetCommentsPrefix   = (assetId: number) => `asset_comment__${assetId}__`;      // per-entry
export const assetUpvotesPrefix    = (assetId: number) => `asset_paid_upvote__${assetId}__`;  // per-entry
export const assetNewsPrefix = (assetId: number) => `asset_news_pub__${assetId}__`;     // per-entry
export const assetDividendItemPrefix = (assetId: number) => `asset_dividendPayout__${assetId}__`;


// Optional 'head' docs for quick fetch of the latest (we still do per-entry for history)
export const assetNewsHeadId = (assetId: number) => `asset_news_head__${assetId}`;
export const assetDividendHeadId        = (assetId: number) => `asset_dividend_head__${assetId}`;


// ----- builders -----
export const assetCommentId = (assetId: number, id6: string) =>
  `${assetCommentsPrefix(assetId)}${id6}`;

export const assetPaidUpvoteId = (assetId: number, id6: string) =>
  `${assetUpvotesPrefix(assetId)}${id6}`;

export const assetNewsItemId = (assetId: number, id6: string) =>
  `${assetNewsPrefix(assetId)}${id6}`;

// Counter-based dividend entry id: …__000001, …__000002, etc.
export const assetDividendItemId = (assetId: number, counter: number) =>
  `${assetDividendItemPrefix(assetId)}${String(counter).padStart(6, '0')}`;



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
