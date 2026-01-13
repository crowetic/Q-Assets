import { getAssetInfo } from '../utils/qortalAssetRequests';
import type { Service } from 'qapp-core'; // or your local types
import { uniqueId6 } from '../utils/ids';

export const Q_ASSETS_OWNER_ADDRESS = 'QWZDZBKafP19Hin4HivuV6WXgWaBaWUMrN';
export const Q_ASSET_APP_PUBLISHER: string = 'Q-Assets';
export const Q_ASSET_APP_VERSION: string = __APP_VERSION__;
export const isBeta: boolean = true;

export const Q_ASSETS_VERSION: string = isBeta ? `${Q_ASSET_APP_VERSION}b` : Q_ASSET_APP_VERSION;
export const ASSETS_KEY = 'qa_assets_index' + Q_ASSET_APP_VERSION;

export const MINTER_GROUP_ID = 694;
export const DEV_GROUP_ID = 1;
export const Q_ASSETS_MANAGEMENT_GROUP_ID = 854;

export const assetCommentsPrefix = (assetId: number) => `asset_comment__${assetId}__`; // per-entry
export const assetUpvotesPrefix = (assetId: number) => `asset_paid_upvote__${assetId}__`; // per-entry
export const assetNewsPrefix = (assetId: number) => `asset_news_pub__${assetId}__`; // per-entry
export const assetDividendItemPrefix = (assetId: number) => `asset_dividendPayout__${assetId}__`;

// Optional 'head' docs for quick fetch of the latest (we still do per-entry for history)
export const assetNewsHeadId = (assetId: number) => `asset_news_head__${assetId}`;
export const assetDividendHeadId = (assetId: number) => `asset_dividend_head__${assetId}`;

// Global announcements (Q-Assets app level, not per-asset)
export const qaAnnouncementPrefix = 'qa_announcement__'; // per-entry
export const qaAnnouncementHeadId = 'qa_announcement_head';

// Global paid promotion identifiers ( documents)
export const qaPaidPromoPrefix = 'qa_paid_promo__'; // per-entry
export const qaPaidPromoHeadId = 'qa_paid_promo_head';
export const qaPromoRequestPrefix = 'qa_promo_req__'; // user-submitted requests
export const qaManagementManifestId = 'qassets_management_manifest';

// Optional: base prefix for asset news across *all* assets, for global search
export const assetNewsGlobalPrefix = 'asset_news_pub__';
export const assetPrivacyPrefix = 'asset_privacy__';
export const assetPrivacyId = (assetId: number, groupId: number) =>
  `${assetPrivacyPrefix}${assetId}__${groupId}`;

export const Q_ASSET_ID_FOR_PROMOS = 6; // Q-Asset ID used for promo discounts
export const Q_ASSET_PROMO_DISCOUNT = 0.2; // 20% discount when paid in Q-Asset

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

const FILE_ID_PREFIX_MAX = 12;
const FILE_IDENTIFIER_MAX_LEN = 64;

const isPrivate = (service?: string) => (service || '').toUpperCase().includes('PRIVATE');

const getFileTypeShortCode = (service: Service | string) => {
  const normalized = (service || '').toUpperCase();
  if (!normalized) return 'file';
  if (
    normalized.includes('IMAGE') ||
    normalized.includes('THUMBNAIL') ||
    normalized.includes('SVG') ||
    normalized.includes('GIF')
  )
    return 'img';
  if (normalized.includes('VIDEO')) return 'vid';
  if (normalized.includes('AUDIO') || normalized.includes('VOICE')) return 'aud';
  if (normalized.includes('JSON')) return 'json';
  if (normalized.includes('HTML') || normalized.includes('WEBSITE')) return 'html';
  if (normalized.includes('BLOG') || normalized.includes('DOCUMENT') || normalized.includes('TEXT'))
    return 'doc';
  return 'file';
};

const hashIdentifierPrefix = (value: string) => {
  const input = value || 'qassets-files';
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash << 5) - hash + input.charCodeAt(i);
    hash |= 0;
  }
  const positive = Math.abs(hash);
  return positive.toString(36).padStart(8, '0').slice(0, FILE_ID_PREFIX_MAX);
};

export const buildQassetsFileIdentifier = (service: Service | string, ownerName?: string) => {
  const randomPart = uniqueId6();
  const timestampPart = Date.now().toString(36);
  if (isPrivate(service)) {
    const prefixSeed = `qassetsFiles:${(ownerName || '').toLowerCase() || 'anon'}`;
    const prefix = hashIdentifierPrefix(prefixSeed);
    return `${prefix}_${randomPart}_${timestampPart}`.slice(0, FILE_ID_PREFIX_MAX);
  }
  const typeCode = getFileTypeShortCode(service);
  return `qa_file_${typeCode}_${randomPart}_${timestampPart}`;
};

export const QASSETS_FILE_ID_MAX = FILE_IDENTIFIER_MAX_LEN;

export async function getAssetIdentifiers(
  assetName: string,
  assetId?: number
): Promise<{
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
