// utils/notifyIndex.ts
import { objectToBase64, Service } from 'qapp-core'; // or your './data' helper
import pLimit from 'p-limit';
import { fetchGroupMembers } from '../utils/access'; // your code you pasted
import { searchSimpleByFullId } from '../utils/searchSimple';
import { getAllAccountNames, getPrimaryAccountName } from '../utils/qortalApi';
// import { base64ToObject } if you want a typed parse; here we JSON.parse manually

/* ------------------------------- Config -------------------------------- */
const INDEX_PREFIX = 'qassets_notif_index::';
const INDEX_SERVICE: 'JSON' | 'DOCUMENT' = 'JSON'; // change if you want DOCUMENT
const INDEX_MAX_ENTRIES = 1000; // guardrail
export const NOTIF_GROUP_ID = 735; // <- set your real notifications group id

/* -------------------------------- Types -------------------------------- */
export interface IndexItem {
  rid: string; // e.g. "JSON/<publisher>/<notifId>" (or DOCUMENT/... if you publish documents)
  createdAt: number; // ms epoch
  priority?: 'low' | 'normal' | 'high';
}

type SearchHit = {
  service: Service;
  identifier: string;
  name: string; // publisher name
  updated?: number; // ms (prefer updated)
  created?: number; // ms
  timestamp?: number; // some cores expose timestamp
};

/* ------------------------------ Helpers -------------------------------- */

// Resolve *all* Qortal names for a single address (deduped). You already have
// getAllAccountNames + getPrimaryAccountName, so we use those.
async function namesForAddress(address: string): Promise<string[]> {
  try {
    const names = await getAllAccountNames(address).catch(() => null);
    const list: string[] = Array.isArray(names) ? names.map(String) : [];
    if (!list.length) {
      const primary = await getPrimaryAccountName(address).catch(() => null);
      if (primary) list.push(String(primary));
    }
    // de-dupe (case-insensitive), keep first spelling
    const seen = new Set<string>();
    return list.filter((n) => {
      const k = encodeURIComponent(n.toLowerCase());
      if (seen.has(k)) return false;
      seen.add(k);
      return !!n.trim();
    });
  } catch {
    return [];
  }
}

// Build a set of **admin publisher names** for a group
async function getAdminNameSet(groupId: number): Promise<Set<string>> {
  const rows = await fetchGroupMembers(true, groupId); // onlyAdmins=true
  const addrs = rows.map((r) => String(r.member || r.address || '').trim()).filter(Boolean);

  const limit = pLimit(6);
  const allNames = (
    await Promise.all(addrs.map((addr) => limit(() => namesForAddress(addr))))
  ).flat();

  // set of lower-cased names for filtering
  return new Set(allNames.map((n) => n.toLowerCase()));
}

// Extract a monotonic timestamp from a hit
function hitTime(h: SearchHit): number {
  return Number(h.updated ?? h.timestamp ?? h.created ?? 0) || 0;
}

// Pick the latest admin publish for identifier+service
function pickLatestAdminPublish(
  hits: SearchHit[],
  adminNames: Set<string>,
  service: 'JSON' | 'DOCUMENT',
  identifier: string
): SearchHit | null {
  const filtered = hits.filter(
    (h) =>
      h.identifier === identifier &&
      h.service?.toUpperCase() === service &&
      h.name &&
      adminNames.has(h.name.toLowerCase())
  );
  if (!filtered.length) return null;
  return filtered.sort((a, b) => hitTime(b) - hitTime(a))[0];
}

// Fetch & parse index from a specific publish (admin)
async function fetchIndexFromPublish(p: {
  service: Service;
  identifier: string;
  name: string;
}): Promise<IndexItem[]> {
  const res = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    service: p.service,
    name: p.name,
    identifier: p.identifier,
    encoding: 'BASE64',
  }).catch(() => null);

  const b64 = (res && (res.data64 ?? res)) as string | undefined;
  if (!b64 || typeof b64 !== 'string') return [];
  try {
    const json = atob(b64);
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

// Merge (replace same rid), sort newest→oldest, cap length
function mergeIndex(existing: IndexItem[], incoming: IndexItem): IndexItem[] {
  const seen = new Set<string>();
  const out: IndexItem[] = [];
  for (const it of existing) {
    if (!it || typeof it.rid !== 'string') continue;
    if (it.rid === incoming.rid) continue; // replaced by incoming
    if (!seen.has(it.rid)) {
      seen.add(it.rid);
      out.push(it);
    }
  }
  if (!seen.has(incoming.rid)) out.push(incoming);
  out.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
  if (out.length > INDEX_MAX_ENTRIES) out.length = INDEX_MAX_ENTRIES;
  return out;
}

/* ------------------------------- Writer -------------------------------- */

/**
 * Append/replace one item in a scope's index.
 * Reads latest admin-published index (via searchSimpleByFullId),
 * merges, and republishes (caller must be an admin of the group).
 */
export async function appendToIndex(
  scopeKey: string,
  newItem: IndexItem,
  opts?: { groupId?: number; service?: 'JSON' | 'DOCUMENT' }
) {
  const groupId = opts?.groupId ?? NOTIF_GROUP_ID;
  const service = opts?.service ?? INDEX_SERVICE;
  const identifier = `${INDEX_PREFIX}${scopeKey}`;

  // 1) resolve set of admin names (lower-case)
  const adminNames = await getAdminNameSet(groupId);

  // 2) find all publishes of this identifier
  const hits = await searchSimpleByFullId(identifier);

  // 3) pick latest admin publish (if any)
  const latest = pickLatestAdminPublish(hits as any, adminNames, service, identifier);

  // 4) fetch current index or start from empty
  let existing: IndexItem[] = [];
  if (latest) {
    existing = await fetchIndexFromPublish({
      service: latest.service,
      identifier: latest.identifier,
      name: latest.name,
    }).catch(() => []);
  }

  // 5) merge
  const updated = mergeIndex(existing, newItem);

  // 6) publish back under current user (should be admin — Core enforces anyway)
  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service,
    identifier,
    data64: await objectToBase64(updated),
  });
}

/* -------------------------------- Reader -------------------------------- */

/**
 * Load index for a scope **from the latest admin publish** only.
 * Returns array plus who we read from.
 */
export async function loadIndex(
  scopeKey: string,
  opts?: { groupId?: number; service?: 'JSON' | 'DOCUMENT' }
): Promise<{ items: IndexItem[]; publisher?: string; ts?: number } | null> {
  const groupId = opts?.groupId ?? NOTIF_GROUP_ID;
  const service = opts?.service ?? INDEX_SERVICE;
  const identifier = `${INDEX_PREFIX}${scopeKey}`;

  const adminNames = await getAdminNameSet(groupId);
  const hits = await searchSimpleByFullId(identifier);
  const latest = pickLatestAdminPublish(hits as any, adminNames, service, identifier);
  if (!latest) return null;

  const items = await fetchIndexFromPublish({
    service: latest.service,
    identifier: latest.identifier,
    name: latest.name,
  });

  return { items, publisher: latest.name, ts: hitTime(latest) };
}
