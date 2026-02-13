import React, {
  createContext,
  useContext,
  useMemo,
  useRef,
  useState,
  useCallback,
  useEffect,
} from 'react';
import {
  QDeckBoard,
  QDeckCard,
  QDeckCardAttachment,
  CardCommentThread,
  CardsIndexDoc,
} from '../../types/qdeck';
import {
  saveCommentsDoc,
  appendPaymentLine,
  QUserIdentity,
  addCardToIndex,
  loadCardDoc,
  findBoardVisibilityHeads,
  resolveBoardForRead,
  discoverCardRefsBySearch,
  resolveBoardForReadWithMeta,
  discoverComments,
  discoverCommentHeadsByBoard,
  loadCommentsDoc,
  buildCardPublishPayload,
  buildCardAttachmentPublishPayload,
  buildCardsIndexPublishPayload,
  buildBoardPublishPayload,
  repairCardsIndex as repairCardsIndexDoc,
  loadMergedCardsIndex,
  loadMergedCardsIndexWithMeta,
  mergeCardsIndexDocs,
  getLatestIdentifierPrefixMeta,
} from '../../utils/qdeckApi';
import { useAuth } from 'qapp-core';
import { deleteBoard as apiDeleteBoard } from '../../utils/qdeckApi'; // path as needed
import { uniqueId6 } from '../../utils/ids';
import {
  canPublisherPublishToBoard,
  canUserEditBoard,
  canUserViewBoard,
  cardAuthHeaderMatchesPublisher,
} from '../../utils/qdeckAccess';
import { QDeckId } from '../../constants/qdeckIdentifiers';
import { useFetchTracker } from '../../state/global/fetchTracker';
import pLimit from 'p-limit';
import { useAlert } from '../alerts';
import { useQdnBatchPublisher } from '../../utils/useQdnBatchPublisher';
import type { BatchPublishResource } from '../../utils/useQdnBatchPublisher';
import { useActiveAccountName } from '../../hooks/useActiveAccountName';
import { getLocalCardsIndex, setLocalCardsIndex } from '../../utils/qdeckCardsIndexCache';
import {
  beginQDeckBoardLoadTrace,
  finishQDeckBoardLoadTrace,
  markQDeckBoardLoadPhase,
} from '../../utils/qdeckPerf';
// import QDeckPermissionsPanel from './QDeckPermissionsPanel';

// ---- Types ----
type LoadOpts = {
  visibility?: 'public' | 'private';
  groupId?: number;
  isAdmins?: boolean;
  preserveExisting?: boolean;
};

type LoadCardsOpts = {
  preserveOnEmpty?: boolean;
  skipIfIndexUnchanged?: boolean;
  perfTraceId?: string | null;
};

type PublishMode = 'immediate' | 'batch';
const QUEUE_STORAGE_KEY = 'qdeck_publish_queue_v1';
const PUBLISH_MODE_STORAGE_KEY = 'qdeck_publish_mode_v1';
const PUBLISH_MODE_BY_BOARD_STORAGE_KEY = 'qdeck_publish_mode_by_board_v1';
const BOARD_LAST_VISIT_STORAGE_PREFIX = 'qdeck_board_last_visit_v1::';
const publishQueueKey = (res: BatchPublishResource) =>
  `${res.service}::${(res.name || '').toLowerCase()}::${res.identifier}`;

const readBoardLastVisit = (boardId?: string | null): number => {
  if (!boardId || typeof window === 'undefined') return 0;
  try {
    const raw = window.localStorage.getItem(`${BOARD_LAST_VISIT_STORAGE_PREFIX}${boardId}`);
    const stamp = Number(raw ?? 0);
    return Number.isFinite(stamp) ? stamp : 0;
  } catch {
    return 0;
  }
};

const writeBoardLastVisit = (boardId?: string | null, stamp?: number) => {
  if (!boardId || typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(
      `${BOARD_LAST_VISIT_STORAGE_PREFIX}${boardId}`,
      String(Number(stamp ?? Date.now()) || Date.now())
    );
  } catch {
    /* ignore */
  }
};

const readPublishQueueFromStorage = (): Record<string, BatchPublishResource[]> => {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.sessionStorage.getItem(QUEUE_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return {};
    const out: Record<string, BatchPublishResource[]> = {};
    for (const [key, value] of Object.entries(parsed)) {
      if (!Array.isArray(value)) continue;
      out[key] = value.filter((item) => item && typeof item === 'object') as BatchPublishResource[];
    }
    return out;
  } catch {
    return {};
  }
};

const readPublishModeFromStorage = (): PublishMode => {
  if (typeof window === 'undefined') return 'immediate';
  try {
    const raw = window.sessionStorage.getItem(PUBLISH_MODE_STORAGE_KEY);
    if (raw === 'batch') return 'batch';
  } catch {
    /* ignore */
  }
  return 'immediate';
};

const readPublishModeForBoard = (boardId?: string | null): PublishMode | null => {
  if (!boardId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PUBLISH_MODE_BY_BOARD_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    const mode = parsed?.[boardId];
    if (mode === 'batch' || mode === 'immediate') return mode;
  } catch {
    /* ignore */
  }
  return null;
};

const writePublishModeForBoard = (boardId: string, mode: PublishMode) => {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(PUBLISH_MODE_BY_BOARD_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, PublishMode>) : {};
    parsed[boardId] = mode;
    window.localStorage.setItem(PUBLISH_MODE_BY_BOARD_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
};

type QDeckCtx = {
  identity: QUserIdentity;

  board: QDeckBoard | null;
  cards: Record<string, QDeckCard>;
  cardVariants: Record<string, QDeckCard[]>;
  archivedCardIds: Set<string>;
  cardsLoading: boolean;
  comments: Record<string, CardCommentThread>;
  commentHeads: Record<string, { latestStamp: number; newestPublisher?: string }>;
  boardLastVisitTs: number;
  changeLog: BoardChangeLog;
  isCardCollapsed: (cardId: string, card?: QDeckCard) => boolean;
  setCardCollapsed: (cardId: string, collapsed: boolean) => void;

  loadBoardById: (
    issuerName: string,
    boardId: string, // short UUID
    visibility?: 'public' | 'private',
    opts?: LoadOpts
  ) => Promise<void>;

  persistBoard: (board: QDeckBoard) => Promise<void>;
  refreshBoard: (issuerOverride?: string) => Promise<void>;

  createCard: (partial: Partial<QDeckCard>) => Promise<QDeckCard>;
  moveCard: (cardId: string, toListId: string, newOrder: number) => Promise<void>;
  updateCard: (card: QDeckCard) => Promise<void>;
  publishCardAttachment: (cardId: string, file: File) => Promise<QDeckCardAttachment>;
  archiveCard: (cardId: string, archived: boolean) => Promise<void>;
  setPreferredVariant: (cardId: string, publisher: string) => Promise<void>;

  addComment: (
    cardId: string,
    commentHtml: string,
    parentId?: string,
    opts?: { isAdminsThread?: boolean; publisherName?: string }
  ) => Promise<void>;

  loadCommentsForCard: (cardId: string) => Promise<void>;
  refreshCommentHeads: () => Promise<void>;
  collectBoardChangeReport: () => Promise<BoardChangeReport>;
  resetBoardChangeLog: () => void;

  publishMode: PublishMode;
  setPublishMode: (mode: PublishMode) => void;
  pendingPublishCount: (boardId: string) => number;
  getPublishQueueForBoard: (boardId: string) => BatchPublishResource[];
  removePublishQueueItem: (boardId: string, resource: BatchPublishResource) => void;
  publishPendingResources: (boardId: string) => Promise<void>;
  isPublishingQueue: (boardId: string) => boolean;
  clearPublishQueue: (boardId?: string) => void;
  isRepairingIndex: boolean;
  repairCardsIndex: () => Promise<void>;

  recordPayment: (line: Parameters<typeof appendPaymentLine>[2]) => Promise<void>;
  deleteBoard: (opts?: { cascadeCards?: boolean; cascadeComments?: boolean }) => Promise<void>;

  pendingRemoteChanges: { cards?: boolean; comments?: boolean; board?: boolean } | null;
  applyPendingRemoteChanges: () => Promise<void>;
  clearPendingRemoteChanges: () => void;
};

// safer default
const Ctx = createContext<QDeckCtx | undefined>(undefined);
export const useQDeck = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useQDeck must be used within QDeckProvider');
  return ctx;
};

const createEmptyCardsIndexDoc = (boardId: string): CardsIndexDoc => ({
  _type: 'QDECK_CARDS_INDEX',
  version: 1,
  boardId,
  cardIds: [],
  entries: [],
  archivedIds: [],
  updatedAt: 0,
  seq: 0,
});

const indexSignature = (doc: CardsIndexDoc | null | undefined) => {
  if (!doc) return '';
  const entriesCount = doc.entries?.length ?? 0;
  const cardIdsCount = doc.cardIds?.length ?? 0;
  const archivedCount = doc.archivedIds?.length ?? 0;
  return `${doc.updatedAt ?? 0}:${doc.seq ?? 0}:${entriesCount}:${cardIdsCount}:${archivedCount}`;
};

const getCardTimestamp = (card: QDeckCard) =>
  Math.max(card.updatedAt ?? 0, card.createdAt ?? 0, card.seq ?? 0);

const pickNewestVariant = (variants: QDeckCard[]) => {
  if (!variants.length) return undefined;
  return variants.reduce((best, next) => {
    const bestTs = getCardTimestamp(best);
    const nextTs = getCardTimestamp(next);
    if (nextTs !== bestTs) return nextTs > bestTs ? next : best;
    if ((next.seq ?? 0) !== (best.seq ?? 0)) return (next.seq ?? 0) > (best.seq ?? 0) ? next : best;
    return (next.createdAt ?? 0) > (best.createdAt ?? 0) ? next : best;
  });
};

const getThreadLatestCommentStamp = (thread: CardCommentThread | null | undefined): number => {
  if (!thread || !Array.isArray(thread.comments) || thread.comments.length === 0) return 0;
  let latest = Number(thread.updatedAt ?? 0);
  for (const comment of thread.comments) {
    latest = Math.max(latest, Number(comment.createdAt ?? 0), Number(comment.updatedAt ?? 0));
  }
  return latest;
};

type BoardChangeType =
  | 'created'
  | 'moved'
  | 'completed'
  | 'reopened'
  | 'updated'
  | 'archived'
  | 'unarchived';

type BoardChangeEntry = {
  type: BoardChangeType;
  cardId: string;
  title?: string;
  ts: number;
  fromListId?: string;
  toListId?: string;
  details?: string;
};

type BoardChangeLog = {
  openedAt: number;
  entries: BoardChangeEntry[];
};

type CommentChange = {
  cardId: string;
  cardTitle?: string;
  author: string;
  createdAt: number;
  bodyHtml: string;
};

type BoardChangeReport = {
  openedAt: number;
  entries: BoardChangeEntry[];
  comments: CommentChange[];
};

//MAIN PROVIDER EXPORT --------------------------------------------------------------------------------------

export const QDeckProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();
  const { activeName } = useActiveAccountName();

  const [board, setBoard] = useState<QDeckBoard | null>(null);
  const [cards, setCards] = useState<Record<string, QDeckCard>>({});
  const [cardVariants, setCardVariants] = useState<Record<string, QDeckCard[]>>({});
  const [archivedCardIds, setArchivedCardIds] = useState<Set<string>>(new Set());
  const [cardsLoading, setCardsLoading] = useState(false);
  const [comments, setComments] = useState<Record<string, CardCommentThread>>({});
  const [commentHeads, setCommentHeads] = useState<
    Record<string, { latestStamp: number; newestPublisher?: string }>
  >({});
  const [boardLastVisitTs, setBoardLastVisitTs] = useState(0);
  const cardsRef = useRef<Record<string, QDeckCard>>({});
  const cardVariantsRef = useRef<Record<string, QDeckCard[]>>({});
  const commentsRef = useRef<Record<string, CardCommentThread>>({});
  const [changeLog, setChangeLog] = useState<BoardChangeLog>({
    openedAt: Date.now(),
    entries: [],
  });
  const cardsIndexCacheRef = useRef<Record<string, CardsIndexDoc | null>>({});
  const cardsIndexSigRef = useRef<Record<string, string>>({});
  const pendingCardsLoadRef = useRef<string | null>(null);
  const cardsLoadRetryRef = useRef<Record<string, number>>({});
  const currentBoardIdRef = useRef<string | null>(null);
  const cardsLoadTokenRef = useRef(0);
  const cardsReadyRef = useRef<Record<string, boolean>>({});
  const pollInFlightRef = useRef(false);
  const boardStampRef = useRef<Record<string, number>>({});
  const cardsIndexStampRef = useRef<Record<string, number>>({});
  const commentsStampRef = useRef<Record<string, number>>({});
  const pollSeedingRef = useRef<Record<string, boolean>>({});
  const { publish: publishResources } = useQdnBatchPublisher();
  const { alert } = useAlert();
  const [publishQueue, setPublishQueue] = useState<Record<string, BatchPublishResource[]>>(() =>
    readPublishQueueFromStorage()
  );
  const [publishMode, setPublishMode] = useState<PublishMode>(() => readPublishModeFromStorage());
  const [publishingBoardId, setPublishingBoardId] = useState<string | null>(null);
  const [repairingIndex, setRepairingIndex] = useState(false);
  const [pendingRemoteChanges, setPendingRemoteChanges] = useState<{
    cards?: boolean;
    comments?: boolean;
    board?: boolean;
  } | null>(null);
  const setCachedCardsIndexDoc = useCallback((boardId: string, doc: CardsIndexDoc) => {
    cardsIndexCacheRef.current[boardId] = doc;
    cardsIndexSigRef.current[boardId] = indexSignature(doc);
    setLocalCardsIndex(boardId, doc);
    const stamp = Number(doc.updatedAt ?? 0);
    if (stamp) {
      cardsIndexStampRef.current[boardId] = Math.max(
        cardsIndexStampRef.current[boardId] ?? 0,
        stamp
      );
    }
  }, []);

  useEffect(() => {
    currentBoardIdRef.current = board?.boardId ?? null;
  }, [board?.boardId]);

  useEffect(() => {
    setPendingRemoteChanges(null);
    if (board?.boardId) {
      cardsReadyRef.current[board.boardId] = false;
      setCardsLoading(true);
      pollSeedingRef.current[board.boardId] = false;
      setCommentHeads({});
      const previousVisit = readBoardLastVisit(board.boardId);
      setBoardLastVisitTs(previousVisit);
      writeBoardLastVisit(board.boardId, Date.now());
    } else {
      setCommentHeads({});
      setBoardLastVisitTs(0);
    }
  }, [board?.boardId]);

  useEffect(() => {
    cardsRef.current = cards;
    cardVariantsRef.current = cardVariants;
    commentsRef.current = comments;
  }, [cards, cardVariants, comments]);

  useEffect(() => {
    const boardId = board?.boardId;
    if (!boardId) return;
    const stored = readPublishModeForBoard(boardId);
    if (stored && stored !== publishMode) {
      setPublishMode(stored);
    }
  }, [board?.boardId]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(QUEUE_STORAGE_KEY, JSON.stringify(publishQueue));
    } catch {
      /* ignore */
    }
  }, [publishQueue]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.sessionStorage.setItem(PUBLISH_MODE_STORAGE_KEY, publishMode);
    } catch {
      /* ignore */
    }
  }, [publishMode]);

  useEffect(() => {
    const boardId = board?.boardId;
    if (!boardId) return;
    writePublishModeForBoard(boardId, publishMode);
  }, [board?.boardId, publishMode]);

  const enqueuePublishResources = useCallback(
    (boardId: string, resources: BatchPublishResource[]) => {
      if (!boardId || resources.length === 0) return;
      setPublishQueue((prev) => {
        const existing = prev[boardId] ?? [];
        const combined = [...existing, ...resources];
        const seen = new Set<string>();
        const deduped: BatchPublishResource[] = [];
        for (let i = combined.length - 1; i >= 0; i -= 1) {
          const res = combined[i];
          const key = publishQueueKey(res);
          if (seen.has(key)) continue;
          seen.add(key);
          deduped.push(res);
        }
        deduped.reverse();
        return { ...prev, [boardId]: deduped };
      });
    },
    []
  );

  const clearPublishQueueForBoard = useCallback((boardId: string) => {
    setPublishQueue((prev) => {
      if (!prev[boardId]) return prev;
      const next = { ...prev };
      delete next[boardId];
      return next;
    });
  }, []);

  const clearPublishQueue = useCallback(
    (boardId?: string) => {
      if (boardId) {
        clearPublishQueueForBoard(boardId);
        return;
      }
      setPublishQueue({});
    },
    [clearPublishQueueForBoard]
  );

  const pendingPublishCount = useCallback(
    (boardId: string) => publishQueue[boardId]?.length ?? 0,
    [publishQueue]
  );
  const getPublishQueueForBoard = useCallback(
    (boardId: string) => publishQueue[boardId] ?? [],
    [publishQueue]
  );
  const removePublishQueueItem = useCallback((boardId: string, resource: BatchPublishResource) => {
    const key = publishQueueKey(resource);
    setPublishQueue((prev) => {
      const existing = prev[boardId];
      if (!existing?.length) return prev;
      const nextItems = existing.filter((item) => publishQueueKey(item) !== key);
      if (!nextItems.length) {
        const next = { ...prev };
        delete next[boardId];
        return next;
      }
      return { ...prev, [boardId]: nextItems };
    });
  }, []);

  const queueOrPublishResources = useCallback(
    async (boardId: string, resources: BatchPublishResource[]) => {
      if (!boardId || resources.length === 0) return;
      if (publishMode === 'batch') {
        enqueuePublishResources(boardId, resources);
        return;
      }
      await publishResources(resources);
    },
    [publishMode, enqueuePublishResources, publishResources]
  );

  const publishPendingResources = useCallback(
    async (boardId: string) => {
      if (!boardId) return;
      const resources = publishQueue[boardId];
      if (!resources?.length) return;
      setPublishingBoardId(boardId);
      try {
        await publishResources(resources);
        clearPublishQueueForBoard(boardId);
        await alert('Queued updates published.', 'Publish queue', { severity: 'success' });
      } finally {
        setPublishingBoardId(null);
      }
    },
    [alert, clearPublishQueueForBoard, publishQueue, publishResources]
  );

  const isPublishingQueue = useCallback(
    (boardId: string) => Boolean(boardId && publishingBoardId === boardId),
    [publishingBoardId]
  );

  const doneListId = useMemo(
    () => board?.lists.find((l) => l.title?.toLowerCase().includes('done'))?.listId,
    [board?.lists]
  );
  const defaultCollapsedListIds = useMemo(() => {
    const set = new Set<string>();
    for (const list of board?.lists ?? []) {
      if (list.defaultCollapsed || list.title?.toLowerCase().includes('done')) {
        set.add(list.listId);
      }
    }
    return set;
  }, [board?.lists]);
  const [collapsedCardPrefs, setCollapsedCardPrefs] = useState<Record<string, boolean>>({});
  const boardIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentBoardId = board?.boardId ?? null;
    if (boardIdRef.current !== currentBoardId) {
      setCollapsedCardPrefs({});
      boardIdRef.current = currentBoardId;
    }
  }, [board?.boardId]);

  const changeLogBoardIdRef = useRef<string | null>(null);
  useEffect(() => {
    const currentBoardId = board?.boardId ?? null;
    if (changeLogBoardIdRef.current !== currentBoardId) {
      changeLogBoardIdRef.current = currentBoardId;
      setChangeLog({ openedAt: Date.now(), entries: [] });
    }
  }, [board?.boardId]);

  const resetBoardChangeLog = useCallback(() => {
    setChangeLog({ openedAt: Date.now(), entries: [] });
  }, []);

  const recordChange = useCallback((entry: BoardChangeEntry) => {
    setChangeLog((prev) => ({
      ...prev,
      entries: [...prev.entries, entry],
    }));
  }, []);

  const setCardCollapsed = useCallback((cardId: string, value: boolean) => {
    setCollapsedCardPrefs((prev) => {
      if (prev[cardId] === value) return prev;
      return { ...prev, [cardId]: value };
    });
  }, []);

  const isCardCollapsed = useCallback(
    (cardId: string, card?: QDeckCard) => {
      const isDone = Boolean(card?.isDone);
      const inDoneList = !!doneListId && card?.statusListId === doneListId;
      const listIsDefaultCollapsed =
        !!card?.statusListId && defaultCollapsedListIds.has(card.statusListId);
      if (isDone || inDoneList || listIsDefaultCollapsed) return true;
      const override = collapsedCardPrefs[cardId];
      if (override !== undefined) return override;
      return false;
    },
    [collapsedCardPrefs, doneListId]
  );

  const normalizeCardCollapse = useCallback(
    (card: QDeckCard) => {
      const collapsed = isCardCollapsed(card.cardId, card);
      if (card.isCollapsed === collapsed) {
        return card;
      }
      return { ...card, isCollapsed: collapsed };
    },
    [isCardCollapsed]
  );

  const identity: QUserIdentity = {
    name: (activeName || auth?.name) as string,
    address: auth?.address as string,
    publicKey: auth?.publicKey as string,
  };

  const lastLoadKey = useRef<string>('');
  const { track } = useFetchTracker();
  const cardLimiter = useMemo(() => pLimit(4), []);

  const loadCardsForBoard = React.useCallback(
    async (_issuerIgnored: string, b: QDeckBoard, opts?: LoadCardsOpts) => {
      const loadToken = ++cardsLoadTokenRef.current;
      setCardsLoading(true);
      const perfTraceId =
        opts?.perfTraceId ??
        beginQDeckBoardLoadTrace({
          issuer: (_issuerIgnored || b.createdBy || identity.name || '').trim() || 'unknown',
          boardId: b.boardId,
          loadKey: `cards:${b.boardId}:${Date.now()}`,
          meta: {
            source: 'cards-only',
            preserveOnEmpty: opts?.preserveOnEmpty ?? false,
            skipIfIndexUnchanged: opts?.skipIfIndexUnchanged ?? false,
          },
        });
      let perfStatus: 'ok' | 'error' | 'cancelled' = 'ok';
      let perfRefsCount = 0;
      let perfUsableCount = 0;
      let perfVariantCount = 0;
      let perfUsedDiscovery = false;
      let perfShowedCached = false;
      let perfIndexEntries = 0;
      let perfIndexCardIds = 0;
      let perfSkippedByUnchanged = false;
      let markReady = false;
      try {
        markQDeckBoardLoadPhase(perfTraceId, 'cards.load.start');
        // 0) Access check
        if (b.visibility === 'private' && !identity.address) {
          pendingCardsLoadRef.current = b.boardId;
          perfStatus = 'cancelled';
          markQDeckBoardLoadPhase(perfTraceId, 'cards.load.waiting-auth');
          return;
        }
        const canView = await canUserViewBoard(b, {
          name: identity.name,
          address: identity.address,
        });
        if (!canView) {
          pendingCardsLoadRef.current = null;
          console.error('[Q-Deck] viewer not allowed; cannot open board');
          setCards({});
          setCardVariants({});
          setArchivedCardIds(new Set());
          perfStatus = 'cancelled';
          markQDeckBoardLoadPhase(perfTraceId, 'cards.load.viewer-denied');
          markReady = true;
          return;
        }
        markReady = true;
        markQDeckBoardLoadPhase(perfTraceId, 'cards.load.access-ok');

        const prefetchedDocs = new Map<string, QDeckCard>();
        const refKey = (name: string, cardId: string) => `${name}::${cardId}`;
        const refsFromIndex = (doc: CardsIndexDoc): Array<{ name: string; cardId: string }> => {
          if (Array.isArray(doc.entries) && doc.entries.length) {
            return doc.entries
              .filter((e) => e?.name && e?.cardId)
              .map((e) => ({
                name: e.name,
                cardId: e.cardId,
              }));
          }
          if (Array.isArray(doc.cardIds) && doc.cardIds.length) {
            const issuer = b.createdBy || identity.name;
            if (!issuer) return [];
            return doc.cardIds.map((cid) => ({ name: issuer, cardId: cid }));
          }
          return [];
        };
        const publisherOkCache = new Map<string, Promise<boolean>>();
        const canPublisher = (publisherName: string) => {
          const key = publisherName.trim().toLowerCase();
          const existing = publisherOkCache.get(key);
          if (existing) return existing;
          const next = canPublisherPublishToBoard(b, { name: publisherName }).catch(() => false);
          publisherOkCache.set(key, next);
          return next;
        };

        const applyLoadedCards = (
          usable: QDeckCard[],
          idxDoc: CardsIndexDoc | null,
          opts?: { cache?: boolean }
        ) => {
          if (usable.length) {
            delete cardsLoadRetryRef.current[b.boardId];
          }
          const archivedSet = new Set(idxDoc?.archivedIds ?? []);
          const cacheDoc = idxDoc ?? createEmptyCardsIndexDoc(b.boardId);
          if (opts?.cache !== false) {
            setCachedCardsIndexDoc(b.boardId, cacheDoc);
          }
          const variants: Record<string, QDeckCard[]> = {};
          const byId: Record<string, QDeckCard> = {};

          for (const c of usable) {
            variants[c.cardId] = variants[c.cardId] || [];
            variants[c.cardId].push(c);
          }

          // Pick display variant per card
          const usePreferred = b.featureFlags?.cardVariants;
          const preferredMap = b.preferredVariants || {};
          for (const [cardId, list] of Object.entries(variants)) {
            if (archivedSet.has(cardId)) continue;
            let chosen: QDeckCard | undefined;
            if (usePreferred) {
              const preferredPublisher = preferredMap[cardId];
              if (preferredPublisher) {
                chosen = list.find((c) => c.createdBy === preferredPublisher);
              }
            }
            if (!chosen) {
              // default: newest across all publishers
              chosen = pickNewestVariant(list);
            }
            if (chosen) byId[cardId] = chosen;
          }

          setCards(byId);
          setCardVariants(variants);
          setArchivedCardIds(archivedSet);
          perfUsableCount = usable.length;
          perfVariantCount = Object.keys(variants).length;
          markQDeckBoardLoadPhase(perfTraceId, 'cards.load.applied', {
            usable: usable.length,
            variants: Object.keys(variants).length,
            archived: archivedSet.size,
          });
        };
        const loadDocsForRefs = async (refs: Array<{ name: string; cardId: string }>) => {
          const loaded = await Promise.all(
            refs.map((r) =>
              cardLimiter(async () => {
                const publisher = (r.name || '').trim();
                if (!publisher) return null;
                const allowed = await canPublisher(publisher);
                if (!allowed) return null;
                const key = refKey(publisher, r.cardId);
                const cached = prefetchedDocs.get(key);
                if (cached) return cached;
                try {
                  const doc = await loadCardDoc(publisher, b, r.cardId);
                  if (!doc || (doc as any)._type === 'QDECK_TOMBSTONE') return null;
                  let cast = doc as QDeckCard;
                  if (!cardAuthHeaderMatchesPublisher(cast, publisher)) {
                    cast = { ...cast, createdBy: publisher };
                  }
                  prefetchedDocs.set(key, cast);
                  return cast;
                } catch {
                  return null;
                }
              })
            )
          );
          return loaded.filter(Boolean) as QDeckCard[];
        };

        const cachedIndex = getLocalCardsIndex(b.boardId);
        if (cachedIndex) {
          cardsIndexCacheRef.current[b.boardId] = cachedIndex;
        }
        const cachedRefs = cachedIndex ? refsFromIndex(cachedIndex) : [];
        markQDeckBoardLoadPhase(perfTraceId, 'cards.load.cache-checked', {
          hasCachedIndex: Boolean(cachedIndex),
          cachedRefs: cachedRefs.length,
        });
        const newestIndexPromise = loadMergedCardsIndex(b, {
          issuerHints: [b.createdBy, identity.name].filter(Boolean) as string[],
        }).catch((e) => {
          console.warn('[Q-Deck] loadMergedCardsIndex failed; will try discovery', e);
          return null;
        });

        let showedCached = false;
        if (cachedRefs.length) {
          const cachedDocs = await loadDocsForRefs(cachedRefs);
          if (cachedDocs.length) {
            applyLoadedCards(cachedDocs, cachedIndex, { cache: false });
            showedCached = true;
            perfShowedCached = true;
            markQDeckBoardLoadPhase(perfTraceId, 'cards.load.cached-preview', {
              cachedDocs: cachedDocs.length,
            });
          }
        }

        // 1) Try newest cards index across issuers
        let refs: Array<{ name: string; cardId: string }> | null = null;
        let idx: CardsIndexDoc | null = null;
        idx = (await newestIndexPromise) ?? null;
        perfIndexEntries = idx?.entries?.length ?? 0;
        perfIndexCardIds = idx?.cardIds?.length ?? 0;
        markQDeckBoardLoadPhase(perfTraceId, 'cards.load.index-ready', {
          entries: perfIndexEntries,
          cardIds: perfIndexCardIds,
        });
        const idxStamp = Number(idx?.updatedAt ?? 0);
        if (idxStamp) {
          cardsIndexStampRef.current[b.boardId] = Math.max(
            cardsIndexStampRef.current[b.boardId] ?? 0,
            idxStamp
          );
        }
        const cachedIndexDoc = cardsIndexCacheRef.current[b.boardId] ?? cachedIndex ?? null;
        const indexUnchanged =
          !!idx &&
          !!cachedIndexDoc &&
          (idx.seq ?? 0) === (cachedIndexDoc.seq ?? 0) &&
          (idx.updatedAt ?? 0) === (cachedIndexDoc.updatedAt ?? 0);
        const hasExisting =
          Object.keys(cardsRef.current).length > 0 ||
          Object.keys(cardVariantsRef.current).length > 0;
        if (opts?.skipIfIndexUnchanged && indexUnchanged && hasExisting) {
          perfSkippedByUnchanged = true;
          markQDeckBoardLoadPhase(perfTraceId, 'cards.load.index-unchanged-skip');
          return;
        }
        if (idx?.entries?.length) {
          refs = idx.entries
            .filter((entry) => entry?.name && entry?.cardId)
            .map((entry) => ({ name: entry.name, cardId: entry.cardId }));
        } else if (idx?.cardIds?.length) {
          // legacy: assume board issuer published these
          refs = idx.cardIds.map((cid) => ({ name: b.createdBy, cardId: cid }));
        }

        // 2) Fallback discovery across *all* issuers
        if (!refs || refs.length === 0) {
          perfUsedDiscovery = true;
          markQDeckBoardLoadPhase(perfTraceId, 'cards.load.discovery-start');
          try {
            const all = await discoverCardRefsBySearch(b);

            const checked = await Promise.all(
              all.map((r) =>
                cardLimiter(async () => {
                  try {
                    const card = await loadCardDoc(r.name, b, r.cardId);
                    if (!card || (card as any)._type === 'QDECK_TOMBSTONE') return null;
                    const ok = await canPublisher(r.name);
                    if (!ok) return null;
                    const cast = card as QDeckCard;
                    return {
                      ref: r,
                      doc: cardAuthHeaderMatchesPublisher(cast, r.name)
                        ? cast
                        : ({ ...cast, createdBy: r.name } as QDeckCard),
                    };
                  } catch {
                    return null;
                  }
                })
              )
            );

            const allowed = checked.filter(Boolean) as Array<{
              ref: { name: string; cardId: string };
              doc: QDeckCard;
            }>;
            for (const { ref, doc } of allowed) {
              prefetchedDocs.set(refKey(ref.name, ref.cardId), doc);
            }
            refs = allowed.map((item) => item.ref);
          } catch (e) {
            console.warn('[Q-Deck] discovery failed', e);
            refs = [];
          }
          markQDeckBoardLoadPhase(perfTraceId, 'cards.load.discovery-ready', {
            refs: refs?.length ?? 0,
          });
        }

        if (!refs || refs.length === 0) {
          const indexSaysEmpty =
            !!idx && !((idx.entries?.length ?? 0) > 0 || (idx.cardIds?.length ?? 0) > 0);
          if (indexSaysEmpty) {
            applyLoadedCards([], idx);
            markQDeckBoardLoadPhase(perfTraceId, 'cards.load.index-empty');
            return;
          }
          if (showedCached) {
            markQDeckBoardLoadPhase(perfTraceId, 'cards.load.no-refs-using-cached');
            return;
          }
          if (opts?.preserveOnEmpty) {
            markQDeckBoardLoadPhase(perfTraceId, 'cards.load.no-refs-preserve-existing');
            return;
          }
          setCards({});
          setCardVariants({});
          setArchivedCardIds(new Set());
          if (typeof window !== 'undefined') {
            const attempts = cardsLoadRetryRef.current[b.boardId] ?? 0;
            if (attempts < 1) {
              cardsLoadRetryRef.current[b.boardId] = attempts + 1;
              window.setTimeout(() => {
                if (currentBoardIdRef.current !== b.boardId) return;
                void track(
                  loadCardsForBoard(b.createdBy || identity.name || '', b, {
                    preserveOnEmpty: true,
                  }),
                  `qdeck:cards:retry:${b.boardId}`
                );
              }, 1200);
            }
          }
          markQDeckBoardLoadPhase(perfTraceId, 'cards.load.no-refs-cleared');
          return;
        }
        perfRefsCount = refs.length;
        markQDeckBoardLoadPhase(perfTraceId, 'cards.load.refs-ready', {
          refs: refs.length,
        });

        // 3) Fetch each card with its *publisher* name
        const usable = await loadDocsForRefs(refs);
        markQDeckBoardLoadPhase(perfTraceId, 'cards.load.docs-ready', {
          usable: usable.length,
        });
        if (!usable.length && opts?.preserveOnEmpty) {
          markQDeckBoardLoadPhase(perfTraceId, 'cards.load.empty-preserve-existing');
          return;
        }
        applyLoadedCards(usable, idx);
      } catch (error) {
        perfStatus = 'error';
        markQDeckBoardLoadPhase(perfTraceId, 'cards.load.error', {
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      } finally {
        if (markReady) {
          cardsReadyRef.current[b.boardId] = true;
        }
        if (cardsLoadTokenRef.current === loadToken) {
          setCardsLoading(false);
        }
        finishQDeckBoardLoadTrace(perfTraceId, perfStatus, {
          boardId: b.boardId,
          refs: perfRefsCount,
          usable: perfUsableCount,
          variants: perfVariantCount,
          usedDiscovery: perfUsedDiscovery,
          showedCached: perfShowedCached,
          indexEntries: perfIndexEntries,
          indexCardIds: perfIndexCardIds,
          skippedByUnchanged: perfSkippedByUnchanged,
          markReady,
        });
      }
    },
    [identity.address, identity.name, cardLimiter, track]
  );

  React.useEffect(() => {
    if (!board || !identity.address) return;
    if (pendingCardsLoadRef.current !== board.boardId) return;
    pendingCardsLoadRef.current = null;
    void track(
      loadCardsForBoard(board.createdBy || identity.name || '', board),
      `qdeck:cards:retry:${board.boardId}`
    );
  }, [board, identity.address, identity.name, loadCardsForBoard, track]);

  const repairCardsIndex = useCallback(async () => {
    if (!board) throw new Error('No board loaded');
    const publisher = identity.name;
    if (!publisher) throw new Error('Active name required for repair');
    setRepairingIndex(true);
    try {
      const repairedDoc = await repairCardsIndexDoc(publisher, board);
      setCachedCardsIndexDoc(board.boardId, repairedDoc);
      await alert('Cards index repaired.', 'Repair index', { severity: 'success' });
      await track(loadCardsForBoard(publisher, board), `qdeck:repair:${board.boardId}`);
    } catch (e: any) {
      await alert(e?.message || 'Failed to repair cards index', 'Repair index', {
        severity: 'error',
      });
    } finally {
      setRepairingIndex(false);
    }
  }, [alert, board, identity.name, loadCardsForBoard, track]);

  const loadBoardById = useCallback<QDeckCtx['loadBoardById']>(
    async (ns, boardIdOrIdent, visibility, opts) => {
      const issuer = (ns || '').trim();
      const raw = (boardIdOrIdent || '').trim();
      if (!issuer || !raw) {
        console.log('[Q-Deck] loadBoardById empty issuer/id', { issuer, raw });
        return;
      }
      const preserveExisting = opts?.preserveExisting === true;
      const visibilityHint = opts?.visibility ?? visibility;

      // Is this a full identifier or a short id?
      const isPrivIdent = raw.startsWith(QDeckId.prefixPrivateBoards);
      const isPubIdent = raw.startsWith(QDeckId.prefixPublicBoards);

      // Cache-key should reflect the exact thing we’re trying to open
      const cacheKey = `${issuer}:${raw}:${visibilityHint ?? 'auto'}`;
      const traceId = beginQDeckBoardLoadTrace({
        issuer,
        boardId: raw,
        loadKey: cacheKey,
        meta: {
          preserveExisting,
          visibilityHint: visibilityHint ?? 'auto',
          inputType: isPubIdent || isPrivIdent ? 'identifier' : 'short-id',
        },
      });
      markQDeckBoardLoadPhase(traceId, 'board.load.start');
      if (
        lastLoadKey.current === cacheKey &&
        board &&
        (board.boardId === raw || isPrivIdent || isPubIdent)
      ) {
        finishQDeckBoardLoadTrace(traceId, 'cancelled', { reason: 'duplicate-load-key' });
        return;
      }
      lastLoadKey.current = cacheKey;

      try {
        // 1) If caller gave a full ident, we already know the intent.
        //    Skip heads probing and go straight to resolve (fast-path).
        if (isPubIdent || isPrivIdent) {
          markQDeckBoardLoadPhase(traceId, 'board.resolve.ident.start');
          const probe = await resolveBoardForReadWithMeta(issuer, raw, visibilityHint).catch(
            (e) => {
              console.error('[Q-Deck] resolveBoardForReadWithMeta error', e);
              return null;
            }
          );
          markQDeckBoardLoadPhase(traceId, 'board.resolve.ident.done', {
            found: Boolean(probe?.doc),
          });

          if (lastLoadKey.current !== cacheKey) {
            finishQDeckBoardLoadTrace(traceId, 'cancelled', { reason: 'superseded' });
            return;
          } // race guard
          if (!probe?.doc) {
            console.error('[Q-Deck] Board not found/inaccessible (ident)', { issuer, ident: raw });
            finishQDeckBoardLoadTrace(traceId, 'error', { reason: 'board-not-found-ident' });
            return;
          }

          setBoard(probe.doc);
          markQDeckBoardLoadPhase(traceId, 'board.state.applied', {
            boardId: probe.doc.boardId,
          });
          boardStampRef.current[probe.doc.boardId] = Math.max(
            boardStampRef.current[probe.doc.boardId] ?? 0,
            Number(probe.doc.updatedAt ?? 0)
          );
          if (!preserveExisting) {
            setCards({});
            setCardVariants({});
            setArchivedCardIds(new Set());
            setComments({});
          }
          void track(
            loadCardsForBoard(issuer, probe.doc, {
              preserveOnEmpty: preserveExisting,
              skipIfIndexUnchanged: preserveExisting,
              perfTraceId: traceId,
            }),
            `${probe.doc}`
          );
          console.log('[Q-Deck] loadBoardById success (ident)', {
            issuer,
            id: raw,
            title: probe.doc.title,
          });
          return;
        }

        // 2) We have a short id. Prefer supplied hint; otherwise peek heads.
        const shortId = raw;
        markQDeckBoardLoadPhase(traceId, 'board.resolve.short.hint.start');
        const hint =
          visibilityHint ??
          ((await findBoardVisibilityHeads(issuer, shortId).catch(() => null)) || undefined);
        markQDeckBoardLoadPhase(traceId, 'board.resolve.short.hint.done', {
          hint: hint ?? null,
        });

        // Use the meta-aware resolver (it handles public first, then private probe)
        const resolved = await track(
          resolveBoardForRead(issuer, shortId, hint).catch((e) => {
            console.error('[Q-Deck] resolveBoardForRead error', e);
            return null;
          }),
          `qdeck:cards:${shortId}`
        );
        markQDeckBoardLoadPhase(traceId, 'board.resolve.short.done', {
          found: Boolean(resolved),
        });

        if (lastLoadKey.current !== cacheKey) {
          finishQDeckBoardLoadTrace(traceId, 'cancelled', { reason: 'superseded' });
          return;
        } // race guard
        if (!resolved) {
          console.error('[Q-Deck] Board not found or inaccessible', { issuer, shortId, hint });
          finishQDeckBoardLoadTrace(traceId, 'error', { reason: 'board-not-found-short' });
          return;
        }

        setBoard(resolved);
        markQDeckBoardLoadPhase(traceId, 'board.state.applied', {
          boardId: resolved.boardId,
        });
        boardStampRef.current[resolved.boardId] = Math.max(
          boardStampRef.current[resolved.boardId] ?? 0,
          Number(resolved.updatedAt ?? 0)
        );
        if (!preserveExisting) {
          setCards({});
          setCardVariants({});
          setArchivedCardIds(new Set());
          setComments({});
        }
        void track(
          loadCardsForBoard(issuer, resolved, {
            preserveOnEmpty: preserveExisting,
            skipIfIndexUnchanged: preserveExisting,
            perfTraceId: traceId,
          }),
          `${resolved}`
        );

        console.debug('[Q-Deck] loadBoardById success', { issuer, shortId, title: resolved.title });
      } catch (error) {
        finishQDeckBoardLoadTrace(traceId, 'error', {
          reason: 'load-board-exception',
          message: error instanceof Error ? error.message : String(error),
        });
        throw error;
      }
    },
    [board, loadCardsForBoard, track] // identity.address not used anymore in this body
  );

  const persistBoard = useCallback<QDeckCtx['persistBoard']>(
    async (nextBoard) => {
      const publisher = identity.name ?? auth.name ?? nextBoard.createdBy;
      const boardPayload = await buildBoardPublishPayload(publisher, nextBoard);
      await queueOrPublishResources(nextBoard.boardId, [boardPayload]);
      setBoard(nextBoard);
      boardStampRef.current[nextBoard.boardId] = Math.max(
        boardStampRef.current[nextBoard.boardId] ?? 0,
        Number(nextBoard.updatedAt ?? 0)
      );
    },
    [identity.name, auth.name, queueOrPublishResources]
  );

  const createCard = useCallback<QDeckCtx['createCard']>(
    async (partial) => {
      if (!board) throw new Error('No board loaded');
      if (!cardsReadyRef.current[board.boardId]) {
        throw new Error('Board cards are still loading. Please wait a moment and try again.');
      }
      // Guard: must be allowed to publish on this board
      const ok = await canUserEditBoard(board, { name: identity.name, address: identity.address });
      if (!ok) {
        throw new Error('You are not allowed to create cards on this board.');
      }

      if (!auth.name || !identity.name) {
        throw new Error('failed authentication in createCard');
      }

      const now = Date.now();
      const cardId = uniqueId6();
      const author = identity.name || 'unknown';
      const authorAddress = identity.address || 'unknown/not published';

      const c: QDeckCard = {
        _type: 'QDECK_CARD',
        version: 1,
        cardId,
        boardId: board.boardId,
        title: partial.title ?? 'Untitled',
        descriptionHtml: partial.descriptionHtml ?? '',
        quickDescription: partial.quickDescription ?? '', // NEW
        primaryImageUrl: partial.primaryImageUrl ?? undefined, // NEW
        estimatedCompletionTimeMinutes: partial.estimatedCompletionTimeMinutes ?? undefined, //estimatedCompletionTime
        createdBy: author,
        creatorAddress: authorAddress,
        assignees: partial.assignees ?? [],
        priority: partial.priority ?? 'NORMAL', // already supported
        tags: partial.tags ?? [],
        statusListId: partial.statusListId ?? board.lists[0].listId,
        order: partial.order ?? 0,
        isDone: false,
        completedAt: undefined,
        scheduledStart: partial.scheduledStart,
        scheduledEnd: partial.scheduledEnd,
        scheduledAllDay: partial.scheduledAllDay,
        hasBounty: !!partial.hasBounty,
        bountyInfo: partial.hasBounty ? partial.bountyInfo : undefined,
        upvotes: partial.upvotes ?? { currency: 'QASSET', count: 0, totalAmount: '0' },
        createdAt: now,
        updatedAt: now,
        seq: 1,
        collapsedWhenDone: true,
      };

      setCards((prev) => ({ ...prev, [c.cardId]: normalizeCardCollapse(c) }));
      recordChange({
        type: 'created',
        cardId: c.cardId,
        title: c.title,
        ts: now,
        toListId: c.statusListId,
      });
      const publisher = identity.name || auth.name;
      const currentIndexDoc =
        cardsIndexCacheRef.current[board.boardId] ?? createEmptyCardsIndexDoc(board.boardId);
      const indexDoc = await addCardToIndex(publisher, board, c.cardId, undefined, {
        skipPublish: true,
        currentDoc: currentIndexDoc,
        card: c,
      });
      setCachedCardsIndexDoc(board.boardId, indexDoc);
      const cardPayload = await buildCardPublishPayload(publisher, board, c);
      const indexPayload = await buildCardsIndexPublishPayload(publisher, board, indexDoc);
      await queueOrPublishResources(board.boardId, [cardPayload, indexPayload]);
      return c;
    },
    [
      board,
      identity.name,
      identity.address,
      auth.name,
      queueOrPublishResources,
      normalizeCardCollapse,
      recordChange,
    ]
  );

  const moveCard = useCallback<QDeckCtx['moveCard']>(
    async (cardId, toListId, newOrder) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      const c = cards[cardId];
      if (!c) return;
      const publisher = identity.name || auth.name;
      const next: QDeckCard = {
        ...c,
        createdBy: publisher,
        creatorAddress: identity.address || c.creatorAddress,
        statusListId: toListId,
        order: newOrder,
        updatedAt: Date.now(),
        seq: c.seq + 1,
      };
      setCards((prev) => ({ ...prev, [cardId]: normalizeCardCollapse(next) }));
      if (c.statusListId !== toListId) {
        recordChange({
          type: 'moved',
          cardId,
          title: c.title,
          ts: next.updatedAt,
          fromListId: c.statusListId,
          toListId,
        });
      }
      const payload = await buildCardPublishPayload(publisher, board, next);
      const currentIndexDoc =
        cardsIndexCacheRef.current[board.boardId] ?? createEmptyCardsIndexDoc(board.boardId);
      const indexDoc = await addCardToIndex(publisher, board, cardId, publisher, {
        skipPublish: true,
        currentDoc: currentIndexDoc,
        card: next,
      });
      setCachedCardsIndexDoc(board.boardId, indexDoc);
      const indexPayload = await buildCardsIndexPublishPayload(publisher, board, indexDoc);
      await queueOrPublishResources(board.boardId, [payload, indexPayload]);
    },
    [
      board,
      cards,
      auth.name,
      identity.name,
      identity.address,
      queueOrPublishResources,
      normalizeCardCollapse,
      recordChange,
    ]
  );

  const increaseCardSeq = (seq: number) => {
    return seq + 1;
  };

  const updateCard = useCallback<QDeckCtx['updateCard']>(
    async (card) => {
      if (!board) throw new Error('No board loaded');

      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      // const ok = await userInAllowedGroups(board, auth.name ? auth.name : identity.name);
      const ok = await canUserEditBoard(board, { name: identity.name, address: identity.address });
      if (!ok) throw new Error('You are not allowed to edit cards on this board.');

      const publisher = identity.name || auth.name;
      const current = cards[card.cardId];

      if (current && card.seq <= current.seq) throw new Error('Stale write (seq too low)');
      const nextCard: QDeckCard = {
        ...card,
        createdBy: publisher,
        creatorAddress: identity.address || card.creatorAddress,
        seq: increaseCardSeq(card.seq),
      };
      if (current) {
        const changedFields: string[] = [];
        if (current.title !== nextCard.title) changedFields.push('title');
        if (current.descriptionHtml !== nextCard.descriptionHtml) changedFields.push('details');
        if (current.quickDescription !== nextCard.quickDescription) changedFields.push('summary');
        if (current.primaryImageUrl !== nextCard.primaryImageUrl) {
          changedFields.push('primary image');
        }
        if (
          (current.primaryImage?.identifier || '') !== (nextCard.primaryImage?.identifier || '')
        ) {
          changedFields.push('primary image');
        }
        if (current.estimatedCompletionTimeMinutes !== nextCard.estimatedCompletionTimeMinutes) {
          changedFields.push('ETA');
        }
        if ((current.tags || []).join(',') !== (nextCard.tags || []).join(',')) {
          changedFields.push('tags');
        }
        if ((current.assignees || []).join(',') !== (nextCard.assignees || []).join(',')) {
          changedFields.push('assignees');
        }
        if (current.priority !== nextCard.priority) changedFields.push('priority');
        if (current.statusListId !== nextCard.statusListId) {
          changedFields.push('status');
        }
        const currentAttachments = current.attachments ?? [];
        const nextAttachments = nextCard.attachments ?? [];
        const attachmentMismatch =
          currentAttachments.length !== nextAttachments.length ||
          currentAttachments.some(
            (att, idx) => att.attachmentId !== nextAttachments[idx]?.attachmentId
          );
        if (attachmentMismatch) {
          changedFields.push('attachments');
        }
        if (current.isDone !== nextCard.isDone) {
          recordChange({
            type: nextCard.isDone ? 'completed' : 'reopened',
            cardId: nextCard.cardId,
            title: nextCard.title,
            ts: nextCard.updatedAt ?? Date.now(),
            fromListId: current.statusListId,
            toListId: nextCard.statusListId,
          });
        }
        if (changedFields.length) {
          recordChange({
            type: 'updated',
            cardId: nextCard.cardId,
            title: nextCard.title,
            ts: nextCard.updatedAt ?? Date.now(),
            details: Array.from(new Set(changedFields)).join(', '),
          });
        }
      }
      setCards((prev) => ({ ...prev, [nextCard.cardId]: normalizeCardCollapse(nextCard) }));
      const payload = await buildCardPublishPayload(publisher, board, nextCard);
      const currentIndexDoc =
        cardsIndexCacheRef.current[board.boardId] ?? createEmptyCardsIndexDoc(board.boardId);
      const indexDoc = await addCardToIndex(publisher, board, nextCard.cardId, publisher, {
        skipPublish: true,
        currentDoc: currentIndexDoc,
        card: nextCard,
      });
      setCachedCardsIndexDoc(board.boardId, indexDoc);
      const indexPayload = await buildCardsIndexPublishPayload(publisher, board, indexDoc);
      await queueOrPublishResources(board.boardId, [payload, indexPayload]);
    },
    [
      board,
      cards,
      auth.name,
      identity.name,
      identity.address,
      queueOrPublishResources,
      normalizeCardCollapse,
      recordChange,
    ]
  );

  const publishCardAttachment = useCallback<QDeckCtx['publishCardAttachment']>(
    async (cardId, file) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      const ok = await canUserEditBoard(board, { name: identity.name, address: identity.address });
      if (!ok) throw new Error('You are not allowed to edit cards on this board.');

      const current = cards[cardId];
      if (!current) throw new Error('Card not found');

      const publisher = identity.name || auth.name;
      const attachmentId = `f${uniqueId6()}`;
      const { resource, attachment } = await buildCardAttachmentPublishPayload(
        publisher,
        board,
        cardId,
        file,
        attachmentId
      );

      const nextCard: QDeckCard = {
        ...current,
        createdBy: publisher,
        creatorAddress: identity.address || current.creatorAddress,
        attachments: [...(current.attachments ?? []), attachment],
        updatedAt: Date.now(),
        seq: current.seq + 1,
      };

      recordChange({
        type: 'updated',
        cardId,
        title: current.title,
        ts: nextCard.updatedAt,
        details: 'attachments',
      });

      setCards((prev) => ({ ...prev, [cardId]: normalizeCardCollapse(nextCard) }));
      const cardPayload = await buildCardPublishPayload(publisher, board, nextCard);
      const currentIndexDoc =
        cardsIndexCacheRef.current[board.boardId] ?? createEmptyCardsIndexDoc(board.boardId);
      const indexDoc = await addCardToIndex(publisher, board, cardId, publisher, {
        skipPublish: true,
        currentDoc: currentIndexDoc,
        card: nextCard,
      });
      setCachedCardsIndexDoc(board.boardId, indexDoc);
      const indexPayload = await buildCardsIndexPublishPayload(publisher, board, indexDoc);
      await queueOrPublishResources(board.boardId, [resource, cardPayload, indexPayload]);

      return attachment;
    },
    [
      board,
      auth.name,
      identity.name,
      identity.address,
      cards,
      queueOrPublishResources,
      recordChange,
      normalizeCardCollapse,
      setCachedCardsIndexDoc,
    ]
  );

  const archiveCard = useCallback<QDeckCtx['archiveCard']>(
    async (cardId, archived) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      const c = cards[cardId];
      if (!c) return;
      const publisher = identity.name || auth.name;

      const nextCard: QDeckCard = {
        ...c,
        createdBy: publisher,
        creatorAddress: identity.address || c.creatorAddress,
        archived,
        archivedAt: archived ? Date.now() : undefined,
        archivedBy: archived ? publisher : undefined,
        updatedAt: Date.now(),
        seq: c.seq + 1,
      };
      recordChange({
        type: archived ? 'archived' : 'unarchived',
        cardId,
        title: c.title,
        ts: nextCard.updatedAt,
      });

      const remoteIndex = await loadMergedCardsIndex(board, {
        issuerHints: [publisher, board.createdBy].filter(Boolean) as string[],
      }).catch(() => null);
      const currentIndex = mergeCardsIndexDocs(board.boardId, [
        remoteIndex,
        cardsIndexCacheRef.current[board.boardId],
        createEmptyCardsIndexDoc(board.boardId),
      ]);
      const archivedSet = new Set(currentIndex.archivedIds ?? []);
      if (archived) archivedSet.add(cardId);
      else archivedSet.delete(cardId);
      const nextIndexDoc: CardsIndexDoc = {
        ...currentIndex,
        cardIds: [...(currentIndex.cardIds ?? [])],
        entries: currentIndex.entries ? [...currentIndex.entries] : [],
        archivedIds: Array.from(archivedSet),
        updatedAt: Date.now(),
        seq: (currentIndex.seq ?? 0) + 1,
      };

      setCachedCardsIndexDoc(board.boardId, nextIndexDoc);
      const cardPayload = await buildCardPublishPayload(publisher, board, nextCard);
      const indexPayload = await buildCardsIndexPublishPayload(publisher, board, nextIndexDoc);
      await queueOrPublishResources(board.boardId, [cardPayload, indexPayload]);
      setArchivedCardIds((prev) => {
        const next = new Set(prev);
        if (archived) next.add(cardId);
        else next.delete(cardId);
        return next;
      });
      if (archived) {
        setCards((prev) => {
          const next = { ...prev };
          delete next[cardId];
          return next;
        });
      } else {
        // restore display card if we have variants
        const variants = cardVariants[cardId];
        if (variants?.length) {
          const preferred = board.preferredVariants?.[cardId];
          const chosen =
            (preferred && variants.find((c) => c.createdBy === preferred)) ||
            pickNewestVariant(variants);
          if (chosen) setCards((prev) => ({ ...prev, [cardId]: chosen }));
        }
      }
    },
    [
      board,
      cardVariants,
      auth.name,
      identity.name,
      identity.address,
      cards,
      queueOrPublishResources,
      recordChange,
    ]
  );

  const setPreferredVariant = useCallback<QDeckCtx['setPreferredVariant']>(
    async (cardId, publisher) => {
      if (!board) throw new Error('No board loaded');
      const nextBoard: QDeckBoard = {
        ...board,
        featureFlags: { ...(board.featureFlags || {}), cardVariants: true },
        preferredVariants: {
          ...(board.preferredVariants || {}),
          [cardId]: publisher,
        },
        updatedAt: Date.now(),
        seq: board.seq + 1,
      };
      publisher = identity.name ?? auth.name ?? board.createdBy;
      const boardPayload = await buildBoardPublishPayload(publisher, nextBoard);
      await queueOrPublishResources(nextBoard.boardId, [boardPayload]);
      setBoard(nextBoard);
      const variants = cardVariants[cardId];
      if (variants?.length) {
        const chosen =
          variants.find((c) => c.createdBy === publisher) || pickNewestVariant(variants);
        if (chosen) setCards((prev) => ({ ...prev, [cardId]: chosen }));
      }
    },
    [board, cardVariants, auth.name, identity.name, queueOrPublishResources]
  );

  const addComment = useCallback<QDeckCtx['addComment']>(
    async (cardId, commentHtml, parentId, opts) => {
      if (!board) throw new Error('No board loaded');
      const publisher = opts?.publisherName || identity.name || auth.name;
      if (!publisher) throw new Error('Authentication Failed');
      const now = Date.now();
      const author = publisher || identity.address || 'unknown';
      const thread: CardCommentThread = comments[cardId] ?? {
        _type: 'QDECK_COMMENTS',
        version: 1,
        cardId,
        comments: [],
        updatedAt: 0,
        seq: 0,
      };
      const next: CardCommentThread = {
        ...thread,
        comments: [
          ...thread.comments,
          {
            commentId: uniqueId6(),
            parentId,
            author,
            bodyHtml: commentHtml,
            createdAt: now,
          },
        ],
        updatedAt: now,
        seq: thread.seq + 1,
      };
      setComments((prev) => ({ ...prev, [cardId]: next }));
      setCommentHeads((prev) => ({
        ...prev,
        [cardId]: {
          latestStamp: now,
          newestPublisher: publisher,
        },
      }));
      await saveCommentsDoc(publisher, board, cardId, next);
    },
    [board, comments, identity.name, identity.address, auth.name]
  );

  // helper: merge N per-issuer threads into one view
  function mergeThreads(threads: CardCommentThread[]): CardCommentThread {
    const base: CardCommentThread = {
      _type: 'QDECK_COMMENTS',
      version: 1,
      cardId: threads[0]?.cardId ?? '',
      comments: [],
      updatedAt: 0,
      seq: 0,
    };

    const seen = new Set<string>();
    const all = [];

    for (const t of threads) {
      // guard tombstones/empties
      if (!t || !Array.isArray(t.comments)) continue;

      for (const c of t.comments) {
        // Prefer stable `commentId`; fall back to composite if ever missing
        const key = c.commentId || `${c.author}::${c.createdAt}::${(c.bodyHtml || '').length}`;
        if (!seen.has(key)) {
          seen.add(key);
          all.push(c);
        }
      }
      if ((t.updatedAt ?? 0) > base.updatedAt) base.updatedAt = t.updatedAt!;
      if ((t.seq ?? 0) > base.seq) base.seq = t.seq!;
    }

    // newest-first
    all.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
    base.comments = all;
    return base;
  }

  const refreshCommentHeads = useCallback(async () => {
    if (!board) return;
    const boardId = board.boardId;
    try {
      const heads = await discoverCommentHeadsByBoard(board);
      if (currentBoardIdRef.current && currentBoardIdRef.current !== boardId) return;
      const next: Record<string, { latestStamp: number; newestPublisher?: string }> = {};
      for (const head of heads) {
        if (!head?.cardId) continue;
        const stamp = Number(head.stamp ?? 0);
        const prev = next[head.cardId];
        if (!prev || stamp >= prev.latestStamp) {
          next[head.cardId] = {
            latestStamp: stamp,
            newestPublisher: head.name,
          };
        }
      }
      for (const [cardId, thread] of Object.entries(commentsRef.current)) {
        const stamp = getThreadLatestCommentStamp(thread);
        if (!stamp) continue;
        const prev = next[cardId];
        if (!prev || stamp > prev.latestStamp) {
          next[cardId] = {
            latestStamp: stamp,
            newestPublisher: prev?.newestPublisher,
          };
        }
      }
      setCommentHeads(next);
    } catch (error) {
      console.warn('[Q-Deck] refreshCommentHeads failed', { boardId, error });
    }
  }, [board]);

  useEffect(() => {
    if (!board || cardsLoading) return;
    void refreshCommentHeads();
  }, [board?.boardId, cardsLoading, refreshCommentHeads]);

  const loadCommentsForCard = React.useCallback(
    async (cardId: string) => {
      if (!board) return;
      if (!cardId) throw new Error('cardId not passed to LoadCommentsForCard');
      try {
        // 1) find all issuers who published a thread for this card *with this board’s visibility/mode*
        const refs = await discoverComments(board, cardId);

        // 2) load per-issuer thread
        const threads = (
          await Promise.all(
            refs.map(async (r) => {
              try {
                const t = await loadCommentsDoc(r.name, board, cardId);
                return t;
              } catch {
                return null;
              }
            })
          )
        ).filter(Boolean) as CardCommentThread[];

        // 3) merge + cache
        const merged = mergeThreads(threads);
        setComments((prev) => ({ ...prev, [cardId]: merged }));
        const latest = getThreadLatestCommentStamp(merged);
        setCommentHeads((prev) => {
          const existing = prev[cardId];
          if (!latest) {
            if (!existing) return prev;
            const next = { ...prev };
            delete next[cardId];
            return next;
          }
          if (existing && existing.latestStamp >= latest) return prev;
          return {
            ...prev,
            [cardId]: {
              latestStamp: latest,
              newestPublisher: existing?.newestPublisher,
            },
          };
        });
      } catch (e) {
        console.warn('[Q-Deck] loadCommentsForCard failed', { cardId, e });
        // best-effort empty cache so UI renders deterministically
        setComments((prev) =>
          prev[cardId]
            ? prev
            : {
                ...prev,
                [cardId]: {
                  _type: 'QDECK_COMMENTS',
                  version: 1,
                  cardId,
                  comments: [],
                  updatedAt: 0,
                  seq: 0,
                },
              }
        );
      }
    },
    [board]
  );

  const refreshLoadedComments = useCallback(async () => {
    if (!board) return;
    const cardIds = Object.keys(commentsRef.current);
    if (!cardIds.length) return;
    const limit = pLimit(4);
    await Promise.all(cardIds.map((cardId) => limit(() => loadCommentsForCard(cardId))));
  }, [board, loadCommentsForCard]);

  const refreshBoard = useCallback(
    async (issuerOverride?: string) => {
      if (!board) return;
      setPendingRemoteChanges(null);
      // allow re-run of same key
      lastLoadKey.current = '';

      // issuer namespace: prefer override (e.g., prop from route), else board.createdBy
      const ns = (issuerOverride && issuerOverride.trim()) || board.createdBy;

      await track(
        loadBoardById(ns, board.boardId, board.visibility, {
          visibility: board.visibility,
          groupId: board.privateMeta?.groupId,
          isAdmins: board.privateMeta?.isAdmins,
          preserveExisting: true,
        }),
        `qdeck:board:${board.boardId}`
      );
      void refreshLoadedComments();
    },
    [board, loadBoardById, refreshLoadedComments, track]
  );

  const clearPendingRemoteChanges = useCallback(() => {
    setPendingRemoteChanges(null);
  }, []);

  const applyPendingRemoteChanges = useCallback(async () => {
    if (!board) return;
    const issuer = board.createdBy || identity.name || '';
    if (!issuer) return;
    const pending = pendingRemoteChanges;
    if (!pending) return;
    setPendingRemoteChanges(null);

    if (pending.board) {
      await refreshBoard(issuer);
      return;
    }

    if (pending.cards) {
      await track(
        loadCardsForBoard(issuer, board, {
          preserveOnEmpty: true,
          skipIfIndexUnchanged: true,
        }),
        `qdeck:apply:cards:${board.boardId}`
      );
    }
    if (pending.comments) {
      await refreshCommentHeads();
      await refreshLoadedComments();
    }
  }, [
    board,
    identity.name,
    loadCardsForBoard,
    pendingRemoteChanges,
    refreshCommentHeads,
    refreshBoard,
    refreshLoadedComments,
    track,
  ]);

  const pollBoardUpdates = useCallback(async () => {
    if (!board) return;
    const issuer = board.createdBy || identity.name || '';
    if (!issuer) return;
    const boardId = board.boardId;
    const hasQueuedChanges =
      publishMode === 'batch' && (pendingPublishCount(boardId) > 0 || isPublishingQueue(boardId));
    if (hasQueuedChanges) return;
    if (typeof document !== 'undefined') {
      const dialogOpen =
        document.querySelector('.MuiDialog-root') || document.querySelector('[role="dialog"]');
      if (dialogOpen) return;
      const active = document.activeElement as HTMLElement | null;
      if (active) {
        const tag = active.tagName?.toLowerCase();
        const isEditable =
          tag === 'input' ||
          tag === 'textarea' ||
          (active as HTMLElement).isContentEditable ||
          active.getAttribute('role') === 'textbox' ||
          active.getAttribute('contenteditable') === 'true';
        if (isEditable) return;
      }
    }
    const isPrivate = board.visibility === 'private';
    const commentsPrefix =
      board.visibility === 'public'
        ? `qdeck_pub__cmv2__${boardId}__`
        : `qdeck_priv__cmv2__${boardId}__`;

    const [indexMeta, commentsMeta] = await Promise.all([
      loadMergedCardsIndexWithMeta(board, {
        issuerHints: [board.createdBy, identity.name].filter(Boolean) as string[],
      }),
      getLatestIdentifierPrefixMeta(commentsPrefix, isPrivate),
    ]);

    const indexDoc = indexMeta?.doc ?? null;
    const cachedIndex = cardsIndexCacheRef.current[boardId] ?? getLocalCardsIndex(boardId) ?? null;
    const prevCommentsStamp = commentsStampRef.current[boardId] ?? 0;
    const nextIndexSig = indexSignature(indexDoc ?? cachedIndex);
    const prevIndexSig = cardsIndexSigRef.current[boardId] ?? indexSignature(cachedIndex);
    const indexChanged = Boolean(nextIndexSig && nextIndexSig !== prevIndexSig);
    const commentsStamp = commentsMeta?.stamp ?? 0;
    const commentsChanged = commentsStamp > prevCommentsStamp;
    const me = identity.name?.trim().toLowerCase();
    const newestIndexPublisher = indexMeta?.newest?.name;
    const indexFromMe =
      !!me && !!newestIndexPublisher && newestIndexPublisher.trim().toLowerCase() === me;
    const commentsFromMe =
      !!me && !!commentsMeta?.name && commentsMeta.name.trim().toLowerCase() === me;

    const noPriorStamps =
      (cardsIndexStampRef.current[boardId] ?? 0) === 0 &&
      (commentsStampRef.current[boardId] ?? 0) === 0;
    if (noPriorStamps || !pollSeedingRef.current[boardId]) {
      const idxStamp = Number(indexDoc?.updatedAt ?? 0);
      if (idxStamp) cardsIndexStampRef.current[boardId] = idxStamp;
      if (nextIndexSig) cardsIndexSigRef.current[boardId] = nextIndexSig;
      if (commentsStamp) commentsStampRef.current[boardId] = commentsStamp;
      pollSeedingRef.current[boardId] = true;
      return;
    }

    if (commentsStamp) commentsStampRef.current[boardId] = commentsStamp;
    if (indexDoc?.updatedAt) {
      cardsIndexStampRef.current[boardId] = Math.max(
        cardsIndexStampRef.current[boardId] ?? 0,
        Number(indexDoc.updatedAt ?? 0)
      );
    }

    if (!indexChanged && !commentsChanged) return;
    if (nextIndexSig) cardsIndexSigRef.current[boardId] = nextIndexSig;

    const nextPending = {
      cards: (pendingRemoteChanges?.cards ?? false) || (indexChanged && !indexFromMe),
      comments: (pendingRemoteChanges?.comments ?? false) || (commentsChanged && !commentsFromMe),
    };
    const samePending =
      pendingRemoteChanges?.cards === nextPending.cards &&
      pendingRemoteChanges?.comments === nextPending.comments;
    if (!samePending) {
      setPendingRemoteChanges(nextPending);
    }
  }, [
    board,
    identity.name,
    isPublishingQueue,
    pendingPublishCount,
    pendingRemoteChanges,
    publishMode,
  ]);

  useEffect(() => {
    if (!board || typeof window === 'undefined') return;
    const interval = window.setInterval(() => {
      if (pollInFlightRef.current) return;
      pollInFlightRef.current = true;
      void pollBoardUpdates().finally(() => {
        pollInFlightRef.current = false;
      });
    }, 30_000);
    return () => window.clearInterval(interval);
  }, [board?.boardId, pollBoardUpdates]);

  const collectBoardChangeReport = useCallback<QDeckCtx['collectBoardChangeReport']>(async () => {
    if (!board) return { openedAt: Date.now(), entries: [], comments: [] };
    const openedAt = changeLog.openedAt;
    const entries = [...changeLog.entries];

    const touchedCardIds = new Set(entries.map((e) => `${e.type}::${e.cardId}`));
    const seenCards = new Set(entries.map((e) => e.cardId));
    const newestCards: QDeckCard[] = [];
    for (const variants of Object.values(cardVariants)) {
      const newest = pickNewestVariant(variants);
      if (newest) newestCards.push(newest);
    }
    for (const c of Object.values(cards)) {
      if (!newestCards.some((x) => x.cardId === c.cardId)) {
        newestCards.push(c);
      }
    }

    for (const card of newestCards) {
      if ((card.updatedAt ?? 0) <= openedAt) continue;
      if (touchedCardIds.has(`updated::${card.cardId}`)) continue;
      if (touchedCardIds.has(`completed::${card.cardId}`)) continue;
      if (touchedCardIds.has(`reopened::${card.cardId}`)) continue;
      if (touchedCardIds.has(`moved::${card.cardId}`)) continue;
      if (touchedCardIds.has(`created::${card.cardId}`)) continue;
      if (seenCards.has(card.cardId)) continue;
      entries.push({
        type: 'updated',
        cardId: card.cardId,
        title: card.title,
        ts: card.updatedAt ?? Date.now(),
        details: 'updated',
      });
    }

    const commentLimit = pLimit(4);
    const commentCardIds = new Set<string>();
    Object.keys(cardVariants).forEach((id) => commentCardIds.add(id));
    Object.keys(cards).forEach((id) => commentCardIds.add(id));
    archivedCardIds.forEach((id) => commentCardIds.add(id));

    const comments: CommentChange[] = [];
    const seenComments = new Set<string>();
    await Promise.all(
      Array.from(commentCardIds).map((cardId) =>
        commentLimit(async () => {
          try {
            const refs = await discoverComments(board, cardId);
            const threads = (
              await Promise.all(
                refs.map(async (r) => {
                  try {
                    return await loadCommentsDoc(r.name, board, cardId);
                  } catch {
                    return null;
                  }
                })
              )
            ).filter(Boolean) as CardCommentThread[];
            const title =
              cards[cardId]?.title ||
              pickNewestVariant(cardVariants[cardId] || [])?.title ||
              undefined;
            for (const thread of threads) {
              for (const c of thread.comments ?? []) {
                if ((c.createdAt ?? 0) <= openedAt) continue;
                const key =
                  c.commentId || `${c.author}::${c.createdAt}::${(c.bodyHtml || '').length}`;
                if (seenComments.has(key)) continue;
                seenComments.add(key);
                comments.push({
                  cardId,
                  cardTitle: title,
                  author: c.author,
                  createdAt: c.createdAt,
                  bodyHtml: c.bodyHtml || '',
                });
              }
            }
          } catch {
            /* ignore */
          }
        })
      )
    );

    comments.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0));

    return { openedAt, entries, comments };
  }, [archivedCardIds, board, cardVariants, cards, changeLog.entries, changeLog.openedAt]);

  const recordPayment = useCallback<QDeckCtx['recordPayment']>(
    async (line) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      await appendPaymentLine(identity.name || auth.name, board, line);
    },
    [board, identity.name, auth.name]
  );

  const deleteBoardImpl = useCallback<QDeckCtx['deleteBoard']>(
    async (opts) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      const publisher = identity.name || auth.name;
      if (!publisher || board.createdBy !== publisher)
        throw new Error(
          'non-publisher delete feature not implemented, you must be the board creator to delete for now.'
        );
      const issuer = board.createdBy;
      const allCards = Object.values(cards);
      await apiDeleteBoard(issuer, board, allCards, opts);

      // clear local state since board is gone
      setBoard(null);
      setCards({});
      setCardVariants({});
      setArchivedCardIds(new Set());
      setComments({});
      setCommentHeads({});
      setBoardLastVisitTs(0);
    },
    [board, cards, auth.name, identity.name]
  );

  const value = useMemo<QDeckCtx>(
    () => ({
      identity,
      board,
      cards,
      cardVariants,
      archivedCardIds,
      cardsLoading,
      comments,
      commentHeads,
      boardLastVisitTs,
      changeLog,
      isCardCollapsed,
      setCardCollapsed,
      loadBoardById,
      persistBoard,
      refreshBoard,
      createCard,
      moveCard,
      updateCard,
      publishCardAttachment,
      archiveCard,
      setPreferredVariant,
      addComment,
      loadCommentsForCard,
      refreshCommentHeads,
      collectBoardChangeReport,
      resetBoardChangeLog,
      publishMode,
      setPublishMode,
      pendingPublishCount,
      getPublishQueueForBoard,
      removePublishQueueItem,
      publishPendingResources,
      isPublishingQueue,
      clearPublishQueue,
      isRepairingIndex: repairingIndex,
      repairCardsIndex,
      recordPayment,
      deleteBoard: deleteBoardImpl,
      pendingRemoteChanges,
      applyPendingRemoteChanges,
      clearPendingRemoteChanges,
    }),
    [
      identity,
      board,
      cards,
      cardVariants,
      archivedCardIds,
      cardsLoading,
      comments,
      commentHeads,
      boardLastVisitTs,
      changeLog,
      isCardCollapsed,
      setCardCollapsed,
      loadBoardById,
      persistBoard,
      refreshBoard,
      createCard,
      moveCard,
      updateCard,
      publishCardAttachment,
      archiveCard,
      setPreferredVariant,
      addComment,
      loadCommentsForCard,
      refreshCommentHeads,
      collectBoardChangeReport,
      resetBoardChangeLog,
      publishMode,
      setPublishMode,
      pendingPublishCount,
      getPublishQueueForBoard,
      removePublishQueueItem,
      publishPendingResources,
      isPublishingQueue,
      clearPublishQueue,
      repairingIndex,
      repairCardsIndex,
      recordPayment,
      deleteBoardImpl,
      pendingRemoteChanges,
      applyPendingRemoteChanges,
      clearPendingRemoteChanges,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
