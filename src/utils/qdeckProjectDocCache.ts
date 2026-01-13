import type { QDeckProject } from '../types/qdeck';

const CACHE_TTL_MS = 15 * 60 * 1000;
const STORAGE_PREFIX = 'qdeck.project.doc:';

type Stored = {
  cachedAt: number;
  doc: QDeckProject;
};

const keyFor = (issuerName: string, projectId: string) =>
  `${STORAGE_PREFIX}${issuerName}:${projectId}`;

const isValidDoc = (doc: any, projectId: string): doc is QDeckProject => {
  if (!doc || typeof doc !== 'object') return false;
  if (doc._type !== 'QDECK_PROJECT') return false;
  if (doc.projectId !== projectId) return false;
  return true;
};

export function getLocalProjectDoc(issuerName: string, projectId: string): QDeckProject | null {
  if (!issuerName || !projectId || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(keyFor(issuerName, projectId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Stored;
    if (!parsed || typeof parsed.cachedAt !== 'number' || !parsed.doc) return null;
    if (Date.now() - parsed.cachedAt > CACHE_TTL_MS) {
      window.localStorage.removeItem(keyFor(issuerName, projectId));
      return null;
    }
    if (!isValidDoc(parsed.doc, projectId)) return null;
    return parsed.doc;
  } catch {
    return null;
  }
}

export function setLocalProjectDoc(issuerName: string, doc: QDeckProject) {
  if (!issuerName || typeof window === 'undefined') return;
  if (!doc?.projectId) return;
  if (!isValidDoc(doc, doc.projectId)) return;
  try {
    const payload: Stored = { cachedAt: Date.now(), doc };
    window.localStorage.setItem(keyFor(issuerName, doc.projectId), JSON.stringify(payload));
  } catch {
    /* ignore */
  }
}
