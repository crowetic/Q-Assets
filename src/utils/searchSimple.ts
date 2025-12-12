// utils/qdnSearchSimple.ts
import type { Service } from 'qapp-core';
import { getGroupResourceServices } from './groupEncryption';

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

const dedupeHits = (hits: SimpleHit[]): SimpleHit[] => {
  const byResource = new Map<string, SimpleHit>();

  const normalizedName = (name?: string) => (name || '').toLowerCase();
  const getStamp = (hit: SimpleHit) =>
    Number.isFinite(hit.updated) ? Number(hit.updated) : Number(hit.created) || 0;
  const prioritize = (next: SimpleHit, current: SimpleHit) => {
    const nextTs = getStamp(next);
    const currentTs = getStamp(current);
    if (nextTs !== currentTs) return nextTs > currentTs;
    const nextSvc = (next.service || '').toUpperCase();
    const currentSvc = (current.service || '').toUpperCase();
    if (currentSvc === 'DOCUMENT' && nextSvc !== 'DOCUMENT') return false;
    if (nextSvc === 'DOCUMENT' && currentSvc !== 'DOCUMENT') return true;
    return false;
  };

  for (const hit of hits) {
    const key = `${normalizedName(hit.name)}::${hit.identifier}`;
    const existing = byResource.get(key);
    if (!existing || prioritize(hit, existing)) {
      byResource.set(key, hit);
    }
  }
  return Array.from(byResource.values());
};

const toServiceArray = (service: string | string[]): string[] => {
  if (Array.isArray(service)) return Array.from(new Set(service));
  return [service];
};

async function fetchSearchSimple(url: string): Promise<SimpleHit[]> {
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
    console.warn('searchSimple request failed', e);
    return [];
  }
}

/**
 * Fetches:
 * /arbitrary/resources/searchsimple?service=DOCUMENT&identifier=<prefix>&prefix=true&limit=0
 */
export async function searchSimpleByIdentifierPrefix(
  service: string | string[],
  identifierPrefix: string,
  limit?: number
): Promise<SimpleHit[]> {
  const services = toServiceArray(service);
  const results = await Promise.all(
    services.map((svc) =>
      fetchSearchSimple(
        `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
          svc
        )}&identifier=${encodeURIComponent(
          identifierPrefix
        )}&prefix=true&limit=${encodeURIComponent(limit || 0)}`
      )
    )
  );
  return dedupeHits(results.flat());
}

export async function searchSimpleByIdPrefixOnly(
  identifierPrefix: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const services = isPrivate ? await getGroupResourceServices() : (['DOCUMENT'] as Service[]);
  const results = await Promise.all(
    services.map((svc) =>
      fetchSearchSimple(
        `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
          svc
        )}&identifier=${encodeURIComponent(identifierPrefix)}&prefix=true&limit=0`
      )
    )
  );
  return dedupeHits(results.flat());
}

export async function searchSimpleNameIdPrefix(
  identifierPrefix: string,
  name: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const services = isPrivate ? await getGroupResourceServices() : (['DOCUMENT'] as Service[]);
  const results = await Promise.all(
    services.map((svc) =>
      fetchSearchSimple(
        `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
          svc
        )}&identifier=${encodeURIComponent(
          identifierPrefix
        )}&name=${encodeURIComponent(
          name
        )}&caseInsensitive=true&prefix=true&limit=0`
      )
    )
  );
  return dedupeHits(results.flat());
}

export async function searchSimpleByFullId(
  identifier: string,
  isPrivate?: boolean
): Promise<SimpleHit[]> {
  const services = isPrivate ? await getGroupResourceServices() : (['DOCUMENT'] as Service[]);
  const results = await Promise.all(
    services.map((svc) =>
      fetchSearchSimple(
        `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
          svc
        )}&identifier=${encodeURIComponent(identifier)}&limit=0`
      )
    )
  );
  return dedupeHits(results.flat());
}
