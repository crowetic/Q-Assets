import type { CardsIndexDoc } from '../types/qdeck';

const CACHE_TTL_MS = 120_000;
const STORAGE_PREFIX = 'qdeck.cards.index:';

type Stored = {
  cachedAt: number;
  doc: CardsIndexDoc;
};

const keyFor = (boardId: string) => `${STORAGE_PREFIX}${boardId}`;

const isValidDoc = (doc: any, boardId: string): doc is CardsIndexDoc => {
  if (!doc || typeof doc !== 'object') return false;
  if (doc._type !== 'QDECK_CARDS_INDEX') return false;
  if (doc.boardId !== boardId) return false;
  return true;
};

export function getLocalCardsIndex(boardId: string): CardsIndexDoc | null {
  if (!boardId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(keyFor(boardId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || typeof parsed.cachedAt !== 'number' || !parsed.doc) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      window.localStorage.removeItem(keyFor(boardId));
      return null;
    }
    if (!isValidDoc(parsed.doc, boardId)) return null;
    return parsed.doc;
  } catch {
    return null;
  }
}

export function setLocalCardsIndex(boardId: string, doc: CardsIndexDoc) {
  if (!boardId || typeof window === 'undefined') return;
  if (!isValidDoc(doc, boardId)) return;
  try {
    const payload: Stored = { cachedAt: Date.now(), doc };
    window.localStorage.setItem(keyFor(boardId), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
