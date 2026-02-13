// utils/qdnSearchSimple.ts
import type { Service } from 'qapp-core';
import pLimit from 'p-limit';
import { getGroupResourceServices, LEGACY_GROUP_ENCRYPTION_SERVICE } from './groupEncryption';

export interface SimpleHit {
  name: string;
  service: Service;
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

const SEARCH_SIMPLE_TTL_MS = 12_000;
const SEARCH_SIMPLE_ERROR_TTL_MS = 3_000;
const SEARCH_SIMPLE_MAX_CONCURRENCY = 4;
const searchSimpleLimiter = pLimit(SEARCH_SIMPLE_MAX_CONCURRENCY);
const searchSimpleCache = new Map<string, { expiresAt: number; hits: SimpleHit[] }>();
const searchSimpleInFlight = new Map<string, Promise<SimpleHit[]>>();

const getCachedSearchSimple = (url: string): SimpleHit[] | null => {
  const hit = searchSimpleCache.get(url);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    searchSimpleCache.delete(url);
    return null;
  }
  return hit.hits;
};

const setCachedSearchSimple = (url: string, hits: SimpleHit[], ttlMs: number) => {
  searchSimpleCache.set(url, {
    expiresAt: Date.now() + ttlMs,
    hits,
  });
};

async function resolveSearchServices(
  isPrivate?: boolean,
  servicesOverride?: string | string[]
): Promise<string[]> {
  if (servicesOverride) return toServiceArray(servicesOverride);
  if (!isPrivate) return ['DOCUMENT'];
  const services = new Set<string>(await getGroupResourceServices());
  services.add(LEGACY_GROUP_ENCRYPTION_SERVICE);
  return Array.from(services);
}

async function fetchSearchSimple(url: string): Promise<SimpleHit[]> {
  const cached = getCachedSearchSimple(url);
  if (cached) return cached;
  const inFlight = searchSimpleInFlight.get(url);
  if (inFlight) return inFlight;

  const request = searchSimpleLimiter(async () => {
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: { accept: 'application/json' },
      });
      if (!res.ok) {
        console.warn(`searchsimple failed: ${res.status} ${res.statusText}`);
        setCachedSearchSimple(url, [], SEARCH_SIMPLE_ERROR_TTL_MS);
        return [];
      }
      const data = await res.json();
      const hits = normalizeHits(data);
      setCachedSearchSimple(url, hits, SEARCH_SIMPLE_TTL_MS);
      return hits;
    } catch (e) {
      console.warn('searchSimple request failed', e);
      setCachedSearchSimple(url, [], SEARCH_SIMPLE_ERROR_TTL_MS);
      return [];
    } finally {
      searchSimpleInFlight.delete(url);
    }
  });

  searchSimpleInFlight.set(url, request);

  try {
    return await request;
  } catch {
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
  isPrivate?: boolean,
  servicesOverride?: string | string[]
): Promise<SimpleHit[]> {
  const services = (await resolveSearchServices(isPrivate, servicesOverride)) as Service[];
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
  isPrivate?: boolean,
  servicesOverride?: string | string[]
): Promise<SimpleHit[]> {
  const services = (await resolveSearchServices(isPrivate, servicesOverride)) as Service[];
  const results = await Promise.all(
    services.map((svc) =>
      fetchSearchSimple(
        `/arbitrary/resources/searchsimple?service=${encodeURIComponent(
          svc
        )}&identifier=${encodeURIComponent(identifierPrefix)}&name=${encodeURIComponent(
          name
        )}&caseInsensitive=true&prefix=true&limit=0`
      )
    )
  );
  return dedupeHits(results.flat());
}

export async function searchSimpleByFullId(
  identifier: string,
  isPrivate?: boolean,
  servicesOverride?: string | string[]
): Promise<SimpleHit[]> {
  const services = (await resolveSearchServices(isPrivate, servicesOverride)) as Service[];
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
