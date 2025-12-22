import pLimit from 'p-limit';
import { WIKI_GROUP_ID, WIKI_IDENTIFIER_PREFIX, WIKI_SECTIONS } from '../constants/wiki';
import { getPrimaryAccountName, getAllAccountNames } from './qortalApi';
import { base64ToObject, base64ToUtf8, utf8ToBase64 } from './data';
import { objectToBase64 } from 'qapp-core';

/* -------------------------------- Types -------------------------------- */
export type LoadedSection = {
  id: string;
  title: string;
  tags?: string[];
  html: string | null;
  publisher?: string;
  publisherRole?: 'admin' | 'member';
  timestamp?: number;
};

export type WikiOverrides = {
  version: 1;
  updatedAt: number;
  overrides: Record<
    string,
    { mode: 'latest' } | { mode: 'preferred'; preferred: { publisher: string } }
  >;
};

type GroupMemberRow = { address?: string; member?: string; isAdmin?: boolean };
type Role = 'admin' | 'member';
export type WikiMenuItem = { id: string; title: string; tags?: string[] };

/* --------------------------- Small address cache ------------------------ */
const CACHE_TTL_MS = 60_000;
let _addrCache: { memberAddrs: Set<string>; adminAddrs: Set<string>; at: number } | null = null;

const normAddr = (s?: string) => (s || '').trim();

/* ------------------------- Group fetchers (paged) ----------------------- */
type GroupMembersResponse =
  | { memberCount?: number; adminCount?: number; members?: GroupMemberRow[] }
  | GroupMemberRow[];

function parseMembersPayload(json: GroupMembersResponse): GroupMemberRow[] {
  if (Array.isArray(json)) return json;
  if (json && Array.isArray((json as any).members)) return (json as any).members;
  return [];
}

async function fetchGroupMembersRaw(groupId: number): Promise<GroupMemberRow[]> {
  if (!groupId) groupId = WIKI_GROUP_ID;
  const url = `/groups/members/${groupId}?limit=0&reverse=true`;
  const res = await fetch(url, { headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`Group members fetch failed: ${res.status} ${res.statusText}`);
  const json = (await res.json()) as GroupMembersResponse;
  return parseMembersPayload(json);
}

async function fetchAllRows(onlyAdmins: boolean): Promise<GroupMemberRow[]> {
  const rows = await fetchGroupMembersRaw(WIKI_GROUP_ID);
  return onlyAdmins ? rows.filter((r) => r.isAdmin === true) : rows;
}

export async function fetchGroupMembers(
  onlyAdmins: boolean,
  groupId: number
): Promise<GroupMemberRow[]> {
  const rows = await fetchGroupMembersRaw(groupId);
  return onlyAdmins ? rows.filter((r) => r.isAdmin === true) : rows;
}

/* ------------------- Address membership (with cache) -------------------- */
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
    for (const a of adminAddrs) memberAddrs.add(a); // admins are members too
    _addrCache = { memberAddrs, adminAddrs, at: now };
    return { memberAddrs, adminAddrs };
  } catch (e) {
    console.error('getGroupAddressSets error:', e);
    return { memberAddrs: new Set(), adminAddrs: new Set() };
  }
}

export async function getGroupAddressSetsById(groupId: number): Promise<{
  memberAddrs: Set<string>;
  adminAddrs: Set<string>;
}> {
  const now = Date.now();
  if (_addrCache && now - _addrCache.at < CACHE_TTL_MS) {
    return { memberAddrs: _addrCache.memberAddrs, adminAddrs: _addrCache.adminAddrs };
  }

  try {
    const [adminsRaw, membersRaw] = await Promise.all([
      fetchGroupMembers(true, groupId),
      fetchGroupMembers(false, groupId),
    ]);
    const memberAddrs = new Set(membersRaw.map((r) => normAddr(r.member || r.address)));
    const adminAddrs = new Set(adminsRaw.map((r) => normAddr(r.member || r.address)));
    for (const a of adminAddrs) memberAddrs.add(a); // admins are members too
    _addrCache = { memberAddrs, adminAddrs, at: now };
    return { memberAddrs, adminAddrs };
  } catch (e) {
    console.error('getGroupAddressSets error:', e);
    return { memberAddrs: new Set(), adminAddrs: new Set() };
  }
}

export async function isAddressInManagementGroup(address?: string | null) {
  if (!address) return false;
  const { memberAddrs } = await getGroupAddressSets();
  return memberAddrs.has(normAddr(address));
}

export async function isAddressAdminInManagementGroup(address?: string | null) {
  if (!address) return false;
  const { adminAddrs } = await getGroupAddressSets();
  return adminAddrs.has(normAddr(address));
}

/* ----------------------- Names per address (robust) --------------------- */
/** Try to fetch *all* names for an address. Hyphens preserved. */
async function getAllNamesForAddress(address: string): Promise<string[]> {
  try {
    // Prefer your util if it returns multiple names
    const names = await getAllAccountNames(address).catch(() => null);

    const normalizeList = (arr: any): string[] =>
      (Array.isArray(arr) ? arr : []).map((s) => encodeURIComponent(s)).filter(Boolean);

    let out = normalizeList(names);

    // Fallback: try GET_ACCOUNT_NAMES via qortalRequest
    if (!out.length) {
      const res = await qortalRequest({ action: 'GET_ACCOUNT_NAMES', address } as any).catch(
        () => null
      );
      if (Array.isArray(res)) out = normalizeList(res);
      else if (Array.isArray((res as any)?.names)) out = normalizeList((res as any).names);
      else if (typeof (res as any)?.name === 'string') out = normalizeList([(res as any).name]);
    }

    // Final fallback: primary name only
    if (!out.length) {
      const primary = await getPrimaryAccountName(address).catch(() => null);
      if (primary) out = [String(primary).trim()];
    }

    // De-dupe case-insensitively, but keep original spelling/hyphens
    const seen = new Set<string>();
    return out.filter((n) => {
      const k = encodeURIComponent(n);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
  } catch {
    return [];
  }
}

/* ----------------- Flattened list of publisher NAMES -------------------- */
/** Returns the full set of publisher names (flattened) with role, hyphen-safe. */
export async function listManagementGroupNames(
  groupId?: number
): Promise<Array<{ name: string; role: Role }>> {
  try {
    // declare outside and assign in branches
    let memberAddrs: Set<string>;
    let adminAddrs: Set<string>;

    if (typeof groupId === 'number') {
      ({ memberAddrs, adminAddrs } = await getGroupAddressSetsById(groupId));
    } else {
      // legacy path (uses the cached WIKI group internally)
      ({ memberAddrs, adminAddrs } = await getGroupAddressSets());
    }

    const addrs = Array.from(memberAddrs);
    const limit = pLimit(4);

    const perAddr = await Promise.all(
      addrs.map((addr) =>
        limit(async () => {
          const names = await getAllNamesForAddress(addr);
          const role: Role = adminAddrs.has(addr) ? 'admin' : 'member';
          return names.map((name) => ({ name, role }));
        })
      )
    );

    // Flatten + de-dupe by name (case-insensitive); prefer admin role if any duplicate
    const map = new Map<string, { name: string; role: Role }>();
    for (const arr of perAddr) {
      for (const rec of arr) {
        const key = encodeURIComponent(rec.name);
        const prev = map.get(key);
        if (!prev || (rec.role === 'admin' && prev.role !== 'admin')) {
          map.set(key, rec);
        }
      }
    }
    return Array.from(map.values());
  } catch (e) {
    console.error('listManagementGroupNames error:', e);
    return [];
  }
}

/* ---------------- Legacy “isName…” helpers, now hyphen-safe ------------- */
export async function isNameInManagementGroup(name?: string | null): Promise<boolean> {
  if (!name) return false;
  const names = await listManagementGroupNames();
  return names.some((m) => encodeURIComponent(m.name) === encodeURIComponent(name));
}

export async function isNameAdminInManagementGroup(name?: string | null): Promise<boolean> {
  if (!name) return false;
  const names = await listManagementGroupNames();
  return names.some(
    (m) => encodeURIComponent(m.name) === encodeURIComponent(name) && m.role === 'admin'
  );
}

/* --------------------------- Publish eligibility ------------------------ */
export async function checkPublishEligibility(address?: string | null, name?: string | null) {
  const inGroup = await isAddressInManagementGroup(address);
  if (!inGroup) return { canPublish: false, reason: 'Requires membership in Q-Assets-Management.' };
  if (!name)
    return { canPublish: false, reason: 'Your account needs a registered Qortal name to publish.' };
  return { canPublish: true as const, reason: '' };
}
export async function isUserInManagementGroup(opts: {
  address?: string | null;
  name?: string | null;
}) {
  if (await isAddressInManagementGroup(opts.address)) return true;
  return isNameInManagementGroup(opts.name);
}

/* ---------------------------- QDN fetch helpers ------------------------- */
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

async function fetchQdnBase64(name: string, identifier: string): Promise<string | null> {
  try {
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

// async function tryFetchHtml(name: string, identifier: string): Promise<string | null> {
//   try {
//     const b64 = await qortalRequest({
//       action: 'FETCH_QDN_RESOURCE',
//       service: 'DOCUMENT',
//       name,          // EXACT, hyphenated OK
//       identifier,
//       encoding: 'base64',
//     });
//     const html = base64ToUtf8(String(b64 ?? ''));
//     return html && html.trim() ? html : null;
//   } catch {
//     return null;
//   }
// }

/* ------------------------------- Publish -------------------------------- */
export async function publishWikiSection(
  sectionId: string,
  html: string,
  publisherName?: string,
  publisherAddress?: string | null
) {
  const ok = await isUserInManagementGroup({
    address: publisherAddress ?? undefined,
    name: publisherName ?? undefined,
  });
  if (!ok) throw new Error('You are not a member of Q-Assets-Management; cannot publish.');

  const identifier = `${WIKI_IDENTIFIER_PREFIX}${sectionId}`;
  const data64 = utf8ToBase64(html);
  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    name: publisherName, // QDN requires NAME
    service: 'DOCUMENT',
    identifier,
    data64,
  });
}

const discoverLimit = pLimit(4);

/** Given an identifier and a list of publishers {name, role},
 * return ONLY those names that actually have hits for that identifier,
 * sorted: admins newest→oldest, then members newest→oldest.
 */
async function discoverCandidatesStrict(
  identifier: string,
  publishers: Array<{ name: string; role: Role }>
): Promise<Candidate[]> {
  const results = await Promise.all(
    publishers.map((p) =>
      discoverLimit(async () => {
        try {
          const res = await qortalRequest({
            action: 'SEARCH_QDN_RESOURCES',
            service: 'DOCUMENT',
            name: p.name, // EXACT name; hyphens preserved
            identifier, // EXACT identifier
          });

          const rows = Array.isArray(res) ? res : res ? [res] : [];
          if (!rows.length) return null;

          // Pick newest row for THIS name + identifier only
          const best = rows
            .filter((r: any) => r?.identifier === identifier && r?.name === p.name)
            .sort(
              (a: any, b: any) =>
                (Number(b.updated ?? b.created ?? 0) || 0) -
                (Number(a.updated ?? a.created ?? 0) || 0)
            )[0];

          if (!best) return null;

          return {
            name: p.name,
            role: p.role,
            ts: Number(best.updated ?? best.created ?? 0) || 0,
          } as Candidate;
        } catch {
          return null;
        }
      })
    )
  );

  const hits = results.filter(Boolean) as Candidate[];
  const admins = hits.filter((h) => h.role === 'admin').sort((a, b) => b.ts - a.ts);
  const members = hits.filter((h) => h.role === 'member').sort((a, b) => b.ts - a.ts);
  return admins.concat(members);
}

/* ---------------------- Sections (admin > member) ----------------------- */
type Candidate = { name: string; role: Role; ts: number };
const parallel = pLimit(4);

export async function loadSectionFromGroup(sectionId: string) {
  // you said this now returns [{ name, role }]
  const names = await listManagementGroupNames();
  if (!names.length) return null;
  // console.log('allNames',names)

  const identifier = `${WIKI_IDENTIFIER_PREFIX}${sectionId}`;

  // 1) build a strictly valid, ordered candidate list
  const ordered = await discoverCandidatesStrict(identifier, names);
  if (!ordered.length) return null;
  // console.log('orderedCandidatesStrict',ordered)

  // 2) try candidates in order; fall back if a fetch 404s/returns empty
  for (const cand of ordered) {
    const html = await fetchDocHtml(cand.name, identifier);
    if (html && html.trim()) {
      return {
        html,
        publisher: cand.name,
        publisherRole: cand.role,
        ts: cand.ts,
      };
    }
  }

  // nothing we could fetch successfully
  return null;
}

export async function loadAllWikiSections(
  meta: { id: string; title: string; tags?: string[] }[] = WIKI_SECTIONS
): Promise<LoadedSection[]> {
  const lim = pLimit(4);
  return Promise.all(
    meta.map((m) =>
      lim(async () => {
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

/*-------------------------------Admin Overrides-------------------------------*/

export async function loadWikiOverrides(): Promise<WikiOverrides | null> {
  try {
    // Adjust issuer/name/bucket as you use in your project
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      service: 'DOCUMENT',
      identifier: 'wiki_overrides', // you can also use 'Q-Assets/wiki_overrides'
      name: 'Q-Assets',
      encoding: 'base64',
    });
    const json = base64ToObject(res);
    if (json && typeof json === 'object' && json.version === 1) return json as WikiOverrides;
  } catch {
    // no manifest yet
  }
  return { version: 1, updatedAt: 0, overrides: {} };
}

// save (admins only)
export async function saveWikiOverrides(doc: WikiOverrides /*, publisherName: string*/) {
  const payload = await objectToBase64(doc);
  // publish under JSON/Q-Assets/wiki_overrides (adjust to your scheme)
  return qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: 'DOCUMENT',
    name: 'Q-Assets',
    identifier: 'wiki_overrides',
    data64: payload,
    // plus any metadata you already attach (e.g., title, category)
  });
}

/* ----------------------------- Menu (TOC) ------------------------------- */
const WIKI_MENU_IDENTIFIER = `${WIKI_IDENTIFIER_PREFIX}__menu`;

export async function loadWikiMenu(): Promise<{
  items: WikiMenuItem[];
  publisher?: string;
  role?: Role;
  ts?: number;
} | null> {
  const names = await listManagementGroupNames(); // [{name, role}]
  if (!names.length) return null;

  const findings = await Promise.all(
    names.map((m) =>
      parallel(async () => {
        try {
          const res = await qortalRequest({
            action: 'SEARCH_QDN_RESOURCES',
            service: 'DOCUMENT',
            name: m.name,
            identifier: WIKI_MENU_IDENTIFIER,
          });

          const rows = Array.isArray(res) ? res : res ? [res] : [];
          if (!rows.length) return null;

          const best = rows
            .filter((r: any) => r.identifier === WIKI_MENU_IDENTIFIER)
            .sort(
              (a: any, b: any) =>
                (Number(b.updated ?? b.created ?? 0) || 0) -
                (Number(a.updated ?? a.created ?? 0) || 0)
            )[0];

          if (!best) return null;
          return { name: m.name, role: m.role, ts: Number(best.updated ?? best.created ?? 0) || 0 };
        } catch {
          return null;
        }
      })
    )
  );

  const candidates = findings.filter(Boolean) as Array<{ name: string; role: Role; ts: number }>;
  if (!candidates.length) return null;

  const newestAdmin = candidates.filter((c) => c.role === 'admin').sort((a, b) => b.ts - a.ts)[0];
  const newestMember = candidates.filter((c) => c.role === 'member').sort((a, b) => b.ts - a.ts)[0];
  const pick = newestAdmin ?? newestMember;
  if (!pick) return null;

  const data64 = await fetchQdnBase64(pick.name, WIKI_MENU_IDENTIFIER);
  if (!data64) return null;

  let itemsRaw: unknown;
  try {
    itemsRaw = await base64ToObject(data64);
  } catch {
    return null;
  }
  if (!Array.isArray(itemsRaw)) return null;

  const items: WikiMenuItem[] = (itemsRaw as any[])
    .map((it) => ({
      id: String(it?.id ?? '').trim(),
      title: String(it?.title ?? '').trim(),
      tags: Array.isArray(it?.tags)
        ? it.tags.map((t: any) => String(t).trim()).filter(Boolean)
        : [],
    }))
    .filter((it) => it.id && it.title);

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

export async function findGroupPublishersWithResource(identifier: string): Promise<Candidate[]> {
  const publishers = await listManagementGroupNames(); // [{name, role}]
  if (!publishers.length) return [];

  const results = await Promise.all(
    publishers.map((p) =>
      discoverLimit(async () => {
        try {
          const res = await qortalRequest({
            action: 'SEARCH_QDN_RESOURCES',
            service: 'DOCUMENT',
            name: p.name, // EXACT name; hyphen-safe
            identifier, // EXACT identifier
          });

          const rows = Array.isArray(res) ? res : res ? [res] : [];
          if (!rows.length) return null;

          const best = rows
            .filter((r: any) => r?.identifier === identifier && r?.name === p.name)
            .sort(
              (a: any, b: any) =>
                (Number(b.updated ?? b.created ?? 0) || 0) -
                (Number(a.updated ?? a.created ?? 0) || 0)
            )[0];

          if (!best) return null;

          return {
            name: p.name,
            role: p.role,
            ts: Number(best.updated ?? best.created ?? 0) || 0,
          } as Candidate;
        } catch {
          return null;
        }
      })
    )
  );

  const hits = results.filter(Boolean) as Candidate[];
  const admins = hits.filter((h) => h.role === 'admin').sort((a, b) => b.ts - a.ts);
  const members = hits.filter((h) => h.role === 'member').sort((a, b) => b.ts - a.ts);
  return admins.concat(members);
}

export async function isNameAdminOfGroupId(name: string, groupId: number): Promise<boolean> {
  try {
    // 1) resolve address for name
    const address = await qortalRequest({ action: 'GET_ADDRESS_FROM_NAME', name } as any).catch(
      () => null
    );
    if (!address) return false;

    // 2) fetch group admins (adjust to your Core endpoints if different)
    // This endpoint mirrors what you used for wiki: /groups/members/<id>?limit=0
    const res = await fetch(`/groups/members/${groupId}?limit=0&reverse=true`, {
      headers: { accept: 'application/json' },
    })
      .then((r) => r.json())
      .catch(() => null);

    const rows: Array<{ member?: string; address?: string; isAdmin?: boolean }> = Array.isArray(res)
      ? res
      : Array.isArray(res?.members)
        ? res.members
        : [];

    const admins = new Set(
      rows.filter((r) => r.isAdmin).map((r) => String(r.member || r.address || '').trim())
    );
    return admins.has(String(address).trim());
  } catch {
    return false;
  }
}

export async function isNameMemberOfGroupId(
  name: string,
  groupId: number
): Promise<{ isMember: boolean; isAdmin: boolean; address?: string }> {
  try {
    // 1) Resolve address from name
    const address = await qortalRequest({
      action: 'GET_ADDRESS_FROM_NAME',
      name,
    } as any).catch(() => null);
    if (!address) return { isMember: false, isAdmin: false };

    // 2) Fetch all members of the group
    const res = await fetch(`/groups/members/${groupId}?limit=0&reverse=true`, {
      headers: { accept: 'application/json' },
    })
      .then((r) => r.json())
      .catch(() => null);

    const rows: Array<{ member?: string; address?: string; isAdmin?: boolean }> = Array.isArray(res)
      ? res
      : Array.isArray((res as any)?.members)
        ? (res as any).members
        : [];

    // Normalize addresses (some rows use member, some address)
    const norm = (s?: string) => (s || '').trim();
    const target = norm(address);

    let found = false;
    let admin = false;

    for (const row of rows) {
      const addr = norm(row.member) || norm(row.address);
      if (addr === target) {
        found = true;
        admin = !!row.isAdmin;
        break;
      }
    }

    return { isMember: found, isAdmin: admin, address: target };
  } catch {
    return { isMember: false, isAdmin: false };
  }
}
