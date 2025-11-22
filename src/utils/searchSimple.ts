// utils/qdnSearchSimple.ts
export interface SimpleHit {
  name: string;
  service: string;
  identifier: string;
  size: number;
  created: number;
  updated?: number;
}

/**
 * Fetches:
 * /arbitrary/resources/searchsimple?service=DOCUMENT&identifier=<prefix>&prefix=true&limit=0
 */
export async function searchSimpleByIdentifierPrefix(
  service: string,
  identifierPrefix: string
): Promise<SimpleHit[]> {
  const url = `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
    service
  )}&identifier=${encodeURIComponent(identifierPrefix)}&prefix=true&limit=0`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`searchsimple failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as SimpleHit[]) : [];
}

export async function searchSimpleByIdPrefixOnly(
  identifierPrefix: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const service = isPrivate ? 'DOCUMENT_PRIVATE' : 'DOCUMENT';

  const url = `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
    service
  )}&identifier=${encodeURIComponent(identifierPrefix)}&prefix=true&limit=0`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`searchsimple failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as SimpleHit[]) : [];
}

export async function searchSimpleNameIdPrefix(
  identifierPrefix: string,
  name: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const service = isPrivate ? 'DOCUMENT_PRIVATE' : 'DOCUMENT';

  const url = `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
    service
  )}&identifier=${encodeURIComponent(identifierPrefix)}&name=${encodeURIComponent(name)}&caseInsensitive=true&prefix=true&limit=0`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`searchsimple failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as SimpleHit[]) : [];
}

export async function searchSimpleByFullId(
  identifier: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const service = isPrivate ? 'DOCUMENT_PRIVATE' : 'DOCUMENT';

  const url = `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
    service
  )}&identifier=${encodeURIComponent(identifier)}&limit=0`;

  const res = await fetch(url, {
    method: 'GET',
    headers: { accept: 'application/json' },
  });

  if (!res.ok) {
    throw new Error(`searchsimple failed: ${res.status} ${res.statusText}`);
  }

  const data = await res.json();
  return Array.isArray(data) ? (data as SimpleHit[]) : [];
}
