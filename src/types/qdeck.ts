export type QDeckVersion = 1;

export type Priority = 'CRITICAL' | 'HIGH' | 'NORMAL' | 'LOW';
export type DefaultStatus = 'IN_PROGRESS' | 'ISSUES' | 'ON_HOLD' | 'REVIEW' | 'FAILED' | 'DONE';

export type Currency = 'QORT' | 'QASSET';

export type QDeckVisibility = 'public' | 'private';

export type QDeckTombstone = {
  _type: 'QDECK_TOMBSTONE';
  entity: 'BOARD' | 'CARD' | 'COMMENTS';
  boardId: string;
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
    // Recommended additions for your UI:
    visibility?: 'public' | 'private';
    service?: 'DOCUMENT' | 'DOCUMENT_PRIVATE';
    mode?: 'direct' | 'group';
  }>;
  updatedAt: number;
  seq: number;
}

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

// export interface CardsIndexDoc {
//   _type: 'QDECK_CARDS_INDEX';
//   version: 1;
//   boardId: string;
//   cardIds: string[];     // minimal; order agnostic
//   updatedAt: number;
//   seq: number;
// }

export type CardsIndexDoc = {
  _type: 'QDECK_CARDS_INDEX';
  version: 1;
  boardId: string;
  cardIds: string[]; // legacy
  entries?: Array<{ name: string; cardId: string }>; // new, multi-issuer
  updatedAt: number;
  seq: number;
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
  groupsAllowed: number[]; // group ids that can create/edit
  usersAllowed?: string[]; // optional allowlist of names/addrs
  adminOverride?: boolean; //optional - allow admins to override data on boards
  // canonical list order (lists are schema-defined; cards link to listId)
  lists: QDeckList[];
  // optimistic concurrency
  seq: number; // monotonic int, increment on each edit
  visibility: QDeckVisibility; // 'public' | 'private'
  service: 'DOCUMENT' | 'DOCUMENT_PRIVATE';
  privateMeta?: {
    groupId?: number; // Qortal groupId used for encryption
    isAdmins?: boolean; // encrypt to admins only if true
    mode?: 'group' | 'direct'; // which encryption mode to use NOTE - direct mode does NOT allow easily adding/removing members in the future. It utilizes direct public keys.
    recipients?: string[];
  };
}

export interface QDeckList {
  listId: string; // slug/uuid
  title: string; // e.g., IN PROGRESS
  faintColor?: string; // e.g., rgba(..,0.08) for background
  order: number; // for column ordering
}

export interface QDeckCard {
  _type: 'QDECK_CARD';
  version: QDeckVersion;
  cardId: string; // uuid
  boardId: string;
  title: string;
  descriptionHtml?: string; // prepared HTML (TipTap output)
  quickDescription?: string;
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
  overriddenBy?: string; // name of admin that overwrote card if overrides are allowed
  overrideIdentifier?: string; // The Identifier of the card published to override this card. Full identifier
  overrideId?: string; // The shortId of the card that overrides this one.
  creatorIsAdmin?: boolean;
  priority: Priority;
  tags: string[];
  statusListId: string; // which list it lives in
  order: number; // position within list
  isDone: boolean; // DONE list will auto-set true
  collapsedWhenDone?: boolean; // This should be default
  hasBounty?: boolean;
  bountyInfo?: BountyInfo;
  upvotes?: UpvoteSummary;
  createdAt: number;
  updatedAt: number;
  seq: number; // per-card optimistic version
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
