// src/utils/news.ts
import { qaAnnouncementPrefix, assetNewsGlobalPrefix } from '../constants/qdnConstants';
import { NewsSummary } from '../types/newsAndPromos';
import { fetchPromotionApprovals } from './promotions';

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
  // TODO: adjust params to your actual SEARCH_QDN_RESOURCES usage
  const results = await qortalRequest({
    action: 'SEARCH_QDN_RESOURCES',
    service: 'DOCUMENT',
    identifier: qaAnnouncementPrefix, // or use 'prefix' if supported
    limit,
    offset: 0,
    reverse: true, // latest first if supported
  });

  if (!Array.isArray(results)) return [];

  const items: NewsSummary[] = [];
  for (const r of results) {
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: r.name,
        service: r.service,
        identifier: r.identifier,
        encoding: 'base64',
      });

      const html = atob(res.data64 ?? res);
      const title = extractTitleFromHtml(html, 'Q-Assets Announcement');
      const text = stripHtml(html);
      const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

      items.push({
        type: 'announcement',
        identifier: r.identifier,
        title,
        excerpt,
        created: r.created || Date.now(),
        // NEW:
        fullHtml: html,
        publisherName: r.name,
        service: r.service,
      });
    } catch {
      // ignore broken resource
    }
  }

  return items.sort((a, b) => b.created - a.created);
}

export async function fetchLatestAssetNews(limit = 10): Promise<NewsSummary[]> {
  // TODO: again, fit to real SEARCH_QDN_RESOURCES signature
  const results = await qortalRequest({
    action: 'SEARCH_QDN_RESOURCES',
    service: 'DOCUMENT',
    identifier: assetNewsGlobalPrefix,
    limit,
    offset: 0,
    reverse: true,
  });

  if (!Array.isArray(results)) return [];

  const items: NewsSummary[] = [];

  for (const r of results) {
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: r.name,
        service: r.service,
        identifier: r.identifier,
        encoding: 'base64',
      });

      const html = atob(res.data64 ?? res);
      const text = stripHtml(html);
      const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

      // Try to derive assetId from identifier: asset_news_pub__<assetId>__<id6>
      let assetId: number | undefined;
      const m = r.identifier.match(/^asset_news_pub__([0-9]+)__/);
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
        identifier: r.identifier,
        title,
        excerpt,
        created: r.created || Date.now(),
        assetId,
        assetName,
        fullHtml: html,
        publisherName: r.name,
        service: r.service,
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
      service: 'JSON',
    });
  }

  return promos.sort((a, b) => (b.promotionEndsAt ?? 0) - (a.promotionEndsAt ?? 0));
}
