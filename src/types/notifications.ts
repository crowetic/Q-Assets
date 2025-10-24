export type NotifScope =
  | { kind: 'global' }
  | { kind: 'asset'; assetId: number }
  | { kind: 'group'; groupId: number }
  | { kind: 'system' }
  | { kind: 'custom'; key: string };

export type NotifPriority = 'low' | 'normal' | 'high';

export interface NotifPaymentProof {
  assetId: number;       // 0 = QORT
  amount: number;
  txSignature: string;
  blockHeight: number;
}

export type NotifRole = 'admin' | 'editor' | 'issuer' | 'user';

export interface NotifV1 {
  version: 1;
  scope: string;         // serialized scope e.g. "asset:123"
  title: string;
  bodyHtml: string;
  links?: { label: string; href: string }[];
  priority?: NotifPriority;
  ttl?: number;
  createdAt: number;
  publisher: { name?: string; address: string; role?: NotifRole };
  audit?: {
    payment?: NotifPaymentProof;
    channel?: { chatGroupId?: number; mailThreadId?: string };
  };
  meta?: { assetId?: number; tags?: string[]; icon?: string };
}

export interface NotifIndexV1 {
  version: 1;
  scope: string; // "global" | "asset:123"
  items: Array<{ rid: string; createdAt: number; priority?: NotifPriority; tombstone?: boolean }>;
}

export interface NotifPolicyV1 {
  version: 1;
  basePriceQort: number;
  discount?: { assetId: number; price: number };
  rateLimits?: { perPublisherPerDay?: number; perAssetPerDay?: number };
  allowedScopes?: string[];
  linkAllowlist?: string[];
}
