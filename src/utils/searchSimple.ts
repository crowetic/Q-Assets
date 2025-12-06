// utils/qdnSearchSimple.ts
import { memoizeAsync } from './cache';
export interface SimpleHit {
  name: string;
  service: string;
  identifier: string;
  size: number;
  created: number;
  updated?: number;
}

// Coerce QDN searchsimple responses into a consistent array shape
const normalizeHits = (data: any): SimpleHit[] => {
  if (Array.isArray(data)) return data as SimpleHit[];
  if (data && typeof data === 'object') return [data as SimpleHit];
  return [];
};

/**
 * Fetches:
 * /arbitrary/resources/searchsimple?service=DOCUMENT&identifier=<prefix>&prefix=true&limit=0
 */
export const searchSimpleByIdentifierPrefix = memoizeAsync(
  async (service: string, identifierPrefix: string, limit?: number): Promise<SimpleHit[]> => {
    const url = `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
      service
    )}&identifier=${encodeURIComponent(identifierPrefix)}&prefix=true&limit=${encodeURIComponent(
      limit || 0
    )}`;

    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        console.warn(`searchsimple failed: ${res.status} ${res.statusText}`);
        return [];
      }
      const data = await res.json();
      return normalizeHits(data);
    } catch (e) {
      console.warn('searchSimpleByIdentifierPrefix error', e);
      return [];
    }
  },
  {
    ttlMs: 60_000,
    keyFn: (service, prefix, limit) => `searchsimple:${service}:${prefix}:${limit || 0}`,
  }
);

export async function searchSimpleByIdPrefixOnly(
  identifierPrefix: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const service = isPrivate ? 'DOCUMENT_PRIVATE' : 'DOCUMENT';

  const url = `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
    service
  )}&identifier=${encodeURIComponent(identifierPrefix)}&prefix=true&limit=0`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(`searchsimple failed: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    return normalizeHits(data);
  } catch (e) {
    console.warn('searchSimpleByIdPrefixOnly error', e);
    return [];
  }
}

export async function searchSimpleNameIdPrefix(
  identifierPrefix: string,
  name: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const service = isPrivate ? 'DOCUMENT_PRIVATE' : 'DOCUMENT';

  const url = `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
    service
  )}&identifier=${encodeURIComponent(
    identifierPrefix
  )}&name=${encodeURIComponent(name)}&caseInsensitive=true&prefix=true&limit=0`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(`searchsimple failed: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    return normalizeHits(data);
  } catch (e) {
    console.warn('searchSimpleNameIdPrefix error', e);
    return [];
  }
}

export async function searchSimpleByFullId(
  identifier: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const service = isPrivate ? 'DOCUMENT_PRIVATE' : 'DOCUMENT';

  const url = `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
    service
  )}&identifier=${encodeURIComponent(identifier)}&limit=0`;

  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: { accept: 'application/json' },
    });

    if (!res.ok) {
      console.warn(`searchsimple failed: ${res.status} ${res.statusText}`);
      return [];
    }

    const data = await res.json();
    return normalizeHits(data);
  } catch (e) {
    console.warn('searchSimpleByFullId error', e);
    return [];
  }
}
