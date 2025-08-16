// src/utils/wikiAccess.ts
import pLimit from 'p-limit';
import { WIKI_GROUP_ID, WIKI_IDENTIFIER_PREFIX, WIKI_SECTIONS } from '../constants/wiki';
import { getPrimaryAccountName } from '../utils/qortalApi';
import { uint8ArrayToBase64, utf8ToBase64 } from './data';

// -------------------------------------------------------------
// Types
// -------------------------------------------------------------
export type LoadedSection = {
  id: string;
  title: string;
  tags?: string[];
  html: string | null;
  publisher?: string;
  publisherRole?: 'admin' | 'member';
  timestamp?: number;
};

type GroupMemberRow = { address?: string; member?: string; isAdmin?: boolean };
type Member = { name: string; isAdmin: boolean };

export type WikiMenuItem = { id: string; title: string; tags?: string[] };

// -------------------------------------------------------------
// Small cache so we don’t refetch group lists every render/poll
// -------------------------------------------------------------
const CACHE_TTL_MS = 60_000;
let _addrCache:
  | { memberAddrs: Set<string>; adminAddrs: Set<string>; at: number }
  | null = null;

const normAddr = (s?: string) => (s || '').trim();

// -------------------------------------------------------------
// Group fetchers (paged)
// -------------------------------------------------------------
async function fetchMembersPage(opts: { onlyAdmins: boolean; offset: number; limit: number }) {
  const { onlyAdmins, offset, limit } = opts;
  const url =
    `/groups/members/${WIKI_GROUP_ID}` +
    `?onlyAdmins=${onlyAdmins ? 'true' : 'false'}` +
    `&limit=${limit}&offset=${offset}&reverse=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Group members fetch failed: ${res.status} ${res.statusText}`);
  return (await res.json()) as GroupMemberRow[];
}

// async function fetchAllRows(onlyAdmins: boolean): Promise<GroupMemberRow[]> {
//   const out: GroupMemberRow[] = [];
//   const size = 200;
//   let offset = 0;
//   for (;;) {
//     const page = await fetchMembersPage({ onlyAdmins, offset, limit: size });
//     if (!page?.length) break;
//     out.push(...page);
//     if (page.length < size) break;
//     offset += page.length;
//   }
//   return out;
// }

type GroupMembersResponse =
  | { memberCount?: number; adminCount?: number; members?: GroupMemberRow[] }
  | GroupMemberRow[];

// Parse both new ({members:[...]}) and old ([...]) shapes defensively
function parseMembersPayload(json: GroupMembersResponse): GroupMemberRow[] {
  if (Array.isArray(json)) return json as GroupMemberRow[];
  if (json && Array.isArray((json as any).members)) return (json as any).members as GroupMemberRow[];
  return [];
}

async function fetchGroupMembersRaw(): Promise<GroupMemberRow[]> {
  // If your node supports unlimited with limit=0, keep it. Otherwise bump higher than your group size.
  const url = `/groups/members/${WIKI_GROUP_ID}?limit=0&reverse=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Group members fetch failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as GroupMembersResponse;
  return parseMembersPayload(json);
}

// Backward-compatible “filtered” fetchers so the rest of the module is unchanged
async function fetchAllRows(onlyAdmins: boolean): Promise<GroupMemberRow[]> {
  const rows = await fetchGroupMembersRaw();
  return onlyAdmins ? rows.filter(r => r.isAdmin === true) : rows;
}

// (Kept for compatibility with your existing call sites; delegates to fetchAllRows)
async function fetchAll(onlyAdmins: boolean): Promise<GroupMemberRow[]> {
  return fetchAllRows(onlyAdmins);
}

// -------------------------------------------------------------
// Address sets (fast membership checks) with cache
// -------------------------------------------------------------
export async function getGroupAddressSets(): Promise<{
  memberAddrs: Set<string>;
  adminAddrs: Set<string>;
}> {
  const now = Date.now();
  if (_addrCache && now - _addrCache.at < CACHE_TTL_MS) {
    return { memberAddrs: _addrCache.memberAddrs, adminAddrs: _addrCache.adminAddrs };
  }

  try {
    const [adminsRaw, membersRaw] = await Promise.all([fetchAllRows(true), fetchAllRows(false)]);
    const memberAddrs = new Set(membersRaw.map((r) => normAddr(r.member || r.address)));
    const adminAddrs = new Set(adminsRaw.map((r) => normAddr(r.member || r.address)));

    // admins are members too
    for (const a of adminAddrs) memberAddrs.add(a);

    _addrCache = { memberAddrs, adminAddrs, at: now };
    // console.debug('[wikiAccess] members', memberAddrs.size, 'admins', adminAddrs.size);
    return { memberAddrs, adminAddrs };
  } catch (e) {
    console.error('getGroupAddressSets error:', e);
    return { memberAddrs: new Set(), adminAddrs: new Set() };
  }
}

export async function isAddressInManagementGroup(address?: string | null): Promise<boolean> {
  if (!address) return false;
  const { memberAddrs } = await getGroupAddressSets();
  return memberAddrs.has(normAddr(address));
}

export async function isAddressAdminInManagementGroup(address?: string | null): Promise<boolean> {
  if (!address) return false;
  const { adminAddrs } = await getGroupAddressSets();
  return adminAddrs.has(normAddr(address));
}

// -------------------------------------------------------------
// Name-mapped list (for QDN IO). We still need names to read/publish.
// -------------------------------------------------------------
export async function listManagementGroupMembers(): Promise<Member[]> {
  try {
    const { memberAddrs, adminAddrs } = await getGroupAddressSets();
    const addrs = Array.from(memberAddrs);
    const limit = pLimit(8);
    console.log('memberAddresses',memberAddrs)
    console.log('adminAddresses', adminAddrs)
    const nameRecs = await Promise.all(
      addrs.map((addr) =>
        limit(async () => {
          try {
            const nm = await getPrimaryAccountName(addr);
            if (!nm) return null;
            console.log('namefromListManagementGroupMembers',nm)
            return { name: nm, isAdmin: adminAddrs.has(normAddr(addr)) } as Member;
          } catch {
            return null;
          }
        })
      )
    );

    // de-dupe names (case-insensitive), keep admin=true if any duplicate was admin
    const map = new Map<string, Member>();
    for (const rec of nameRecs) {
      if (!rec) continue;
      const k = rec.name.toLowerCase();
      const prev = map.get(k);
      if (!prev || (rec.isAdmin && !prev.isAdmin)) map.set(k, rec);
    }
    return Array.from(map.values());
  } catch (e) {
    console.error('listManagementGroupMembers error:', e);
    return [];
  }
}

// Legacy name checks (OK to keep for parity; prefer address checks in UI)
export async function isNameInManagementGroup(name?: string|null ): Promise<boolean> {
  if (!name) return false;
  const members = await listManagementGroupMembers();
  return members.some((m) => m.name.toLowerCase() === name.toLowerCase());
}

export async function isNameAdminInManagementGroup(name?: string | null): Promise<boolean> {
  if (!name) return false;
  const members = await listManagementGroupMembers();
  return members.some((m) => m.name.toLowerCase() === name.toLowerCase() && m.isAdmin);
}

// Convenience for UI: explain *why* publish is disabled
export async function checkPublishEligibility(address?: string | null, name?: string | null) {
  const inGroup = await isAddressInManagementGroup(address);
  if (!inGroup) return { canPublish: false, reason: 'Requires membership in Q-Assets-Management.' };
  if (!name) return { canPublish: false, reason: 'Your account needs a registered Qortal name to publish.' };
  return { canPublish: true as const, reason: '' };
}

export async function isUserInManagementGroup(opts: { address?: string | null; name?: string | null }): Promise<boolean> {
  if (await isAddressInManagementGroup(opts.address)) return true;
  return isNameInManagementGroup(opts.name);
}

// -------------------------------------------------------------
// QDN helpers / IO
// -------------------------------------------------------------
type QdnFetchResult = { data64: string; name: string; created?: number; updated?: number };

async function fetchQdnDocument(name: string, identifier: string): Promise<QdnFetchResult | null> {
  try {
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name,
      service: 'DOCUMENT',
      identifier,
      encoding: 'base64',
    } as any);
    return res as QdnFetchResult;
  } catch {
    return null;
  }
}

export async function publishWikiSection(
  sectionId: string,
  html: string,
  publisherName?: string | undefined,
  publisherAddress?: string | null
) {
  // Use the same membership logic as the UI (address OR name)
  const ok = await isUserInManagementGroup({
    address: publisherAddress ?? undefined,
    name: publisherName ?? undefined,
  });
  const data64 = utf8ToBase64(html)

  if (!ok) {
    throw new Error('You are not a member of Q-Assets-Management; cannot publish.');
  }

  const identifier = `${WIKI_IDENTIFIER_PREFIX}${sectionId}`;
  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    name: publisherName, // QDN still needs the NAME to publish under; ensure you pass it
    service: 'DOCUMENT',
    identifier,
    data64,
  });
}

// -------------------------------------------------------------
// Sections: load winner (admin > member) for each section id
// -------------------------------------------------------------
export async function loadSectionFromGroup(sectionId: string) {
  const members = await listManagementGroupMembers(); // need names for QDN pulls
  if (!members.length) return null;

  const identifier = `${WIKI_IDENTIFIER_PREFIX}${sectionId}`;
  const limit = pLimit(6);

  const attempts = await Promise.all(
    members.map((m) =>
      limit(async () => {
        const doc = await fetchQdnDocument(m.name, identifier);
        if (!doc?.data64) return null;
        const ts = Number(doc.updated ?? doc.created ?? 0) || Date.now();
        const html = atob(doc.data64);
        return { html, ts, name: m.name, role: m.isAdmin ? 'admin' : 'member' } as const;
      })
    )
  );

  const valid = attempts.filter(Boolean) as Array<{ html: string; ts: number; name: string; role: 'admin' | 'member' }>;
  if (!valid.length) return null;

  const admin = valid.filter((v) => v.role === 'admin').sort((a, b) => b.ts - a.ts)[0];
  const member = valid.filter((v) => v.role === 'member').sort((a, b) => b.ts - a.ts)[0];
  const pick = admin ?? member;
  return { html: pick.html, publisher: pick.name, publisherRole: pick.role, ts: pick.ts };
}

// Accepts optional meta so both call sites work:
//   loadAllWikiSections()                      -> uses WIKI_SECTIONS
//   loadAllWikiSections(customMetaArray)       -> uses your array
export async function loadAllWikiSections(
  meta: { id: string; title: string; tags?: string[] }[] = WIKI_SECTIONS
): Promise<LoadedSection[]> {
  const limit = pLimit(3);
  return Promise.all(
    meta.map((m) =>
      limit(async () => {
        const remote = await loadSectionFromGroup(m.id).catch(() => null);
        return {
          id: m.id,
          title: m.title,
          tags: m.tags,
          html: remote?.html ?? null,
          publisher: remote?.publisher,
          publisherRole: remote?.publisherRole,
          timestamp: remote?.ts,
        } as LoadedSection;
      })
    )
  );
}

// -------------------------------------------------------------
// MENU (TOC) — admin > member priority
// -------------------------------------------------------------
const WIKI_MENU_IDENTIFIER = `${WIKI_IDENTIFIER_PREFIX}__menu`;

export async function loadWikiMenu(): Promise<{ items: WikiMenuItem[]; publisher?: string; role?: 'admin' | 'member'; ts?: number } | null> {
  const members = await listManagementGroupMembers();
  if (!members.length) return null;

  const limit = pLimit(6);
  const attempts = await Promise.all(
    members.map(async (m) => {
      const doc = await fetchQdnDocument(m.name, WIKI_MENU_IDENTIFIER);
      if (!doc?.data64) return null;
      try {
        const json = atob(doc.data64);
        const parsed = JSON.parse(json) as { items: WikiMenuItem[] };
        const ts = Number(doc.updated ?? doc.created ?? 0) || Date.now();
        return { items: parsed.items || [], publisher: m.name, role: m.isAdmin ? 'admin' : 'member', ts };
      } catch {
        return null;
      }
    })
  );

  const valid = attempts.filter(Boolean) as Array<{ items: WikiMenuItem[]; publisher: string; role: 'admin' | 'member'; ts: number }>;
  if (!valid.length) return null;

  const admin = valid.filter((v) => v.role === 'admin').sort((a, b) => b.ts - a.ts)[0];
  const member = valid.filter((v) => v.role === 'member').sort((a, b) => b.ts - a.ts)[0];
  return admin ?? member ?? null;
}

export async function saveWikiMenu(items: WikiMenuItem[], publisherName: string) {
  const ok = await isNameInManagementGroup(publisherName);
  if (!ok) throw new Error('You are not a member of Q-Assets-Management; cannot publish menu.');
  const payload = btoa(JSON.stringify({ items }));
  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    name: publisherName,
    service: 'DOCUMENT',
    identifier: WIKI_MENU_IDENTIFIER,
    data64: payload,
  });
}
