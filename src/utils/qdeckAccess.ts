import { QDeckBoard, QDeckCard } from '../types/qdeck';
import { fetchGroupMembers } from './access';
import { qdeckFetch } from './qdeckApi';
import { getAccountGroupIds, getAccountGroups } from './qortalApi';
import { getCached, setCached } from './cache';
import pLimit from 'p-limit';

function eq(a?: string, b?: string) {
  if (!a || !b) return false;
  return a === b;
}

export async function userInAllowedGroups(board: QDeckBoard, viewerAddress?: string) {
  const need = new Set(board.groupsAllowed ?? []);
  if (!need.size || !viewerAddress) return false;
  const mineKey = `qdeck:groups:${viewerAddress}`;
  let mineArr = getCached<number[]>(mineKey);
  if (!mineArr) {
    mineArr = await getAccountGroupIds(viewerAddress);
    setCached(mineKey, mineArr, 60_000);
  }
  const mine = new Set(mineArr);
  for (const id of need) if (mine.has(Number(id))) return true;
  return false;
}

export function userInUsersAllowlist(board: QDeckBoard, viewerName?: string, viewerAddr?: string) {
  const allow = board.usersAllowed ?? [];
  if (!allow.length) return false;
  return allow.some((v) => eq(v, viewerName) || eq(v, viewerAddr));
}

/** EDIT permission rules */
export async function canUserEditBoard(
  board: QDeckBoard,
  viewer: { name?: string; address?: string }
) {
  const permKey = `qdeck:perm:edit:${board.boardId}:${board.updatedAt || board.seq || ''}:${
    viewer.name || ''
  }:${viewer.address || ''}`;
  const cached = getCached<boolean>(permKey);
  if (cached !== undefined) return cached;

  const useEnhanced = board.featureFlags?.enhancedPerms === true;
  const owners = new Set(
    (board.owners && board.owners.length ? board.owners : [board.createdBy]).map((s) => s.trim())
  );
  const ownerGroups = new Set(board.ownerGroups ?? []);
  const editors = new Set(board.editors ?? board.usersAllowed ?? []);
  const editorGroups = new Set(
    board.editorGroups && board.editorGroups.length
      ? board.editorGroups
      : (board.groupsAllowed ?? [])
  );

  if (
    (viewer.name && owners.has(viewer.name)) ||
    (viewer.address && owners.has(viewer.address)) ||
    (viewer.address && ownerGroups.size && (await isAdminOfAnyGroup(viewer.address, ownerGroups)))
  ) {
    setCached(permKey, true, 60_000);
    return true;
  }

  if (useEnhanced) {
    if (
      (viewer.name && editors.has(viewer.name)) ||
      (viewer.address && editors.has(viewer.address)) ||
      (viewer.address &&
        editorGroups.size &&
        (await isMemberOfAnyGroup(viewer.address, editorGroups)))
    ) {
      setCached(permKey, true, 60_000);
      return true;
    }
  }

  // creator can always edit
  if (eq(board.createdBy, viewer.name) || eq(board.creatorAddress, viewer.address)) {
    setCached(permKey, true, 60_000);
    return true;
  }
  // explicit allowlist
  if (userInUsersAllowlist(board, viewer.name, viewer.address)) {
    setCached(permKey, true, 60_000);
    return true;
  }
  // groups
  let ok = await userInAllowedGroups(board, viewer.address);
  // Fallback: open edit on public boards when no editor restrictions defined
  const noExplicitEditors =
    !useEnhanced &&
    (!board.usersAllowed || board.usersAllowed.length === 0) &&
    (!board.groupsAllowed || board.groupsAllowed.length === 0);
  const noEnhancedEditors =
    useEnhanced &&
    (!board.editors || board.editors.length === 0) &&
    (!board.editorGroups || board.editorGroups.length === 0) &&
    (!board.usersAllowed || board.usersAllowed.length === 0) &&
    (!board.groupsAllowed || board.groupsAllowed.length === 0);
  if (!ok && board.visibility === 'public' && (noExplicitEditors || noEnhancedEditors)) {
    ok = true;
  }
  setCached(permKey, ok, 60_000);
  return ok;
}

/** VIEW permission rules — ONLY board visibility matters. */
export async function canUserViewBoard(board: QDeckBoard, viewer: { address?: string }) {
  const permKey = `qdeck:perm:view:${board.boardId}:${board.updatedAt || board.seq || ''}:${
    viewer.address || ''
  }`;
  const cached = getCached<boolean>(permKey);
  if (cached !== undefined) return cached;

  const useEnhanced = board.featureFlags?.enhancedPerms === true;

  if (board.visibility === 'public') {
    setCached(permKey, true, 60_000);
    return true;
  }
  // private → must be in the one private group
  if (userInUsersAllowlist(board, viewer.address, viewer.address)) {
    setCached(permKey, true, 60_000);
    return true;
  }

  if (useEnhanced && viewer.address) {
    const editorGroups = new Set(
      board.editorGroups && board.editorGroups.length
        ? board.editorGroups
        : (board.groupsAllowed ?? [])
    );
    if (editorGroups.size && (await isMemberOfAnyGroup(viewer.address, editorGroups))) {
      setCached(permKey, true, 60_000);
      return true;
    }
  }

  const ok = await userInAllowedGroups(board, viewer.address);
  setCached(permKey, ok, 60_000);
  return ok;
}

export async function canUserDeleteBoard(
  board: QDeckBoard,
  caller: { name?: string; address?: string }
): Promise<boolean> {
  // Issuer can always delete
  if (caller?.name && board.createdBy && caller.name === board.createdBy) return true;

  if (!board.adminOverride) return false;

  // If adminOverride enabled, allow admins of any editor group
  const addr = caller?.address;
  if (!addr) return false;
  const groups = await getAccountGroups(addr).catch(() => []);
  const editorSet = new Set(board.groupsAllowed ?? []);
  return groups.some((g) => g.isAdmin && editorSet.has(g.groupId));
}

type NameOrAddress = string;

export type CollectRecipientsArgs = {
  // one or more groups to expand
  groupIds?: number[]; // <— plural now
  adminsOnly?: boolean; // only include admins from those groups

  // Optional lists to include
  usersAllowed?: NameOrAddress[]; // board “usersAllowed”
  assignees?: NameOrAddress[]; // card “assignees”
  extraAddresses?: NameOrAddress[]; // ad-hoc (addresses or names)

  // Include/exclude the current user
  includeSelf?: boolean; // default false (exclude self)
  me?: { name?: string; address?: string };

  // Optional: provide a resolveName→address cache to save roundtrips
  nameCache?: Map<string, string>;
};

export type RecipientResolution = {
  publicKeys: string[]; // final deduped recipients
  included: Array<{
    address: string;
    publicKey: string;
    name?: string;
    source: 'group' | 'usersAllowed' | 'assignees' | 'extra';
  }>;
  skipped: Array<{
    input?: string;
    address?: string;
    name?: string;
    source?: 'group' | 'usersAllowed' | 'assignees' | 'extra';
    reason: 'noAddress' | 'noPublicKey' | 'duplicate' | 'selfExcluded' | 'error';
    errorMessage?: string;
  }>;
};

const limit = pLimit(10);

// --- Qortal helpers ---------------------------------------------------------

async function getNameData(name: string): Promise<{ name: string; owner: string } | null> {
  try {
    const res = await qortalRequest({ action: 'GET_NAME_DATA', name });
    if (res?.owner) return { name, owner: res.owner };
  } catch {
    /* empty */
  }
  return null;
}

async function getAccountPublicKey(address: string): Promise<string | null> {
  try {
    const data = await qortalRequest({ action: 'GET_ACCOUNT_DATA', address });
    if (data?.publicKey) return data.publicKey;
  } catch {
    /* empty */
  }
  return null;
}

async function resolveGroupMembers(
  groupId: number
): Promise<Array<{ address: string; isAdmin?: boolean }>> {
  const list: any[] = await fetchGroupMembers(false, groupId);
  if (!Array.isArray(list)) return [];
  return list
    .map((m) => ({ address: m?.address, isAdmin: !!m?.isAdmin }))
    .filter((m) => !!m.address);
}

function looksLikeAddress(s: string) {
  return /^Q[1-9A-HJ-NP-Za-km-z]{20,}$/.test(s);
}

async function isMemberOfAnyGroup(address: string, groupIds: Set<number>) {
  if (!groupIds.size) return false;
  const groups = await getAccountGroups(address).catch(() => []);
  return groups.some((g) => groupIds.has(g.groupId));
}

async function isAdminOfAnyGroup(address: string, groupIds: Set<number>) {
  if (!groupIds.size) return false;
  const groups = await getAccountGroups(address).catch(() => []);
  return groups.some((g) => g.isAdmin && groupIds.has(g.groupId));
}

async function resolveNameOrAddress(
  id: NameOrAddress,
  nameCache?: Map<string, string>
): Promise<{ address: string; name?: string } | null> {
  const s = id.trim();
  if (!s) return null;
  if (looksLikeAddress(s)) return { address: s };

  // cached?
  const cached = nameCache?.get(s);
  if (cached) return { address: cached, name: s };

  const nd = await getNameData(s);
  if (!nd) return null;

  nameCache?.set(s, nd.owner);
  return { address: nd.owner, name: s };
}

// --- Main collector ---------------------------------------------------------

export async function collectRecipientPublicKeys({
  groupIds = [],
  adminsOnly = false,
  usersAllowed = [],
  assignees = [],
  extraAddresses = [],
  includeSelf = false,
  me,
  nameCache,
}: CollectRecipientsArgs): Promise<RecipientResolution> {
  const included: RecipientResolution['included'] = [];
  const skipped: RecipientResolution['skipped'] = [];
  const seenAddresses = new Set<string>();
  const seenPublicKeys = new Set<string>();

  // Figure out self (for include/exclude)
  let myAddr = me?.address;
  if (!myAddr) {
    try {
      const acct = await qortalRequest({ action: 'GET_USER_ACCOUNT' });
      myAddr = acct?.address;
    } catch {
      /* empty */
    }
  }

  // 1) Gather raw candidates
  type Cand = {
    source: RecipientResolution['included'][number]['source'];
    id?: string;
    name?: string;
    address?: string;
  };
  const candidates: Cand[] = [];

  // Groups (expand to addresses)
  if (groupIds.length) {
    await Promise.all(
      groupIds.map((gid) =>
        limit(async () => {
          try {
            const members = await resolveGroupMembers(gid);
            for (const m of members) {
              if (adminsOnly && !m.isAdmin) continue;
              candidates.push({ source: 'group', address: m.address });
            }
          } catch (e: any) {
            skipped.push({
              input: String(gid),
              source: 'group',
              reason: 'error',
              errorMessage: e?.message || String(e),
            });
          }
        })
      )
    );
  }

  // Users allowed / assignees / extra
  usersAllowed.forEach((u) => candidates.push({ source: 'usersAllowed', id: u }));
  assignees.forEach((a) => candidates.push({ source: 'assignees', id: a }));
  extraAddresses.forEach((x) => candidates.push({ source: 'extra', id: x }));

  // 2) Resolve names → addresses where needed
  const withAddresses = await Promise.all(
    candidates.map((c) =>
      limit(async () => {
        if (c.address) return c;
        if (!c.id) return c;
        const r = await resolveNameOrAddress(c.id, nameCache);
        if (!r) {
          skipped.push({ input: c.id, source: c.source, reason: 'noAddress' });
          return null;
        }
        return { ...c, address: r.address, name: r.name ?? c.name };
      })
    )
  );

  const addressables = withAddresses.filter(Boolean) as Array<{
    source: Cand['source'];
    name?: string;
    address: string;
  }>;

  // 3) Self filter + address dedupe
  const uniqueByAddress: Array<{ source: Cand['source']; address: string; name?: string }> = [];
  for (const c of addressables) {
    if (!includeSelf && myAddr && c.address === myAddr) {
      skipped.push({ address: c.address, name: c.name, source: c.source, reason: 'selfExcluded' });
      continue;
    }
    if (seenAddresses.has(c.address)) {
      skipped.push({ address: c.address, name: c.name, source: c.source, reason: 'duplicate' });
      continue;
    }
    seenAddresses.add(c.address);
    uniqueByAddress.push(c);
  }

  // 4) Fetch & dedupe by public key
  const keys = await Promise.all(
    uniqueByAddress.map((c) =>
      limit(async () => {
        const k = await getAccountPublicKey(c.address);
        if (!k) {
          skipped.push({
            address: c.address,
            name: c.name,
            source: c.source,
            reason: 'noPublicKey',
          });
          return null;
        }
        if (seenPublicKeys.has(k)) {
          skipped.push({ address: c.address, name: c.name, source: c.source, reason: 'duplicate' });
          return null;
        }
        seenPublicKeys.add(k);
        included.push({ address: c.address, publicKey: k, name: c.name, source: c.source });
        return k;
      })
    )
  );

  return {
    publicKeys: keys.filter(Boolean) as string[],
    included,
    skipped,
  };
}

// --- Convenience wrappers ---------------------------------------------------

// Use this when you already have a QDeckBoard loaded
export async function collectRecipientsForBoardDirect(
  board: { privateMeta?: { groupId?: number }; usersAllowed?: string[] },
  opts?: {
    assignees?: string[];
    extraAddresses?: string[];
    includeSelf?: boolean;
    me?: { name?: string; address?: string };
  }
) {
  return collectRecipientPublicKeys({
    groupIds: board.privateMeta?.groupId ? [board.privateMeta.groupId] : undefined,
    usersAllowed: board.usersAllowed ?? [],
    assignees: opts?.assignees ?? [],
    extraAddresses: opts?.extraAddresses ?? [],
    includeSelf: opts?.includeSelf ?? false,
    me: opts?.me,
  });
}

// Use this from your create dialog (multiple groups + usersAllowed)
export async function collectRecipientsForCreateDialogDirect(args: {
  groupIds?: number[];
  usersAllowed?: string[];
  includeSelf?: boolean;
  me?: { name?: string; address?: string };
}) {
  return collectRecipientPublicKeys({
    groupIds: args.groupIds ?? [],
    usersAllowed: args.usersAllowed ?? [],
    includeSelf: args.includeSelf ?? false,
    me: args.me,
  });
}

export async function resolveNameAddress(name: string): Promise<string | undefined> {
  const key = `qdeck:nameaddr:${name.toLowerCase()}`;
  const cached = getCached<string>(key);
  if (cached !== undefined) return cached;
  try {
    const data = await qortalRequest({ action: 'GET_NAME_DATA', name });
    const owner = data?.owner;
    if (owner) setCached(key, owner, 300_000);
    return owner; // address
  } catch {
    setCached(key, undefined as any, 60_000);
    return undefined;
  }
}

/**
 * Is the given publisher allowed to publish/edit on this board per board policy?
 * Mirrors your createCard guard, but used when *reading* cards from other issuers.
 * - Checks usersAllowed and editor groups (incl. admin-only boards).
 */
export async function canPublisherPublishToBoard(
  board: QDeckBoard,
  publisher: { name?: string; address?: string }
): Promise<boolean> {
  const name = publisher.name;
  let address = publisher.address;

  if (!name && !address) return false;

  if (!address && name) {
    address = await resolveNameAddress(name);
  }
  if (!address) return false;

  // Delegate to the same logic you already use for writers
  return canUserEditBoard(board, { name, address });
}

/**
 * Extra sanity: the card's embedded author must match the publisher's name.
 * (Prevents someone publishing a doc under Alice’s name with createdBy = Bob.)
 */
export function cardAuthHeaderMatchesPublisher(card: QDeckCard, publisherName?: string): boolean {
  if (!publisherName) return false;
  if (!card?.createdBy) return false;
  return card.createdBy === publisherName;
}

export type PrivateBoardProbe =
  | { doc: QDeckBoard; mode: 'group'; groupId: number; isAdmins: boolean }
  | { doc: QDeckBoard; mode: 'direct' }
  | null;

export async function tryLoadPrivateBoardDoc(
  issuer: string,
  identifier: string, // full QDN identifier (qdeck__boards__private__<boardId>)
  myGroups?: Array<{ groupId: number; isAdmin?: boolean }>
): Promise<PrivateBoardProbe> {
  // 1) GROUP mode — admins first, then members
  if (myGroups?.length) {
    const admins = myGroups.filter((g) => g.isAdmin);
    const members = myGroups;

    const tryGroups = async (arr: typeof myGroups) => {
      for (const g of arr) {
        try {
          const doc = await qdeckFetch<QDeckBoard>(
            issuer,
            identifier,
            /* isPrivate */ true,
            g.groupId,
            false,
            /* privateMode */ 'group'
          );
          if (doc && (doc as any)?._type !== 'QDECK_TOMBSTONE') {
            return { doc, mode: 'group' as const, groupId: g.groupId, isAdmins: !!g.isAdmin };
          }
        } catch {
          /* next */
        }
      }
      return null;
    };

    const tryGroupsIsAdmins = async (arr: typeof myGroups) => {
      for (const g of arr) {
        try {
          const doc = await qdeckFetch<QDeckBoard>(
            issuer,
            identifier,
            /* isPrivate */ true,
            g.groupId,
            !!g.isAdmin,
            /* privateMode */ 'group'
          );
          if (doc && (doc as any)?._type !== 'QDECK_TOMBSTONE') {
            return { doc, mode: 'group' as const, groupId: g.groupId, isAdmins: !!g.isAdmin };
          }
        } catch {
          /* next */
        }
      }
      return null;
    };

    const grp = (await tryGroupsIsAdmins(admins)) || (await tryGroups(members));
    if (grp) return grp;
  }

  // 2) DIRECT mode — single attempt (no groupId/isAdmins)
  try {
    const doc = await qdeckFetch<QDeckBoard>(
      issuer,
      identifier,
      /* isPrivate */ true,
      undefined,
      undefined,
      'direct'
    );
    if (doc && (doc as any)?._type !== 'QDECK_TOMBSTONE') {
      return { doc, mode: 'direct' as const };
    }
  } catch {
    /* ignore */
  }

  return null;
}
