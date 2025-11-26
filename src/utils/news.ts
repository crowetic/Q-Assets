import { Service } from 'qapp-core';
import { qaAnnouncementPrefix, assetNewsGlobalPrefix } from '../constants/qdnConstants';
import { NewsSummary } from '../types/newsAndPromos';
import { fetchPromotionApprovals } from './promotions';
import { searchSimpleByIdentifierPrefix } from './searchSimple';
import { stripHtml, extractTitleFromHtml, isManagementAdminPublisher } from './newsHelpers';
import { loadAnnouncementApprovalDoc } from './announcementApprovals';
import { getNewsPromoExpiryDays, publisherHasPermission } from './managementManifest';
import { base64ToObject, base64ToUtf8 } from './data';
import { getCached, setCached } from './cache';

async function canPublishAnnouncement(publisher: string): Promise<boolean> {
  try {
    return await publisherHasPermission(publisher, 'announcements.publish');
  } catch {
    return isManagementAdminPublisher(publisher);
  }
}

const decodeAnnouncementResource = async (data64?: string | null) => {
  if (!data64 || typeof data64 !== 'string') return null;

  // Attempt JSON first
  try {
    const parsed = await base64ToObject(data64);
    if (parsed && typeof parsed === 'object' && typeof (parsed as any).html === 'string') {
      return {
        html: (parsed as any).html as string,
        title: typeof (parsed as any).title === 'string' ? (parsed as any).title : undefined,
        createdAt:
          typeof (parsed as any).createdAt === 'number' ? (parsed as any).createdAt : undefined,
      };
    }
  } catch {
    /* fall back to utf8 decode */
  }

  // Fallback: treat as plain HTML payload
  try {
    const decoded = base64ToUtf8(data64);
    if (decoded) return { html: decoded };
  } catch {
    /* ignore */
  }

  // Last-resort: atob
  try {
    const decoded = atob(data64);
    if (decoded) return { html: decoded };
  } catch {
    /* ignore */
  }

  return null;
};

type FetchNewsOptions = { includeExpired?: boolean };

const LIST_CACHE_MS = 60_000;
const ITEM_CACHE_MS = 5 * 60_000;

export async function fetchAnnouncements(
  limit = 5,
  options?: FetchNewsOptions
): Promise<NewsSummary[]> {
  try {
    const includeExpired = options?.includeExpired ?? false;
    const listKey = `ann:list:${includeExpired}:${limit}`;
    const cachedList = getCached<NewsSummary[]>(listKey);
    if (cachedList) return cachedList;

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
        const svc = service || ('DOCUMENT' as Service);
        const cacheKey = `ann:item:${(publisher || '').toLowerCase()}:${svc}:${identifier}`;
        let payload: { html: string; title?: string; createdAt?: number } | null | undefined =
          getCached(cacheKey);

        if (!payload) {
          const res = await qortalRequest({
            action: 'FETCH_QDN_RESOURCE',
            name: publisher,
            service: svc,
            identifier,
            encoding: 'base64',
          });
          payload = await decodeAnnouncementResource(res?.data64 ?? res);
          if (payload) setCached(cacheKey, payload, ITEM_CACHE_MS);
        }

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
      let docHits: Awaited<ReturnType<typeof searchSimpleByIdentifierPrefix>> = [];
      let jsonHits: Awaited<ReturnType<typeof searchSimpleByIdentifierPrefix>> = [];
      try {
        [docHits, jsonHits] = await Promise.all([
          searchSimpleByIdentifierPrefix('DOCUMENT', qaAnnouncementPrefix, limit),
          searchSimpleByIdentifierPrefix('JSON', qaAnnouncementPrefix, limit).catch(() => []),
        ]);
      } catch (e) {
        console.warn('Failed to fetch announcement list', e);
      }
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

    const finalList = items.sort((a, b) => b.created - a.created).slice(0, limit);
    setCached(listKey, finalList, LIST_CACHE_MS);
    return finalList;
  } catch (e) {
    console.warn('fetchAnnouncements failed', e);
    return [];
  }
}

export async function fetchLatestAssetNews(
  limit = 10,
  options?: FetchNewsOptions
): Promise<NewsSummary[]> {
  try {
    const includeExpired = options?.includeExpired ?? false;
    const listKey = `assetnews:list:${includeExpired}:${limit}`;
    const cachedList = getCached<NewsSummary[]>(listKey);
    if (cachedList) return cachedList;

    const expiryDays = await getNewsPromoExpiryDays();
    const expiryCutoff =
      typeof expiryDays === 'number' && expiryDays > 0
        ? Date.now() - expiryDays * 86_400_000
        : null;
    let hits: Awaited<ReturnType<typeof searchSimpleByIdentifierPrefix>> = [];
    try {
      hits = await searchSimpleByIdentifierPrefix('DOCUMENT', assetNewsGlobalPrefix, limit);
    } catch (e) {
      console.warn('Failed to fetch asset news list', e);
      return [];
    }
    if (!hits.length) return [];

    const items: NewsSummary[] = [];
    const seen = new Set<string>();

    for (const hit of hits) {
      const dedupeKey = `${hit.name}::${hit.identifier}`;
      if (seen.has(dedupeKey)) continue;
      seen.add(dedupeKey);
      const finalService = hit.service ? (hit.service as Service) : ('DOCUMENT' as Service);
      try {
        const payloadKey = `assetnews:item:${hit.name.toLowerCase()}:${finalService}:${hit.identifier}`;
        let payload = getCached<{ html: string; title?: string; createdAt?: number }>(payloadKey);

        if (!payload) {
          const res = await qortalRequest({
            action: 'FETCH_QDN_RESOURCE',
            name: hit.name,
            service: finalService,
            identifier: hit.identifier,
            encoding: 'base64',
          });

          const raw = res?.data64 ?? res;
          let html = '';
          let title: string | undefined;
          let createdAt: number | undefined;

          try {
            const parsed = await base64ToObject(raw);
            if (parsed && typeof parsed === 'object') {
              html = parsed.html || parsed.fullHtml || '';
              title = parsed.title;
              createdAt = parsed.updatedAt || parsed.createdAt || hit.updated || hit.created;
            }
          } catch {
            /* fallback below */
          }

          if (!html && typeof raw === 'string') {
            try {
              html = atob(raw);
            } catch {
              try {
                html = base64ToUtf8(raw);
              } catch {
                html = String(raw);
              }
            }
          }
          if (!html) console.log('wtfnohtml', html);
          if (!html) continue;
          payload = { html, title, createdAt };
          setCached(payloadKey, payload, ITEM_CACHE_MS);
        }

        const html = payload.html;
        let title = payload.title;
        const createdAt = payload.createdAt;

        const text = stripHtml(html);
        const excerpt = text.slice(0, 220) + (text.length > 220 ? '…' : '');

        // Try to derive assetId from identifier: asset_news_pub__<assetId>__<id6>
        let assetId: number | undefined;
        const m = hit.identifier.match(/^asset_news_pub__([0-9]+)__/);
        if (m && m[1]) {
          assetId = Number(m[1]);
        }

        const assetName = assetId != null ? `Asset #${assetId}` : undefined;

        title = extractTitleFromHtml(
          html,
          assetId != null ? `News for ${assetName}` : 'Asset news'
        );
        // const finalTitle = typeof title === 'string' && title.trim() ? title : titleExtracted;

        const created = createdAt || hit.updated || hit.created || Date.now();
        const isExpired = expiryCutoff != null && created < expiryCutoff;
        if (!includeExpired && isExpired) continue;

        items.push({
          type: 'assetNews',
          identifier: hit.identifier,
          title,
          excerpt,
          created,
          isExpired: Boolean(isExpired),
          assetId,
          assetName,
          fullHtml: html,
          publisherName: hit.name,
          service: finalService,
        });
      } catch (err) {
        console.warn('Failed to fetch asset news item', err);
      }
    }

    // Sort latest first and trim to limit
    const finalList = items.sort((a, b) => b.created - a.created).slice(0, limit);
    setCached(listKey, finalList, LIST_CACHE_MS);
    return finalList;
  } catch (e) {
    console.warn('fetchLatestAssetNews failed', e);
    return [];
  }
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
