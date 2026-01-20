import type { Service } from 'qapp-core';
import {
  XQLORE_APP_INDEX_HEAD_ID,
  XQLORE_APP_INDEX_PREFIX,
  XQLORE_APP_INDEX_WHITELIST_ID,
  XQLORE_TX_INDEX_HEAD_ID,
  XQLORE_TX_INDEX_PREFIX,
} from '../constants/qdnConstants';
import { base64ToObject, objectToBase64 } from './data';
import {
  searchSimpleByFullId,
  searchSimpleByIdentifierPrefix,
  type SimpleHit,
} from './searchSimple';
import { listManagementGroupNames } from './access';
import { getTransactionInfoBySignature } from './qortalApi';

export type XqlorePublisher = {
  name?: string;
  address?: string;
};

export type XqloreTxIndexEntry = {
  signature: string;
  timestamp: number;
  type: string;
  blockHeight?: number;
  txGroupId?: number;
  creatorAddress?: string;
  creatorName?: string;
  recipient?: string;
  amount?: number;
  fee?: number;
  assetId?: number;
  service?: string;
  identifier?: string;
  tx?: Record<string, any>;
};

export type XqloreTxIndex = {
  version: number;
  createdAt: number;
  updatedAt: number;
  publisher?: XqlorePublisher;
  blockStart: number;
  blockEnd: number;
  blockCount: number;
  entryCount: number;
  entries: XqloreTxIndexEntry[];
};

export type XqloreTxIndexHead = {
  version: number;
  updatedAt: number;
  publisher?: XqlorePublisher;
  latestIdentifier: string;
  blockStart: number;
  blockEnd: number;
  entryCount: number;
};

export type XqloreTxIndexValidation = {
  ok: boolean;
  errors: string[];
  warnings: string[];
  checkedSignatures: string[];
};

export type XqloreAppRegistryEntry = {
  name: string;
  label?: string;
  description?: string;
  iconUrl?: string;
  website?: string;
  prefixes: string[];
  identifiers?: string[];
  tags?: string[];
  updatedAt?: number;
};

export type XqloreAppIndex = {
  version: number;
  updatedAt: number;
  publisher?: XqlorePublisher;
  apps: XqloreAppRegistryEntry[];
};

export type XqloreAppIndexHead = {
  version: number;
  updatedAt: number;
  publisher?: XqlorePublisher;
  latestIdentifier: string;
  appCount: number;
};

export type XqloreAppIndexWhitelist = {
  version: number;
  updatedAt: number;
  publishers: string[];
};

const toTimestamp = (hit: SimpleHit) => Number(hit.updated ?? hit.created ?? 0) || 0;

const coerceObject = (value: unknown) =>
  value && typeof value === 'object' ? (value as Record<string, any>) : null;

const normalizePublisher = (raw: any): XqlorePublisher | undefined => {
  const obj = coerceObject(raw);
  if (!obj) return undefined;
  const name = typeof obj.name === 'string' ? obj.name.trim() : undefined;
  const address = typeof obj.address === 'string' ? obj.address.trim() : undefined;
  if (!name && !address) return undefined;
  return { name, address };
};

const normalizeTxIndexEntry = (raw: any): XqloreTxIndexEntry | null => {
  if (!raw || typeof raw !== 'object') return null;
  const rawTx = raw.tx && typeof raw.tx === 'object' ? (raw.tx as Record<string, any>) : null;
  const signature = typeof raw.signature === 'string' ? raw.signature.trim() : '';
  if (!signature) return null;
  const entry: XqloreTxIndexEntry = {
    signature,
    timestamp: Number(raw.timestamp) || 0,
    type: typeof raw.type === 'string' ? raw.type : 'UNKNOWN',
  };
  const optNum = (value: any) => (Number.isFinite(Number(value)) ? Number(value) : undefined);
  const optStr = (value: any) =>
    typeof value === 'string' && value.trim() ? value.trim() : undefined;
  entry.blockHeight = optNum(raw.blockHeight ?? rawTx?.blockHeight ?? rawTx?.height);
  entry.txGroupId = optNum(raw.txGroupId ?? rawTx?.txGroupId ?? rawTx?.groupId);
  entry.creatorAddress = optStr(
    raw.creatorAddress ?? rawTx?.creatorAddress ?? rawTx?.creator ?? rawTx?.sender
  );
  entry.creatorName = optStr(raw.creatorName ?? rawTx?.creatorName);
  entry.recipient = optStr(raw.recipient ?? rawTx?.recipient ?? rawTx?.recipientAddress);
  entry.amount = optNum(raw.amount ?? rawTx?.amount ?? rawTx?.amountAsset ?? rawTx?.total);
  entry.fee = optNum(raw.fee ?? rawTx?.fee ?? rawTx?.feeAmount);
  entry.assetId = optNum(raw.assetId ?? rawTx?.assetId);
  entry.service = optStr(raw.service ?? rawTx?.service ?? rawTx?.data?.service);
  entry.identifier = optStr(raw.identifier ?? rawTx?.identifier ?? rawTx?.data?.identifier);
  if (rawTx) entry.tx = rawTx;
  if (!entry.timestamp && rawTx?.timestamp != null) {
    entry.timestamp = Number(rawTx.timestamp) || entry.timestamp;
  }
  if (entry.type === 'UNKNOWN' && rawTx?.type) {
    entry.type = String(rawTx.type);
  }
  return entry;
};

const normalizeTxIndex = (raw: any): XqloreTxIndex | null => {
  const obj = coerceObject(raw);
  if (!obj) return null;
  const entries = Array.isArray(obj.entries)
    ? (obj.entries.map(normalizeTxIndexEntry).filter(Boolean) as XqloreTxIndexEntry[])
    : [];
  const blockStart = Number(obj.blockStart);
  const blockEnd = Number(obj.blockEnd);
  if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
  return {
    version: Number(obj.version) || 1,
    createdAt: Number(obj.createdAt) || Date.now(),
    updatedAt: Number(obj.updatedAt) || Number(obj.createdAt) || Date.now(),
    publisher: normalizePublisher(obj.publisher),
    blockStart,
    blockEnd,
    blockCount: Number(obj.blockCount) || Math.max(0, blockEnd - blockStart + 1),
    entryCount: Number(obj.entryCount) || entries.length,
    entries,
  };
};

const normalizeTxIndexHead = (raw: any): XqloreTxIndexHead | null => {
  const obj = coerceObject(raw);
  if (!obj) return null;
  const latestIdentifier = typeof obj.latestIdentifier === 'string' ? obj.latestIdentifier : '';
  const blockStart = Number(obj.blockStart);
  const blockEnd = Number(obj.blockEnd);
  if (!latestIdentifier || !Number.isFinite(blockStart) || !Number.isFinite(blockEnd)) return null;
  return {
    version: Number(obj.version) || 1,
    updatedAt: Number(obj.updatedAt) || Date.now(),
    publisher: normalizePublisher(obj.publisher),
    latestIdentifier,
    blockStart,
    blockEnd,
    entryCount: Number(obj.entryCount) || 0,
  };
};

const normalizeAppEntry = (raw: any): XqloreAppRegistryEntry | null => {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;
  const listOf = (value: any) =>
    Array.isArray(value)
      ? value.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
      : [];
  const prefixes = listOf(raw.prefixes);
  const identifiers = listOf(raw.identifiers);
  const tags = listOf(raw.tags);
  const entry: XqloreAppRegistryEntry = {
    name,
    label: typeof raw.label === 'string' ? raw.label.trim() : undefined,
    description: typeof raw.description === 'string' ? raw.description.trim() : undefined,
    iconUrl: typeof raw.iconUrl === 'string' ? raw.iconUrl.trim() : undefined,
    website: typeof raw.website === 'string' ? raw.website.trim() : undefined,
    prefixes,
    identifiers: identifiers.length ? identifiers : undefined,
    tags: tags.length ? tags : undefined,
    updatedAt: Number(raw.updatedAt) || undefined,
  };
  return entry;
};

const normalizeAppIndex = (raw: any): XqloreAppIndex | null => {
  const obj = coerceObject(raw);
  if (!obj) return null;
  const apps = Array.isArray(obj.apps)
    ? (obj.apps.map(normalizeAppEntry).filter(Boolean) as XqloreAppRegistryEntry[])
    : [];
  return {
    version: Number(obj.version) || 1,
    updatedAt: Number(obj.updatedAt) || Date.now(),
    publisher: normalizePublisher(obj.publisher),
    apps,
  };
};

const normalizeAppIndexHead = (raw: any): XqloreAppIndexHead | null => {
  const obj = coerceObject(raw);
  if (!obj) return null;
  const latestIdentifier = typeof obj.latestIdentifier === 'string' ? obj.latestIdentifier : '';
  if (!latestIdentifier) return null;
  return {
    version: Number(obj.version) || 1,
    updatedAt: Number(obj.updatedAt) || Date.now(),
    publisher: normalizePublisher(obj.publisher),
    latestIdentifier,
    appCount: Number(obj.appCount) || 0,
  };
};

const normalizeAppWhitelist = (raw: any): XqloreAppIndexWhitelist => {
  const obj = coerceObject(raw);
  const publishers = Array.isArray(obj?.publishers)
    ? obj.publishers.map((item) => (typeof item === 'string' ? item.trim() : '')).filter(Boolean)
    : [];
  return {
    version: Number(obj?.version) || 1,
    updatedAt: Number(obj?.updatedAt) || Date.now(),
    publishers,
  };
};

async function fetchQdnJson(hit: SimpleHit): Promise<any | null> {
  if (!hit.name || !hit.identifier) return null;
  try {
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      name: hit.name,
      service: hit.service ?? ('DOCUMENT' as Service),
      identifier: hit.identifier,
    });
    if (typeof res === 'string') {
      return JSON.parse(res);
    }
    return res;
  } catch (err) {
    console.warn('Xqlore index fetch failed', err);
    return null;
  }
}

export function buildTxIndexIdentifier(blockStart: number, blockEnd: number) {
  const stamp = Date.now().toString(36);
  return `${XQLORE_TX_INDEX_PREFIX}${blockStart}__${blockEnd}__${stamp}`;
}

export function buildAppIndexIdentifier() {
  const stamp = Date.now().toString(36);
  return `${XQLORE_APP_INDEX_PREFIX}${stamp}`;
}

export async function fetchLatestTxIndexHead(): Promise<XqloreTxIndexHead | null> {
  const hits = await searchSimpleByFullId(XQLORE_TX_INDEX_HEAD_ID, false);
  if (!hits.length) return null;
  const sorted = hits.slice().sort((a, b) => toTimestamp(b) - toTimestamp(a));
  const best = sorted[0];
  const doc = await fetchQdnJson(best);
  return normalizeTxIndexHead(doc);
}

export async function fetchLatestTxIndex(): Promise<{
  head: XqloreTxIndexHead | null;
  index: XqloreTxIndex | null;
}> {
  const head = await fetchLatestTxIndexHead();
  if (head?.latestIdentifier) {
    const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', head.latestIdentifier, 0);
    const hit = hits.find((item) => item.identifier === head.latestIdentifier) ?? hits[0];
    if (!hit) return { head, index: null };
    const doc = await fetchQdnJson(hit);
    return { head, index: normalizeTxIndex(doc) };
  }

  const fallbackHits = await fetchTxIndexCandidates(1);
  if (!fallbackHits.length) return { head, index: null };
  const doc = await fetchQdnJson(fallbackHits[0]);
  return { head, index: normalizeTxIndex(doc) };
}

export async function fetchTxIndexCandidates(limit = 20): Promise<SimpleHit[]> {
  const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', XQLORE_TX_INDEX_PREFIX, limit);
  return hits.sort((a, b) => toTimestamp(b) - toTimestamp(a)).slice(0, limit);
}

export async function fetchLatestAppIndexHead(
  allowedPublishers?: string[]
): Promise<XqloreAppIndexHead | null> {
  const hits = await searchSimpleByFullId(XQLORE_APP_INDEX_HEAD_ID, false);
  if (!hits.length) return null;
  const allowed = new Set((allowedPublishers || []).map((p) => p.toLowerCase()));
  const pick = (list: SimpleHit[]) =>
    list.slice().sort((a, b) => toTimestamp(b) - toTimestamp(a))[0];
  const preferred = allowed.size
    ? hits.filter((hit) => allowed.has(String(hit.name || '').toLowerCase()))
    : [];
  const best = preferred.length ? pick(preferred) : pick(hits);
  const doc = await fetchQdnJson(best);
  return normalizeAppIndexHead(doc);
}

export async function fetchLatestAppIndex(allowedPublishers?: string[]): Promise<{
  head: XqloreAppIndexHead | null;
  index: XqloreAppIndex | null;
}> {
  const head = await fetchLatestAppIndexHead(allowedPublishers);
  if (head?.latestIdentifier) {
    const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', head.latestIdentifier, 0);
    const hit = hits.find((item) => item.identifier === head.latestIdentifier) ?? hits[0];
    if (!hit) return { head, index: null };
    const doc = await fetchQdnJson(hit);
    return { head, index: normalizeAppIndex(doc) };
  }

  const fallbackHits = await fetchAppIndexCandidates(1);
  if (!fallbackHits.length) return { head, index: null };
  const doc = await fetchQdnJson(fallbackHits[0]);
  return { head, index: normalizeAppIndex(doc) };
}

export async function fetchAppIndexCandidates(limit = 20): Promise<SimpleHit[]> {
  const hits = await searchSimpleByIdentifierPrefix('DOCUMENT', XQLORE_APP_INDEX_PREFIX, limit);
  return hits.sort((a, b) => toTimestamp(b) - toTimestamp(a)).slice(0, limit);
}

export async function fetchAppIndexWhitelist(): Promise<XqloreAppIndexWhitelist> {
  const hits = await searchSimpleByFullId(XQLORE_APP_INDEX_WHITELIST_ID, false);
  if (!hits.length) {
    return { version: 1, updatedAt: Date.now(), publishers: [] };
  }
  const sorted = hits.slice().sort((a, b) => toTimestamp(b) - toTimestamp(a));
  const doc = await fetchQdnJson(sorted[0]);
  return normalizeAppWhitelist(doc);
}

export async function resolveAllowedAppIndexPublishers(): Promise<string[]> {
  const [groupNames, whitelist] = await Promise.all([
    listManagementGroupNames(),
    fetchAppIndexWhitelist(),
  ]);
  const allowed = new Set<string>();
  groupNames.forEach((row) => allowed.add(row.name.trim()));
  whitelist.publishers.forEach((name) => allowed.add(name.trim()));
  return Array.from(allowed).filter(Boolean);
}

export async function buildAppIndexPublishResources(params: {
  publisherName: string;
  publisherAddress?: string;
  apps: XqloreAppRegistryEntry[];
}): Promise<
  Array<{
    name: string;
    service: Service;
    identifier: string;
    base64: string;
  }>
> {
  const { publisherName, publisherAddress, apps } = params;
  const now = Date.now();
  const identifier = buildAppIndexIdentifier();
  const payload: XqloreAppIndex = {
    version: 1,
    updatedAt: now,
    publisher: { name: publisherName, address: publisherAddress },
    apps,
  };
  const head: XqloreAppIndexHead = {
    version: 1,
    updatedAt: now,
    publisher: { name: publisherName, address: publisherAddress },
    latestIdentifier: identifier,
    appCount: apps.length,
  };
  const [body64, head64] = await Promise.all([objectToBase64(payload), objectToBase64(head)]);
  return [
    {
      name: publisherName,
      service: 'DOCUMENT',
      identifier,
      base64: body64,
    },
    {
      name: publisherName,
      service: 'DOCUMENT',
      identifier: XQLORE_APP_INDEX_HEAD_ID,
      base64: head64,
    },
  ];
}

export async function buildAppIndexHeadResource(params: {
  publisherName: string;
  publisherAddress?: string;
  latestIdentifier: string;
  appCount: number;
}): Promise<{ name: string; service: Service; identifier: string; base64: string }> {
  const payload: XqloreAppIndexHead = {
    version: 1,
    updatedAt: Date.now(),
    publisher: { name: params.publisherName, address: params.publisherAddress },
    latestIdentifier: params.latestIdentifier,
    appCount: params.appCount,
  };
  return {
    name: params.publisherName,
    service: 'DOCUMENT',
    identifier: XQLORE_APP_INDEX_HEAD_ID,
    base64: await objectToBase64(payload),
  };
}

export async function buildAppWhitelistPublishResource(params: {
  publisherName: string;
  publishers: string[];
}): Promise<{ name: string; service: Service; identifier: string; base64: string }> {
  const payload: XqloreAppIndexWhitelist = {
    version: 1,
    updatedAt: Date.now(),
    publishers: Array.from(new Set(params.publishers.map((p) => p.trim()))).filter(Boolean),
  };
  return {
    name: params.publisherName,
    service: 'DOCUMENT',
    identifier: XQLORE_APP_INDEX_WHITELIST_ID,
    base64: await objectToBase64(payload),
  };
}

export async function fetchAppIndexDoc(hit: SimpleHit): Promise<XqloreAppIndex | null> {
  const doc = await fetchQdnJson(hit);
  return normalizeAppIndex(doc);
}

export async function fetchTxIndexDoc(hit: SimpleHit): Promise<XqloreTxIndex | null> {
  const doc = await fetchQdnJson(hit);
  return normalizeTxIndex(doc);
}

export function decodeIndexPayload(base64: string) {
  return base64ToObject(base64);
}

export async function buildTxIndexPublishResources(params: {
  publisherName: string;
  publisherAddress?: string;
  blockStart: number;
  blockEnd: number;
  entries: XqloreTxIndexEntry[];
}): Promise<Array<{ name: string; service: Service; identifier: string; base64: string }>> {
  const { publisherName, publisherAddress, blockStart, blockEnd, entries } = params;
  const now = Date.now();
  const identifier = buildTxIndexIdentifier(blockStart, blockEnd);
  const payload: XqloreTxIndex = {
    version: 1,
    createdAt: now,
    updatedAt: now,
    publisher: { name: publisherName, address: publisherAddress },
    blockStart,
    blockEnd,
    blockCount: Math.max(0, blockEnd - blockStart + 1),
    entryCount: entries.length,
    entries,
  };
  const head: XqloreTxIndexHead = {
    version: 1,
    updatedAt: now,
    publisher: { name: publisherName, address: publisherAddress },
    latestIdentifier: identifier,
    blockStart,
    blockEnd,
    entryCount: entries.length,
  };
  const [body64, head64] = await Promise.all([objectToBase64(payload), objectToBase64(head)]);
  return [
    {
      name: publisherName,
      service: 'DOCUMENT',
      identifier,
      base64: body64,
    },
    {
      name: publisherName,
      service: 'DOCUMENT',
      identifier: XQLORE_TX_INDEX_HEAD_ID,
      base64: head64,
    },
  ];
}

const normalizeSig = (value: unknown) => (typeof value === 'string' ? value.trim() : '');

export async function validateTxIndexEntries(params: {
  blockStart: number;
  blockEnd: number;
  entries: XqloreTxIndexEntry[];
  sampleSize?: number;
}): Promise<XqloreTxIndexValidation> {
  const { blockStart, blockEnd, entries } = params;
  const sampleSize = Math.max(1, params.sampleSize ?? 5);
  const errors: string[] = [];
  const warnings: string[] = [];

  if (!Number.isFinite(blockStart) || !Number.isFinite(blockEnd) || blockStart > blockEnd) {
    errors.push('Invalid block range.');
  }

  const signatures = new Set<string>();
  let minHeight = Number.POSITIVE_INFINITY;
  let maxHeight = 0;
  let lastHeight = 0;
  let hasUnsortedHeights = false;

  entries.forEach((entry) => {
    const sig = normalizeSig(entry.signature);
    if (!sig) return;
    if (signatures.has(sig)) errors.push(`Duplicate signature detected: ${sig}`);
    signatures.add(sig);
    const height = Number(entry.blockHeight ?? 0);
    if (Number.isFinite(height) && height > 0) {
      minHeight = Math.min(minHeight, height);
      maxHeight = Math.max(maxHeight, height);
      if (lastHeight && height < lastHeight) hasUnsortedHeights = true;
      lastHeight = height;
    }
  });

  if (entries.length === 0) {
    warnings.push('No transactions returned for this block range.');
  }

  if (Number.isFinite(minHeight) && minHeight < blockStart) {
    errors.push(`Entry block height ${minHeight} is before start block ${blockStart}.`);
  }
  if (maxHeight > blockEnd) {
    errors.push(`Entry block height ${maxHeight} exceeds end block ${blockEnd}.`);
  }
  if (hasUnsortedHeights) {
    warnings.push('Transaction heights are not sorted; consider sorting before publish.');
  }

  const sigArray = Array.from(signatures);
  if (!sigArray.length) {
    errors.push('No signatures available for validation.');
  }

  const sampled: string[] = [];
  for (let i = 0; i < Math.min(sampleSize, sigArray.length); i += 1) {
    const idx = Math.floor(Math.random() * sigArray.length);
    sampled.push(sigArray[idx]);
  }

  for (const sig of sampled) {
    try {
      const tx = await getTransactionInfoBySignature(sig);
      if (!tx) {
        warnings.push(`Signature ${sig} could not be resolved.`);
        continue;
      }
      const match = entries.find((entry) => normalizeSig(entry.signature) === sig);
      if (!match) {
        errors.push(`Signature ${sig} missing from index entries.`);
        continue;
      }
      const expectedType = String(match.type || '').toUpperCase();
      const actualType = String((tx as any)?.type || '').toUpperCase();
      if (expectedType && actualType && expectedType !== actualType) {
        errors.push(`Type mismatch for ${sig}: ${expectedType} vs ${actualType}.`);
      }
      const expectedHeight = Number(match.blockHeight ?? 0);
      const actualHeight = Number((tx as any)?.blockHeight ?? 0);
      if (expectedHeight && actualHeight && expectedHeight !== actualHeight) {
        errors.push(`Block height mismatch for ${sig}: ${expectedHeight} vs ${actualHeight}.`);
      }
      const expectedTs = Number(match.timestamp ?? 0);
      const actualTs = Number((tx as any)?.timestamp ?? 0);
      if (expectedTs && actualTs && expectedTs !== actualTs) {
        warnings.push(`Timestamp mismatch for ${sig}.`);
      }
    } catch {
      warnings.push(`Failed to validate signature ${sig}.`);
    }
  }

  return { ok: errors.length === 0, errors, warnings, checkedSignatures: sampled };
}
