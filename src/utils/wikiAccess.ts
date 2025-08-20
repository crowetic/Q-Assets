import pLimit from 'p-limit';
import { WIKI_GROUP_ID, WIKI_IDENTIFIER_PREFIX, WIKI_SECTIONS } from '../constants/wiki';
import { getPrimaryAccountName } from '../utils/qortalApi';
import { base64ToObject, base64ToUtf8, uint8ArrayToBase64, utf8ToBase64 } from './data';
import { objectToBase64 } from 'qapp-core';

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
    // console.log('memberAddresses',memberAddrs)
    // console.log('adminAddresses', adminAddrs)
    const nameRecs = await Promise.all(
      addrs.map((addr) =>
        limit(async () => {
          try {
            const nm = await getPrimaryAccountName(addr);
            if (!nm) return null;
            // console.log('namefromListManagementGroupMembers',nm)
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


async function fetchQdnDocument(name: string, identifier: string): Promise<string | null> {
  try {
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name,
      service: 'DOCUMENT',
      identifier,
      encoding: 'base64',
    } as any);
    const final = base64ToUtf8(res)
    return final;
  } catch {
    return null;
  }
}

async function fetchDocHtml(name: string, identifier: string): Promise<string | null> {
  try {
    const b64 = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name,
      identifier,
      encoding: 'base64',
    });
    return base64ToUtf8(String(b64 || ''));
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
type Candidate = {
  name: string;                       // publisher name
  role: 'admin' | 'member';
  ts: number;
};
const limit = pLimit(6);

export async function loadSectionFromGroup(sectionId: string) {
  const members = await listManagementGroupMembers(); // must include: {name, isAdmin}
  if (!members?.length) return null;

  const identifier = `${WIKI_IDENTIFIER_PREFIX}${sectionId}`;

  // 1) discover who has this section via SEARCH (metadata only)
  const searchResults = await Promise.all(
    members.map(m =>
      limit(async () => {
        try {
          const res = await qortalRequest({
            action: 'SEARCH_QDN_RESOURCES',
            service: 'DOCUMENT',
            name: m.name,
            identifier, 
          });

          // Some nodes return an array; some a single result. Normalize to array.
          const rows = Array.isArray(res) ? res : (res ? [res] : []);
          if (!rows.length) return null;

          // Pick newest hit for this user
          const best = rows
            .filter((r: any) => (r.identifier) === (identifier))
            .sort((a: any, b: any) =>
              (Number(b.updated ?? b.created ?? 0) || 0) -
              (Number(a.updated ?? a.created ?? 0) || 0)
            )[0];

          if (!best) return null;

          return {
            name: m.name,
            role: m.isAdmin ? 'admin' as const : 'member' as const,
            ts: Number(best.updated ?? best.created ?? 0) || 0,
          } as Candidate;
        } catch {
          return null;
        }
      })
    )
  );

  const candidates = (searchResults.filter(Boolean) as Candidate[]);
  if (!candidates.length) return null;

  // 2) choose newest admin; else newest member
  const newestAdmin = candidates
    .filter(c => c.role === 'admin')
    .sort((a, b) => b.ts - a.ts)[0];
  const newestMember = candidates
    .filter(c => c.role === 'member')
    .sort((a, b) => b.ts - a.ts)[0];

  const pick = newestAdmin ?? newestMember;
  if (!pick) return null;

  // 3) fetch the actual document content from the chosen publisher
  const html = await fetchDocHtml(pick.name, identifier);
  if (!html) return null;

  return {
    html,
    publisher: pick.name,
    publisherRole: pick.role,
    ts: pick.ts,
  };
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



async function fetchQdnBase64(name: string, identifier: string): Promise<string | null> {
  try {
    // Ask QDN to return *base64* directly
    const data64 = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name,
      identifier,
      encoding: 'base64',
      rebuild: false,
    });
    return typeof data64 === 'string' && data64 ? data64 : null;
  } catch {
    return null;
  }
}

type Role = 'admin' | 'member';

// -------------------------------------------------------------
// MENU (TOC) — admin > member priority
// -------------------------------------------------------------
const WIKI_MENU_IDENTIFIER = `${WIKI_IDENTIFIER_PREFIX}__menu`;

export async function loadWikiMenu(): Promise<{
  items: WikiMenuItem[];
  publisher?: string;
  role?: Role;
  ts?: number;
} | null> {
  const members = await listManagementGroupMembers();
  if (!members?.length) return null;

  // 1) Discover who has the menu + their latest ts (newest admin wins)
  const discoveries = await Promise.all(
    members.map(m =>
      limit(async () => {
        try {
          const res = await qortalRequest({
            action: 'SEARCH_QDN_RESOURCES',
            service: 'DOCUMENT',
            name: m.name,
            identifier: WIKI_MENU_IDENTIFIER,
          });

          const rows = Array.isArray(res) ? res : (res ? [res] : []);
          if (!rows.length) return null;

          const best = rows
            .filter((r: any) => (r.identifier) === (WIKI_MENU_IDENTIFIER))
            .sort(
              (a: any, b: any) =>
                (Number(b.updated ?? b.created ?? 0) || 0) -
                (Number(a.updated ?? a.created ?? 0) || 0)
            )[0];

          if (!best) return null;

          return {
            name: m.name as string,
            role: (m.isAdmin ? 'admin' : 'member') as Role,
            ts: Number(best.updated ?? best.created ?? 0) || 0,
          };
        } catch {
          return null;
        }
      })
    )
  );

  const candidates = (discoveries.filter(Boolean) as Array<{ name: string; role: Role; ts: number }>);
  if (!candidates.length) return null;

  const newestAdmin = candidates.filter(c => c.role === 'admin').sort((a, b) => b.ts - a.ts)[0];
  const newestMember = candidates.filter(c => c.role === 'member').sort((a, b) => b.ts - a.ts)[0];
  const pick = newestAdmin ?? newestMember;
  if (!pick) return null;

  // 2) Fetch chosen publisher’s doc (base64), decode → JSON ARRAY of WikiMenuItem
  const data64 = await fetchQdnBase64(pick.name, WIKI_MENU_IDENTIFIER);
  if (!data64) return null;

  let itemsRaw: unknown;
  try {
    itemsRaw = await base64ToObject(data64);
  } catch {
    return null;
  }

  if (!Array.isArray(itemsRaw)) return null;

  // 3) Normalize and validate items
  const items: WikiMenuItem[] = (itemsRaw as any[]).map((it) => ({
    id: (it?.id),
    title: String(it?.title ?? '').trim(),
    tags: Array.isArray(it?.tags) ? it.tags.map((t: any) => String(t).trim()).filter(Boolean) : [],
  })).filter(it => it.id && it.title);

  return { items, publisher: pick.name, role: pick.role, ts: pick.ts };
}

export async function saveWikiMenu(items: WikiMenuItem[], publisherName: string) {
  const ok = await isNameInManagementGroup(publisherName);
  if (!ok) throw new Error('You are not a member of Q-Assets-Management; cannot publish menu.');
  const payload = await objectToBase64(items);
  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    name: publisherName,
    service: 'DOCUMENT',
    identifier: WIKI_MENU_IDENTIFIER,
    data64: payload,
  });
}
