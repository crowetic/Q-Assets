// src/utils/news.ts
import { Service } from 'qapp-core';
import {
  qaAnnouncementPrefix,
  assetNewsGlobalPrefix,
  Q_ASSETS_MANAGEMENT_GROUP_ID,
} from '../constants/qdnConstants';
import { NewsSummary } from '../types/newsAndPromos';
import { fetchPromotionApprovals } from './promotions';
import { searchSimpleByIdentifierPrefix } from './searchSimple';
import { getAccountGroups } from './qortalApi';

const nameAddressCache = new Map<string, string | null>();
const adminCache = new Map<string, boolean>();

const looksLikeAddress = (value: string) => /^Q[1-9A-HJ-NP-Za-km-z]{20,}$/.test(value.trim());

async function resolvePublisherAddress(publisher?: string): Promise<string | null> {
  if (!publisher) return null;
  const key = publisher.toLowerCase();
  if (nameAddressCache.has(key)) return nameAddressCache.get(key)!;

  if (looksLikeAddress(publisher)) {
    nameAddressCache.set(key, publisher);
    return publisher;
  }

  try {
    const data = await qortalRequest({ action: 'GET_NAME_DATA', name: publisher });
    const owner = data?.owner ? String(data.owner) : null;
    nameAddressCache.set(key, owner);
    return owner;
  } catch {
    nameAddressCache.set(key, null);
    return null;
  }
}

async function isManagementAdminPublisher(publisher?: string): Promise<boolean> {
  if (!publisher) return false;
  const key = publisher.toLowerCase();
  if (adminCache.has(key)) return adminCache.get(key)!;

  const address = await resolvePublisherAddress(publisher);
  if (!address) {
    adminCache.set(key, false);
    return false;
  }

  try {
    const groups = await getAccountGroups(address);
    const ok = groups.some((g) => g.groupId === Q_ASSETS_MANAGEMENT_GROUP_ID && Boolean(g.isAdmin));
    adminCache.set(key, ok);
    return ok;
  } catch {
    adminCache.set(key, false);
    return false;
  }
}

function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function extractTitleFromHtml(html: string, fallback: string): string {
  if (!html) return fallback;
  const match = html.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
  if (match && match[1]) {
    // Rough decode of entities; you can replace this with a real decoder if you want
    return stripHtml(match[1]);
  }
  return fallback;
}

export async function fetchAnnouncements(limit = 5): Promise<NewsSummary[]> {
  const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', qaAnnouncementPrefix);
  if (!hits.length) return [];
  const ordered = hits.sort((a, b) => (b.created || 0) - (a.created || 0));

  const items: NewsSummary[] = [];
  for (const hit of ordered) {
    if (!(await isManagementAdminPublisher(hit.name))) continue;
    const finalService = hit.service ? (hit.service as Service) : ('DOCUMENT' as Service);
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: hit.name,
        service: hit.service as Service,
        identifier: hit.identifier,
        encoding: 'base64',
      });

      const html = atob(res.data64 ?? res);
      const title = extractTitleFromHtml(html, 'Q-Assets Announcement');
      const text = stripHtml(html);
      const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

      items.push({
        type: 'announcement',
        identifier: hit.identifier,
        title,
        excerpt,
        created: hit.created || Date.now(),
        fullHtml: html,
        publisherName: hit.name,
        service: finalService,
      });
    } catch {
      // ignore broken resource
    }
    if (items.length >= limit) break;
  }

  return items.sort((a, b) => b.created - a.created);
}

export async function fetchLatestAssetNews(limit = 10): Promise<NewsSummary[]> {
  const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', assetNewsGlobalPrefix);
  if (!hits.length) return [];

  const items: NewsSummary[] = [];

  for (const hit of hits) {
    const finalService = hit.service ? (hit.service as Service) : ('DOCUMENT' as Service);
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: hit.name,
        service: finalService,
        identifier: hit.identifier,
        encoding: 'base64',
      });

      const html = atob(res.data64 ?? res);
      const text = stripHtml(html);
      const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

      // Try to derive assetId from identifier: asset_news_pub__<assetId>__<id6>
      let assetId: number | undefined;
      const m = hit.identifier.match(/^asset_news_pub__([0-9]+)__/);
      if (m && m[1]) {
        assetId = Number(m[1]);
      }

      const assetName = assetId != null ? `Asset #${assetId}` : undefined;

      const title = extractTitleFromHtml(
        html,
        assetId != null ? `News for ${assetName}` : 'Asset news'
      );

      items.push({
        type: 'assetNews',
        identifier: hit.identifier,
        title,
        excerpt,
        created: hit.created || Date.now(),
        assetId,
        assetName,
        fullHtml: html,
        publisherName: hit.name,
        service: finalService,
      });
    } catch {
      // ignore
    }
  }

  // Sort latest first and trim to limit
  return items.sort((a, b) => b.created - a.created).slice(0, limit);
}

export async function fetchActivePromotions(now = Date.now()): Promise<NewsSummary[]> {
  const approvals = await fetchPromotionApprovals(120);
  const promos: NewsSummary[] = [];

  for (const promo of approvals) {
    if (!promo.contentHtml) continue;
    if (!promo.isActive) continue;
    if (now < promo.startsAt || now > promo.endsAt) continue;

    const text = stripHtml(promo.contentHtml);
    const excerpt = text.slice(0, 200) + (text.length > 200 ? '…' : '');

    promos.push({
      type: 'promotion',
      identifier: promo.id,
      title: promo.title || 'Promotion',
      excerpt,
      created: promo.created,
      assetId: promo.assetId,
      assetName: promo.assetName,
      promotionEndsAt: promo.endsAt,
      fullHtml: promo.contentHtml,
      publisherName: promo.createdBy,
      service: 'DOCUMENT',
    });
  }

  return promos.sort((a, b) => (b.promotionEndsAt ?? 0) - (a.promotionEndsAt ?? 0));
}
