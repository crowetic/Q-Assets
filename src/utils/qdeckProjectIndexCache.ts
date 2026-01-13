import type { ProjectsIndexDoc } from '../types/qdeck';
import { mergeIndexDocs } from './qdeckIndexCache';
import { loadProjectsIndex, saveProjectsIndex } from './qdeckApi';

const STORAGE_PREFIX = 'qdeck.projects.index:';

const keyFor = (issuerName: string) => `${STORAGE_PREFIX}${issuerName}`;

export function normalizeProjectIndexDoc(
  doc: ProjectsIndexDoc | null,
  expectedIssuer?: string
): ProjectsIndexDoc | null {
  if (!doc) return null;
  const issuerName =
    doc.issuerName && doc.issuerName.trim() ? doc.issuerName.trim() : (expectedIssuer ?? '');
  return {
    _type: 'QDECK_PROJECTS_INDEX',
    version: 1 as const,
    issuerName,
    projects: (doc.projects ?? []).map((row) => ({
      projectId: String(row.projectId),
      title: String(row.title ?? ''),
      createdAt: Number(row.createdAt ?? 0),
      updatedAt: Number(row.updatedAt ?? 0),
      visibility: row.visibility === 'private' ? 'private' : 'public',
      service: row.service === 'DOCUMENT_PRIVATE' ? 'DOCUMENT_PRIVATE' : 'DOCUMENT',
      mode: row.mode === 'direct' ? 'direct' : 'group',
    })),
    updatedAt: Number(doc.updatedAt ?? Date.now()),
    seq: Number(doc.seq ?? 0),
  };
}

export function getLocalProjectsIndex(issuerName: string): ProjectsIndexDoc | null {
  if (!issuerName || typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(keyFor(issuerName));
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?._type === 'QDECK_PROJECTS_INDEX') return parsed;
  } catch {
    return null;
  }
  return null;
}

export function setLocalProjectsIndex(issuerName: string, doc: ProjectsIndexDoc) {
  if (!issuerName || typeof window === 'undefined') return;
  if (doc?._type !== 'QDECK_PROJECTS_INDEX') return;
  try {
    window.localStorage.setItem(keyFor(issuerName), JSON.stringify(doc));
  } catch {
    /* ignore */
  }
}

export function mergeProjectIndices(
  a?: ProjectsIndexDoc | null,
  b?: ProjectsIndexDoc | null
): ProjectsIndexDoc | null {
  return mergeIndexDocs(a as any, b as any, {
    itemsKey: 'projects',
    idKey: 'projectId',
    updatedKey: 'updatedAt',
  }) as ProjectsIndexDoc | null;
}

export async function loadProjectsIndexMerged(issuer: string): Promise<ProjectsIndexDoc | null> {
  const local = normalizeProjectIndexDoc(getLocalProjectsIndex(issuer), issuer);
  let remote = null as ProjectsIndexDoc | null;
  try {
    const net = await loadProjectsIndex(issuer);
    remote = normalizeProjectIndexDoc(net, issuer);
  } catch {
    /* empty */
  }
  const merged = mergeProjectIndices(local, remote);
  if (merged) setLocalProjectsIndex(issuer, merged);
  return merged;
}

export async function saveProjectsIndexWriteThrough(issuer: string, next: ProjectsIndexDoc) {
  const fixed = normalizeProjectIndexDoc(next, issuer)!;
  setLocalProjectsIndex(issuer, fixed);
  try {
    await saveProjectsIndex(issuer, fixed);
  } catch (e) {
    console.warn('saveProjectsIndex failed', e);
  }
  return fixed;
}
