import { Service } from 'qapp-core';
import { qaAnnouncementPrefix, assetNewsGlobalPrefix } from '../constants/qdnConstants';
import { NewsSummary } from '../types/newsAndPromos';
import { fetchPromotionApprovals } from './promotions';
import { searchSimpleByIdentifierPrefix } from './searchSimple';
import { stripHtml, extractTitleFromHtml, isManagementAdminPublisher } from './newsHelpers';
import { loadAnnouncementApprovalDoc } from './announcementApprovals';
import { publisherHasPermission } from './managementManifest';
import { base64ToObject, base64ToUtf8 } from './data';

async function canPublishAnnouncement(publisher: string): Promise<boolean> {
  try {
    return await publisherHasPermission(publisher, 'announcements.publish');
  } catch {
    return isManagementAdminPublisher(publisher);
  }
}

const decodeAnnouncementResource = async (data64?: string | null) => {
  if (!data64 || typeof data64 !== 'string') return null;
  try {
    const parsed = await base64ToObject(data64);
    const decoded = base64ToUtf8(data64);
    try {
      // const parsed = JSON.parse(decoded);
      if (parsed && typeof parsed.html === 'string') {
        return {
          html: parsed.html as string,
          title: typeof parsed.title === 'string' ? parsed.title : undefined,
          createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : undefined,
        };
      }
    } catch {
      /* not JSON */
    }
    return { html: decoded };
  } catch {
    return null;
  }
};

export async function fetchAnnouncements(limit = 5): Promise<NewsSummary[]> {
  const approvalDoc = await loadAnnouncementApprovalDoc();
  const approvedEntries = approvalDoc.items || [];
  const items: NewsSummary[] = [];

  if (approvedEntries.length) {
    const ordered = approvedEntries
      .slice()
      .sort((a, b) => (b.approvedAt || b.createdAt || 0) - (a.approvedAt || a.createdAt || 0));

    for (const entry of ordered) {
      try {
        const res = await qortalRequest({
          action: 'FETCH_QDN_RESOURCE',
          name: entry.publisher,
          service: entry.service || ('DOCUMENT' as Service),
          identifier: entry.identifier,
          encoding: 'base64',
        });
        const payload = await decodeAnnouncementResource(res?.data64 ?? res);
        if (!payload) continue;
        const html = payload.html;
        const title = payload.title || extractTitleFromHtml(html, 'Q-Assets Announcement');
        const text = stripHtml(html);
        const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

        items.push({
          type: 'announcement',
          identifier: entry.identifier,
          title,
          excerpt,
          created: payload.createdAt || entry.approvedAt || entry.createdAt || Date.now(),
          fullHtml: html,
          publisherName: entry.publisher,
          service: entry.service,
        });
      } catch {
        // ignore corrupted entry
      }
      if (items.length >= limit) break;
    }
  }

  if (items.length) {
    return items.sort((a, b) => b.created - a.created).slice(0, limit);
  }

  // Fallback for legacy announcements (admin publishers only)
  const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', qaAnnouncementPrefix);
  if (!hits.length) return [];
  const orderedHits = hits.sort((a, b) => (b.created || 0) - (a.created || 0));

  for (const hit of orderedHits) {
    const allowed = await canPublishAnnouncement(hit.name);
    if (!allowed) continue;
    const finalService = hit.service ? (hit.service as Service) : ('DOCUMENT' as Service);
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: hit.name,
        service: hit.service as Service,
        identifier: hit.identifier,
        encoding: 'base64',
      });

      const payload = await decodeAnnouncementResource(res?.data64 ?? res);
      if (!payload) continue;
      const html = payload.html;
      const title = payload.title || extractTitleFromHtml(html, 'Q-Assets Announcement');
      const text = stripHtml(html);
      const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

      items.push({
        type: 'announcement',
        identifier: hit.identifier,
        title,
        excerpt,
        created: payload.createdAt || hit.created || Date.now(),
        fullHtml: html,
        publisherName: hit.name,
        service: finalService,
      });
    } catch {
      // ignore broken resource
    }
    if (items.length >= limit) break;
  }

  return items.sort((a, b) => b.created - a.created).slice(0, limit);
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
