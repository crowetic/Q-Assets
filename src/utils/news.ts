import { Service } from 'qapp-core';
import { qaAnnouncementPrefix, assetNewsGlobalPrefix } from '../constants/qdnConstants';
import { NewsSummary } from '../types/newsAndPromos';
import { fetchPromotionApprovals } from './promotions';
import { searchSimpleByIdentifierPrefix } from './searchSimple';
import { stripHtml, extractTitleFromHtml, isManagementAdminPublisher } from './newsHelpers';
import { loadAnnouncementApprovalDoc } from './announcementApprovals';
import { getNewsPromoExpiryDays, publisherHasPermission } from './managementManifest';
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

type FetchNewsOptions = { includeExpired?: boolean };

export async function fetchAnnouncements(
  limit = 5,
  options?: FetchNewsOptions
): Promise<NewsSummary[]> {
  const includeExpired = options?.includeExpired ?? false;
  const expiryDays = Number(await getNewsPromoExpiryDays());
  const expiryCutoff =
    Number.isFinite(expiryDays) && expiryDays > 0 ? Date.now() - expiryDays * 86_400_000 : null;
  const approvalDoc = await loadAnnouncementApprovalDoc();
  const approvedEntries = approvalDoc.items || [];
  const items: NewsSummary[] = [];
  const seen = new Set<string>();

  const keyFor = (publisher: string, identifier: string) =>
    `${(publisher || '').toLowerCase()}::${identifier}`;

  const pushAnnouncement = async (
    publisher: string,
    identifier: string,
    service: Service | undefined,
    createdHint?: number
  ) => {
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: publisher,
        service: service || ('DOCUMENT' as Service),
        identifier,
        encoding: 'base64',
      });
      const payload = await decodeAnnouncementResource(res?.data64 ?? res);
      if (!payload) return false;
      const html = payload.html;
      const title = payload.title || extractTitleFromHtml(html, 'Q-Assets Announcement');
      const text = stripHtml(html);
      const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

      const created = payload.createdAt || createdHint || Date.now();
      const isExpired = expiryCutoff != null && created < expiryCutoff;
      if (!includeExpired && isExpired) return false;

      items.push({
        type: 'announcement',
        identifier,
        title,
        excerpt,
        created,
        isExpired: Boolean(isExpired),
        fullHtml: html,
        publisherName: publisher,
        service,
      });
      return true;
    } catch {
      return false;
    }
  };

  if (approvedEntries.length) {
    const ordered = approvedEntries
      .slice()
      .sort((a, b) => (b.approvedAt || b.createdAt || 0) - (a.approvedAt || a.createdAt || 0));

    for (const entry of ordered) {
      const dedupeKey = keyFor(entry.publisher, entry.identifier);
      if (seen.has(dedupeKey)) continue;
      const createdHint = entry.approvedAt || entry.createdAt || Date.now();
      const added = await pushAnnouncement(
        entry.publisher,
        entry.identifier,
        entry.service,
        createdHint
      );
      if (added) {
        seen.add(dedupeKey);
      }
      if (items.length >= limit) break;
    }
  }

  // Also surface admin-published announcements even if not explicitly approved
  if (items.length < limit) {
    const [docHits, jsonHits] = await Promise.all([
      searchSimpleByIdentifierPrefix('DOCUMENT', qaAnnouncementPrefix),
      searchSimpleByIdentifierPrefix('JSON', qaAnnouncementPrefix).catch(() => []),
    ]);
    const allHits = [...docHits, ...jsonHits].sort(
      (a, b) => (b.created || b.updated || 0) - (a.created || a.updated || 0)
    );

    for (const hit of allHits) {
      const dedupeKey = keyFor(hit.name, hit.identifier);
      if (seen.has(dedupeKey)) continue;
      const allowed = await canPublishAnnouncement(hit.name);
      if (!allowed) continue;
      const finalService = (hit.service as Service) || ('DOCUMENT' as Service);
      const added = await pushAnnouncement(hit.name, hit.identifier, finalService, hit.created);
      if (added) {
        seen.add(dedupeKey);
      }
      if (items.length >= limit) break;
    }
  }

  return items.sort((a, b) => b.created - a.created).slice(0, limit);
}

export async function fetchLatestAssetNews(
  limit = 10,
  options?: FetchNewsOptions
): Promise<NewsSummary[]> {
  const includeExpired = options?.includeExpired ?? false;
  const expiryDays = Number(await getNewsPromoExpiryDays());
  const expiryCutoff =
    Number.isFinite(expiryDays) && expiryDays > 0 ? Date.now() - expiryDays * 86_400_000 : null;
  const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', assetNewsGlobalPrefix);
  if (!hits.length) return [];

  const items: NewsSummary[] = [];
  const seen = new Set<string>();

  for (const hit of hits) {
    const dedupeKey = `${hit.name}::${hit.identifier}`;
    if (seen.has(dedupeKey)) continue;
    seen.add(dedupeKey);
    const finalService = hit.service ? (hit.service as Service) : ('DOCUMENT' as Service);
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: hit.name,
        service: finalService,
        identifier: hit.identifier,
        encoding: 'base64',
      });

      const newsObject = await base64ToObject(res.data64 ?? res);
      const html = newsObject.fullHtml;
      const text = stripHtml(html);
      const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

      // Try to derive assetId from identifier: asset_news_pub__<assetId>__<id6>
      let assetId: number | undefined;
      const m = hit.identifier.match(/^asset_news_pub__([0-9]+)__/);
      if (m && m[1]) {
        assetId = Number(m[1]);
      }

      const assetName = assetId != null ? `Asset #${assetId}` : undefined;

      const title = newsObject.title;

      const titleExtracted = extractTitleFromHtml(
        html,
        assetId != null ? `News for ${assetName}` : 'Asset news'
      );

      const finalTitle = typeof title == 'string' ? title : titleExtracted;

      const created = hit.created || hit.updated || Date.now();
      const isExpired = expiryCutoff != null && created < expiryCutoff;
      if (!includeExpired && isExpired) continue;

      items.push({
        type: 'assetNews',
        identifier: hit.identifier,
        title: finalTitle,
        excerpt,
        created,
        isExpired: Boolean(isExpired),
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
