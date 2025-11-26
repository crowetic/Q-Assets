import { Service } from 'qapp-core';

export type NewsType = 'announcement' | 'assetNews' | 'promotion';

export interface NewsSummary {
  type: NewsType;
  identifier: string;
  title: string;
  excerpt: string;
  created: number;
  isExpired?: boolean;
  assetId?: number;
  assetName?: string;
  promotionEndsAt?: number;

  // NEW:
  fullHtml?: string; // full HTML (for announcements + asset news, or promo contentHtml)
  publisherName?: string; // Qortal name that published it
  service?: Service; // original service for debugging
}

export type PromotionScope = 'asset' | 'general';

export type PromotionPaymentCurrency = 'QORT' | 'QASSET';

export interface PromotionPayment {
  currency: PromotionPaymentCurrency;
  assetId?: number;
  basePrice: number;
  amountPaid: number;
  discountApplied?: number;
  txSignature?: string | null;
}

export interface PromotionRequest {
  identifier: string; // qa_promo_req__XXXXXX
  title: string;
  contentHtml: string;
  scope: PromotionScope;
  assetId?: number;
  assetName?: string;
  targetDescription?: string | null;
  startsAt: number;
  endsAt: number;
  createdAt: number;
  createdBy: string;
  createdByAddress?: string;
  payment: PromotionPayment;
  status: 'pending' | 'active' | 'inactive' | 'denied';
  isActive?: boolean;
}

export interface PaidPromotion {
  id: string; // identifier (qa_paid_promo__XXXXXX)
  title: string;
  contentHtml: string;
  created: number;
  assetId?: number;
  assetName?: string;
  amountQort?: number;
  startsAt: number;
  endsAt: number;
  createdBy: string;
  status?: 'pending' | 'active' | 'inactive' | 'denied';
  isActive?: boolean;
  payment?: PromotionPayment;
  requestIdentifier?: string;
  targetDescription?: string | null;
  scope?: PromotionScope;
  approvedBy?: string;
  approvedAt?: number;
}

export interface PromotionContribution {
  account: string;
  requestCount: number;
  totalQort: number;
  totalQAsset: number;
  lastContributionAt: number;
}
