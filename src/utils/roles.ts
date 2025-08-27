// ------------------------------------------------------------------------------------
// Resolve a Qortal name to an address, then fetch its group memberships (member/admin).
// Uses qortalRequest for GET_NAME_DATA and fetch('/groups/member/{address}') for groups.
// Adds/updates roleTags on ThreadComment items based on memberships.
// ------------------------------------------------------------------------------------
// import { MINTER_GROUP_ID, DEV_GROUP_ID } from "../constants/qdnConstants";
import type { ThreadComment } from "../types/ThreadedComment";

export type RoleMap = Record<number, string>; // groupId -> tag label (e.g., 691: 'MINTER')



// global in q-app
declare const qortalRequest: (args: unknown) => Promise<any>;

// --- in-memory caches (session-scoped) -----------------
const nameAddrCache = new Map<string, string>();    // name(lower) -> address
const addrGroupsCache = new Map<string, GroupInfo[]>(); // address -> memberships

type GroupInfo = {
  groupId: number;
  groupName: string;
  isAdmin?: boolean;
};

export interface TaggingInputs {
  primaryGroupId: number;        // PAG id
  MINTER_GROUP_ID: number;
  DEV_GROUP_ID: number;
  assetIssuer?: string | null;   // issuer name (optional)
}

export type RoleTag =
  | 'ASSET ISSUER'
  | 'PAG Admin'
  | 'M'  // Minter member
  | 'MA' // Minter admin
  | 'D'  // Dev member
  | 'DA' // Dev admin;

// --- fetch helpers ------------------------------------
async function getAddressForName(name: string): Promise<string | null> {
  const key = encodeURIComponent(name);
  if (nameAddrCache.has(key)) return nameAddrCache.get(key)!;

  try {
    const res = await qortalRequest({ action: 'GET_NAME_DATA', name } as any);
    const addr = res?.owner ? String(res.owner) : null;
    if (addr) nameAddrCache.set(key, addr);
    return addr;
  } catch {
    return null;
  }
}

async function getGroupsForAddress(address: string): Promise<GroupInfo[]> {
  if (!address) return [];
  if (addrGroupsCache.has(address)) return addrGroupsCache.get(address)!;

  try {
    const resp = await fetch(`/groups/member/${encodeURIComponent(address)}`, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });
    if (!resp.ok) throw new Error(`groups/member failed: ${resp.status}`);
    const arr = await resp.json();
    const out: GroupInfo[] = Array.isArray(arr)
      ? arr
          .map((g: any) => ({
            groupId: Number(g?.groupId),
            groupName: String(g?.groupName ?? ''),
            isAdmin: Boolean(g?.isAdmin),
          }))
          .filter((g) => Number.isFinite(g.groupId))
      : [];
    addrGroupsCache.set(address, out);
    return out;
  } catch {
    return [];
  }
}

/** Compute role tags for a *name* (using address + groups) according to the rules. */
export async function addTagsForName(
  name: string,
  inputs: TaggingInputs
): Promise<RoleTag[]> {
  const norm = (s?: string | null) => encodeURIComponent(s as string);
  const isIssuer = inputs.assetIssuer && norm(inputs.assetIssuer) === norm(name);

  // issuer tag is independent of groups
  const out = new Set<RoleTag>();
  if (isIssuer) out.add('ASSET ISSUER');

  const addr = await getAddressForName(name);
  if (!addr) return Array.from(out);

  const memberships = await getGroupsForAddress(addr);
  if (!Array.isArray(memberships) || memberships.length === 0) return Array.from(out);

  // Primary Asset Group: ONLY tag admins
  const pag = memberships.find(g => g.groupId === inputs.primaryGroupId);
  if (pag?.isAdmin) out.add('PAG Admin');

  // Minter: M or MA
  const minter = memberships.find(g => g.groupId === inputs.MINTER_GROUP_ID);
  if (minter) out.add(minter.isAdmin ? 'MA' : 'M');

  // Dev: D or DA
  const dev = memberships.find(g => g.groupId === inputs.DEV_GROUP_ID);
  if (dev) out.add(dev.isAdmin ? 'DA' : 'D');

  return Array.from(out);
}

export async function tagComments(
  comments: ThreadComment[],
  inputs: TaggingInputs
): Promise<ThreadComment[]> {
  // dedupe names
  const names = Array.from(new Set(comments.map(c => (c.author || '').trim()).filter(Boolean)));

  // resolve tags per name (these calls should use your cached helpers under the hood)
  const tagsByName = new Map<string, RoleTag[]>();
  await Promise.all(
    names.map(async n => {
      const tags = await addTagsForName(n, inputs);
      tagsByName.set(encodeURIComponent(n), tags);
    })
  );

  // apply/merge (and correct if previously wrong/missing)
  return comments.map(c => {
    const resolved = tagsByName.get((c.author || '')) || [];
    const merged = Array.from(new Set([...(c.roleTags ?? []), ...resolved]));
    return { ...c, roleTags: merged };
  });
}
