// src/utils/commentsDiscovery.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import pLimit from 'p-limit';
import { DEV_GROUP_ID, MINTER_GROUP_ID } from '../constants/qdnConstants';
import { getGroupAddressSetsById } from '../utils/access';
import { getAllAccountNames, getPrimaryAccountName } from '../utils/qortalApi';

const limit = pLimit(6);

// Robust: get all names for an address (you already have similar in wikiAccess.ts)
async function getAllNamesForAddress(address: string): Promise<string[]> {
  try {
    const names = await getAllAccountNames(address).catch(() => null);
    const normalize = (arr: any) =>
      (Array.isArray(arr) ? arr : []).map((s) => encodeURIComponent(s)).filter(Boolean);
    let out = normalize(names);
    if (!out.length) {
      const primary = await getPrimaryAccountName(address).catch(() => null);
      if (primary) out = [String(primary).trim()];
    }
    // de-dupe case-insensitive
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

export type PublisherWithTags = { name: string; tags: string[] };

type AddrSets = { memberAddrs: Set<string>; adminAddrs: Set<string> };

function tagFor(addr: string, sets: AddrSets, memberTag?: string, adminTag?: string): string[] {
  const tags: string[] = [];
  if (sets.adminAddrs.has(addr) && adminTag) tags.push(adminTag);
  else if (sets.memberAddrs.has(addr) && memberTag) tags.push(memberTag);
  return tags;
}

function normalizeAddrSets(input: any): AddrSets {
  const mem = Array.isArray(input?.memberAddrs)
    ? input.memberAddrs
    : Array.from(input?.memberAddrs ?? []);
  const adm = Array.isArray(input?.adminAddrs)
    ? input.adminAddrs
    : Array.from(input?.adminAddrs ?? []);

  return {
    memberAddrs: new Set<string>(mem.map((x: any) => String(x ?? '').trim()).filter(Boolean)),
    adminAddrs: new Set<string>(adm.map((x: any) => String(x ?? '').trim()).filter(Boolean)),
  };
}

/**
 * Discover eligible publishers for an asset’s comments:
 *  - PAG (primary group): members/admins
 *  - MINTER group: members/admins
 *  - DEV group: members/admins
 *  - Asset issuer name (tag: ASSET ISSUER)
 */
export async function discoverEligibleCommentPublishers(opts: {
  primaryGroupId: number;
  issuerAddress?: string | null;
  issuerName?: string | null;
}): Promise<PublisherWithTags[]> {
  const { primaryGroupId, issuerName } = opts;

  // Fetch addr sets for all groups in parallel
  const [pagRaw, minterRaw, devRaw] = await Promise.all([
    getGroupAddressSetsById(primaryGroupId).catch(() => ({
      memberAddrs: new Set(),
      adminAddrs: new Set(),
    })),
    getGroupAddressSetsById(MINTER_GROUP_ID).catch(() => ({
      memberAddrs: new Set(),
      adminAddrs: new Set(),
    })),
    getGroupAddressSetsById(DEV_GROUP_ID).catch(() => ({
      memberAddrs: new Set(),
      adminAddrs: new Set(),
    })),
  ]);

  const pag = normalizeAddrSets(pagRaw);
  const minter = normalizeAddrSets(minterRaw);
  const dev = normalizeAddrSets(devRaw);

  // console.log('pag', pag);
  // console.log('minter',minter)
  // console.log('dev',dev)

  // Union of all addresses (now strongly typed)
  const unionAddrs = new Set<string>([
    ...pag.memberAddrs,
    ...minter.memberAddrs,
    ...dev.memberAddrs,
  ]);

  const limit = pLimit(8);
  const perAddr = await Promise.all(
    Array.from(unionAddrs).map((addr) =>
      limit(async () => {
        const names = await getAllNamesForAddress(addr);
        if (!names.length) return [] as PublisherWithTags[];

        // tags for this address from all cohorts (can have multiple)
        const tags = [
          ...tagFor(addr, pag, undefined, 'PAG Admin'),
          ...tagFor(addr, minter, 'M', 'MA'),
          ...tagFor(addr, dev, 'D', 'DA'),
        ];

        // If no tags (edge), still eligible because they’re in some cohort; default is untagged PAG member
        const finalTags = tags.length ? tags : [];
        // console.log('wtfnames',names.length)
        return names.map((n) => ({ name: n, tags: finalTags }));
      })
    )
  );

  // Flatten + dedupe by encoded name, keep superset of tags
  const byName = new Map<string, PublisherWithTags>();
  for (const arr of perAddr) {
    for (const rec of arr) {
      const key = encodeURIComponent(rec.name);
      const prev = byName.get(key);
      if (!prev) byName.set(key, { name: rec.name, tags: Array.from(new Set(rec.tags)) });
      else
        byName.set(key, {
          name: prev.name,
          tags: Array.from(new Set([...prev.tags, ...rec.tags])),
        });
    }
  }

  // Include issuer
  if (issuerName) {
    const key = encodeURIComponent(issuerName);
    const prev = byName.get(key);
    const issuerTags = ['ASSET ISSUER'];
    if (!prev) byName.set(key, { name: issuerName, tags: issuerTags });
    else
      byName.set(key, {
        name: prev.name,
        tags: Array.from(new Set([...prev.tags, ...issuerTags])),
      });
  }

  return Array.from(byName.values());
}

type RawRow = { name?: string; identifier?: string; created?: number; updated?: number };

/**
 * Return ALL rows for each publisher whose identifier startsWith(prefix).
 * No "newest-only" collapsing.
 */
export async function searchByIdentifierPrefixForPublishers(
  prefix: string,
  publishers: PublisherWithTags[]
): Promise<Array<{ name: string; identifier: string; ts: number }>> {
  if (!publishers.length) return [];

  const perName = await Promise.all(
    publishers.map((p) =>
      limit(async () => {
        try {
          const res = await qortalRequest({
            action: 'SEARCH_QDN_RESOURCES',
            service: 'DOCUMENT',
            name: p.name, // exact name
            identifier: prefix, // prefix search
            prefix: true,
            mode: 'all',
            prefixOnly: true,
            reverse: false,
          } as any).catch(() => null);

          const rows: RawRow[] = Array.isArray(res) ? res : res ? [res as RawRow] : [];
          return rows.map((r) => ({
            name: p.name,
            identifier: r.identifier!,
            ts: Number(r.updated ?? r.created ?? 0) || 0,
          }));
        } catch {
          return [] as Array<{ name: string; identifier: string; ts: number }>;
        }
      })
    )
  );

  // Flatten and sort oldest→newest (fetcher can re-sort if needed)
  return perName.flat();
}

export async function searchAllByIdentifierPrefix(
  prefix: string,
  opts?: { limit?: number; maxPages?: number; reverse?: boolean }
): Promise<Array<{ name: string; identifier: string; created?: number }>> {
  // const limit = Math.max(1, opts?.limit ?? 2000);
  const limit = 0;
  const maxPages = Math.max(1, opts?.maxPages ?? 50);
  const reverse = !!opts?.reverse;

  const out: Array<{ name: string; identifier: string; created?: number }> = [];
  let offset = 0;

  for (let page = 0; page < maxPages; page++) {
    // eslint-disable-next-line no-await-in-loop
    const res = await qortalRequest({
      action: 'SEARCH_QDN_RESOURCES',
      service: 'DOCUMENT',
      identifier: prefix,
      limit,
      offset,
      reverse,
      prefix: true,
    } as any);

    const arr = Array.isArray(res) ? res : [];
    for (const r of arr) {
      if (r && typeof r.identifier === 'string' && typeof r.name === 'string') {
        out.push({
          name: r.name,
          identifier: r.identifier,
          created: Number(r.created) || undefined,
        });
      }
    }

    if (arr.length < limit) break; // exhausted
    offset += limit;
  }

  // de-dupe by (name, identifier) pair, keep oldest-first stable
  const seen = new Set<string>();
  const deduped: typeof out = [];
  for (const h of out.sort(
    (a, b) =>
      (a.created ?? 0) - (b.created ?? 0) ||
      a.identifier.localeCompare(b.identifier) ||
      a.name.localeCompare(b.name)
  )) {
    const key = `${h.name}::${h.identifier}`;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(h);
    }
  }

  return deduped;
}

/**
 * Convenience helper: search all, then filter down to allowed publisher names.
 */
export async function searchAllThenFilterByPublishers(
  prefix: string,
  pubs: PublisherWithTags[],
  opts?: { limit?: number; maxPages?: number; reverse?: boolean }
): Promise<Array<{ name: string; identifier: string; created?: number }>> {
  const allowed = new Set(pubs.map((p) => p.name));
  const all = await searchAllByIdentifierPrefix(prefix, opts);
  return all.filter((h) => allowed.has(h.name));
}

export async function searchByIdentifierPrefixFFSPublishers(
  prefix: string,
  pubs: PublisherWithTags[],
  opts?: { limit?: number; maxPages?: number; reverse?: boolean }
): Promise<Array<{ name: string; identifier: string; created?: number }>> {
  const limit = Math.max(1, opts?.limit ?? 200);
  const maxPages = Math.max(1, opts?.maxPages ?? 50);
  const reverse = !!opts?.reverse;

  const out: Array<{ name: string; identifier: string; created?: number }> = [];

  // Query each eligible publisher, paging until exhaustion
  for (const p of pubs) {
    let offset = 0;
    for (let page = 0; page < maxPages; page++) {
      // eslint-disable-next-line no-await-in-loop
      const res = await qortalRequest({
        action: 'SEARCH_QDN_RESOURCES',
        service: 'DOCUMENT',
        name: p.name, // <— constrain to this publisher
        identifier: prefix,
        prefixOnly: true,
        limit,
        offset,
        reverse, // oldest→newest by default
      } as any);

      const arr = Array.isArray(res) ? res : [];
      for (const r of arr) {
        if (r && typeof r.identifier === 'string') {
          out.push({
            name: p.name,
            identifier: r.identifier,
            created: Number(r.created) || undefined,
          });
        }
      }

      if (arr.length < limit) break; // no more pages for this publisher
      offset += limit;
    }
  }

  // De-dupe across publishers (same identifier can exist in multiple namespaces)
  const seen = new Set<string>();
  const deduped: typeof out = [];
  for (const h of out.sort(
    (a, b) => (a.created ?? 0) - (b.created ?? 0) || a.identifier.localeCompare(b.identifier)
  )) {
    if (!seen.has(h.identifier)) {
      seen.add(h.identifier);
      deduped.push(h);
    }
  }
  return deduped;
}
