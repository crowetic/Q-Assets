import type { Service } from 'qapp-core';
import {
  QDeckBoard,
  QDeckCard,
  QDeckCardAttachment,
  CardCommentThread,
  coerceVisibility,
  coerceService,
  QDeckTombstone,
  CardsIndexDoc,
  QDeckProject,
  ProjectsIndexDoc,
  PaymentLine,
  BoardsIndexDoc,
  PaymentsDoc,
} from '../types/qdeck';
import { base64ToObject, objectToBase64 } from 'qapp-core';
import { createBoard, createProject } from './qdeckDefaults';
import {
  getQAssetsRevenueAddress,
  parsePrivateBoardIdentV2,
  parsePrivateProjectIdentV2,
  PRIVATE_MAGIC_B64,
  QDeckCommentsId,
  QDeckId,
  stripPrivateMagic,
  tempQAssetEscrowAccountAddress,
} from '../constants/qdeckIdentifiers';
import {
  loadBoardsIndexMerged,
  normalizeIndexDoc,
  saveBoardsIndexWriteThrough,
} from './qdeckIndexCache';
import { loadProjectsIndexMerged, saveProjectsIndexWriteThrough } from './qdeckProjectIndexCache';
import { getLocalProjectDoc, setLocalProjectDoc } from './qdeckProjectDocCache';
import { searchSimpleByFullId, searchSimpleByIdPrefixOnly } from './searchSimple';
import { fileToBase64 } from './data';
import { guessImageMimeFromBase64 } from './fetchAssetAvatar';
import { transferAsset } from './qortalApi';
import {
  canUserDeleteBoard,
  collectRecipientPublicKeys,
  canPublisherPublishToBoard,
  canPublisherPublishToProject,
  cardAuthHeaderMatchesPublisher,
} from './qdeckAccess';
import { LruTtl } from './cache';
import type { BatchPublishResource } from './useQdnBatchPublisher';
import pLimit from 'p-limit';
import {
  getGroupResourceServices,
  resolveGroupPublishService,
  shouldUseLegacyPrivateMagic,
  GROUP_ENCRYPTION_SERVICE,
  LEGACY_GROUP_ENCRYPTION_SERVICE,
} from './groupEncryption';

export type QUserIdentity = {
  name?: string; // QDN name (issuer)
  address?: string; // Qortal address
  publicKey?: string; // base58/pubkey hex per your env
};

type CreateBoardArgs = {
  issuerName: string; // QDN issuer to publish under
  title: string;
  groupsAllowed: number[]; // names (or ids) allowed to edit
  usersAllowed?: string[]; // optional allowlist
  visibility?: 'public' | 'private';
  privateOpts?: {
    // only needed when visibility === 'private'
    groupId?: number;
    isAdmins?: boolean;
    mode?: 'group' | 'direct';
    recipients?: string[];
  };
  adminOverride?: boolean;
};

type CreateProjectArgs = {
  issuerName: string;
  title: string;
  description?: string;
  groupsAllowed: number[];
  usersAllowed?: string[];
  visibility?: 'public' | 'private';
  privateOpts?: {
    groupId?: number;
    isAdmins?: boolean;
    mode?: 'group' | 'direct';
    recipients?: string[];
  };
  adminOverride?: boolean;
};

export function displayNameOf(u: QUserIdentity) {
  return u.name || u.address || 'unknown';
}

export function requireName(u: QUserIdentity) {
  if (!u.name) throw new Error('This action requires a QDN name. Please register / select a name.');
  return u.name;
}

// const cardFetchLimit = pLimit(2);

export async function loadCardsIndex(
  issuerName: string,
  board: QDeckBoard
): Promise<CardsIndexDoc | null> {
  const id = QDeckId.cardsIndex(board.boardId);
  if (board.visibility !== 'private') {
    return qdeckFetch<CardsIndexDoc>(issuerName, id, false);
  }
  return qdeckFetch<CardsIndexDoc>(
    issuerName,
    id,
    true,
    board.privateMeta?.groupId,
    board.privateMeta?.isAdmins,
    board.privateMeta?.mode ?? 'group'
  );
}

type CardsIndexCandidate = {
  name: string;
  doc: CardsIndexDoc;
  stamp?: number;
};

const pickNewestCardsIndex = (a: CardsIndexCandidate, b: CardsIndexCandidate) => {
  const aStamp = a.stamp ?? 0;
  const bStamp = b.stamp ?? 0;
  if (aStamp !== bStamp) return aStamp > bStamp ? a : b;
  const aSeq = a.doc.seq ?? 0;
  const bSeq = b.doc.seq ?? 0;
  if (aSeq !== bSeq) return aSeq > bSeq ? a : b;
  const aUpdated = a.doc.updatedAt ?? 0;
  const bUpdated = b.doc.updatedAt ?? 0;
  if (aUpdated !== bUpdated) return aUpdated > bUpdated ? a : b;
  return a;
};

export async function loadNewestCardsIndex(
  board: QDeckBoard,
  opts?: { issuerHints?: string[] }
): Promise<CardsIndexDoc | null> {
  const identifier = QDeckId.cardsIndex(board.boardId);
  const isPrivate = board.visibility === 'private';
  const hits = await searchSimpleByFullId(identifier, isPrivate).catch(() => []);
  const names = new Set<string>();
  const hitStamps = new Map<string, number>();
  for (const hint of opts?.issuerHints ?? []) {
    const trimmed = (hint || '').trim();
    if (trimmed) names.add(trimmed);
  }
  for (const hit of hits) {
    if (hit?.name) {
      const normalized = hit.name.trim();
      if (!normalized) continue;
      names.add(normalized);
      const stamp = Number.isFinite(hit.updated) ? Number(hit.updated) : Number(hit.created) || 0;
      const key = normalized.toLowerCase();
      const prev = hitStamps.get(key) ?? 0;
      if (stamp > prev) hitStamps.set(key, stamp);
    }
  }
  if (names.size === 0) return null;

  const limit = pLimit(2);
  const candidates = (
    await Promise.all(
      Array.from(names).map((name) =>
        limit(async () => {
          try {
            const doc = await loadCardsIndex(name, board);
            if (!doc || doc.boardId !== board.boardId) return null;
            const stamp = hitStamps.get(name.toLowerCase()) ?? 0;
            return { name, doc, stamp };
          } catch {
            return null;
          }
        })
      )
    )
  ).filter(Boolean) as CardsIndexCandidate[];

  if (!candidates.length) return null;
  let newest = candidates[0];
  for (let i = 1; i < candidates.length; i += 1) {
    newest = pickNewestCardsIndex(newest, candidates[i]);
  }
  return newest.doc;
}

const maxHitStamp = (hits: Array<{ created?: number; updated?: number }>) => {
  let max = 0;
  for (const hit of hits) {
    const stamp = Number.isFinite(hit.updated) ? Number(hit.updated) : Number(hit.created) || 0;
    if (stamp > max) max = stamp;
  }
  return max;
};

export async function getLatestIdentifierStamp(
  identifier: string,
  isPrivate?: boolean
): Promise<number> {
  if (!identifier) return 0;
  try {
    const hits = await searchSimpleByFullId(identifier, isPrivate);
    return maxHitStamp(hits);
  } catch {
    return 0;
  }
}

export async function getLatestIdentifierPrefixStamp(
  identifierPrefix: string,
  isPrivate?: boolean
): Promise<number> {
  if (!identifierPrefix) return 0;
  try {
    const hits = await searchSimpleByIdPrefixOnly(identifierPrefix, isPrivate);
    return maxHitStamp(hits);
  } catch {
    return 0;
  }
}

type ProjectDocCandidate = {
  name: string;
  doc: QDeckProject;
  stamp?: number;
};

const pickNewestProjectDoc = (a: ProjectDocCandidate, b: ProjectDocCandidate) => {
  const aStamp = a.stamp ?? 0;
  const bStamp = b.stamp ?? 0;
  if (aStamp !== bStamp) return aStamp > bStamp ? a : b;
  const aSeq = a.doc.seq ?? 0;
  const bSeq = b.doc.seq ?? 0;
  if (aSeq !== bSeq) return aSeq > bSeq ? a : b;
  const aUpdated = a.doc.updatedAt ?? 0;
  const bUpdated = b.doc.updatedAt ?? 0;
  if (aUpdated !== bUpdated) return aUpdated > bUpdated ? a : b;
  return a;
};

export async function saveCardsIndex(issuerName: string, board: QDeckBoard, doc: CardsIndexDoc) {
  const identifier = QDeckId.cardsIndex(doc.boardId);
  const payloadBase64 = stripDataUrlPrefix(await objectToBase64(doc));
  if (!payloadBase64) throw new Error('saveCardsIndex: empty payload');

  if (board.visibility !== 'private') {
    return qortalRequest({
      action: 'PUBLISH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name: issuerName,
      identifier,
      base64: payloadBase64,
    });
  }

  const mode = board.privateMeta?.mode ?? 'group';
  if (mode === 'group') {
    if (!board.privateMeta?.groupId)
      throw new Error('private board missing groupId for cards index');
    const enc: string = await qortalRequestWithTimeout(
      {
        action: 'ENCRYPT_QORTAL_GROUP_DATA',
        base64: payloadBase64,
        groupId: board.privateMeta.groupId,
        isAdmins: !!board.privateMeta?.isAdmins,
      },
      240_000
    );
    const service = resolveGroupPublishService('group');
    const encrypted = enc;
    return qortalRequest({
      action: 'PUBLISH_QDN_RESOURCE',
      service,
      name: issuerName,
      identifier,
      base64: encrypted,
    });
  }

  // direct
  let recipients = board.privateMeta?.recipients;
  if (!recipients?.length) {
    const issNameData = await qortalRequest({ action: 'GET_NAME_DATA', name: issuerName });
    const issuerAddress = issNameData?.owner;
    if (!issuerAddress) throw new Error('saveCardsIndex: cannot resolve issuer address');

    const { publicKeys } = await collectRecipientPublicKeys({
      usersAllowed: board.usersAllowed ?? [],
      includeSelf: true,
      me: { name: issuerName, address: issuerAddress },
    });
    recipients = publicKeys;
  }
  if (!recipients?.length) throw new Error('saveCardsIndex: no recipients for direct mode');

  const enc = await encryptForRecipients(payloadBase64, recipients);
  const data64 = enc;
  return qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: resolveGroupPublishService('direct'),
    name: issuerName,
    identifier,
    base64: data64,
  });
}

export async function repairCardsIndex(
  issuerName: string,
  board: QDeckBoard,
  opts?: { concurrency?: number }
): Promise<CardsIndexDoc> {
  if (
    board.visibility === 'private' &&
    (board.privateMeta?.mode ?? 'group') === 'group' &&
    board.privateMeta?.groupId
  ) {
    await migrateLegacyGroupResourceToPublic({
      issuerName,
      identifier: QDeckId.cardsIndex(board.boardId),
      groupId: board.privateMeta.groupId,
      isAdmins: board.privateMeta?.isAdmins,
    });
  }

  const issuerHints = [issuerName, board.createdBy].filter(Boolean) as string[];
  const current = (await loadNewestCardsIndex(board, { issuerHints })) ??
    (await loadCardsIndex(issuerName, board)) ?? {
      _type: 'QDECK_CARDS_INDEX' as const,
      version: 1 as const,
      boardId: board.boardId,
      cardIds: [],
      entries: [],
      archivedIds: [],
      updatedAt: 0,
      seq: 0,
    };
  const refs = await discoverCardRefsBySearch(board);
  const limit = opts?.concurrency ? pLimit(opts.concurrency) : pLimit(2);
  const seen = new Set<string>();
  const entries: NonNullable<CardsIndexDoc['entries']> = [];
  const cardIds = new Set<string>(current.cardIds ?? []);

  await Promise.all(
    refs.map((ref) =>
      limit(async () => {
        const key = `${ref.name}::${ref.cardId}`;
        if (seen.has(key)) return;
        seen.add(key);
        try {
          const doc = await loadCardDoc(ref.name, board, ref.cardId);
          if (!doc || (doc as any)._type === 'QDECK_TOMBSTONE') return;
          if (!cardAuthHeaderMatchesPublisher(doc as QDeckCard, ref.name)) return;
          if (!(await canPublisherPublishToBoard(board, { name: ref.name }))) return;
          entries.push({
            name: ref.name,
            cardId: ref.cardId,
            title: doc.title,
            statusListId: doc.statusListId,
            scheduledStart: doc.scheduledStart,
            scheduledEnd: doc.scheduledEnd,
            scheduledAllDay: doc.scheduledAllDay,
            completedAt: doc.completedAt,
            isDone: doc.isDone,
          });
          cardIds.add(ref.cardId);
        } catch {
          /* ignore */
        }
      })
    )
  );

  const next: CardsIndexDoc = {
    _type: 'QDECK_CARDS_INDEX',
    version: 1,
    boardId: board.boardId,
    cardIds: Array.from(cardIds),
    entries,
    archivedIds: current.archivedIds ?? [],
    updatedAt: Date.now(),
    seq: (current.seq ?? 0) + 1,
  };

  await saveCardsIndex(issuerName, board, next);
  return next;
}

export async function addCardToIndex(
  issuerName: string, // issuer we're writing the index under (usually board.createdBy)
  board: QDeckBoard,
  cardId: string,
  publisherName?: string, // the *card's* publisher (defaults to issuerName for legacy)
  opts?: { skipPublish?: boolean; currentDoc?: CardsIndexDoc; card?: QDeckCard }
): Promise<CardsIndexDoc> {
  const doc =
    opts?.currentDoc ??
    (await loadCardsIndex(issuerName, board)) ??
    ({
      _type: 'QDECK_CARDS_INDEX' as const,
      version: 1 as const,
      boardId: board.boardId,
      cardIds: [],
      entries: [],
      archivedIds: [],
      updatedAt: 0,
      seq: 0,
    } as CardsIndexDoc);

  const pub = publisherName || issuerName;

  // legacy list
  if (!doc.cardIds.includes(cardId)) {
    doc.cardIds.push(cardId);
  }

  // new entries (with schedule metadata when available)
  doc.entries = doc.entries ?? [];
  const schedule: Partial<NonNullable<CardsIndexDoc['entries']>[number]> = opts?.card
    ? {
        title: opts.card.title,
        statusListId: opts.card.statusListId,
        scheduledStart: opts.card.scheduledStart,
        scheduledEnd: opts.card.scheduledEnd,
        scheduledAllDay: opts.card.scheduledAllDay,
        completedAt: opts.card.completedAt,
        isDone: opts.card.isDone,
      }
    : {};
  const entryIndex = doc.entries.findIndex((e) => e.name === pub && e.cardId === cardId);
  if (entryIndex === -1) {
    doc.entries.push({ name: pub, cardId, ...schedule });
  } else if (opts?.card) {
    doc.entries[entryIndex] = { ...doc.entries[entryIndex], ...schedule };
  }

  doc.updatedAt = Date.now();
  doc.seq = (doc.seq ?? 0) + 1;

  if (opts?.skipPublish) {
    return doc;
  }

  await saveCardsIndex(issuerName, board, doc);
  return doc;
}

export async function removeCardFromIndex(issuerName: string, board: QDeckBoard, cardId: string) {
  const doc = await loadCardsIndex(issuerName, board);
  if (!doc) return;
  const next = {
    ...doc,
    cardIds: doc.cardIds.filter((id) => id !== cardId),
    archivedIds: (doc.archivedIds || []).filter((id) => id !== cardId),
    updatedAt: Date.now(),
    seq: (doc.seq ?? 0) + 1,
  };
  await saveCardsIndex(issuerName, board, next);
}

export async function updateCardArchiveState(
  issuerName: string,
  board: QDeckBoard,
  cardId: string,
  archived: boolean
) {
  const doc = (await loadCardsIndex(issuerName, board)) ?? {
    _type: 'QDECK_CARDS_INDEX' as const,
    version: 1 as const,
    boardId: board.boardId,
    cardIds: [],
    entries: [],
    archivedIds: [],
    updatedAt: 0,
    seq: 0,
  };
  const archivedIds = new Set(doc.archivedIds || []);
  if (archived) archivedIds.add(cardId);
  else archivedIds.delete(cardId);

  // Also set flag on card doc
  try {
    const card = await loadCardDoc(issuerName, board, cardId);
    if (card) {
      const updated: QDeckCard = {
        ...card,
        archived,
        archivedAt: archived ? Date.now() : undefined,
        archivedBy: archived ? issuerName : undefined,
      };
      await saveCardDoc(issuerName, board, updated);
    }
  } catch {
    /* best effort */
  }

  const next: CardsIndexDoc = {
    ...doc,
    archivedIds: Array.from(archivedIds),
    updatedAt: Date.now(),
    seq: (doc.seq ?? 0) + 1,
  };

  await saveCardsIndex(issuerName, board, next);
}

// qdeckApi.ts
export class GroupKeyMissingError extends Error {
  constructor() {
    super('No group key found');
    this.name = 'GroupKeyMissingError';
  }
}

// --- low-level helpers (unchanged wrappers, but cleaned) ---
async function encryptForRecipients(base64: string, publicKeys: string[]) {
  const enc: string | null = await qortalRequest({
    action: 'ENCRYPT_DATA',
    base64,
    publicKeys,
  });
  if (!enc) throw new Error('ENCRYPT_DATA failed');
  return enc;
}

type PrivatePayloadOptions = {
  payloadBase64: string;
  mode?: 'group' | 'direct';
  groupId?: number;
  isAdmins?: boolean;
  recipients?: string[];
  service?: Service;
};

async function encryptPrivatePayload(opts: PrivatePayloadOptions) {
  const { payloadBase64, mode, groupId, isAdmins, recipients } = opts;
  const effMode = mode ?? (groupId != null ? 'group' : 'direct');
  // if (effMode === 'group' && isAdmins === true) {
  //   if (isAdmins === undefined) {
  //     console.error('mode is group and isAdmins is true')
  //     return;
  //   }
  // }
  if (effMode === 'group') {
    if (groupId == null) throw new Error('Group mode requires groupId');
    const enc: string = await qortalRequestWithTimeout(
      {
        action: 'ENCRYPT_QORTAL_GROUP_DATA',
        base64: payloadBase64,
        groupId,
        isAdmins: !!isAdmins,
      },
      240_000
    );
    if (!enc) throw new Error('ENCRYPT_QORTAL_GROUP_DATA failed');
    console.log('encryptedBeforePrivateMagic', enc);
    return enc;
  }
  if (!recipients?.length) throw new Error('Direct mode requires recipients');
  const enc = await encryptForRecipients(payloadBase64, recipients);
  return enc;
}

type PublishPayloadParams = {
  name: string;
  identifier: string;
  object: object;
  isPrivate?: boolean;
  groupId?: number;
  isAdmins?: boolean;
  mode?: 'group' | 'direct';
  recipients?: string[];
  service?: Service;
};

async function preparePublishPayload(params: PublishPayloadParams): Promise<BatchPublishResource> {
  const { name, identifier, object, isPrivate, groupId, isAdmins, mode, recipients, service } =
    params;
  const base64 = await objectToBase64(object);
  const effectiveMode = isPrivate ? (mode ?? (groupId != null ? 'group' : 'direct')) : undefined;
  const resolvedService: Service =
    service ??
    (isPrivate ? resolveGroupPublishService(effectiveMode ?? 'group') : ('DOCUMENT' as Service));
  if (isPrivate) {
    const encrypted = await encryptPrivatePayload({
      payloadBase64: base64,
      mode: effectiveMode,
      groupId,
      isAdmins,
      recipients,
      service: resolvedService,
    });
    console.log('prepared private payload', {
      identifier,
      service: resolvedService,
      mode: effectiveMode,
      hasMagic: encrypted.startsWith(PRIVATE_MAGIC_B64),
      payloadLength: encrypted.length,
    });
    console.log('pre-encrypted base64', base64);
    console.log('encryptedPayloadFromPreparePublishPayload with PrivateMagic', encrypted);
    return {
      name,
      service: resolvedService,
      identifier,
      base64: encrypted,
      privateMode: effectiveMode,
      groupId,
      isAdmins,
      recipients: effectiveMode === 'direct' ? recipients : undefined,
    };
  }
  return {
    name,
    service: resolvedService,
    identifier,
    base64,
  };
}

export async function buildCardPublishPayload(
  issuerName: string,
  board: QDeckBoard,
  card: QDeckCard
): Promise<BatchPublishResource> {
  const identifier =
    board.visibility === 'public'
      ? QDeckId.cardPublic(board.boardId, card.cardId)
      : QDeckId.cardPrivate(board.boardId, card.cardId);
  return preparePublishPayload({
    name: issuerName,
    identifier,
    object: card,
    isPrivate: board.visibility === 'private',
    groupId: board.privateMeta?.groupId,
    isAdmins: board.privateMeta?.isAdmins,
    mode: board.privateMeta?.mode,
    recipients: board.privateMeta?.recipients,
    service:
      board.visibility === 'private'
        ? resolveGroupPublishService(board.privateMeta?.mode ?? 'group')
        : 'DOCUMENT',
  });
}

export async function buildCardsIndexPublishPayload(
  issuerName: string,
  board: QDeckBoard,
  doc: CardsIndexDoc
): Promise<BatchPublishResource> {
  const identifier = QDeckId.cardsIndex(board.boardId);
  return preparePublishPayload({
    name: issuerName,
    identifier,
    object: doc,
    isPrivate: board.visibility === 'private',
    groupId: board.privateMeta?.groupId,
    isAdmins: board.privateMeta?.isAdmins,
    mode: board.privateMeta?.mode,
    recipients: board.privateMeta?.recipients,
    service:
      board.visibility === 'private'
        ? resolveGroupPublishService(board.privateMeta?.mode ?? 'group')
        : 'DOCUMENT',
  });
}

export async function buildBoardPublishPayload(
  issuerName: string,
  board: QDeckBoard
): Promise<BatchPublishResource> {
  const identifier =
    board.visibility === 'public'
      ? QDeckId.boardPublic(board.boardId)
      : QDeckId.boardPrivate(
          board.boardId,
          board.privateMeta?.mode ?? 'group',
          board.privateMeta?.isAdmins,
          board.privateMeta?.groupId
        );
  return preparePublishPayload({
    name: issuerName,
    identifier,
    object: board,
    isPrivate: board.visibility === 'private',
    groupId: board.privateMeta?.groupId,
    isAdmins: board.privateMeta?.isAdmins,
    mode: board.privateMeta?.mode,
    recipients: board.privateMeta?.recipients,
    service:
      board.visibility === 'private'
        ? resolveGroupPublishService(board.privateMeta?.mode ?? 'group')
        : 'DOCUMENT',
  });
}

export async function buildProjectPublishPayload(
  issuerName: string,
  project: QDeckProject
): Promise<BatchPublishResource> {
  const identifier =
    project.visibility === 'public'
      ? QDeckId.projectPublic(project.projectId)
      : QDeckId.projectPrivate(
          project.projectId,
          project.privateMeta?.mode ?? 'group',
          project.privateMeta?.isAdmins,
          project.privateMeta?.groupId
        );
  return preparePublishPayload({
    name: issuerName,
    identifier,
    object: project,
    isPrivate: project.visibility === 'private',
    groupId: project.privateMeta?.groupId,
    isAdmins: project.privateMeta?.isAdmins,
    mode: project.privateMeta?.mode,
    recipients: project.privateMeta?.recipients,
    service:
      project.visibility === 'private'
        ? resolveGroupPublishService(project.privateMeta?.mode ?? 'group')
        : 'DOCUMENT',
  });
}

export async function buildProjectsIndexPublishPayload(
  issuerName: string,
  doc: ProjectsIndexDoc
): Promise<BatchPublishResource> {
  return preparePublishPayload({
    name: issuerName,
    identifier: QDeckId.ownerProjectsIndex(),
    object: doc,
    isPrivate: false,
    service: 'DOCUMENT',
  });
}

async function decryptDirect(encryptedData: string) {
  const clear: string | null = await qortalRequest({
    action: 'DECRYPT_DATA',
    encryptedData,
  });
  if (!clear) throw new Error('DECRYPT_DATA failed');
  return clear;
}

// --- unified private publish ---
async function publishPrivate(opts: {
  identifier: string;
  payloadBase64: string;
  mode: 'group' | 'direct';
  groupId?: number;
  isAdmins?: boolean;
  recipients?: string[];
  issuerName: string;
}) {
  const { identifier, payloadBase64, mode, groupId, isAdmins, recipients, issuerName } = opts;

  if (mode === 'group') {
    if (groupId == null) throw new Error('Group mode requires groupId');
    try {
      const enc: string = await qortalRequestWithTimeout(
        {
          action: 'ENCRYPT_QORTAL_GROUP_DATA',
          base64: payloadBase64,
          groupId,
          isAdmins: !!isAdmins,
        },
        240_000
      );
      if (!enc) throw new Error('ENCRYPT_QORTAL_GROUP_DATA failed');

      const service = resolveGroupPublishService('group');
      const data64 = enc;
      return qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        service,
        name: issuerName,
        identifier,
        base64: data64,
      });
    } catch (e: any) {
      if (isGroupKeyMissing(e)) throw new GroupKeyMissingError();
      throw e;
    }
  }

  // direct
  if (!recipients?.length) throw new Error('Direct mode requires recipients');
  const enc = await encryptForRecipients(payloadBase64, recipients);
  const data64 = enc;
  return qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: resolveGroupPublishService('direct'),
    name: issuerName,
    identifier,
    base64: data64,
  });
}

async function migrateLegacyGroupResourceToPublic(opts: {
  issuerName: string;
  identifier: string;
  groupId?: number;
  isAdmins?: boolean;
}) {
  const { issuerName, identifier, groupId, isAdmins } = opts;
  if (!groupId) return false;
  try {
    const hits = await searchSimpleByFullId(identifier, true);
    const normalizedIssuer = issuerName.toLowerCase();
    const matching = hits.filter(
      (hit) => (hit.name || '').toLowerCase() === normalizedIssuer && !!hit.service
    );
    const legacyHit = matching.find(
      (hit) => (hit.service || '').toUpperCase() === LEGACY_GROUP_ENCRYPTION_SERVICE
    );
    if (!legacyHit) return false;
    const documentHit = matching.find(
      (hit) => (hit.service || '').toUpperCase() === GROUP_ENCRYPTION_SERVICE
    );
    const stamp = (hit?: typeof legacyHit) => (hit ? Number(hit.updated ?? hit.created ?? 0) : 0);
    if (documentHit && stamp(documentHit) >= stamp(legacyHit)) {
      return false;
    }

    const legacyRes = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: issuerName,
      service: LEGACY_GROUP_ENCRYPTION_SERVICE,
      identifier,
      encoding: 'base64',
    });
    const legacyData =
      typeof legacyRes === 'string' ? legacyRes : (legacyRes?.data64 ?? legacyRes?.base64);
    if (!legacyData || typeof legacyData !== 'string') return false;
    const encryptedPayload = stripPrivateMagic(legacyData);
    const decrypted = await qortalRequest({
      action: 'DECRYPT_QORTAL_GROUP_DATA',
      base64: encryptedPayload,
      groupId,
      isAdmins: !!isAdmins,
    });
    if (!decrypted || typeof decrypted !== 'string') return false;
    await publishPrivate({
      identifier,
      payloadBase64: decrypted,
      mode: 'group',
      groupId,
      isAdmins,
      issuerName,
    });
    console.info(`Migrated legacy group resource ${identifier} for ${issuerName} to DOCUMENT`);
    return true;
  } catch (error) {
    console.warn(`Failed to migrate legacy group resource ${identifier}`, error);
    return false;
  }
}

// --- unified private fetch ---
async function fetchPrivate<T>(opts: {
  identifier: string;
  issuerName: string;
  mode: 'group' | 'direct';
  groupId?: number;
  isAdmins?: boolean;
}): Promise<T | null> {
  const { identifier, issuerName, mode, groupId, isAdmins } = opts;

  const services =
    mode === 'group'
      ? await getGroupResourceServices()
      : ([resolveGroupPublishService('direct')] as Service[]);

  let base64: string | null = null;
  let fetchedService: Service | null = null;
  for (const svc of services) {
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: issuerName,
        service: svc,
        identifier,
        encoding: 'base64',
      });
      if (res) {
        base64 = res;
        fetchedService = svc;
        break;
      }
    } catch {
      /* try next */
    }
  }
  if (!base64 || !fetchedService) return null;

  if (mode === 'group') {
    if (groupId == null) return null;
    if (shouldUseLegacyPrivateMagic(fetchedService, 'group')) {
      base64 = stripPrivateMagic(base64);
    }
    const clear = await qortalRequest({
      action: 'DECRYPT_QORTAL_GROUP_DATA',
      base64,
      groupId,
      isAdmins: !!isAdmins,
    });
    if (!clear) return null;
    try {
      return (await base64ToObject(clear)) as T;
    } catch {
      return null;
    }
  }

  // direct
  const clear64 = await decryptDirect(base64);
  if (!clear64) return null;
  try {
    return (await base64ToObject(clear64)) as T;
  } catch {
    return null;
  }
}

// --- FETCH: parsed JSON for public/private ---
// name: QDN namespace, service: 'DOCUMENT' | 'DOCUMENT_PRIVATE' (hint for public path only)
// --- public/private JSON fetch facade ---
export async function qdeckFetch<T>(
  name: string,
  // service: 'DOCUMENT' | 'DOCUMENT_PRIVATE',
  identifier: string,
  isPrivate?: boolean,
  groupId?: number,
  isAdmins?: boolean,
  privateMode?: 'group' | 'direct'
): Promise<T | null> {
  if (isPrivate) {
    const mode: 'group' | 'direct' = privateMode ?? (groupId != null ? 'group' : 'direct');
    return fetchPrivate<T>({
      identifier,
      issuerName: name,
      mode,
      groupId,
      isAdmins,
    });
  }
  // console.log('passed service',service)

  // PUBLIC: fetch + decode JSON
  let res: string | null = null;
  try {
    res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name,
      service: 'DOCUMENT',
      identifier,
      encoding: 'base64',
    });
  } catch {
    return null;
  }
  if (!res) return null;

  try {
    const obj = await base64ToObject(res);
    return obj && typeof obj === 'object' ? (obj as T) : null;
  } catch {
    // non-JSON = tombstone or opaque
    return null;
  }
}

export async function getUserAccountName(): Promise<string> {
  const me = await qortalRequest({ action: 'GET_USER_ACCOUNT' });
  // const me = useAuth();
  if (!me?.name) throw new Error('No QDN name on this account. Please register a name.');
  return me.name as string;
}

/** Optional escape hatch for org-owned publishing */
export async function resolveIssuerName(override?: string): Promise<string> {
  console.log('Fetching Issuer Name... if override was passed, name will be:  ', override);
  if (override && override.trim()) return encodeURIComponent(override.trim());
  console.log('override not passed, fetching name from user account... ');
  return getUserAccountName();
}

// --- publish: route to public or private cleanly ---
export async function qdeckPublish(
  name: string,
  identifier: string,
  object: object,
  isPrivate?: boolean,
  groupId?: number,
  isAdmins?: boolean,
  mode?: 'direct' | 'group',
  recipients?: string[]
) {
  const payload = await preparePublishPayload({
    name,
    identifier,
    object,
    isPrivate,
    groupId,
    isAdmins,
    mode,
    recipients,
    service: isPrivate ? resolveGroupPublishService(mode ?? 'group') : 'DOCUMENT',
  });
  if (isPrivate) {
    console.log('publishing private resource', {
      identifier,
      service: payload.service,
      mode: payload.privateMode ?? mode,
      hasMagic: payload.base64.startsWith(PRIVATE_MAGIC_B64),
      payloadLength: payload.base64.length,
    });
  }
  return qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: payload.service,
    name,
    identifier,
    data64: payload.base64,
  });
}

/* --------------------------------- Access --------------------------------- */

// MOVED to qortalApi groups calls.

/* ------------------------- Boards (visibility-aware) ------------------------ */

// helpers
export function boardUrl(issuer: string, boardId: string) {
  if (!issuer) throw new Error('Missing issuer for boardUrl');
  return `/qdeck/${encodeURIComponent(issuer)}/${boardId}`;
}

export async function repairOwnerIndex(issuer: string) {
  const current = await loadBoardsIndex(issuer);
  console.log('Before repair', current);
  const fixed = normalizeIndexDoc(current, issuer);
  if (fixed) {
    console.log('fixed issuer', fixed.issuerName);
    await saveBoardsIndex(issuer, fixed);
    console.log('After repair', fixed);
  }
}

export async function saveBoardDoc(issuerName: string, board: QDeckBoard) {
  const identifier =
    board.visibility === 'public'
      ? QDeckId.boardPublic(board.boardId)
      : // v2 private id is mode-aware (and carries admins flag)
        QDeckId.boardPrivate(
          board.boardId,
          board.privateMeta?.mode ?? 'group',
          board.privateMeta?.isAdmins,
          board.privateMeta?.groupId
        );

  const base64 = await objectToBase64(board);

  if (board.visibility === 'public') {
    board.service = 'DOCUMENT';
    const res = await qortalRequest({
      action: 'PUBLISH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name: issuerName,
      identifier,
      base64,
    });
    return res;
  }

  try {
    await publishPrivate({
      identifier,
      payloadBase64: base64,
      mode: board.privateMeta?.mode ?? 'group',
      groupId: board.privateMeta?.groupId,
      isAdmins: board.privateMeta?.isAdmins,
      recipients: board.privateMeta?.recipients,
      issuerName,
    });
    board.service = resolveGroupPublishService(board.privateMeta?.mode ?? 'group') as
      | 'DOCUMENT'
      | 'DOCUMENT_PRIVATE';
  } catch (e) {
    if (e instanceof GroupKeyMissingError) throw e;
    throw e;
  }
}

export async function loadBoardDoc(
  issuerName: string,
  boardIdOrIdent: string,
  visibilityHint: 'public' | 'private'
): Promise<QDeckBoard | null> {
  if (visibilityHint === 'public') {
    const ident = boardIdOrIdent.startsWith(QDeckId.prefixPublicBoards)
      ? boardIdOrIdent
      : QDeckId.boardPublic(boardIdOrIdent);
    return qdeckFetch<QDeckBoard>(issuerName, ident, false);
  }

  // PRIVATE: must be a v2 ident (caller should pass the real ident)
  const ident = boardIdOrIdent.startsWith(QDeckId.prefixPrivateBoards) ? boardIdOrIdent : null; // don't synthesize a fake v2 ident

  if (!ident) return null;

  const parsed = parsePrivateBoardIdentV2(ident);
  if (!parsed) return null;

  if (parsed.mode === 'group') {
    return qdeckFetch<QDeckBoard>(
      issuerName,
      ident,
      true,
      parsed.groupId,
      parsed.isAdmins,
      'group'
    );
  }
  return qdeckFetch<QDeckBoard>(issuerName, ident, true, undefined, undefined, 'direct');
}

/* ------------------------ Projects (visibility-aware) ----------------------- */

export async function saveProjectDoc(issuerName: string, project: QDeckProject) {
  const identifier =
    project.visibility === 'public'
      ? QDeckId.projectPublic(project.projectId)
      : QDeckId.projectPrivate(
          project.projectId,
          project.privateMeta?.mode ?? 'group',
          project.privateMeta?.isAdmins,
          project.privateMeta?.groupId
        );

  const base64 = await objectToBase64(project);

  if (project.visibility === 'public') {
    project.service = 'DOCUMENT';
    return qortalRequest({
      action: 'PUBLISH_QDN_RESOURCE',
      service: 'DOCUMENT',
      name: issuerName,
      identifier,
      base64,
    });
  }

  await publishPrivate({
    identifier,
    payloadBase64: base64,
    mode: project.privateMeta?.mode ?? 'group',
    groupId: project.privateMeta?.groupId,
    isAdmins: project.privateMeta?.isAdmins,
    recipients: project.privateMeta?.recipients,
    issuerName,
  });
  project.service = resolveGroupPublishService(project.privateMeta?.mode ?? 'group') as
    | 'DOCUMENT'
    | 'DOCUMENT_PRIVATE';
}

export async function loadProjectDoc(
  issuerName: string,
  projectIdOrIdent: string,
  visibilityHint: 'public' | 'private'
): Promise<QDeckProject | null> {
  if (visibilityHint === 'public') {
    const ident = projectIdOrIdent.startsWith(QDeckId.prefixPublicProjects)
      ? projectIdOrIdent
      : QDeckId.projectPublic(projectIdOrIdent);
    return qdeckFetch<QDeckProject>(issuerName, ident, false);
  }

  const ident = projectIdOrIdent.startsWith(QDeckId.prefixPrivateProjects)
    ? projectIdOrIdent
    : null;

  if (!ident) return null;
  const parsed = parsePrivateProjectIdentV2(ident);
  if (!parsed) return null;

  if (parsed.mode === 'group') {
    return qdeckFetch<QDeckProject>(
      issuerName,
      ident,
      true,
      parsed.groupId,
      parsed.isAdmins,
      'group'
    );
  }
  return qdeckFetch<QDeckProject>(issuerName, ident, true, undefined, undefined, 'direct');
}

// Cards -------------------------

export async function saveCardDoc(issuerName: string, board: QDeckBoard, card: QDeckCard) {
  const identifier =
    board.visibility === 'public'
      ? QDeckId.cardPublic(board.boardId, card.cardId)
      : QDeckId.cardPrivate(board.boardId, card.cardId);

  // persist archive flag inside card doc for robustness
  const payload = {
    ...card,
    archived: !!card.archived,
    archivedAt: card.archived ? (card.archivedAt ?? Date.now()) : undefined,
    archivedBy: card.archived ? card.archivedBy : undefined,
    archiveReason: card.archived ? card.archiveReason : undefined,
  };

  if (board.visibility === 'public') {
    return qdeckPublish(issuerName, identifier, payload, false);
  }

  const mode = board.privateMeta?.mode ?? 'group';
  const payloadBase64 = await objectToBase64(payload);

  if (mode === 'direct') {
    // derive recipients (assignees + allowed + self)
    const issNameData = await qortalRequest({ action: 'GET_NAME_DATA', name: issuerName });
    const issuerAddress = issNameData?.owner;
    if (!issuerAddress) throw new Error('Cannot resolve issuer address for direct card');

    const { publicKeys } = await collectRecipientPublicKeys({
      assignees: card.assignees ?? [],
      usersAllowed: board.usersAllowed ?? [],
      includeSelf: true,
      me: { name: issuerName, address: issuerAddress },
    });

    return publishPrivate({
      identifier,
      payloadBase64,
      mode: 'direct',
      issuerName,
      recipients: publicKeys,
    });
  }

  if (!board.privateMeta?.groupId) throw new Error('Private board missing groupId');
  return publishPrivate({
    identifier,
    payloadBase64,
    mode: 'group',
    groupId: board.privateMeta.groupId,
    isAdmins: board.privateMeta.isAdmins,
    issuerName,
  });
}

export async function loadCardDoc(issuerName: string, board: QDeckBoard, cardId: string) {
  const identifier =
    board.visibility === 'public'
      ? QDeckId.cardPublic(board.boardId, cardId)
      : QDeckId.cardPrivate(board.boardId, cardId);

  if (board.visibility === 'public') {
    return qdeckFetch<QDeckCard>(issuerName, identifier, false);
  }

  const mode = board.privateMeta?.mode ?? 'group';
  if (mode === 'group') {
    return fetchPrivate<QDeckCard>({
      identifier,
      issuerName,
      mode: 'group',
      groupId: board.privateMeta?.groupId,
      isAdmins: board.privateMeta?.isAdmins,
    });
  }
  return fetchPrivate<QDeckCard>({ identifier, issuerName, mode: 'direct' });
}

export async function saveCommentsDoc(
  issuerName: string,
  board: QDeckBoard,
  cardId?: string,
  thread?: CardCommentThread
) {
  const privateMode = board.privateMeta?.mode ?? (board.privateMeta?.groupId ? 'group' : 'direct');
  const identifier =
    board.visibility === 'public'
      ? QDeckId.commentsPublic(board.boardId, cardId!)
      : QDeckId.commentsPrivate(
          board.boardId,
          cardId!,
          privateMode,
          board.privateMeta?.isAdmins,
          board.privateMeta?.groupId
        );

  if (board.visibility === 'public') {
    return qdeckPublish(issuerName, identifier, thread!, false);
  }

  const mode = board.privateMeta?.mode ?? 'group';
  const payloadBase64 = await objectToBase64(thread!);

  if (mode === 'direct') {
    const issNameData = await qortalRequest({ action: 'GET_NAME_DATA', name: issuerName });
    const issuerAddress = issNameData?.owner;
    if (!issuerAddress) throw new Error('Cannot resolve issuer address for direct comments');

    const { publicKeys } = await collectRecipientPublicKeys({
      usersAllowed: board.usersAllowed ?? [],
      includeSelf: true,
      me: { name: issuerName, address: issuerAddress },
    });

    return publishPrivate({
      identifier,
      payloadBase64,
      mode: 'direct',
      issuerName,
      recipients: publicKeys,
    });
  }

  if (!board.privateMeta?.groupId) throw new Error('Private board missing groupId');
  return publishPrivate({
    identifier,
    payloadBase64,
    mode: 'group',
    groupId: board.privateMeta.groupId,
    isAdmins: board.privateMeta.isAdmins,
    issuerName,
  });
}

export async function loadCommentsDoc(issuerName: string, board: QDeckBoard, cardId: string) {
  const identifier =
    board.visibility === 'public'
      ? QDeckId.commentsPublic(board.boardId, cardId)
      : board.privateMeta
        ? QDeckId.commentsPrivate(
            board.boardId,
            cardId,
            board.privateMeta.mode ?? 'group',
            board.privateMeta.isAdmins,
            board.privateMeta.groupId
          )
        : QDeckId.commentsPrivate(board.boardId, cardId, 'group', undefined, undefined);

  console.log('identifier in loadCommentsDoc', identifier);

  if (board.visibility === 'public') {
    return qdeckFetch<CardCommentThread>(issuerName, identifier, false);
  }

  const mode = board.privateMeta?.mode ?? 'group';
  if (mode === 'group') {
    return fetchPrivate<CardCommentThread>({
      identifier,
      issuerName,
      mode: 'group',
      groupId: board.privateMeta?.groupId,
      isAdmins: board.privateMeta?.isAdmins,
    });
  }
  return fetchPrivate<CardCommentThread>({ identifier, issuerName, mode: 'direct' });
}

export function isGroupKeyMissing(e: unknown): boolean {
  if (!e) return false;
  const msg = (e as any)?.message || (e as any)?.error || '';
  return String(msg).toLowerCase().includes('no group key');
}

export async function discoverComments(
  board: QDeckBoard,
  cardId: string
): Promise<Array<{ name: string }>> {
  const ident =
    board.visibility === 'public'
      ? QDeckCommentsId.publicV2(board.boardId, cardId)
      : QDeckCommentsId.privateV2(
          board.boardId,
          cardId,
          board.privateMeta?.groupId ? 'group' : 'direct',
          board.privateMeta?.groupId,
          board.privateMeta?.isAdmins
        );

  // console.log('ident from discoverComments', ident);

  const refs = await searchSimpleByFullId(ident, board.visibility === 'private' ? true : false);
  // console.log('refs from discoverComments', refs);

  return refs;
}

// qdeckApi.ts
export async function canEncryptToGroup(groupId: number, isAdmins?: boolean): Promise<boolean> {
  try {
    // 1-byte base64 ("x") is fine
    await qortalRequest({
      action: 'ENCRYPT_QORTAL_GROUP_DATA',
      base64: 'eA==',
      groupId,
      isAdmins: !!isAdmins,
    });
    return true;
  } catch (e: any) {
    return !isGroupKeyMissing(e) ? true : false;
  }
}

/* ------------------------------ Owner index doc ----------------------------- */

const INDEX_ID = QDeckId.ownerBoardsIndex();
const PROJECTS_INDEX_ID = QDeckId.ownerProjectsIndex();

export async function loadBoardsIndex(issuerName: string): Promise<BoardsIndexDoc | null> {
  return await qdeckFetch<BoardsIndexDoc>(issuerName, INDEX_ID);
}

export async function saveBoardsIndex(issuerName: string, doc: BoardsIndexDoc) {
  console.log('[Q-Deck] saveBoardsIndex', { issuerName, INDEX_ID });
  return await qdeckPublish(issuerName, INDEX_ID, doc);
}

export async function loadProjectsIndex(issuerName: string): Promise<ProjectsIndexDoc | null> {
  return await qdeckFetch<ProjectsIndexDoc>(issuerName, PROJECTS_INDEX_ID);
}

export async function saveProjectsIndex(issuerName: string, doc: ProjectsIndexDoc) {
  console.log('[Q-Deck] saveProjectsIndex', { issuerName, PROJECTS_INDEX_ID });
  return await qdeckPublish(issuerName, PROJECTS_INDEX_ID, doc);
}

export async function createBoardAndIndex(args: CreateBoardArgs) {
  const { issuerName, title, groupsAllowed, usersAllowed, visibility, privateOpts, adminOverride } =
    args;

  console.log('createBoardAndIndex visibility', visibility);

  let myName = issuerName;
  let my = await qortalRequest({ action: 'GET_USER_ACCOUNT' });
  if (!myName && my.name) myName = my.name;

  let myAddress = my.address;
  if (!myAddress && myName) {
    const nameData = await qortalRequest({
      action: 'GET_NAME_DATA',
      name: myName,
    });
    myAddress = nameData.owner;
  }
  if (!myAddress) throw Error('failed to obtain address in createBoardAndIndex');
  if (!myName) throw Error('failed to obtain name in createBoardAndIndex');

  console.log('sending this visibility to createBoard', visibility);
  // Create the board document (qdeckDefaults.createBoard derives service/isPrivate)
  const board: QDeckBoard = await createBoard({
    title,
    createdBy: myName,
    createdByAddress: myAddress,
    groupsAllowed: groupsAllowed ?? [],
    usersAllowed,
    visibility, // 'public' | 'private'
    groupId: privateOpts?.groupId, // used only when private
    isAdmins: privateOpts?.isAdmins,
    mode: privateOpts?.mode,
    adminOverride,
    // isPrivate/service are inferred inside createBoard from visibility
  });
  if (privateOpts && privateOpts.mode === 'direct' && privateOpts.recipients) {
    const { publicKeys, skipped } = await collectRecipientPublicKeys({
      groupIds: groupsAllowed, // direct mode: ignore group encrypt
      usersAllowed, // from board form
      assignees: [], // or card assignees when needed
      includeSelf: true,
      me: { name: myName, address: myAddress },
    });

    if (skipped.length) console.warn('Some recipients were skipped:', skipped);

    // then set on the board before save:
    board.privateMeta = { mode: 'direct', recipients: publicKeys, isAdmins: false };
  }

  // Publish the board
  await saveBoardDoc(myName, board);

  // Merge current index (local+remote) and append/replace this board entry
  const idx = (await loadBoardsIndexMerged(myName)) ?? {
    _type: 'QDECK_BOARDS_INDEX' as const,
    version: 1 as const,
    issuerName: myName,
    boards: [],
    updatedAt: 0,
    seq: 0,
  };

  const next = {
    ...idx,
    boards: [
      // ensure uniqueness by boardId
      ...idx.boards.filter((b) => b.boardId !== board.boardId),
      {
        boardId: board.boardId,
        title: board.title,
        createdAt: board.createdAt,
        updatedAt: board.updatedAt,
        visibility: coerceVisibility(board.visibility),
        service: coerceService(board.service),
      },
    ],
    updatedAt: Date.now(),
    seq: (idx.seq ?? 0) + 1,
  };

  await saveBoardsIndexWriteThrough(issuerName, next);
  return board;
}

export async function createProjectAndIndex(args: CreateProjectArgs) {
  const {
    issuerName,
    title,
    description,
    groupsAllowed,
    usersAllowed,
    visibility,
    privateOpts,
    adminOverride,
  } = args;

  let myName = issuerName;
  let my = await qortalRequest({ action: 'GET_USER_ACCOUNT' });
  if (!myName && my.name) myName = my.name;

  let myAddress = my.address;
  if (!myAddress && myName) {
    const nameData = await qortalRequest({
      action: 'GET_NAME_DATA',
      name: myName,
    });
    myAddress = nameData.owner;
  }
  if (!myAddress) throw Error('failed to obtain address in createProjectAndIndex');
  if (!myName) throw Error('failed to obtain name in createProjectAndIndex');

  const project: QDeckProject = await createProject({
    title,
    description,
    createdBy: myName,
    createdByAddress: myAddress,
    groupsAllowed: groupsAllowed ?? [],
    usersAllowed,
    visibility,
    groupId: privateOpts?.groupId,
    isAdmins: privateOpts?.isAdmins,
    mode: privateOpts?.mode,
    adminOverride,
  });

  if (privateOpts && privateOpts.mode === 'direct') {
    const { publicKeys } = await collectRecipientPublicKeys({
      groupIds: groupsAllowed,
      usersAllowed,
      assignees: [],
      includeSelf: true,
      me: { name: myName, address: myAddress },
    });
    project.privateMeta = {
      mode: 'direct',
      recipients: publicKeys,
      isAdmins: false,
    };
  }

  await saveProjectDoc(myName, project);
  setLocalProjectDoc(myName, project);

  const idx = (await loadProjectsIndexMerged(myName)) ?? {
    _type: 'QDECK_PROJECTS_INDEX' as const,
    version: 1 as const,
    issuerName: myName,
    projects: [],
    updatedAt: 0,
    seq: 0,
  };

  const next = {
    ...idx,
    projects: [
      ...idx.projects.filter((p) => p.projectId !== project.projectId),
      {
        projectId: project.projectId,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        visibility: coerceVisibility(project.visibility),
        service: coerceService(project.service),
        mode: project.privateMeta?.mode ?? 'group',
      },
    ],
    updatedAt: Date.now(),
    seq: (idx.seq ?? 0) + 1,
  };

  await saveProjectsIndexWriteThrough(myName, next);
  return project;
}

export async function saveProjectDocAndIndex(issuerName: string, project: QDeckProject) {
  await saveProjectDoc(issuerName, project);
  setLocalProjectDoc(issuerName, project);
  const idx = (await loadProjectsIndexMerged(issuerName)) ?? {
    _type: 'QDECK_PROJECTS_INDEX' as const,
    version: 1 as const,
    issuerName,
    projects: [],
    updatedAt: 0,
    seq: 0,
  };

  const next = {
    ...idx,
    projects: [
      ...idx.projects.filter((p) => p.projectId !== project.projectId),
      {
        projectId: project.projectId,
        title: project.title,
        createdAt: project.createdAt,
        updatedAt: project.updatedAt,
        visibility: coerceVisibility(project.visibility),
        service: coerceService(project.service),
        mode: project.privateMeta?.mode ?? 'group',
      },
    ],
    updatedAt: Date.now(),
    seq: (idx.seq ?? 0) + 1,
  };

  await saveProjectsIndexWriteThrough(issuerName, next);
}

// PRIMARY IMAGE FUNCTIONS -----------------------------------------------------------

// helper: strip data URL if fileToBase64 ever includes it (defensive)
function stripDataUrlPrefix(b64: string) {
  const i = b64.indexOf(',');
  if (i !== -1 && b64.slice(0, i).startsWith('data:')) return b64.slice(i + 1);
  return b64;
}

export async function publishPrimaryImageForCard(
  issuerName: string,
  board: QDeckBoard,
  cardId: string,
  file: File
): Promise<{ service: 'IMAGE' | 'DOCUMENT_PRIVATE'; identifier: string; isPrivate?: boolean }> {
  const identifier =
    board.visibility === 'private'
      ? QDeckId.cardPrimaryImagePrivate(board.boardId, cardId)
      : QDeckId.cardPrimaryImagePublic(board.boardId, cardId);

  // Read file -> base64 (raw)
  let data64 = await fileToBase64(file);
  data64 = stripDataUrlPrefix(data64);

  if (board.visibility === 'private') {
    const mode = board.privateMeta?.mode ?? 'group';

    if (mode === 'group') {
      const gid = board.privateMeta?.groupId;
      if (gid == null) throw new Error('private board missing groupId for image upload');

      // Encrypt to group, then publish as DOCUMENT_PRIVATE with magic
      const enc: string | null = await qortalRequestWithTimeout(
        {
          action: 'ENCRYPT_QORTAL_GROUP_DATA',
          base64: data64,
          groupId: gid,
          isAdmins: !!board.privateMeta?.isAdmins,
        },
        240000
      );
      if (!enc) throw new Error('Encrypt failed for image (group)');
      const service: Service = 'IMAGE';
      const payload = enc;
      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        service,
        name: issuerName,
        identifier,
        base64: payload,
      });

      return { service, identifier, isPrivate: true };
    } else {
      // --- DIRECT MODE ---
      // Use existing recipients if present; otherwise resolve like cards/comments.
      let recipients = board.privateMeta?.recipients;

      if (!recipients?.length) {
        const issNameData = await qortalRequest({
          action: 'GET_NAME_DATA',
          name: issuerName,
        });
        const issuerAddress = issNameData?.owner;
        if (!issuerAddress)
          throw new Error('Cannot resolve issuer address for direct image upload');

        const { publicKeys } = await collectRecipientPublicKeys({
          // best-effort: send to allowed users; cards’ assignees are unknown here
          usersAllowed: board.usersAllowed ?? [],
          includeSelf: true,
          me: { name: issuerName, address: issuerAddress },
        });

        recipients = publicKeys;
      }

      if (!recipients?.length) {
        throw new Error('Direct mode image upload has no recipients resolved');
      }

      const enc: string | null = await qortalRequest({
        action: 'ENCRYPT_DATA',
        base64: data64,
        publicKeys: recipients,
      });
      if (!enc) throw new Error('Encrypt failed for image (direct)');

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'DOCUMENT_PRIVATE',
        name: issuerName,
        identifier,
        base64: enc,
      });

      return { service: 'DOCUMENT_PRIVATE', identifier, isPrivate: true };
    }
  }

  // PUBLIC: publish as IMAGE (raw base64)
  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: 'IMAGE',
    name: issuerName,
    identifier,
    base64: data64,
  });

  return { service: 'IMAGE', identifier };
}

export async function resolvePrimaryImageDataUrl(
  issuerName: string,
  ref: { service: 'IMAGE' | 'DOCUMENT_PRIVATE'; identifier: string; isPrivate?: boolean },
  groupId?: number,
  isAdmins?: boolean
): Promise<string | undefined> {
  const primaryService = ref.service || 'IMAGE';
  const servicesToTry = ref.isPrivate
    ? Array.from(new Set([primaryService, 'DOCUMENT_PRIVATE']))
    : [primaryService];

  let base64: string | null = null;
  let resolvedService: Service | null = null;
  for (const svc of servicesToTry) {
    try {
      const res = await qortalRequest({
        action: 'FETCH_QDN_RESOURCE',
        name: issuerName,
        service: svc as Service,
        identifier: ref.identifier,
        encoding: 'base64',
      });
      if (res) {
        base64 = res;
        resolvedService = svc as Service;
        break;
      }
    } catch {
      /* try next */
    }
  }

  if (!base64) return undefined;

  // If somehow the node returned a data URL already, just pass it through
  if (base64.startsWith('data:')) {
    return base64;
  }

  // PRIVATE: remove magic, then decrypt (group or direct)
  if (ref.isPrivate && resolvedService) {
    // You added magic on publish (both group and direct), so strip it first

    if (groupId) {
      if (shouldUseLegacyPrivateMagic(resolvedService, 'group')) {
        base64 = stripPrivateMagic(base64);
      }
      base64 = await qortalRequest({
        action: 'DECRYPT_QORTAL_GROUP_DATA',
        base64,
        groupId,
        isAdmins: !!isAdmins,
      });
    } else {
      base64 = await qortalRequest({
        action: 'DECRYPT_DATA',
        encryptedData: base64,
      });
    }
  }

  if (!base64) return undefined;

  // Determine MIME type; fall back to file extension; default to png
  let mime = guessImageMimeFromBase64(base64);
  if (mime === 'application/octet-stream') {
    const ext = (ref.identifier.split('.').pop() || '').toLowerCase();
    mime =
      ext === 'jpg' || ext === 'jpeg'
        ? 'image/jpeg'
        : ext === 'webp'
          ? 'image/webp'
          : ext === 'gif'
            ? 'image/gif'
            : 'image/png';
  }

  // Always return a proper data URL (previous code accidentally returned just the MIME)
  return `data:${mime};base64,${base64}`;
}

export async function buildCardAttachmentPublishPayload(
  issuerName: string,
  board: QDeckBoard,
  cardId: string,
  file: File,
  attachmentId: string
): Promise<{ resource: BatchPublishResource; attachment: QDeckCardAttachment }> {
  const identifier =
    board.visibility === 'private'
      ? QDeckId.cardFilePrivate(board.boardId, cardId, attachmentId)
      : QDeckId.cardFilePublic(board.boardId, cardId, attachmentId);
  const isPrivate = board.visibility === 'private';
  const mode = board.privateMeta?.mode ?? (board.privateMeta?.groupId ? 'group' : 'direct');
  const service: Service =
    !isPrivate || mode === 'group' ? 'ATTACHMENT' : ('ATTACHMENT_PRIVATE' as Service);

  let data64 = await fileToBase64(file);
  data64 = stripDataUrlPrefix(data64);

  let recipients = board.privateMeta?.recipients;
  if (isPrivate) {
    if (mode === 'group') {
      if (!board.privateMeta?.groupId)
        throw new Error('private board missing groupId for attachment upload');
    } else if (!recipients?.length) {
      const issNameData = await qortalRequest({
        action: 'GET_NAME_DATA',
        name: issuerName,
      });
      const issuerAddress = issNameData?.owner;
      if (!issuerAddress) throw new Error('Cannot resolve issuer address for direct attachments');

      const { publicKeys } = await collectRecipientPublicKeys({
        usersAllowed: board.usersAllowed ?? [],
        includeSelf: true,
        me: { name: issuerName, address: issuerAddress },
      });
      recipients = publicKeys;
    }

    if (mode === 'direct' && !recipients?.length) {
      throw new Error('Direct mode attachment upload has no recipients resolved');
    }

    data64 = await encryptPrivatePayload({
      payloadBase64: data64,
      mode,
      groupId: board.privateMeta?.groupId,
      isAdmins: board.privateMeta?.isAdmins,
      recipients,
      service,
    });
  }

  const attachment: QDeckCardAttachment = {
    attachmentId,
    identifier,
    fileName: file.name,
    size: file.size,
    mimeType: file.type || undefined,
    uploadedAt: Date.now(),
    uploadedBy: issuerName,
    service,
    isPrivate,
  };

  const resource: BatchPublishResource = {
    name: issuerName,
    service,
    identifier,
    base64: data64,
    filename: file.name,
    privateMode: isPrivate ? mode : undefined,
    groupId: isPrivate ? board.privateMeta?.groupId : undefined,
    isAdmins: isPrivate ? board.privateMeta?.isAdmins : undefined,
    recipients: isPrivate && mode === 'direct' ? recipients : undefined,
  };

  return { resource, attachment };
}

// tombstone related ("DELETE" deck boards, cards, comments, etc.) --------------------------------------------------<DELETE FUNCTIONS> TOMBSTONE FUNCTIONS

export function isTombstone(v: any): v is QDeckTombstone {
  return v && v._type === 'QDECK_TOMBSTONE';
}

function makeTombstone(
  entity: QDeckTombstone['entity'],
  boardId: string,
  deletedBy: string,
  cardId?: string
): QDeckTombstone {
  return {
    _type: 'QDECK_TOMBSTONE',
    entity,
    boardId,
    cardId,
    deletedAt: Date.now(),
    deletedBy,
    version: 1,
  };
}

/**
 * Publish a tombstone over an existing identifier.
 * Works for public/private because it uses qdeckPublish with the same service/identifier.
 */
async function publishTombstone(
  issuerName: string,
  identifier: string,
  tomb: QDeckTombstone,
  isPrivate: boolean,
  groupId?: number,
  isAdmins?: boolean,
  recipients?: string[], // <-- add
  mode: 'group' | 'direct' = groupId != null ? 'group' : 'direct' // <-- infer
) {
  if (!isPrivate) {
    return qdeckPublish(issuerName, identifier, tomb, false);
  }
  // private
  return qdeckPublish(issuerName, identifier, tomb, true, groupId, isAdmins, mode, recipients);
}

/**
 * Delete a board. Overwrites:
 *  - the board document (BOARD tombstone)
 *  - (optional) every card (CARD tombstone)
 *  - (optional) every comments thread (COMMENTS tombstone)
 * Also removes the board from the owner's boards index.
 */
export async function deleteBoard(
  issuerName: string,
  board: QDeckBoard,
  cards?: QDeckCard[],
  opts?: { cascadeCards?: boolean; cascadeComments?: boolean }
) {
  const cascadeCards = !!opts?.cascadeCards;
  const cascadeComments = !!opts?.cascadeComments;

  const isPrivate = board.visibility === 'private';
  const gid = board.privateMeta?.groupId;
  const isAdmins = board.privateMeta?.isAdmins;

  // 1) Tombstone the board
  const boardIdent =
    board.visibility === 'public'
      ? QDeckId.boardPublic(board.boardId)
      : board.privateMeta
        ? QDeckId.boardPrivate(
            board.boardId,
            board.privateMeta.mode ?? 'group',
            board.privateMeta.isAdmins,
            board.privateMeta.groupId
          )
        : QDeckId.boardPrivate(board.boardId, 'group');

  await publishTombstone(
    issuerName,
    boardIdent,
    makeTombstone('BOARD', board.boardId, issuerName),
    isPrivate,
    gid,
    isAdmins,
    board.privateMeta?.recipients,
    board.privateMeta?.mode
  );
  // 2) Optionally cascade cards (and their comments)
  if (cascadeCards && cards && cards.length) {
    for (const c of cards) {
      const cardIdent =
        board.visibility === 'public'
          ? QDeckId.cardPublic(board.boardId, c.cardId)
          : QDeckId.cardPrivate(board.boardId, c.cardId);

      await publishTombstone(
        issuerName,
        cardIdent,
        makeTombstone('CARD', board.boardId, issuerName, c.cardId),
        isPrivate,
        gid,
        isAdmins,
        board.privateMeta?.recipients,
        board.privateMeta?.mode
      );

      if (cascadeComments) {
        const commentsIdent =
          board.visibility === 'public'
            ? QDeckId.commentsPublic(board.boardId, c.cardId)
            : board.privateMeta
              ? QDeckId.commentsPrivate(
                  board.boardId,
                  c.cardId,
                  board.privateMeta.mode ?? 'group',
                  board.privateMeta.isAdmins,
                  board.privateMeta.groupId
                )
              : QDeckId.commentsPrivate(board.boardId, c.cardId, 'group', undefined, undefined);

        await publishTombstone(
          issuerName,
          commentsIdent,
          makeTombstone('COMMENTS', board.boardId, issuerName, c.cardId),
          isPrivate,
          gid,
          isAdmins,
          board.privateMeta?.recipients,
          board.privateMeta?.mode
        );
      }
    }
  }

  // 3) Prune from the index (load merged for safety, then remove)
  const idx = (await loadBoardsIndexMerged(issuerName)) ?? null;
  if (idx) {
    const next = {
      ...idx,
      boards: idx.boards.filter((b) => b.boardId !== board.boardId),
      updatedAt: Date.now(),
      seq: (idx.seq ?? 0) + 1,
    };
    await saveBoardsIndexWriteThrough(issuerName, next);
  }
}

export type CardRef = { name: string; cardId: string };

export async function discoverCardRefsBySearch(board: QDeckBoard): Promise<CardRef[]> {
  const prefix =
    board.visibility === 'public'
      ? QDeckId.prefixPublicCards(board.boardId)
      : QDeckId.prefixPrivateCards(board.boardId);

  const heads = await searchSimpleByIdPrefixOnly(prefix, board.visibility === 'private');

  // Extract {name, cardId} for *any* issuer that has matching identifier
  const refs = heads
    .filter((h) => h?.identifier?.startsWith(prefix))
    .map((h) => ({ name: h.name, cardId: h.identifier.slice(prefix.length) }))
    // de-dupe (some nodes can give dup heads)
    .filter((v, i, a) => a.findIndex((x) => x.name === v.name && x.cardId === v.cardId) === i);

  console.log('refs from discoverCardRefsBySearch', refs);

  return refs;
}

// PAYMENTS AND UPVOTES BELOW --------------------------------------------------------------------------------------------------------------
/* ------------------------------- Payments/Upvotes --------------------------- */

/**
 * Append a payment line, creating the payments doc if it doesn't exist.
 * Respects board visibility (public/private).
 */
export async function appendPaymentLine(
  issuerName: string,
  board: QDeckBoard, // pass the board, not just id
  line: PaymentLine,
  maxRetries = 2
) {
  // const id = `qdeck__payments__${board.boardId}`;
  const id = QDeckId.boardPaymentsDoc(board.boardId);
  const isPrivate = board.visibility === 'private';
  const gid = board.privateMeta?.groupId;
  const isAdmins = board.privateMeta?.isAdmins;

  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    // fetch existing (visibility-aware)
    const existing = await qdeckFetch<PaymentsDoc>(issuerName, id, isPrivate, gid, isAdmins);

    // create if missing
    const doc: PaymentsDoc = existing ?? {
      _type: 'QDECK_PAYMENTS',
      version: 1,
      boardId: board.boardId,
      lines: [],
      updatedAt: 0,
      seq: 0,
    };

    doc.lines.push(line);
    doc.updatedAt = Date.now();
    doc.seq = (doc.seq ?? 0) + 1;

    try {
      await qdeckPublish(issuerName, id, doc, isPrivate, gid, isAdmins);
      return; // success
    } catch (e) {
      // if a concurrent writer beat us, refetch and try again
      if (attempt === maxRetries) throw e;
      await new Promise((r) => setTimeout(r, 200));
    }
  }
}

export async function sendUpvoteSplit({
  currency,
  amount,
  projectOwnerAddress,
  isEscrow,
  percentSplit = 66,
  qAssetId = 6,
}: {
  currency: 'QORT' | 'QASSET';
  amount: number;
  projectOwnerAddress: string;
  isEscrow?: boolean;
  percentSplit?: number;
  qAssetId?: number;
}) {
  const fee = amount * (10 / 100);
  const remaining = amount - fee;
  const amt1 = remaining * (percentSplit / 100);
  const amt2 = remaining - amt1;

  const user = await qortalRequest({
    action: 'GET_USER_ACCOUNT',
  });
  const senderAddress = user.address;
  const senderPublicKey = user.publicKey;

  const appRevenueAddress = await getQAssetsRevenueAddress();

  if (currency === 'QORT') {
    await qortalRequest({
      action: 'SEND_COIN',
      coin: 'QORT',
      recipient: appRevenueAddress,
      amount: fee,
    });
    await qortalRequest({
      action: 'SEND_COIN',
      coin: 'QORT',
      recipient: isEscrow ? tempQAssetEscrowAccountAddress : appRevenueAddress,
      amount: amt1,
    });
    await qortalRequest({
      action: 'SEND_COIN',
      coin: 'QORT',
      recipient: isEscrow ? tempQAssetEscrowAccountAddress : projectOwnerAddress,
      amount: amt2,
    });
  } else {
    await transferAsset(senderAddress, senderPublicKey, appRevenueAddress, qAssetId, fee);
    await transferAsset(
      senderAddress,
      senderPublicKey,
      isEscrow ? tempQAssetEscrowAccountAddress : appRevenueAddress,
      qAssetId,
      amt1
    );
    await transferAsset(
      senderAddress,
      senderPublicKey,
      isEscrow ? tempQAssetEscrowAccountAddress : projectOwnerAddress,
      qAssetId,
      amt2
    );
  }
}

// ADMIN functions

export function applyAdminOverride(
  board: QDeckBoard,
  card: QDeckCard,
  adminName: string,
  overrideId: string // full QDN id or short card id per your choice
): QDeckCard {
  if (!board.adminOverride) return card; // no-op when not allowed
  return {
    ...card,
    overriddenBy: adminName,
    overrideId,
    updatedAt: Date.now(),
    seq: card.seq + 1,
    creatorIsAdmin: true, // often you’ll mark who wrote last
  };
}

// qdeckApi.ts (add helper)
export async function deleteBoardById(
  issuerName: string,
  boardId: string,
  opts?: { cascadeCards?: boolean; cascadeComments?: boolean }
) {
  const me = await qortalRequest({ action: 'GET_USER_ACCOUNT' }).catch(() => null);
  console.log('me from deleteBoardById', me);
  const board = await resolveBoardForRead(issuerName, boardId /*, undefined, me?.address*/).catch(
    () => null
  );
  console.log('board from deleteBoardById after resolveBoardForRead', board);

  if (!board || isTombstone(board)) {
    // prune index as before...
    const idx = await loadBoardsIndexMerged(issuerName).catch(() => null);
    if (idx) {
      const next = {
        ...idx,
        boards: idx.boards.filter((b) => b.boardId !== boardId),
        updatedAt: Date.now(),
        seq: (idx.seq ?? 0) + 1,
      };
      await saveBoardsIndexWriteThrough(issuerName, next);
    }
    return;
  }

  const ok = await canUserDeleteBoard(board, { name: me?.name, address: me?.address });
  if (!ok) throw new Error('Not authorized to delete this board.');

  // cascade as before...
  let cards: QDeckCard[] | undefined;
  if (opts?.cascadeCards) {
    const idx = await loadCardsIndex(issuerName, board).catch(() => null);
    if (idx?.cardIds?.length) {
      const docs = await Promise.all(
        idx.cardIds.map((cid) => loadCardDoc(issuerName, board, cid).catch(() => null))
      );
      cards = (docs.filter(Boolean) as QDeckCard[]).filter((d) => !isTombstone(d));
    } else {
      cards = [];
    }
  }

  await deleteBoard(issuerName, board, cards, opts);
}

// export async function findBoardVisibilityHeads(
//   issuerName: string,
//   boardId: string
// ): Promise<'public' | 'private' | null> {
//   const publicIdent = QDeckId.boardPublic(boardId);

//   const [pubHeads, privHeads] = await Promise.all([
//     cachedHeads(QDeckId.prefixPublicBoards, false),
//     cachedHeads(QDeckId.prefixPrivateBoards, true),
//   ]);

//   // Public match = definitely public
//   if (pubHeads.some(h => h.name === issuerName && h.identifier === publicIdent)) {
//     return 'public';
//   }

//   // Private match (accept legacy, v1, and v2)
//   const isPrivateForBoard = (ident: string) => {

//     // v2 parse (preferred)
//     const p2 = parsePrivateBoardIdentV2(ident);
//     if (p2?.boardId === boardId) return true;

//   };

//   if (privHeads.some(h => h.name === issuerName && isPrivateForBoard(h.identifier))) {
//     return 'private';
//   }

//   return null;
// }

export async function findBoardVisibilityHeads(
  issuerName: string,
  boardId: string
): Promise<'public' | 'private' | null> {
  const [pubHeads, privHeads] = await Promise.all([
    cachedHeads(QDeckId.prefixPublicBoards, false),
    cachedHeads(QDeckId.prefixPrivateBoards, true),
  ]);

  const pubId = QDeckId.boardPublic(boardId);
  if (pubHeads.some((h) => h.name === issuerName && h.identifier === pubId)) return 'public';

  const mine = privHeads.filter((h) => h.name === issuerName);
  for (const h of mine) {
    const p = parsePrivateBoardIdentV2(h.identifier);
    if (p?.boardId === boardId) return 'private';
  }
  return null;
}

const headsCache = new LruTtl<string, any[]>(128, 30_000); // 30s heads
// const groupsCache = new LruTtl<string, Array<{groupId:number;isAdmin?:boolean}>>(64, 30_000);

// helper: cached heads
async function cachedHeads(prefix: string, isPrivate: boolean) {
  const key = `${isPrivate ? 'priv' : 'pub'}:${prefix}`;
  const hit = headsCache.get(key);
  if (hit) return hit;
  const res = await searchSimpleByIdPrefixOnly(prefix, isPrivate);
  headsCache.set(key, res || []);
  return res || [];
}

export type BoardProbe = {
  doc: QDeckBoard;
  visibility: 'public' | 'private';
  mode?: 'group' | 'direct'; // only for private
  groupId?: number; // only for private+group
  isAdmins?: boolean; // only for private+group
} | null;

export type ProjectProbe = {
  doc: QDeckProject;
  visibility: 'public' | 'private';
  mode?: 'group' | 'direct';
  groupId?: number;
  isAdmins?: boolean;
} | null;

// qdeckApi.ts
export async function resolveBoardForRead(
  issuerName: string,
  boardIdOrIdent: string,
  hint?: 'public' | 'private'
): Promise<QDeckBoard | null> {
  const res = await resolveBoardForReadWithMeta(issuerName, boardIdOrIdent, hint);
  return res?.doc ?? null;
}

export async function resolveBoardForReadWithMeta(
  issuer: string,
  boardIdOrIdent: string,
  hint?: 'public' | 'private'
) {
  // If an ident was passed, handle directly (unchanged)
  if (boardIdOrIdent.startsWith(QDeckId.prefixPublicBoards)) {
    const doc = await qdeckFetch<QDeckBoard>(issuer, boardIdOrIdent, false);
    return doc ? { doc, visibility: 'public' as const } : null;
  }
  if (boardIdOrIdent.startsWith(QDeckId.prefixPrivateBoards)) {
    const p = parsePrivateBoardIdentV2(boardIdOrIdent);
    if (!p) return null;
    if (p.mode === 'group') {
      const doc = await qdeckFetch<QDeckBoard>(
        issuer,
        boardIdOrIdent,
        true,
        p.groupId,
        !!p.isAdmins,
        'group'
      );
      return doc
        ? {
            doc,
            visibility: 'private' as const,
            mode: 'group' as const,
            groupId: p.groupId,
            isAdmins: !!p.isAdmins,
          }
        : null;
    } else {
      const doc = await qdeckFetch<QDeckBoard>(
        issuer,
        boardIdOrIdent,
        true,
        undefined,
        undefined,
        'direct'
      );
      return doc ? { doc, visibility: 'private' as const, mode: 'direct' as const } : null;
    }
  }

  // From here, we have a short boardId.
  const boardId = boardIdOrIdent.trim();
  if (!boardId) return null;

  // If caller hints PUBLIC, go straight there.
  if (hint === 'public') {
    const pubIdent = QDeckId.boardPublic(boardId);
    const doc = await qdeckFetch<QDeckBoard>(issuer, pubIdent, false);
    return doc ? { doc, visibility: 'public' as const } : null;
  }

  // If caller hints PRIVATE, skip public and discover the v2 ident.
  const discoverPrivateV2 = async () => {
    const privHeads = await searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateBoards, true);
    const mine = privHeads.filter((h) => h.name === issuer);
    const hit = mine.find((h) => {
      const p = parsePrivateBoardIdentV2(h.identifier);
      return p && p.boardId === boardId;
    });
    if (!hit) return null;

    const p = parsePrivateBoardIdentV2(hit.identifier)!;
    if (p.mode === 'group') {
      const doc = await qdeckFetch<QDeckBoard>(
        issuer,
        hit.identifier,
        true,
        p.groupId,
        !!p.isAdmins,
        'group'
      );
      return doc
        ? {
            doc,
            visibility: 'private' as const,
            mode: 'group' as const,
            groupId: p.groupId,
            isAdmins: !!p.isAdmins,
          }
        : null;
    } else {
      const doc = await qdeckFetch<QDeckBoard>(
        issuer,
        hit.identifier,
        true,
        undefined,
        undefined,
        'direct'
      );
      return doc ? { doc, visibility: 'private' as const, mode: 'direct' as const } : null;
    }
  };

  if (hint === 'private') {
    return await discoverPrivateV2();
  }

  // No hint: try public, then private discovery
  {
    const pubIdent = QDeckId.boardPublic(boardId);
    const pub = await qdeckFetch<QDeckBoard>(issuer, pubIdent, false);
    if (pub) return { doc: pub, visibility: 'public' as const };
  }
  return await discoverPrivateV2();
}

export async function resolveProjectForRead(
  issuerName: string,
  projectIdOrIdent: string,
  hint?: 'public' | 'private'
): Promise<QDeckProject | null> {
  const res = await resolveProjectForReadWithMeta(issuerName, projectIdOrIdent, hint);
  return res?.doc ?? null;
}

async function loadNewestAuthorizedProjectDoc(
  base: QDeckProject,
  meta: {
    visibility: 'public' | 'private';
    mode?: 'group' | 'direct';
    groupId?: number;
    isAdmins?: boolean;
  },
  opts?: { issuerHints?: string[]; maxCandidates?: number }
): Promise<QDeckProject | null> {
  const identifier =
    meta.visibility === 'private'
      ? QDeckId.projectPrivate(
          base.projectId,
          meta.mode ?? (meta.groupId != null ? 'group' : 'direct'),
          meta.isAdmins,
          meta.groupId
        )
      : QDeckId.projectPublic(base.projectId);
  const isPrivate = meta.visibility === 'private';
  const hits = await searchSimpleByFullId(identifier, isPrivate).catch(() => []);
  const maxCandidates = opts?.maxCandidates ?? 20;
  const candidates: Array<{ name: string; stamp: number }> = [];

  for (const hit of hits) {
    if (!hit?.name) continue;
    const stamp = Number.isFinite(hit.updated) ? Number(hit.updated) : Number(hit.created) || 0;
    candidates.push({ name: hit.name.trim(), stamp });
  }

  candidates.sort((a, b) => b.stamp - a.stamp);

  const names = new Set<string>();
  for (const hint of opts?.issuerHints ?? []) {
    const trimmed = (hint || '').trim();
    if (trimmed) names.add(trimmed);
  }
  for (const entry of candidates) {
    if (names.size >= maxCandidates) break;
    if (entry.name) names.add(entry.name);
  }

  const mode = meta.mode ?? (meta.groupId != null ? 'group' : 'direct');
  const limit = pLimit(2);
  const baseCandidate: ProjectDocCandidate = {
    name: (opts?.issuerHints?.[0] ?? base.createdBy ?? '').trim(),
    doc: base,
    stamp: base.updatedAt ?? 0,
  };
  const docs = (
    await Promise.all(
      Array.from(names).map((name) =>
        limit(async () => {
          try {
            const doc =
              meta.visibility === 'private'
                ? await qdeckFetch<QDeckProject>(
                    name,
                    identifier,
                    true,
                    mode === 'group' ? meta.groupId : undefined,
                    mode === 'group' ? !!meta.isAdmins : undefined,
                    mode
                  )
                : await qdeckFetch<QDeckProject>(name, identifier, false);
            if (!doc || (doc as any)._type === 'QDECK_TOMBSTONE') return null;
            if (doc.projectId !== base.projectId) return null;
            if (!(await canPublisherPublishToProject(base, { name }))) return null;
            const stamp = candidates.find((c) => c.name === name)?.stamp ?? doc.updatedAt ?? 0;
            return { name, doc, stamp };
          } catch {
            return null;
          }
        })
      )
    )
  ).filter(Boolean) as ProjectDocCandidate[];

  const all = docs.length ? docs.slice() : [];
  if (!all.some((c) => c.doc.projectId === base.projectId && c.name === baseCandidate.name)) {
    all.push(baseCandidate);
  }
  if (!all.length) return null;
  let newest = all[0];
  for (let i = 1; i < all.length; i += 1) {
    newest = pickNewestProjectDoc(newest, all[i]);
  }
  return newest.doc;
}

export async function resolveProjectForReadWithMeta(
  issuer: string,
  projectIdOrIdent: string,
  hint?: 'public' | 'private'
) {
  const localProbeFor = (projectId: string, expected?: 'public' | 'private') => {
    if (!projectId) return null;
    const cached = getLocalProjectDoc(issuer, projectId);
    if (!cached) return null;
    const visibility = cached.visibility === 'private' ? 'private' : 'public';
    if (expected && visibility !== expected) return null;
    if (visibility === 'private') {
      const mode = cached.privateMeta?.mode ?? 'group';
      if (mode === 'group') {
        return {
          doc: cached,
          visibility: 'private' as const,
          mode: 'group' as const,
          groupId: cached.privateMeta?.groupId,
          isAdmins: !!cached.privateMeta?.isAdmins,
        };
      }
      return { doc: cached, visibility: 'private' as const, mode: 'direct' as const };
    }
    return { doc: cached, visibility: 'public' as const };
  };

  const discoverPrivateV2 = async (projectId: string) => {
    const privHeads = await searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateProjects, true);
    const mine = privHeads.filter((h) => h.name === issuer);
    const hit = mine.find((h) => {
      const p = parsePrivateProjectIdentV2(h.identifier);
      return p && p.projectId === projectId;
    });
    if (!hit) return null;

    const p = parsePrivateProjectIdentV2(hit.identifier)!;
    if (p.mode === 'group') {
      const doc = await qdeckFetch<QDeckProject>(
        issuer,
        hit.identifier,
        true,
        p.groupId,
        !!p.isAdmins,
        'group'
      );
      return doc
        ? {
            doc,
            visibility: 'private' as const,
            mode: 'group' as const,
            groupId: p.groupId,
            isAdmins: !!p.isAdmins,
          }
        : null;
    }
    const doc = await qdeckFetch<QDeckProject>(
      issuer,
      hit.identifier,
      true,
      undefined,
      undefined,
      'direct'
    );
    return doc ? { doc, visibility: 'private' as const, mode: 'direct' as const } : null;
  };

  if (projectIdOrIdent.startsWith(QDeckId.prefixPublicProjects)) {
    const doc = await qdeckFetch<QDeckProject>(issuer, projectIdOrIdent, false);
    if (doc) {
      const latest = await loadNewestAuthorizedProjectDoc(
        doc,
        { visibility: 'public' },
        { issuerHints: [issuer, doc.createdBy].filter(Boolean) as string[] }
      ).catch(() => null);
      return { doc: latest ?? doc, visibility: 'public' as const };
    }
    const projectId = projectIdOrIdent.slice(QDeckId.prefixPublicProjects.length);
    const local = localProbeFor(projectId, 'public');
    if (local) return local;
    return projectId ? await discoverPrivateV2(projectId) : null;
  }
  if (projectIdOrIdent.startsWith(QDeckId.prefixPrivateProjects)) {
    const p = parsePrivateProjectIdentV2(projectIdOrIdent);
    if (!p) return null;
    if (p.mode === 'group') {
      const doc = await qdeckFetch<QDeckProject>(
        issuer,
        projectIdOrIdent,
        true,
        p.groupId,
        !!p.isAdmins,
        'group'
      );
      if (doc) {
        const latest = await loadNewestAuthorizedProjectDoc(
          doc,
          { visibility: 'private', mode: 'group', groupId: p.groupId, isAdmins: !!p.isAdmins },
          { issuerHints: [issuer, doc.createdBy].filter(Boolean) as string[] }
        ).catch(() => null);
        return {
          doc: latest ?? doc,
          visibility: 'private' as const,
          mode: 'group' as const,
          groupId: p.groupId,
          isAdmins: !!p.isAdmins,
        };
      }
      return localProbeFor(p.projectId, 'private');
    }
    const doc = await qdeckFetch<QDeckProject>(
      issuer,
      projectIdOrIdent,
      true,
      undefined,
      undefined,
      'direct'
    );
    if (doc) {
      const latest = await loadNewestAuthorizedProjectDoc(
        doc,
        { visibility: 'private', mode: 'direct' },
        { issuerHints: [issuer, doc.createdBy].filter(Boolean) as string[] }
      ).catch(() => null);
      return { doc: latest ?? doc, visibility: 'private' as const, mode: 'direct' as const };
    }
    return localProbeFor(p.projectId, 'private');
  }

  const projectId = projectIdOrIdent.trim();
  if (!projectId) return null;

  if (hint === 'public') {
    const pubIdent = QDeckId.projectPublic(projectId);
    const doc = await qdeckFetch<QDeckProject>(issuer, pubIdent, false);
    if (doc) {
      const latest = await loadNewestAuthorizedProjectDoc(
        doc,
        { visibility: 'public' },
        { issuerHints: [issuer, doc.createdBy].filter(Boolean) as string[] }
      ).catch(() => null);
      return { doc: latest ?? doc, visibility: 'public' as const };
    }
    return localProbeFor(projectId, 'public');
  }

  if (hint === 'private') {
    const local = localProbeFor(projectId, 'private');
    if (local) return local;
    return await discoverPrivateV2(projectId);
  }

  {
    const pubIdent = QDeckId.projectPublic(projectId);
    const pub = await qdeckFetch<QDeckProject>(issuer, pubIdent, false);
    if (pub) {
      const latest = await loadNewestAuthorizedProjectDoc(
        pub,
        { visibility: 'public' },
        { issuerHints: [issuer, pub.createdBy].filter(Boolean) as string[] }
      ).catch(() => null);
      return { doc: latest ?? pub, visibility: 'public' as const };
    }
  }
  const local = localProbeFor(projectId);
  if (local) return local;
  return await discoverPrivateV2(projectId);
}
