export type QDeckVersion = 1;

export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
export type DefaultStatus = 'IN_PROGRESS' | 'ISSUES' | 'ON_HOLD' | 'REVIEW' | 'FAILED' | 'DONE';

export type Currency = 'QORT' | 'QASSET';

export type QDeckVisibility = 'public' | 'private';

export type QDeckTombstone = {
  _type: 'QDECK_TOMBSTONE';
  entity: 'BOARD' | 'CARD' | 'COMMENTS' | 'PROJECT';
  boardId?: string;
  projectId?: string;
  cardId?: string;
  deletedAt: number;
  deletedBy: string; // issuer or address
  version: 1;
};

export interface BoardsIndexDoc {
  _type: 'QDECK_BOARDS_INDEX';
  version: 1;
  issuerName: string;
  boards: Array<{
    boardId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    issuerName?: string;
    createdBy?: string;
    creatorAddress?: string;
    // Recommended additions for your UI:
    visibility?: 'public' | 'private';
    service?: 'DOCUMENT' | 'DOCUMENT_PRIVATE';
    mode?: 'direct' | 'group';
  }>;
  updatedAt: number;
  seq: number;
}

export type QDeckAssetLink = {
  assetId: string; // asset id or name
  issuerName?: string;
};

export type AnyBoard = {
  name: string; // issuer
  shortId: string; // boardId
  title: string;
  updatedAt?: number;
  visibility: 'public' | 'private';
  service: 'DOCUMENT' | 'DOCUMENT_PRIVATE';
  accessible: boolean; // can the current user open now
  privMode?: 'group' | 'direct'; // only when private & accessible
};

export interface ProjectsIndexDoc {
  _type: 'QDECK_PROJECTS_INDEX';
  version: 1;
  issuerName: string;
  projects: Array<{
    projectId: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    visibility?: 'public' | 'private';
    service?: 'DOCUMENT' | 'DOCUMENT_PRIVATE';
    mode?: 'group' | 'direct';
  }>;
  updatedAt: number;
  seq: number;
}

export type AnyProject = {
  name: string; // issuer
  shortId: string; // projectId
  title: string;
  updatedAt?: number;
  visibility: 'public' | 'private';
  service: 'DOCUMENT' | 'DOCUMENT_PRIVATE';
  accessible: boolean;
  privMode?: 'group' | 'direct';
};

export type CardsIndexDoc = {
  _type: 'QDECK_CARDS_INDEX';
  version: 1;
  boardId: string;
  cardIds: string[]; // legacy
  entries?: Array<{
    name: string;
    cardId: string;
    title?: string;
    statusListId?: string;
    scheduledStart?: number;
    scheduledEnd?: number;
    scheduledAllDay?: boolean;
    completedAt?: number;
    isDone?: boolean;
  }>; // new, multi-issuer
  archivedIds?: string[]; // optional list of archived cardIds
  updatedAt: number;
  seq: number;
};

export type QDeckFeatureFlags = {
  enhancedPerms?: boolean;
  cardVariants?: boolean;
  cardArchive?: boolean;
};

export interface QDeckBoard {
  _type: 'QDECK_BOARD';
  version: QDeckVersion;
  boardId: string; // uuid
  title: string;
  description?: string;
  displayName?: string; // if user renames a board that they don't own?? Maybe //TODO potentially add this functionality to allow others to save display names for boards.
  createdBy: string; // primary Qortal name (issuer/admin)
  creatorAddress?: string;
  creatorIsAdmin?: boolean;
  createdAt: number; // epoch ms
  updatedAt: number; // epoch ms
  // Legacy permissions (kept for backward compatibility)
  groupsAllowed: number[]; // group ids that can create/edit
  usersAllowed?: string[]; // optional allowlist of names/addrs
  // Enhanced permissions (opt-in via featureFlags.enhancedPerms)
  owners?: string[]; // names who are admins
  ownerGroups?: number[]; // groupIds whose admins are board admins
  editors?: string[]; // names allowed to edit/publish
  editorGroups?: number[]; // groupIds allowed to edit/publish
  adminOverride?: boolean; //optional - allow admins to override data on boards
  preferredVariants?: Record<string, string>; // cardId -> publisher name
  // canonical list order (lists are schema-defined; cards link to listId)
  lists: QDeckList[];
  // optimistic concurrency
  seq: number; // monotonic int, increment on each edit
  visibility: QDeckVisibility; // 'public' | 'private'
  service: 'DOCUMENT' | 'DOCUMENT_PRIVATE';
  featureFlags?: QDeckFeatureFlags;
  privateMeta?: {
    groupId?: number; // Qortal groupId used for encryption
    isAdmins?: boolean; // encrypt to admins only if true
    mode?: 'group' | 'direct'; // which encryption mode to use NOTE - direct mode does NOT allow easily adding/removing members in the future. It utilizes direct public keys.
    recipients?: string[];
  };
  assetIds?: QDeckAssetLink[];
}

export interface QDeckProject {
  _type: 'QDECK_PROJECT';
  version: QDeckVersion;
  projectId: string;
  title: string;
  description?: string;
  createdBy: string; // primary Qortal name (issuer/admin)
  creatorAddress?: string;
  createdAt: number;
  updatedAt: number;
  groupsAllowed: number[];
  usersAllowed?: string[];
  owners?: string[];
  ownerGroups?: number[];
  editors?: string[];
  editorGroups?: number[];
  adminOverride?: boolean;
  boards?: Array<{ boardId: string; issuerName: string; colorHex?: string }>;
  assetIds?: QDeckAssetLink[];
  seq: number;
  visibility: QDeckVisibility;
  service: 'DOCUMENT' | 'DOCUMENT_PRIVATE';
  privateMeta?: {
    groupId?: number;
    isAdmins?: boolean;
    mode?: 'group' | 'direct';
    recipients?: string[];
  };
}

export interface QDeckList {
  listId: string; // slug/uuid
  title: string; // e.g., IN PROGRESS
  faintColor?: string; // e.g., rgba(..,0.08) for background
  order: number; // for column ordering
  defaultCollapsed?: boolean;
}

export type QDeckCardAttachment = {
  attachmentId: string;
  identifier: string;
  fileName: string;
  size?: number;
  mimeType?: string;
  uploadedAt: number;
  uploadedBy?: string;
  service?: string;
  isPrivate?: boolean;
};

export interface QDeckCard {
  _type: 'QDECK_CARD';
  version: QDeckVersion;
  cardId: string; // uuid
  boardId: string;
  title: string;
  descriptionHtml?: string; // prepared HTML (TipTap output)
  quickDescription?: string;
  attachments?: QDeckCardAttachment[];
  primaryImageUrl?: string;
  primaryImage?: {
    // NEW: small stable reference
    service: 'IMAGE' | 'DOCUMENT_PRIVATE';
    identifier: string; // e.g., qdeck__cardimg__<boardId>__<cardId>
    isPrivate?: boolean;
  };
  estimatedCompletionTimeMinutes?: number;
  createdBy: string; // qortal name/address
  creatorAddress?: string;
  assignees?: string[]; // qortal names
  workedBy?: string[]; // users who have worked on the task
  startedFromListId?: string; // list before first start, for cancel-start restores
  overriddenBy?: string; // name of admin that overwrote card if overrides are allowed
  overrideIdentifier?: string; // The Identifier of the card published to override this card. Full identifier
  overrideId?: string; // The shortId of the card that overrides this one.
  creatorIsAdmin?: boolean;
  priority: Priority;
  tags: string[];
  statusListId: string; // which list it lives in
  order: number; // position within list
  isDone: boolean; // DONE list will auto-set true
  collapsedWhenDone?: boolean; // old field kept for compatibility
  isCollapsed?: boolean;
  completedAt?: number;
  completionComment?: string;
  scheduledStart?: number;
  scheduledEnd?: number;
  scheduledAllDay?: boolean;
  hasBounty?: boolean;
  bountyInfo?: BountyInfo;
  upvotes?: UpvoteSummary;
  archived?: boolean;
  archivedAt?: number;
  archivedBy?: string;
  archiveReason?: string;
  createdAt: number;
  updatedAt: number;
  seq: number; // per-card optimistic version
  variants?: Array<{
    publisher: string;
    updatedAt: number;
    title?: string;
    contentHash?: string;
  }>;
}

export interface BountyInfo {
  status: 'open' | 'funded' | 'expired' | 'completed' | 'paid';
  currency: Currency;
  // target bounty pool intended to reach (community funded, or creator-staked)
  targetAmount?: string; // human string ("123.45")
  isQFund?: boolean;
  qFundAtAddress?: string;
  isStaticAmount?: boolean;
  isEscrowed?: boolean; // Will the bounty be escrowed through the Q-Assets Escrow account?
  // tracked funds (sum of contributions in currency)
  fundedAmount?: string;
  // single-payer bounty (classic)
  offeredAmount?: string; // if creator pledges a fixed bounty
  offeredByName?: string;
  offeredByAddress?: string;
  expiresAt?: number; // epoch ms
  // payee suggestion (filled when completed)
  suggestedPayee?: string; // qortal name/address
}

export interface UpvoteSummary {
  currency: Currency; // generally QASSET for revenue splits
  count: number;
  totalAmount: string; // human string sum
}

export interface CardCommentThread {
  _type: 'QDECK_COMMENTS';
  version: QDeckVersion;
  cardId: string;
  comments: CardComment[];
  updatedAt: number;
  seq: number;
}

export interface CardComment {
  commentId: string; // uuid
  parentId?: string; // for threading
  author: string; // qortal name/address
  authorAddress?: string;
  bodyHtml: string;
  createdAt: number;
  updatedAt?: number;
}

export function coerceVisibility(v: unknown): 'public' | 'private' {
  return v === 'private' ? 'private' : 'public';
}
export function coerceService(s: unknown): 'DOCUMENT' | 'DOCUMENT_PRIVATE' {
  return s === 'DOCUMENT_PRIVATE' ? 'DOCUMENT_PRIVATE' : 'DOCUMENT';
}

export type PaymentsDoc = {
  _type: 'QDECK_PAYMENTS';
  version: 1;
  boardId: string;
  lines: PaymentLine[];
  updatedAt: number;
  seq: number;
};

export interface PaymentLine {
  ts: number;
  type: 'UPVOTE' | 'BOUNTY_CONTRIB' | 'BOUNTY_PAYOUT';
  cardId: string;
  currency: 'QORT' | 'QASSET';
  amount: number;
  from: string; // address/name
  to: string; // address/name or "addr1+addr2"
  note?: string;
}
