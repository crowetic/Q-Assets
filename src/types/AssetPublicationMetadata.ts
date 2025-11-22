// src/types/AssetPublicationMetadata.ts
export interface AssetGroupMetadata {
  primaryGroupName: string;
  primaryGroupId: string;
  primaryGroupJoinLink: string;
  primaryGroupIsPrivate: boolean;

  secondaryGroupName?: string;
  secondaryGroupId?: string;
  secondaryGroupJoinLink?: string;
  secondaryGroupIsPrivate?: boolean;

  tertiaryGroupName?: string;
  tertiaryGroupId?: string;
  tertiaryGroupJoinLink?: string;
  tertiaryGroupIsPrivate?: boolean;
}

export type DividendPeriod = '1W' | '2W' | '1M' | '3M' | '6M' | '1Y';

export interface AssetPublication {
  description?: string;
  html?: string; // rendered in a rich display section
  genesisPostId?: string; // ID or identifier to a BLOG_POST
  primaryGroup?: {
    name: string;
    id: string;
    joinLink: string;
    isPrivate?: boolean;
  };
  extraGroups?: {
    name: string;
    id: string;
    joinLink: string;
    isPrivate?: boolean;
  }[];
  dividends?: boolean; // dividend-paying asset?
  dividendPeriod?: DividendPeriod; // frequency, if dividends==true
  news?: {
    title: string;
    date: string; // ISO format
    postId: string;
  }[];
  customFields?: Record<string, string>; // arbitrary key/val metadata
}

export function normalizePublication(pub?: AssetPublication): AssetPublication {
  const p: AssetPublication = { ...(pub ?? {}) };
  if (p.dividends == null) p.dividends = false;
  if (p.dividends && !isValidDividendPeriod(p.dividendPeriod)) p.dividendPeriod = '1M';
  return p;
}
export function isValidDividendPeriod(x: any): x is DividendPeriod {
  return ['1W', '2W', '1M', '3M', '6M', '1Y'].includes(x);
}

export function convertGroupMetaToPublication(
  meta: AssetGroupMetadata
): Pick<AssetPublication, 'primaryGroup' | 'extraGroups'> {
  const {
    primaryGroupName,
    primaryGroupId,
    primaryGroupJoinLink,
    primaryGroupIsPrivate,
    secondaryGroupName,
    secondaryGroupId,
    secondaryGroupJoinLink,
    secondaryGroupIsPrivate,
    tertiaryGroupName,
    tertiaryGroupId,
    tertiaryGroupJoinLink,
    tertiaryGroupIsPrivate,
  } = meta;

  const primaryGroup = {
    name: primaryGroupName,
    id: primaryGroupId,
    joinLink: primaryGroupJoinLink,
    isPrivate: primaryGroupIsPrivate ?? false, // ⬅ force boolean
  };

  const extraGroupsRaw: {
    name: string;
    id: string;
    joinLink: string;
    isPrivate: boolean;
  }[] = [];

  if (secondaryGroupName && secondaryGroupId && secondaryGroupJoinLink) {
    extraGroupsRaw.push({
      name: secondaryGroupName,
      id: secondaryGroupId,
      joinLink: secondaryGroupJoinLink,
      isPrivate: secondaryGroupIsPrivate ?? false,
    });
  }

  if (tertiaryGroupName && tertiaryGroupId && tertiaryGroupJoinLink) {
    extraGroupsRaw.push({
      name: tertiaryGroupName,
      id: tertiaryGroupId,
      joinLink: tertiaryGroupJoinLink,
      isPrivate: tertiaryGroupIsPrivate ?? false,
    });
  }

  return { primaryGroup, extraGroups: extraGroupsRaw };
}

export function convertPublicationToGroupMeta(pub: AssetPublication): AssetGroupMetadata {
  const primary = pub.primaryGroup ?? { name: '', id: '', joinLink: '', isPrivate: false };
  const [secondary, tertiary] = pub.extraGroups ?? [];

  return {
    primaryGroupName: primary.name,
    primaryGroupId: primary.id,
    primaryGroupJoinLink: primary.joinLink,
    primaryGroupIsPrivate: primary.isPrivate ?? false,

    secondaryGroupName: secondary?.name,
    secondaryGroupId: secondary?.id,
    secondaryGroupJoinLink: secondary?.joinLink,
    secondaryGroupIsPrivate: secondary?.isPrivate,

    tertiaryGroupName: tertiary?.name,
    tertiaryGroupId: tertiary?.id,
    tertiaryGroupJoinLink: tertiary?.joinLink,
    tertiaryGroupIsPrivate: tertiary?.isPrivate,
  };
}
