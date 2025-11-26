import { Service } from 'qapp-core';
import { qaAnnouncementHeadId, qaAnnouncementPrefix } from '../constants/qdnConstants';
import {
  searchSimpleByFullId,
  searchSimpleByIdentifierPrefix,
  type SimpleHit,
} from './searchSimple';
import { base64ToUtf8, objectToBase64, base64ToObject } from './data';
import { extractTitleFromHtml, isManagementAdminPublisher, stripHtml } from './newsHelpers';
import { publisherHasPermission } from './managementManifest';

async function canPublisherSubmit(publisher: string): Promise<boolean> {
  try {
    return await publisherHasPermission(publisher, 'announcements.publish');
  } catch {
    return isManagementAdminPublisher(publisher);
  }
}

const APPROVAL_DOC_VERSION = 1;
const MAX_APPROVAL_ITEMS = 200;

export interface AnnouncementApprovalEntry {
  identifier: string;
  publisher: string;
  service: Service;
  createdAt: number;
  approvedAt: number;
  approvedBy?: string;
}

export interface AnnouncementApprovalDoc {
  version: number;
  items: AnnouncementApprovalEntry[];
}

export interface PendingAnnouncementSummary {
  identifier: string;
  publisherName: string;
  service: Service;
  createdAt: number;
  title: string;
  excerpt: string;
  fullHtml: string;
}

const approvalKey = (publisher: string, identifier: string) =>
  `${(publisher || '').toLowerCase()}::${identifier}`;

const normalizeEntry = (entry: any): AnnouncementApprovalEntry | null => {
  if (!entry || typeof entry !== 'object') return null;
  if (!entry.identifier || !entry.publisher) return null;
  const service = (entry.service || 'DOCUMENT').toString().toUpperCase() as Service;
  return {
    identifier: String(entry.identifier),
    publisher: String(entry.publisher),
    service,
    createdAt: Number(entry.createdAt || Date.now()),
    approvedAt: Number(entry.approvedAt || Date.now()),
    approvedBy: entry.approvedBy ? String(entry.approvedBy) : undefined,
  };
};

async function fetchApprovalDocHit(): Promise<SimpleHit | null> {
  const hits = await searchSimpleByFullId(qaAnnouncementHeadId, false);
  if (!hits.length) return null;

  const adminHits: SimpleHit[] = [];
  for (const hit of hits) {
    if (await isManagementAdminPublisher(hit.name)) {
      adminHits.push(hit);
    }
  }

  const source = adminHits.length ? adminHits : hits;
  return source
    .slice()
    .sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0))[0];
}

export async function loadAnnouncementApprovalDoc(): Promise<AnnouncementApprovalDoc> {
  const hit = await fetchApprovalDocHit();
  if (!hit) return { version: APPROVAL_DOC_VERSION, items: [] };
  try {
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: hit.name,
      service: (hit.service as Service) || 'DOCUMENT',
      identifier: qaAnnouncementHeadId,
      encoding: 'base64',
    });
    const data64 = res?.data64 ?? res;
    if (!data64 || typeof data64 !== 'string') {
      return { version: APPROVAL_DOC_VERSION, items: [] };
    }
    // const json = atob(data64);
    const parsed = await base64ToObject(data64);
    if (parsed && Array.isArray(parsed.items)) {
      const items = parsed.items
        .map((entry: any) => normalizeEntry(entry))
        .filter(Boolean) as AnnouncementApprovalEntry[];
      return { version: Number(parsed.version) || APPROVAL_DOC_VERSION, items };
    }
  } catch {
    /* ignore */
  }
  return { version: APPROVAL_DOC_VERSION, items: [] };
}

async function publishAnnouncementApprovalDoc(doc: AnnouncementApprovalDoc) {
  const payload = await objectToBase64({
    version: APPROVAL_DOC_VERSION,
    items: doc.items.slice(0, MAX_APPROVAL_ITEMS),
  });

  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: 'DOCUMENT',
    identifier: qaAnnouncementHeadId,
    data64: payload,
  });
}

const fetchAnnouncementPayload = async (
  hit: SimpleHit
): Promise<{ html: string; title?: string; createdAt?: number } | null> => {
  try {
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: hit.name,
      service: (hit.service as Service) || 'DOCUMENT',
      identifier: hit.identifier,
      encoding: 'base64',
    });
    const data64 = res?.data64 ?? res;
    if (!data64 || typeof data64 !== 'string') return null;
    try {
      const decoded = base64ToUtf8(data64);
      try {
        const parsed = base64ToObject(data64);
        if (parsed && typeof parsed.html === 'string') {
          return {
            html: parsed.html,
            title: typeof parsed.title === 'string' ? parsed.title : undefined,
            createdAt:
              typeof parsed.updatedAt === 'number'
                ? parsed.updatedAt
                : (parsed.createdAt ?? hit.created ?? hit.updated),
          };
        }
      } catch {
        /* plain HTML */
      }
      return { html: decoded };
    } catch {
      return null;
    }
  } catch {
    return null;
  }
};

export async function fetchPendingAnnouncementsDetailed(
  limit = 50
): Promise<PendingAnnouncementSummary[]> {
  const [hits, doc] = await Promise.all([
    searchSimpleByIdentifierPrefix('DOCUMENT', qaAnnouncementPrefix, limit),
    loadAnnouncementApprovalDoc(),
  ]);

  const approvedKeys = new Set(
    doc.items.map((entry) => approvalKey(entry.publisher, entry.identifier))
  );

  const pending: PendingAnnouncementSummary[] = [];
  const ordered = hits.slice().sort((a, b) => (b.created || 0) - (a.created || 0));

  for (const hit of ordered) {
    const key = approvalKey(hit.name, hit.identifier);
    if (approvedKeys.has(key)) continue;
    const allowed = await canPublisherSubmit(hit.name);
    // Admins can publish directly; they should not appear in the pending queue.
    if (await isManagementAdminPublisher(hit.name)) continue;
    if (!allowed) continue;
    const payload = await fetchAnnouncementPayload(hit);
    if (!payload) continue;
    const title = payload.title || extractTitleFromHtml(payload.html, 'Q-Assets Announcement');
    const excerpt = stripHtml(payload.html).slice(0, 220) + '…';
    pending.push({
      identifier: hit.identifier,
      publisherName: hit.name,
      service: (hit.service as Service) || 'DOCUMENT',
      createdAt: payload.createdAt || hit.created || Date.now(),
      title,
      excerpt,
      fullHtml: payload.html,
    });
    if (pending.length >= limit) break;
  }

  return pending;
}

export async function approveAnnouncement(
  announcement: PendingAnnouncementSummary,
  approverName?: string
) {
  const doc = await loadAnnouncementApprovalDoc();
  const key = approvalKey(announcement.publisherName, announcement.identifier);
  if (doc.items.some((item) => approvalKey(item.publisher, item.identifier) === key)) {
    return;
  }
  doc.items.unshift({
    identifier: announcement.identifier,
    publisher: announcement.publisherName,
    service: announcement.service || 'DOCUMENT',
    createdAt: announcement.createdAt,
    approvedAt: Date.now(),
    approvedBy: approverName || 'unknown',
  });
  if (doc.items.length > MAX_APPROVAL_ITEMS) doc.items.length = MAX_APPROVAL_ITEMS;
  await publishAnnouncementApprovalDoc(doc);
}

export async function removeAnnouncementApproval(identifier: string, publisher: string) {
  const doc = await loadAnnouncementApprovalDoc();
  const key = approvalKey(publisher, identifier);
  const filtered = doc.items.filter(
    (entry) => approvalKey(entry.publisher, entry.identifier) !== key
  );
  if (filtered.length === doc.items.length) return;
  doc.items = filtered;
  await publishAnnouncementApprovalDoc(doc);
}
