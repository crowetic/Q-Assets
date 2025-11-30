import {
  qaPromoRequestPrefix,
  qaPaidPromoPrefix,
  Q_ASSET_ID_FOR_PROMOS,
  Q_ASSET_PROMO_DISCOUNT,
} from '../constants/qdnConstants';
import { PaidPromotion, PromotionContribution, PromotionRequest } from '../types/newsAndPromos';
import { base64ToObject, objectToBase64 } from './data';
import type { Service } from 'qapp-core';

type SearchResult = {
  identifier: string;
  name: string;
  service: Service;
  created?: number;
};

function parsePromotionRequestPayload(
  identifier: string,
  publisher: string,
  created: number | undefined,
  payload: any
): PromotionRequest | null {
  if (!payload || typeof payload !== 'object') return null;
  const scope = payload.scope === 'general' ? 'general' : 'asset';
  const payment = payload.payment || {};

  return {
    identifier,
    title: String(payload.title ?? 'Promotion'),
    contentHtml: String(payload.contentHtml ?? ''),
    scope,
    assetId: scope === 'asset' && payload.assetId != null ? Number(payload.assetId) : undefined,
    assetName: scope === 'asset' ? payload.assetName || undefined : undefined,
    targetDescription: scope === 'general' ? payload.targetDescription || null : null,
    startsAt: Number(payload.startsAt ?? created ?? Date.now()),
    endsAt: Number(payload.endsAt ?? payload.startsAt ?? Date.now()),
    createdAt: Number(payload.createdAt ?? created ?? Date.now()),
    createdBy: payload.createdBy || publisher || 'unknown',
    createdByAddress: payload.createdByAddress || undefined,
    payment: {
      currency: payment.currency === 'QASSET' ? 'QASSET' : 'QORT',
      assetId: payment.assetId != null ? Number(payment.assetId) : undefined,
      basePrice: Number(payment.basePrice ?? payment.amountPaid ?? 0),
      amountPaid: Number(payment.amountPaid ?? payment.basePrice ?? 0),
      discountApplied:
        payment.currency === 'QASSET'
          ? Number(payment.discountApplied ?? Q_ASSET_PROMO_DISCOUNT)
          : undefined,
      txSignature: payment.txSignature || payload.paymentRef || null,
    },
    status: payload.status || 'pending',
    isActive: Boolean(payload.isActive),
  };
}

function parsePaidPromotionPayload(payload: any, identifier: string): PaidPromotion | null {
  if (!payload || typeof payload !== 'object') return null;
  const scope = payload.scope === 'general' ? 'general' : 'asset';

  return {
    id: identifier,
    title: String(payload.title ?? 'Promotion'),
    contentHtml: String(payload.contentHtml ?? ''),
    created: Number(payload.createdAt ?? payload.created ?? Date.now()),
    assetId: payload.assetId != null ? Number(payload.assetId) : undefined,
    assetName: payload.assetName || undefined,
    amountQort: payload.payment?.amountPaid ?? payload.amountQort ?? undefined,
    startsAt: Number(payload.startsAt ?? payload.createdAt ?? Date.now()),
    endsAt: Number(payload.endsAt ?? payload.startsAt ?? Date.now()),
    createdBy: payload.createdBy || 'unknown',
    status: payload.status,
    isActive: payload.isActive !== false,
    payment: payload.payment,
    requestIdentifier: payload.requestIdentifier || payload.identifier,
    targetDescription: scope === 'general' ? payload.targetDescription || null : null,
    scope,
    approvedBy: payload.reviewedBy || undefined,
    approvedAt: payload.reviewedAt || undefined,
  };
}

async function searchResourcesForPrefix(prefix: string, limit = 120): Promise<SearchResult[]> {
  const results = await qortalRequest({
    action: 'SEARCH_QDN_RESOURCES',
    identifier: prefix,
    limit,
    offset: 0,
    reverse: true,
    mode: 'ALL',
  });

  if (!Array.isArray(results)) return [];
  return results as SearchResult[];
}

async function fetchAndDecode(identifier: string, publisher: string, service: Service) {
  const resource = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    name: publisher,
    service,
    identifier,
    encoding: 'base64',
  });

  const payloadB64 = typeof resource === 'string' ? resource : resource?.data64;
  if (!payloadB64) return null;
  try {
    return base64ToObject(payloadB64);
  } catch {
    return null;
  }
}

export async function fetchPromotionRequests(limit = 120): Promise<PromotionRequest[]> {
  const results = await searchResourcesForPrefix(qaPromoRequestPrefix, limit);
  const requests: PromotionRequest[] = [];

  for (const entry of results) {
    try {
      const payload = await fetchAndDecode(entry.identifier, entry.name, entry.service);
      if (!payload) continue;
      const parsed = parsePromotionRequestPayload(
        entry.identifier,
        entry.name,
        entry.created,
        payload
      );
      if (parsed) requests.push(parsed);
    } catch {
      // ignore malformed entry
    }
  }

  return requests.sort((a, b) => b.createdAt - a.createdAt);
}

export async function fetchPromotionApprovals(limit = 120): Promise<PaidPromotion[]> {
  const results = await searchResourcesForPrefix(qaPaidPromoPrefix, limit);
  const promos: PaidPromotion[] = [];

  for (const entry of results) {
    try {
      const payload = await fetchAndDecode(entry.identifier, entry.name, entry.service);
      if (!payload) continue;
      const parsed = parsePaidPromotionPayload(payload, entry.identifier);
      if (parsed) promos.push(parsed);
    } catch {
      // ignore invalid payload
    }
  }

  return promos.sort((a, b) => (b.approvedAt ?? b.created) - (a.approvedAt ?? a.created));
}

export function summarizePromotionContributions(
  requests: PromotionRequest[]
): PromotionContribution[] {
  const map = new Map<string, PromotionContribution>();

  for (const req of requests) {
    const key = req.createdBy || req.createdByAddress || 'unknown';
    const entry =
      map.get(key) ??
      ({
        account: key,
        requestCount: 0,
        totalQort: 0,
        totalQAsset: 0,
        lastContributionAt: 0,
      } as PromotionContribution);

    entry.requestCount += 1;
    entry.lastContributionAt = Math.max(entry.lastContributionAt, req.createdAt);
    if (req.payment?.currency === 'QASSET') entry.totalQAsset += req.payment.amountPaid;
    else entry.totalQort += req.payment?.amountPaid ?? 0;

    map.set(key, entry);
  }

  return Array.from(map.values()).sort(
    (a, b) =>
      b.totalQort + b.totalQAsset - (a.totalQort + a.totalQAsset) ||
      b.lastContributionAt - a.lastContributionAt
  );
}

function toApprovalIdentifier(identifier: string) {
  return `${qaPaidPromoPrefix}${identifier.replace(qaPromoRequestPrefix, '')}`;
}

export async function fetchPendingPromotionRequests(limit = 120): Promise<PromotionRequest[]> {
  const [requests, approvals] = await Promise.all([
    fetchPromotionRequests(limit),
    fetchPromotionApprovals(limit),
  ]);
  const approvedKeys = new Set(
    approvals
      .map((appr) => appr.requestIdentifier || appr.id)
      .filter((id): id is string => Boolean(id))
  );
  return requests.filter((req) => !approvedKeys.has(req.identifier));
}

export async function setPromotionActive(
  request: PromotionRequest,
  isActive: boolean,
  adminName?: string
) {
  const payload = {
    kind: 'QASSETS_PROMOTION',
    requestIdentifier: request.identifier,
    title: request.title,
    contentHtml: request.contentHtml,
    createdAt: request.createdAt,
    startsAt: request.startsAt,
    endsAt: request.endsAt,
    createdBy: request.createdBy,
    assetId: request.assetId,
    assetName: request.assetName,
    targetDescription: request.targetDescription,
    scope: request.scope,
    payment: request.payment,
    status: isActive ? 'active' : 'inactive',
    isActive,
    reviewedAt: Date.now(),
    reviewedBy: adminName || 'unknown',
  };

  const identifier = toApprovalIdentifier(request.identifier);
  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    ...(adminName ? { name: adminName } : {}),
    service: 'DOCUMENT',
    identifier,
    data64: await objectToBase64(payload),
  });
}

export function getDiscountedAmount(basePrice: number): number {
  const discounted = basePrice * (1 - Q_ASSET_PROMO_DISCOUNT);
  return Math.max(0, Number(discounted.toFixed(2)));
}

export const PROMO_PAYMENT_OPTIONS = [
  { label: 'QORT', value: 'QORT' },
  { label: `Q-Asset #${Q_ASSET_ID_FOR_PROMOS}`, value: 'QASSET' },
];
