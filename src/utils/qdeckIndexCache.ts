// src/utils/qdeckIndexCache.ts
import { loadBoardsIndex, saveBoardsIndex } from './qdeckApi'; // adjust path
import type { BoardsIndexDoc } from '../types/qdeck';

type IndexDocBase<T> = {
  _type: string;
  version: 1;
  issuerName: string;
  updatedAt: number;
  seq: number;
} & Record<string, T[]>;

type MergeOptions<T> = {
  itemsKey: string;
  idKey: keyof T;
  updatedKey: keyof T;
};

export function mergeIndexDocs<T extends Record<string, any>>(
  a: IndexDocBase<T> | null | undefined,
  b: IndexDocBase<T> | null | undefined,
  opts: MergeOptions<T>
): IndexDocBase<T> | null {
  if (!a && !b) return null;
  if (a && !b) return a;
  if (b && !a) return b;

  const newer =
    (a!.seq ?? 0) > (b!.seq ?? 0)
      ? a!
      : (a!.seq ?? 0) < (b!.seq ?? 0)
        ? b!
        : (a!.updatedAt ?? 0) >= (b!.updatedAt ?? 0)
          ? a!
          : b!;

  const map = new Map<string, T>();
  const itemsKey = opts.itemsKey;
  const idKey = opts.idKey;
  const updatedKey = opts.updatedKey;

  for (const src of [a!, b!]) {
    const items = (src?.[itemsKey] as T[]) ?? [];
    for (const it of items) {
      const id = String(it[idKey] ?? '');
      if (!id) continue;
      const prev = map.get(id);
      if (!prev || (Number(it[updatedKey] ?? 0) > Number(prev[updatedKey] ?? 0))) {
        map.set(id, it);
      }
    }
  }

  return {
    ...newer,
    [itemsKey]: Array.from(map.values()),
    updatedAt: Math.max(a!.updatedAt ?? 0, b!.updatedAt ?? 0),
    seq: Math.max(a!.seq ?? 0, b!.seq ?? 0),
  } as IndexDocBase<T>;
}

export function normalizeIndexDoc(
  doc: BoardsIndexDoc | null,
  expectedIssuer?: string
): BoardsIndexDoc | null {
  if (!doc) return null;

  const issuerName =
    doc.issuerName && doc.issuerName.trim() ? doc.issuerName.trim() : (expectedIssuer ?? '');

  // nothing else fancy, but you could coerce row types here too
  return {
    _type: 'QDECK_BOARDS_INDEX',
    version: 1 as const,
    issuerName,
    boards: (doc.boards ?? []).map((row) => ({
      boardId: String(row.boardId),
      title: String(row.title ?? ''),
      createdAt: Number(row.createdAt ?? 0),
      updatedAt: Number(row.updatedAt ?? 0),
      visibility: row.visibility === 'private' ? 'private' : 'public',
      service: row.service === 'DOCUMENT_PRIVATE' ? 'DOCUMENT_PRIVATE' : 'DOCUMENT',
    })),
    updatedAt: Number(doc.updatedAt ?? Date.now()),
    seq: Number(doc.seq ?? 0),
  };
}

const keyFor = (issuerName: string) => `qdeck.idx:${issuerName}`;

export function getLocalIndex(issuerName: string): BoardsIndexDoc | null {
  try {
    const s = localStorage.getItem(keyFor(issuerName));
    if (!s) return null;
    const doc = JSON.parse(s);
    if (doc?._type === 'QDECK_BOARDS_INDEX') return doc;
  } catch {}
  return null;
}

export function setLocalIndex(issuerName: string, doc: BoardsIndexDoc) {
  try {
    localStorage.setItem(keyFor(issuerName), JSON.stringify(doc));
  } catch {}
}

export function mergeIndices(
  a?: BoardsIndexDoc | null,
  b?: BoardsIndexDoc | null
): BoardsIndexDoc | null {
  return mergeIndexDocs(a, b, {
    itemsKey: 'boards',
    idKey: 'boardId',
    updatedKey: 'updatedAt',
  }) as BoardsIndexDoc | null;
}

export async function loadBoardsIndexMerged(issuer: string): Promise<BoardsIndexDoc | null> {
  const local = normalizeIndexDoc(getLocalIndex(issuer), issuer);
  let remote = null as BoardsIndexDoc | null;
  try {
    const net = await loadBoardsIndex(issuer);
    remote = normalizeIndexDoc(net, issuer);
  } catch {}
  const merged = mergeIndices(local, remote);
  if (merged) setLocalIndex(issuer, merged);
  return merged;
}

export async function saveBoardsIndexWriteThrough(issuer: string, next: BoardsIndexDoc) {
  const fixed = normalizeIndexDoc(next, issuer)!; // force correct issuer
  setLocalIndex(issuer, fixed);
  try {
    await saveBoardsIndex(issuer, fixed);
  } catch (e) {
    console.warn('saveBoardsIndex failed', e);
  }
}
