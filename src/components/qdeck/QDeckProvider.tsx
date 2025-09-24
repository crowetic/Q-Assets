import React, { createContext, useContext, useMemo, useRef, useState, useCallback } from 'react';
import { QDeckBoard, QDeckCard, CardCommentThread } from '../../types/qdeck';
import {
  saveBoardDoc,
  saveCardDoc,
  saveCommentsDoc,
  appendPaymentLine,
  QUserIdentity,
  addCardToIndex,
  loadCardsIndex,
  loadCardDoc,
  findBoardVisibilityHeads,
  resolveBoardForRead,
  discoverCardRefsBySearch,
  resolveBoardForReadWithMeta,
  discoverComments,
  loadCommentsDoc,
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

// ---- Types ----
type LoadOpts = {
  visibility?: 'public' | 'private';
  groupId?: number;
  isAdmins?: boolean;
};

type QDeckCtx = {
  identity: QUserIdentity;

  board: QDeckBoard | null;
  cards: Record<string, QDeckCard>;
  comments: Record<string, CardCommentThread>;

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

  addComment: (
    cardId: string,
    commentHtml: string,
    parentId?: string,
    opts?: { isAdminsThread?: boolean }
  ) => Promise<void>;

  loadCommentsForCard: (cardId: string) => Promise<void>;

  recordPayment: (line: Parameters<typeof appendPaymentLine>[2]) => Promise<void>;
  deleteBoard: (opts?: { cascadeCards?: boolean; cascadeComments?: boolean }) => Promise<void>;
};

// safer default
const Ctx = createContext<QDeckCtx | undefined>(undefined);
export const useQDeck = () => {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useQDeck must be used within QDeckProvider');
  return ctx;
};

//MAIN PROVIDER EXPORT --------------------------------------------------------------------------------------

export const QDeckProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const auth = useAuth();

  const [board, setBoard] = useState<QDeckBoard | null>(null);
  const [cards, setCards] = useState<Record<string, QDeckCard>>({});
  const [comments, setComments] = useState<Record<string, CardCommentThread>>({});

  const identity: QUserIdentity = {
    name: auth?.name as string,
    address: auth?.address as string,
    publicKey: auth?.publicKey as string,
  };

  const lastLoadKey = useRef<string>('');
  const { track } = useFetchTracker();

  const loadCardsForBoard = React.useCallback(
    async (_issuerIgnored: string, b: QDeckBoard) => {
      // 0) Access check
      const canView = await canUserViewBoard(b, { address: identity.address });
      if (!canView) {
        console.error('[Q-Deck] viewer not allowed; cannot open board');
        setCards({});
        return;
      }

      // 1) Try index (read under board issuer!)
      let refs: Array<{ name: string; cardId: string }> | null = null;
      try {
        const idx = await loadCardsIndex(b.createdBy, b);
        if (idx?.entries?.length) {
          refs = idx.entries.slice();
        } else if (idx?.cardIds?.length) {
          // legacy: assume board issuer published these
          refs = idx.cardIds.map((cid) => ({ name: b.createdBy, cardId: cid }));
        }
      } catch (e) {
        console.warn('[Q-Deck] loadCardsIndex failed; will try discovery', e);
      }

      // 2) Fallback discovery across *all* issuers
      if (!refs || refs.length === 0) {
        try {
          const all = await discoverCardRefsBySearch(b);
          // Filter by board policy + author header coherence
          const allowed: Array<{ name: string; cardId: string }> = [];
          for (const r of all) {
            try {
              const card = await loadCardDoc(r.name, b, r.cardId);
              if (!card || (card as any)._type === 'QDECK_TOMBSTONE') continue;
              if (!cardAuthHeaderMatchesPublisher(card as QDeckCard, r.name)) continue;
              const ok = await canPublisherPublishToBoard(b, { name: r.name });
              if (!ok) continue;
              allowed.push(r);
            } catch {
              // ignore bad/undecryptable
            }
          }
          refs = allowed;
        } catch (e) {
          console.warn('[Q-Deck] discovery failed', e);
          refs = [];
        }
      }

      if (!refs || refs.length === 0) {
        setCards({});
        return;
      }

      // 3) Fetch each card with its *publisher* name
      const loaded = await Promise.all(
        refs.map(async (r) => {
          try {
            const doc = await loadCardDoc(r.name, b, r.cardId);
            if (!doc || (doc as any)._type === 'QDECK_TOMBSTONE') return null;
            return doc as QDeckCard;
          } catch {
            return null;
          }
        })
      );

      const usable = loaded.filter(Boolean) as QDeckCard[];
      const byId = Object.fromEntries(usable.map((c) => [c.cardId, c]));
      setCards(byId);
    },
    [identity.address, setCards]
  );

  const loadBoardById = useCallback<QDeckCtx['loadBoardById']>(
    async (ns, boardIdOrIdent, visibility, _opts) => {
      const issuer = (ns || '').trim();
      const raw = (boardIdOrIdent || '').trim();
      if (!issuer || !raw) {
        console.log('[Q-Deck] loadBoardById empty issuer/id', { issuer, raw });
        return;
      }

      // Is this a full identifier or a short id?
      const isPrivIdent = raw.startsWith(QDeckId.prefixPrivateBoards);
      const isPubIdent = raw.startsWith(QDeckId.prefixPublicBoards);

      // Cache-key should reflect the exact thing we’re trying to open
      const cacheKey = `${issuer}:${raw}:${visibility ?? 'auto'}`;
      if (
        lastLoadKey.current === cacheKey &&
        board &&
        (board.boardId === raw || isPrivIdent || isPubIdent)
      ) {
        return;
      }
      lastLoadKey.current = cacheKey;

      // 1) If caller gave a full ident, we already know the intent.
      //    Skip heads probing and go straight to resolve (fast-path).
      if (isPubIdent || isPrivIdent) {
        const probe = await resolveBoardForReadWithMeta(issuer, raw, visibility).catch((e) => {
          console.error('[Q-Deck] resolveBoardForReadWithMeta error', e);
          return null;
        });

        if (lastLoadKey.current !== cacheKey) return; // race guard
        if (!probe?.doc) {
          console.error('[Q-Deck] Board not found/inaccessible (ident)', { issuer, ident: raw });
          return;
        }

        setBoard(probe.doc);
        setCards({});
        setComments({});
        void track(loadCardsForBoard(issuer, probe.doc), `${probe.doc}`);
        console.log('[Q-Deck] loadBoardById success (ident)', {
          issuer,
          id: raw,
          title: probe.doc.title,
        });
        return;
      }

      // 2) We have a short id. Prefer supplied hint; otherwise peek heads.
      const shortId = raw;
      const hint =
        visibility ??
        ((await findBoardVisibilityHeads(issuer, shortId).catch(() => null)) || undefined);

      // Use the meta-aware resolver (it handles public first, then private probe)
      const resolved = await track(
        resolveBoardForRead(issuer, shortId, hint).catch((e) => {
          console.error('[Q-Deck] resolveBoardForRead error', e);
          return null;
        }),
        `qdeck:cards:${shortId}`
      );

      if (lastLoadKey.current !== cacheKey) return; // race guard
      if (!resolved) {
        console.error('[Q-Deck] Board not found or inaccessible', { issuer, shortId, hint });
        return;
      }

      setBoard(resolved);
      setCards({});
      setComments({});
      void track(loadCardsForBoard(issuer, resolved), `${resolved}`);

      console.debug('[Q-Deck] loadBoardById success', { issuer, shortId, title: resolved.title });
    },
    [board, loadCardsForBoard] // identity.address not used anymore in this body
  );

  const persistBoard = useCallback<QDeckCtx['persistBoard']>(
    async (nextBoard) => {
      await saveBoardDoc(auth.name!, nextBoard);
      setBoard(nextBoard);
    },
    [identity.name]
  );

  const refreshBoard = useCallback(
    async (issuerOverride?: string) => {
      if (!board) return;
      // allow re-run of same key
      lastLoadKey.current = '';

      // issuer namespace: prefer override (e.g., prop from route), else board.createdBy
      const ns = (issuerOverride && issuerOverride.trim()) || board.createdBy;

      await track(
        loadBoardById(ns, board.boardId, board.visibility, {
          visibility: board.visibility,
          groupId: board.privateMeta?.groupId,
          isAdmins: board.privateMeta?.isAdmins,
        }),
        `qdeck:board:${board.boardId}`
      );
    },
    [board, loadBoardById]
  );

  const createCard = useCallback<QDeckCtx['createCard']>(
    async (partial) => {
      if (!board) throw new Error('No board loaded');
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
        hasBounty: !!partial.hasBounty,
        bountyInfo: partial.hasBounty ? partial.bountyInfo : undefined,
        upvotes: partial.upvotes ?? { currency: 'QASSET', count: 0, totalAmount: '0' },
        createdAt: now,
        updatedAt: now,
        seq: 1,
      };

      setCards((prev) => ({ ...prev, [c.cardId]: c }));
      await saveCardDoc(auth.name ? auth.name : identity.name, board, c);
      await addCardToIndex(auth.name ? auth.name : identity.name, board, c.cardId);
      return c;
    },
    [board, identity.name, identity.address]
  );

  const moveCard = useCallback<QDeckCtx['moveCard']>(
    async (cardId, toListId, newOrder) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      const c = cards[cardId];
      if (!c) return;
      const next: QDeckCard = {
        ...c,
        statusListId: toListId,
        order: newOrder,
        updatedAt: Date.now(),
        seq: c.seq + 1,
      };
      setCards((prev) => ({ ...prev, [cardId]: next }));
      await saveCardDoc(auth.name ? auth.name : identity.name, board, next);
    },
    [board, cards]
  );

  const updateCard = useCallback<QDeckCtx['updateCard']>(
    async (card) => {
      if (!board) throw new Error('No board loaded');

      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      // const ok = await userInAllowedGroups(board, auth.name ? auth.name : identity.name);
      const ok = await canUserEditBoard(board, { name: identity.name, address: identity.address });
      if (!ok) throw new Error('You are not allowed to edit cards on this board.');

      const current = cards[card.cardId];

      if (current && card.seq <= current.seq) throw new Error('Stale write (seq too low)');
      card.seq + 1;
      setCards((prev) => ({ ...prev, [card.cardId]: card }));
      // if (!auth.name) alert('Authentication failure', 'error', { severity: 'error' });
      // if (!auth || !auth.name || !identity.name) return;
      await saveCardDoc(auth.name ? auth.name : identity.name, board, card);
    },
    [board, cards]
  );

  const addComment = useCallback<QDeckCtx['addComment']>(
    async (cardId, commentHtml, parentId) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      const now = Date.now();
      const author = identity.name || identity.address || 'unknown';
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
      await saveCommentsDoc(auth.name ? auth.name : identity.name, board, cardId, next);
    },
    [board, comments, identity.name, identity.address]
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

  const recordPayment = useCallback<QDeckCtx['recordPayment']>(
    async (line) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      await appendPaymentLine(auth.name ? auth.name : identity.name, board, line);
    },
    [board, identity.name]
  );

  const deleteBoardImpl = useCallback<QDeckCtx['deleteBoard']>(
    async (opts) => {
      if (!board) throw new Error('No board loaded');
      if (!auth.name || !identity.name) throw new Error('Authentication Failed');
      if (board.createdBy != auth.name || board.createdBy != identity.name)
        throw new Error(
          'non-publisher delete feature not implemented, you must be the board creator to delete for now.'
        );
      const issuer = board.createdBy;
      const allCards = Object.values(cards);
      await apiDeleteBoard(issuer, board, allCards, opts);

      // clear local state since board is gone
      setBoard(null);
      setCards({});
      setComments({});
    },
    [board, cards]
  );

  const value = useMemo<QDeckCtx>(
    () => ({
      identity,
      board,
      cards,
      comments,
      loadBoardById,
      persistBoard,
      refreshBoard,
      createCard,
      moveCard,
      updateCard,
      addComment,
      loadCommentsForCard,
      recordPayment,
      deleteBoard: deleteBoardImpl,
    }),
    [
      identity,
      board,
      cards,
      comments,
      loadBoardById,
      persistBoard,
      refreshBoard,
      createCard,
      moveCard,
      updateCard,
      addComment,
      loadCommentsForCard,
      recordPayment,
      deleteBoardImpl,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
