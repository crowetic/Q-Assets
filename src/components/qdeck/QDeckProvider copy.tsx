import React, { createContext, useContext, useMemo, useRef, useState, useCallback } from 'react';
import { QDeckBoard, QDeckCard, CardCommentThread } from '../../types/qdeck';
import {
  saveBoardDoc,
  saveCardDoc,
  saveCommentsDoc,
  appendPaymentLine,
  QUserIdentity,
  requireName,
  addCardToIndex,
  loadCardsIndex,
  loadCardDoc,
  discoverCardIdsBySearch,
  findBoardVisibilityHeads,
  resolveBoardForRead,
  discoverCardRefsBySearch,
} from '../../utils/qdeckApi';
import { useAuth } from 'qapp-core';
import { deleteBoard as apiDeleteBoard } from '../../utils/qdeckApi'; // path as needed
import { useAlert } from '../alerts';
import { uniqueId6 } from '../../utils/ids';
import {
  canPublisherPublishToBoard,
  canUserEditBoard,
  canUserViewBoard,
  cardAuthHeaderMatchesPublisher,
  userInAllowedGroups,
} from '../../utils/qdeckAccess';

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

// async function findBoardVisibility(
//   issuer: string,
//   shortId: string
// ): Promise<'public' | 'private' | null> {
//   const publicIdent = QDeckId.boardPublic(shortId);
//   const privateIdent = QDeckId.boardPrivate(shortId);

//   // Search each namespace once, then check for exact match
//   const [pubHeads, privHeads] = await Promise.all([
//     searchSimpleByIdPrefixOnly(QDeckId.prefixPublicBoards, false),
//     searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateBoards, true),
//   ]);

//   const hasPublic = pubHeads.some((h) => h.name === issuer && h.identifier === publicIdent);
//   if (hasPublic) return 'public';

//   const hasPrivate = privHeads.some((h) => h.name === issuer && h.identifier === privateIdent);
//   if (hasPrivate) return 'private';

//   return null; // not found (or no access to private)
// }

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

  const issuerName = () => requireName(identity);
  // const { alert } = useAlert();

  // const getIssuerName = useCallback(() => requireName(identity), [identity]);
  const lastLoadKey = useRef<string>('');

  // const loadCardsForBoard = React.useCallback(
  //   async (issuer: string, b: QDeckBoard) => {
  //     // we’ll accumulate here and only call setCards once at the end
  //     let cardIds: string[] | null = null;

  //     const canView = await canUserViewBoard(b, { address: identity.address });
  //     if (!canView) {
  //       console.error('[Q-Deck] viewer not in private group; cannot open board');
  //       return;
  //     }
  //     // 1) Try cards index – but don’t bail if it throws
  //     try {
  //       const idx = await loadCardsIndex(identity.name!, b);
  //       cardIds = idx?.cardIds ?? null;
  //       if (!cardIds || cardIds.length === 0) {
  //         console.info('[Q-Deck] cards index empty or missing; will try discovery');
  //       } else {
  //         console.debug('[Q-Deck] cards index loaded', { count: cardIds.length });
  //       }
  //     } catch (e) {
  //       console.warn('[Q-Deck] loadCardsIndex failed; attempting discovery fallback', e);
  //       // fall through to discovery
  //       cardIds = null;
  //     }

  //     // 2) Fallback: discover IDs by searching QDN identifiers (usually public only)
  //     if (!cardIds || cardIds.length === 0) {
  //       try {
  //         const cardRes = await discoverCardIdsBySearch(b);
  //         console.log('[Q-Deck] discovery found cards', { count: cardRes.length });
  //       } catch (e) {
  //         console.warn('[Q-Deck] discoverCardIdsBySearch failed', e);
  //         cardIds = null;
  //       }
  //     }

  //     // 3) If still nothing, show empty (don’t throw) //TODO - MUST FIX THIS.
  //     if (!cardIds || cardIds.length === 0) {
  //       setCards({});
  //       return;
  //     }

  //     // 4) Fetch each card; ignore nulls & tombstones
  //     const loaded = await Promise.all(
  //       cardRes.map(async (cid) => {
  //         try {
  //           const doc = await loadCardDoc(cid.name, b, cid);
  //           if (!doc) return null;
  //           // tombstone check – either via helper or inline
  //           if ((doc as any)._type === 'QDECK_TOMBSTONE') return null;
  //           return doc as QDeckCard;
  //         } catch {
  //           return null;
  //         }
  //       })
  //     );

  //     const usable = loaded.filter(Boolean) as QDeckCard[];

  //     // 5) Normalize by id once, then set
  //     const byId = Object.fromEntries(usable.map((c) => [c.cardId, c]));
  //     setCards(byId);
  //   },
  //   [setCards]
  // );

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

  // EXACT signature as in QDeckCtx:
  // const loadBoardById = useCallback<QDeckCtx['loadBoardById']>(
  //   async (ns, boardId, visibility, opts) => {
  //     const issuer = (ns || '').trim();
  //     const shortId = (boardId || '').trim();
  //     if (!issuer || !shortId) {
  //       console.warn('[Q-Deck] loadBoardById empty issuer/id', { issuer, shortId });
  //       return;
  //     }

  //     // If we already have this board loaded with same id, skip needless hits
  //     if (board?.boardId === shortId) {
  //       // Optional: also check visibility/adminness if you want
  //       return;
  //     }

  //     const hint: 'public' | 'private' | undefined = visibility ?? opts?.visibility;
  //     const key = `${issuer}:${shortId}:${hint ?? 'auto'}`;

  //     let vis: 'public' | 'private' | null | undefined = hint;
  //     if (!vis) {
  //       try {
  //         vis = await findBoardVisibility(issuer, shortId);
  //       } catch (e) {
  //         console.warn(
  //           '[Q-Deck] findBoardVisibility failed, will fall back to public->private tries',
  //           e
  //         );
  //         vis = undefined; // fall through to old behavior
  //       }
  //     }
  //     if (lastLoadKey.current === key) {
  //       // Same load already in-flight or done — bail
  //       return;
  //     }
  //     lastLoadKey.current = key;
  //     console.log('[Q-Deck] loadBoardById start', { key, issuer, shortId, hint, opts });

  //     let b: QDeckBoard | null = null;

  //     try {
  //       if (b && isTombstone(b)) {
  //         console.warn('[Q-Deck] Board tombstoned (deleted).');
  //         alert('Q-Deck board has been tombstoned (deleted)', 'error', { severity: 'error' });

  //         // Option A: just clear state
  //         setBoard(null);
  //         setCards({});
  //         setComments({});
  //         // Optionally: toast the user
  //         return;
  //       }
  //       if (vis === 'public') {
  //         b = await loadBoardDoc(issuer, shortId, 'public');
  //       } else if (vis === 'private') {
  //         // Try the hinted opts first if present

  //         b = await loadBoardDoc(issuer, shortId, 'private');

  //         // If still null, try all of the user’s groups (admins first)
  //         if (!b && identity?.address) {
  //           const groups = await getAccountGroups(identity.address).catch(() => []);
  //           const admins = groups.filter((g) => g.isAdmin);
  //           const members = groups.filter((g) => !g.isAdmin);
  //           const tryGroups = async (arr: typeof groups) => {
  //             for (const g of arr) {
  //               const maybe = await loadBoardDoc(
  //                 issuer,
  //                 shortId,
  //                 'private',
  //                 g.groupId,
  //                 !!g.isAdmin
  //               );
  //               if (maybe) return maybe;
  //             }
  //             return null;
  //           };
  //           b = (await tryGroups(admins)) || (await tryGroups(members));
  //         }
  //       } else {
  //         // No visibility determined (not found in heads): conservative fallback
  //         b = await loadBoardDoc(issuer, shortId, 'public');
  //         if (!b && identity?.address) {
  //           const groups = await getAccountGroups(identity.address).catch(() => []);
  //           const admins = groups.filter((g) => g.isAdmin);
  //           const members = groups.filter((g) => !g.isAdmin);
  //           const tryGroups = async (arr: typeof groups) => {
  //             for (const g of arr) {
  //               const maybe = await loadBoardDoc(
  //                 issuer,
  //                 shortId,
  //                 'private',
  //                 g.groupId,
  //                 !!g.isAdmin
  //               );
  //               if (maybe) return maybe;
  //             }
  //             return null;
  //           };
  //           b = (await tryGroups(admins)) || (await tryGroups(members));
  //         }
  //       }
  //     } catch (e) {
  //       console.error('[Q-Deck] loadBoardDoc threw', e);
  //     }

  //     // race guard
  //     if (lastLoadKey.current !== key) {
  //       console.log('[Q-Deck] loadBoardById stale result ignored', {
  //         key,
  //         current: lastLoadKey.current,
  //       });
  //       return;
  //     }

  //     if (!b) {
  //       console.error('[Q-Deck] Board not found or inaccessible', { issuer, shortId, hint, opts });
  //       return;
  //     }

  //     setBoard(b);
  //     setCards({});
  //     setComments({});

  //     void loadCardsForBoard(issuer, b);

  //     console.debug('[Q-Deck] loadBoardById success', { issuer, shortId, title: b.title });
  //   },
  //   [board] // only read board for the early-return check
  // );

  const loadBoardById = useCallback<QDeckCtx['loadBoardById']>(
    async (ns, boardId, visibility, _opts) => {
      const issuer = (ns || '').trim();
      const shortId = (boardId || '').trim();
      if (!issuer || !shortId) {
        console.warn('[Q-Deck] loadBoardById empty issuer/id', { issuer, shortId });
        return;
      }

      // Prevent redundant loads of same key
      const key = `${issuer}:${shortId}:${visibility ?? 'auto'}`;
      if (lastLoadKey.current === key && board?.boardId === shortId) return;
      lastLoadKey.current = key;

      // Prefer hint if provided; else probe heads
      const hint =
        visibility ??
        ((await findBoardVisibilityHeads(issuer, shortId).catch(() => null)) || undefined);

      const b = await resolveBoardForRead(issuer, shortId, hint, identity.address).catch((e) => {
        console.error('[Q-Deck] resolveBoardForRead error', e);
        return null;
      });

      // race guard
      if (lastLoadKey.current !== key) return;

      if (!b) {
        console.error('[Q-Deck] Board not found or inaccessible', { issuer, shortId, hint });
        return;
      }

      setBoard(b);
      setCards({});
      setComments({});
      void loadCardsForBoard(issuer, b);

      console.debug('[Q-Deck] loadBoardById success', { issuer, shortId, title: b.title });
    },
    [board, identity.address, loadCardsForBoard]
  );

  const persistBoard = useCallback<QDeckCtx['persistBoard']>(
    async (nextBoard) => {
      await saveBoardDoc(issuerName(), nextBoard);
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

      await loadBoardById(ns, board.boardId, board.visibility, {
        visibility: board.visibility,
        groupId: board.privateMeta?.groupId,
        isAdmins: board.privateMeta?.isAdmins,
      });
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
    async (cardId, commentHtml, parentId, opts) => {
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
            commentId: crypto.randomUUID(),
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
      await saveCommentsDoc(auth.name ? auth.name : identity.name, board, next);
    },
    [board, comments, identity.name, identity.address]
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
      const issuer = auth.name ? auth.name : identity.name;
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
      recordPayment,
      deleteBoardImpl,
    ]
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};
