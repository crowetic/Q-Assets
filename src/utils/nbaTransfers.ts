import type { Service } from 'qapp-core';
import type { QdnResource } from '../hooks/useQdnResources';
import { base64ToObject, base64ToUtf8, utf8ToBase64 } from './data';
import {
  DEFAULT_MANUAL_TX_FEE,
  getAccount,
  getNameDataCached,
  getPrimaryAccountName,
  getPrimaryNameCached,
} from './qortalApi';
import { searchSimpleByIdentifierPrefix, type SimpleHit } from './searchSimple';

declare function qortalRequest<T = any>(request: any): Promise<T>;

export const NBA_TRANSFER_IDENTIFIER_PREFIX = 'nba-transfer-';
export const NBA_TRANSFER_PACKAGE_SERVICE: Service = 'DOCUMENT_PRIVATE';
export const NBA_TRANSFER_PACKAGE_VERSION = 1;
export const NBA_TRANSFER_TOMBSTONE_TEXT = 'd';
export const NBA_TRANSFER_TOMBSTONE_BASE64 = utf8ToBase64(NBA_TRANSFER_TOMBSTONE_TEXT);
export const NBA_TRANSFER_TOMBSTONE_SIZE = NBA_TRANSFER_TOMBSTONE_TEXT.length;

export type NbaTransferPackage = {
  version: 1;
  type: 'qassets-nba-transfer';
  createdAt: number;
  packageIdentifier: string;
  transferName: string;
  amount: number;
  note?: string | null;
  transferor: {
    address: string;
    name?: string | null;
    publicKey?: string | null;
  };
  transferee: {
    address: string;
    name?: string | null;
    publicKey?: string | null;
  };
  sellerSignedTransaction: string;
  reencryptedResources?: Array<{
    name: string;
    service: string;
    identifier: string;
    title?: string | null;
    path?: string | null;
    previousMode?: string | null;
    republishedAt: number;
  }>;
};

export type NbaTransferChainTx = {
  type: 'SELL_NAME' | 'BUY_NAME';
  signature: string;
  timestamp: number;
  amount: number | null;
  name: string;
  seller: string;
  buyer: string;
  raw: any;
};

export type NbaTransferHistoryItem = {
  resource: SimpleHit;
  transfer: NbaTransferPackage;
  ownership: NbaTransferOwnershipState;
  sellTransaction: NbaTransferChainTx | null;
  buyTransaction: NbaTransferChainTx | null;
  status: 'pending' | 'sell-only' | 'buy-only' | 'completed' | 'intercepted';
};

export type NbaTransferOwnershipState = {
  currentOwnerAddress: string | null;
  currentOwnerPrimaryName?: string | null;
  state: 'transferor' | 'transferee' | 'other' | 'unknown';
};

type TxConfirmationStatus = 'UNCONFIRMED' | 'CONFIRMED' | 'BOTH';

type NbaTransferPublishTx = {
  name: string;
  identifier: string;
  timestamp: number;
  size: number;
  signature: string;
};

type CreatorTransactionRow = {
  type: string;
  timestamp: number;
  signature: string;
  creatorAddress: string;
  name: string;
  amount: number | null;
  recipient: string;
  raw: any;
};

export type TransferPackageCreatorRow = {
  type: 'ARBITRARY';
  timestamp: number;
  signature: string;
  creatorAddress: string;
  name: string;
  identifier: string;
  service: string | number | null;
  raw: any;
};

const TX_PROCESS_HEADERS = {
  'Content-Type': 'text/plain',
  'X-API-VERSION': '2',
};

const normalizeData64 = (payload: any): string | null => {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload.data64 === 'string') return payload.data64;
  if (typeof payload.base64 === 'string') return payload.base64;
  return null;
};

const getFirstString = (obj: any, keys: string[]) => {
  for (const key of keys) {
    const value = obj?.[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
};

const getNestedString = (obj: any, key: string) => {
  const value = obj?.[key];
  return typeof value === 'string' ? value.trim() : '';
};

const getFirstNumber = (obj: any, keys: string[]) => {
  for (const key of keys) {
    const value = obj?.[key];
    const numeric = Number(value);
    if (Number.isFinite(numeric)) return numeric;
  }
  return null;
};

const normalizeAddress = (value?: string | null) => (value || '').trim();
const normalizeName = (value?: string | null) => (value || '').trim().toLowerCase();

const getTransferPublishKey = (hit: Pick<SimpleHit, 'name' | 'identifier'>) =>
  `${(hit.name || '').toLowerCase()}::${(hit.identifier || '').toLowerCase()}`;

export const isNbaTransferTombstoneSize = (size?: number | null) =>
  Number(size) === NBA_TRANSFER_TOMBSTONE_SIZE;

export const isNbaTransferTombstoneBase64 = (payload?: string | null) => {
  const trimmed = (payload || '').trim();
  if (!trimmed) return false;
  if (trimmed === NBA_TRANSFER_TOMBSTONE_BASE64) return true;
  try {
    return base64ToUtf8(trimmed) === NBA_TRANSFER_TOMBSTONE_TEXT;
  } catch {
    return false;
  }
};

const amountsMatch = (left?: number | null, right?: number | null) => {
  if (!Number.isFinite(left) || !Number.isFinite(right)) return true;
  return Math.abs(Number(left) - Number(right)) < 0.00000001;
};

const normalizeNameTransferTransaction = (tx: any): NbaTransferChainTx | null => {
  const signature = getFirstString(tx, ['signature', 'txId', 'id', 'txSignature']);
  const timestamp = getFirstNumber(tx, ['timestamp']) ?? 0;
  const rawType = getFirstString(tx, ['type', 'txType']).toUpperCase();
  const type = rawType === 'SELL_NAME' || rawType === 'BUY_NAME' ? rawType : '';
  if (!signature || !timestamp || !type) return null;

  return {
    type,
    signature,
    timestamp,
    amount: getFirstNumber(tx, ['amount', 'price', 'salePrice']),
    name: getFirstString(tx, ['name', 'saleName']),
    seller:
      type === 'SELL_NAME'
        ? normalizeAddress(
            getFirstString(tx, ['owner', 'ownerAddress', 'creatorAddress', 'sender', 'creator'])
          )
        : normalizeAddress(getFirstString(tx, ['seller', 'recipient', 'owner', 'ownerAddress'])),
    buyer:
      type === 'SELL_NAME'
        ? normalizeAddress(getFirstString(tx, ['recipient', 'buyer', 'buyerAddress']))
        : normalizeAddress(
            getFirstString(tx, ['buyer', 'buyerAddress', 'creatorAddress', 'sender', 'creator'])
          ),
    raw: tx,
  };
};

const getTransferPackageSortStamp = (hit: SimpleHit) => Number(hit.updated || hit.created || 0);

const getTransactionName = (tx: NbaTransferChainTx) => normalizeName(tx.name);

const findMatchingTransaction = (
  transfer: NbaTransferPackage,
  candidates: NbaTransferChainTx[],
  type: 'SELL_NAME' | 'BUY_NAME'
): NbaTransferChainTx | null => {
  const seller = normalizeAddress(transfer.transferor.address);
  const buyer = normalizeAddress(transfer.transferee.address);
  const transferName = normalizeName(transfer.transferName);
  const createdAt = Number(transfer.createdAt) || 0;

  const matches = candidates.filter((tx) => {
    if (tx.type !== type) return false;
    if (transferName && getTransactionName(tx) !== transferName) return false;
    if (seller && tx.seller && tx.seller !== seller) return false;
    if (buyer && tx.buyer && tx.buyer !== buyer) return false;
    if (!amountsMatch(tx.amount, transfer.amount)) return false;
    if (createdAt && tx.timestamp < createdAt - 300_000) return false;
    return true;
  });

  if (!matches.length) return null;

  return matches.sort((left, right) => {
    const leftDelta = Math.abs(left.timestamp - createdAt);
    const rightDelta = Math.abs(right.timestamp - createdAt);
    if (leftDelta !== rightDelta) return leftDelta - rightDelta;
    return right.timestamp - left.timestamp;
  })[0];
};

export async function findTransferTransaction(params: {
  transfer: NbaTransferPackage;
  type: 'SELL_NAME' | 'BUY_NAME';
  confirmationStatus?: TxConfirmationStatus;
  maxPages?: number;
  pageSize?: number;
}) {
  const candidates = await searchNameTransferTransactionsForSeller({
    sellerAddress: params.transfer.transferor.address,
    maxPages: params.maxPages ?? 1,
    pageSize: params.pageSize ?? 20,
    confirmationStatus: params.confirmationStatus ?? 'CONFIRMED',
    txTypes: [params.type],
  });
  return findMatchingTransaction(params.transfer, candidates, params.type);
}

export const abbreviateAddress = (address: string) => {
  const trimmed = (address || '').trim();
  if (!trimmed) return 'unk0000';
  const start = trimmed.slice(0, 3);
  const end = trimmed.slice(-4);
  return `${start}${end}`.toLowerCase();
};

const formatDateParts = (date = new Date()) => {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, '0');
  const day = `${date.getDate()}`.padStart(2, '0');
  return `${year}${month}${day}`;
};

const createRandomSegment = (length = 6) => {
  const alphabet = 'abcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let index = 0; index < bytes.length; index += 1) {
    out += alphabet[bytes[index] % alphabet.length];
  }
  return out;
};

export const buildNbaTransferIdentifier = (
  transferorAddress: string,
  transfereeAddress: string,
  date = new Date()
) => {
  const fromPart = abbreviateAddress(transferorAddress);
  const toPart = abbreviateAddress(transfereeAddress);
  const datePart = formatDateParts(date);
  const randomPart = createRandomSegment(6);
  const identifier =
    `${NBA_TRANSFER_IDENTIFIER_PREFIX}${fromPart}-${toPart}-${datePart}-${randomPart}`.slice(
      0,
      120
    );
  return identifier;
};

export async function createSellNameTransaction(args: {
  ownerAddress: string;
  ownerPublicKey: string;
  recipientAddress: string;
  name: string;
  amount: number;
  fee?: number;
  txGroupId?: number;
}) {
  const account = await getAccount(args.ownerAddress);
  const body = {
    timestamp: Date.now(),
    reference: account.reference,
    fee: args.fee ?? DEFAULT_MANUAL_TX_FEE,
    txGroupId: args.txGroupId ?? 0,
    recipient: args.recipientAddress,
    ownerPublicKey: args.ownerPublicKey,
    name: args.name,
    amount: args.amount,
  };

  const res = await fetch('/names/sell', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Create sell name failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
    );
  }
  return res.text();
}

export async function createBuyNameTransaction(args: {
  buyerAddress: string;
  buyerPublicKey: string;
  sellerAddress: string;
  name: string;
  amount: number;
  fee?: number;
  txGroupId?: number;
}) {
  const account = await getAccount(args.buyerAddress);
  const body = {
    timestamp: Date.now(),
    reference: account.reference,
    fee: args.fee ?? DEFAULT_MANUAL_TX_FEE,
    txGroupId: args.txGroupId ?? 0,
    recipient: args.sellerAddress,
    buyerPublicKey: args.buyerPublicKey,
    name: args.name,
    amount: args.amount,
    seller: args.sellerAddress,
  };

  const res = await fetch('/names/buy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'text/plain' },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `Create buy name failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
    );
  }
  return res.text();
}

export async function signTransaction(unsignedBytes: string) {
  return qortalRequest<string>({
    action: 'SIGN_TRANSACTION',
    unsignedBytes,
  });
}

export async function processSignedTransaction(signedBytes: string) {
  const res = await fetch('/transactions/process', {
    method: 'POST',
    headers: TX_PROCESS_HEADERS,
    body: signedBytes,
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to process transaction (${res.status} ${res.statusText})`);
  }
  return res.text();
}

export async function fetchNbaTransferPackage(
  resource: Pick<QdnResource, 'name' | 'service' | 'identifier'>
) {
  const encrypted = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    name: resource.name,
    service: resource.service,
    identifier: resource.identifier,
    encoding: 'base64',
  });
  const data64 = normalizeData64(encrypted);
  if (!data64) throw new Error('Unable to load transfer package.');
  if (isNbaTransferTombstoneBase64(data64)) {
    throw new Error('NBA transfer package was cancelled.');
  }
  const decrypted = await qortalRequest<string>({
    action: 'DECRYPT_DATA',
    encryptedData: data64,
  });
  if (!decrypted) throw new Error('Unable to decrypt transfer package.');
  if (isNbaTransferTombstoneBase64(decrypted)) {
    throw new Error('NBA transfer package was cancelled.');
  }
  return base64ToObject(decrypted) as NbaTransferPackage;
}

export async function searchTransferPackagesForRecipient(address: string): Promise<SimpleHit[]> {
  const addressKey = abbreviateAddress(address);
  const hits = await searchSimpleByIdentifierPrefix(
    NBA_TRANSFER_PACKAGE_SERVICE,
    NBA_TRANSFER_IDENTIFIER_PREFIX
  );
  const sorted = hits.sort((a, b) => (b.updated || b.created || 0) - (a.updated || a.created || 0));
  const seen = new Set<string>();
  const items: SimpleHit[] = [];

  for (const hit of sorted) {
    const key = getTransferPublishKey(hit);
    if (seen.has(key)) continue;
    seen.add(key);
    if (!(hit.identifier || '').toLowerCase().includes(`-${addressKey}-`)) continue;
    if (isNbaTransferTombstoneSize(hit.size)) continue;
    items.push(hit);
  }

  return items;
}

const normalizeTransferPublishTransaction = (tx: any): NbaTransferPublishTx | null => {
  const type = getFirstString(tx, ['type', 'txType']).toUpperCase();
  if (type !== 'ARBITRARY') return null;

  const identifier =
    getFirstString(tx, ['identifier']) || getNestedString(tx?.data, 'identifier') || '';
  const name = getFirstString(tx, ['name']) || getNestedString(tx?.data, 'name') || '';
  const timestamp = getFirstNumber(tx, ['timestamp']) ?? 0;
  const signature = getFirstString(tx, ['signature', 'txId', 'id', 'txSignature']);
  const size = getFirstNumber(tx, ['size', 'dataLength', 'dataSize']) ?? 0;

  if (!identifier || !name || !timestamp || !signature) return null;
  if (!identifier.toLowerCase().startsWith(NBA_TRANSFER_IDENTIFIER_PREFIX)) return null;

  return {
    name,
    identifier,
    timestamp,
    size,
    signature,
  };
};

const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

const normalizeCreatorTransaction = (tx: any): CreatorTransactionRow | null => {
  const type = getFirstString(tx, ['type', 'txType']).toUpperCase();
  const timestamp = getFirstNumber(tx, ['timestamp']) ?? 0;
  const signature = getFirstString(tx, ['signature', 'txId', 'id', 'txSignature']);
  if (!type || !timestamp || !signature) return null;

  return {
    type,
    timestamp,
    signature,
    creatorAddress: normalizeAddress(
      getFirstString(tx, ['creatorAddress', 'sender', 'creator', 'owner', 'ownerAddress'])
    ),
    name: getFirstString(tx, ['name', 'saleName']),
    amount: getFirstNumber(tx, ['amount', 'price', 'salePrice']),
    recipient: normalizeAddress(getFirstString(tx, ['recipient', 'buyer', 'buyerAddress'])),
    raw: tx,
  };
};

const normalizeTransferPackageCreatorRow = (tx: any): TransferPackageCreatorRow | null => {
  const type = getFirstString(tx, ['type', 'txType']).toUpperCase();
  const timestamp = getFirstNumber(tx, ['timestamp']) ?? 0;
  const signature = getFirstString(tx, ['signature', 'txId', 'id', 'txSignature']);
  if (type !== 'ARBITRARY' || !timestamp || !signature) return null;

  const identifier =
    getFirstString(tx, ['identifier']) || getNestedString(tx?.data, 'identifier') || '';
  const name = getFirstString(tx, ['name']) || getNestedString(tx?.data, 'name') || '';
  if (!identifier || !name) return null;
  if (!identifier.toLowerCase().startsWith(NBA_TRANSFER_IDENTIFIER_PREFIX)) return null;

  return {
    type: 'ARBITRARY',
    timestamp,
    signature,
    creatorAddress: normalizeAddress(
      getFirstString(tx, ['creatorAddress', 'sender', 'creator', 'owner', 'ownerAddress'])
    ),
    name,
    identifier,
    service: tx?.service ?? tx?.data?.service ?? null,
    raw: tx,
  };
};

const matchesTransferPackagePublishRow = (params: {
  row: TransferPackageCreatorRow;
  packageIdentifier: string;
  packagePublisherName?: string | null;
}) => {
  if (params.row.identifier.toLowerCase() !== params.packageIdentifier.trim().toLowerCase()) {
    return false;
  }
  if (
    params.packagePublisherName &&
    normalizeName(params.row.name) !== normalizeName(params.packagePublisherName)
  ) {
    return false;
  }
  return true;
};

const matchesSellTransferRow = (row: CreatorTransactionRow, transfer: NbaTransferPackage) => {
  if (row.type !== 'SELL_NAME') return false;
  if (normalizeName(row.name) !== normalizeName(transfer.transferName)) return false;
  if (!amountsMatch(row.amount, transfer.amount)) return false;

  const expectedCreator = normalizeAddress(transfer.transferor.address);
  if (row.creatorAddress && expectedCreator && row.creatorAddress !== expectedCreator) return false;

  const expectedRecipient = normalizeAddress(transfer.transferee.address);
  if (row.recipient && expectedRecipient && row.recipient !== expectedRecipient) return false;

  return true;
};

const matchesBuyTransferRow = (row: CreatorTransactionRow, transfer: NbaTransferPackage) => {
  if (row.type !== 'BUY_NAME') return false;
  if (normalizeName(row.name) !== normalizeName(transfer.transferName)) return false;
  if (!amountsMatch(row.amount, transfer.amount)) return false;

  const expectedCreator = normalizeAddress(transfer.transferee.address);
  if (row.creatorAddress && expectedCreator && row.creatorAddress !== expectedCreator) return false;

  const expectedRecipient = normalizeAddress(transfer.transferor.address);
  if (row.recipient && expectedRecipient && row.recipient !== expectedRecipient) return false;

  return true;
};

export async function hasUnconfirmedSellNameTransaction(params: {
  transfer: NbaTransferPackage;
  creatorPublicKey: string;
  limit?: number;
}) {
  const unconfirmed = await fetchTransactionsByCreatorPublicKey({
    creatorPublicKey: params.creatorPublicKey,
    confirmationStatus: 'UNCONFIRMED',
    limit: params.limit ?? 20,
    reverse: true,
  });
  return unconfirmed.some((row) => matchesSellTransferRow(row, params.transfer));
}

export async function hasUnconfirmedBuyNameTransaction(params: {
  transfer: NbaTransferPackage;
  creatorPublicKey: string;
  limit?: number;
}) {
  const unconfirmed = await fetchTransactionsByCreatorPublicKey({
    creatorPublicKey: params.creatorPublicKey,
    confirmationStatus: 'UNCONFIRMED',
    limit: params.limit ?? 20,
    reverse: true,
  });
  return unconfirmed.some((row) => matchesBuyTransferRow(row, params.transfer));
}

export async function fetchTransactionsByCreatorPublicKey(params: {
  creatorPublicKey: string;
  confirmationStatus?: TxConfirmationStatus;
  limit?: number;
  reverse?: boolean;
}) {
  const url = new URL(
    `/transactions/creator/${encodeURIComponent(params.creatorPublicKey)}`,
    window.location.origin
  );
  url.searchParams.set('confirmationStatus', params.confirmationStatus ?? 'UNCONFIRMED');
  url.searchParams.set('limit', String(Math.max(1, params.limit ?? 20)));
  url.searchParams.set('reverse', String(params.reverse ?? true));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `/transactions/creator failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
    );
  }

  const raw = await res.json().catch(() => []);
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return rows
    .map((row) => normalizeCreatorTransaction(row))
    .filter((row): row is CreatorTransactionRow => Boolean(row));
}

export async function fetchTransferPackagePublishesByCreatorPublicKey(params: {
  creatorPublicKey: string;
  confirmationStatus?: TxConfirmationStatus;
  limit?: number;
  reverse?: boolean;
}) {
  const url = new URL(
    `/transactions/creator/${encodeURIComponent(params.creatorPublicKey)}`,
    window.location.origin
  );
  url.searchParams.set('confirmationStatus', params.confirmationStatus ?? 'UNCONFIRMED');
  url.searchParams.set('limit', String(Math.max(1, params.limit ?? 20)));
  url.searchParams.set('reverse', String(params.reverse ?? true));

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `/transactions/creator failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
    );
  }

  const raw = await res.json().catch(() => []);
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
  return rows
    .map((row) => normalizeTransferPackageCreatorRow(row))
    .filter((row): row is TransferPackageCreatorRow => Boolean(row));
}

export async function hasUnconfirmedTransferPackagePublish(params: {
  creatorPublicKey: string;
  packageIdentifier: string;
  packagePublisherName?: string | null;
  limit?: number;
}) {
  const unconfirmed = await fetchTransferPackagePublishesByCreatorPublicKey({
    creatorPublicKey: params.creatorPublicKey,
    confirmationStatus: 'UNCONFIRMED',
    limit: params.limit ?? 20,
    reverse: true,
  });
  return unconfirmed.some((row) =>
    matchesTransferPackagePublishRow({
      row,
      packageIdentifier: params.packageIdentifier,
      packagePublisherName: params.packagePublisherName,
    })
  );
}

export async function findConfirmedTransferPackagePublish(params: {
  creatorPublicKey: string;
  packageIdentifier: string;
  packagePublisherName?: string | null;
  limit?: number;
}) {
  const confirmed = await fetchTransferPackagePublishesByCreatorPublicKey({
    creatorPublicKey: params.creatorPublicKey,
    confirmationStatus: 'CONFIRMED',
    limit: params.limit ?? 50,
    reverse: true,
  });
  return (
    confirmed.find((row) =>
      matchesTransferPackagePublishRow({
        row,
        packageIdentifier: params.packageIdentifier,
        packagePublisherName: params.packagePublisherName,
      })
    ) || null
  );
}

export async function searchTransferPackagesForSenderAddress(params: {
  ownerAddress: string;
  maxPages?: number;
  pageSize?: number;
}): Promise<SimpleHit[]> {
  const seen = new Set<string>();
  const items: SimpleHit[] = [];
  const url = new URL('/arbitrary/search', window.location.origin);
  url.searchParams.set('service', NBA_TRANSFER_PACKAGE_SERVICE);
  url.searchParams.set('address', params.ownerAddress);
  url.searchParams.set('confirmationStatus', 'CONFIRMED');
  url.searchParams.set('limit', '0');
  url.searchParams.set('reverse', 'true');

  const res = await fetch(url.toString(), {
    method: 'GET',
    headers: { accept: 'application/json' },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(
      `/arbitrary/search failed: ${res.status} ${res.statusText}${text ? ` — ${text}` : ''}`
    );
  }

  const raw = await res.json().catch(() => []);
  const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];

  for (const row of rows) {
    const creator = normalizeAddress(getFirstString(row, ['creatorAddress', 'sender', 'creator']));
    if (creator && creator !== normalizeAddress(params.ownerAddress)) continue;

    const normalized = normalizeTransferPublishTransaction(row);
    if (!normalized) continue;
    const key = `${normalized.name.toLowerCase()}::${normalized.identifier.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (isNbaTransferTombstoneSize(normalized.size)) continue;
    items.push({
      name: normalized.name,
      service: NBA_TRANSFER_PACKAGE_SERVICE,
      identifier: normalized.identifier,
      size: normalized.size,
      created: normalized.timestamp,
      updated: normalized.timestamp,
    });
  }

  return items.sort((a, b) => getTransferPackageSortStamp(b) - getTransferPackageSortStamp(a));
}

export async function searchNameTransferTransactionsForSeller(params: {
  sellerAddress: string;
  maxPages?: number;
  pageSize?: number;
  confirmationStatus?: TxConfirmationStatus;
  txTypes?: Array<'SELL_NAME' | 'BUY_NAME'>;
}) {
  const pageSize = Math.max(1, params.pageSize ?? 50);
  const maxPages = Math.max(1, params.maxPages ?? 4);
  const seen = new Set<string>();
  const items: NbaTransferChainTx[] = [];
  let offset = 0;

  for (let pageIndex = 0; pageIndex < maxPages; pageIndex += 1) {
    const raw = await qortalRequest<any[]>({
      action: 'SEARCH_TRANSACTIONS',
      address: params.sellerAddress,
      confirmationStatus: params.confirmationStatus ?? 'BOTH',
      limit: pageSize,
      offset,
      reverse: true,
      txType: params.txTypes ?? ['SELL_NAME', 'BUY_NAME'],
    }).catch(() => []);

    const rows = Array.isArray(raw) ? raw : raw ? [raw] : [];
    if (!rows.length) break;

    for (const row of rows) {
      const normalized = normalizeNameTransferTransaction(row);
      if (!normalized || seen.has(normalized.signature)) continue;
      seen.add(normalized.signature);
      items.push(normalized);
    }

    if (rows.length < pageSize) break;
    offset += rows.length;
  }

  return items.sort((a, b) => b.timestamp - a.timestamp);
}

export async function waitForSellNameConfirmation(params: {
  transfer: NbaTransferPackage;
  creatorPublicKey: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onStatus?: (message: string) => void;
}) {
  const timeoutMs = Math.max(5_000, params.timeoutMs ?? 180_000);
  const pollIntervalMs = Math.max(250, params.pollIntervalMs ?? 1_000);
  const deadline = Date.now() + timeoutMs;
  let sawUnconfirmed = false;

  while (Date.now() < deadline) {
    const unconfirmed = await fetchTransactionsByCreatorPublicKey({
      creatorPublicKey: params.creatorPublicKey,
      confirmationStatus: 'UNCONFIRMED',
      limit: 20,
      reverse: true,
    });
    const pendingSell = unconfirmed.find((row) => matchesSellTransferRow(row, params.transfer));

    if (pendingSell) {
      if (!sawUnconfirmed) {
        params.onStatus?.(
          'Seller transaction detected in unconfirmed transactions. Waiting for it to confirm...'
        );
      }
      sawUnconfirmed = true;
      await sleep(pollIntervalMs);
      continue;
    }

    const confirmed = await searchNameTransferTransactionsForSeller({
      sellerAddress: params.transfer.transferor.address,
      maxPages: 1,
      pageSize: 20,
      confirmationStatus: 'CONFIRMED',
      txTypes: ['SELL_NAME'],
    });
    const confirmedSell = findMatchingTransaction(params.transfer, confirmed, 'SELL_NAME');
    if (confirmedSell) {
      params.onStatus?.('Seller transaction confirmed. Creating the buyer transaction now...');
      return confirmedSell;
    }

    params.onStatus?.(
      sawUnconfirmed
        ? 'Seller transaction left unconfirmed transactions. Checking for confirmation...'
        : 'Waiting for the seller transaction to appear in unconfirmed transactions...'
    );
    await sleep(pollIntervalMs);
  }

  throw new Error(
    'Timed out while waiting for the seller transaction to confirm. The sell may still complete later, so review the name state before retrying.'
  );
}

export async function createBuyNameTransactionWithRetry(
  args: Parameters<typeof createBuyNameTransaction>[0],
  opts?: {
    timeoutMs?: number;
    retryIntervalMs?: number;
    onRetry?: (message: string) => void;
  }
) {
  const timeoutMs = Math.max(1_000, opts?.timeoutMs ?? 12_000);
  const retryIntervalMs = Math.max(150, opts?.retryIntervalMs ?? 500);
  const deadline = Date.now() + timeoutMs;
  let lastError: any = null;

  while (Date.now() < deadline) {
    try {
      return await createBuyNameTransaction(args);
    } catch (err: any) {
      lastError = err;
      opts?.onRetry?.('Sell confirmed. Retrying buy transaction creation...');
      await sleep(retryIntervalMs);
    }
  }

  throw lastError || new Error('Unable to create the buyer transaction after the sell confirmed.');
}

export async function resolveTransferOwnershipState(
  transfer: NbaTransferPackage
): Promise<NbaTransferOwnershipState> {
  try {
    const nameData = await getNameDataCached(transfer.transferName);
    const currentOwnerAddress =
      typeof nameData?.owner === 'string' && nameData.owner.trim() ? nameData.owner.trim() : null;

    if (!currentOwnerAddress) {
      return {
        currentOwnerAddress: null,
        currentOwnerPrimaryName: null,
        state: 'unknown',
      };
    }

    const transferorAddress = normalizeAddress(transfer.transferor.address);
    const transfereeAddress = normalizeAddress(transfer.transferee.address);
    const normalizedOwner = normalizeAddress(currentOwnerAddress);

    if (normalizedOwner === transferorAddress) {
      return {
        currentOwnerAddress,
        currentOwnerPrimaryName: transfer.transferor.name || null,
        state: 'transferor',
      };
    }

    if (normalizedOwner === transfereeAddress) {
      const currentOwnerPrimaryName =
        transfer.transferee.name ||
        (await getPrimaryNameCached(currentOwnerAddress).catch(() => '')) ||
        null;
      return {
        currentOwnerAddress,
        currentOwnerPrimaryName,
        state: 'transferee',
      };
    }

    const currentOwnerPrimaryName = await getPrimaryNameCached(currentOwnerAddress).catch(() => '');
    return {
      currentOwnerAddress,
      currentOwnerPrimaryName: currentOwnerPrimaryName || null,
      state: 'other',
    };
  } catch {
    return {
      currentOwnerAddress: null,
      currentOwnerPrimaryName: null,
      state: 'unknown',
    };
  }
}

export async function loadNbaTransferHistory(params: {
  ownerAddress: string;
  maxPackages?: number;
  maxPublishPages?: number;
  maxTxPages?: number;
  txPageSize?: number;
}): Promise<NbaTransferHistoryItem[]> {
  const hits = await searchTransferPackagesForSenderAddress({
    ownerAddress: params.ownerAddress,
    maxPages: params.maxPublishPages,
    pageSize: params.txPageSize,
  });
  const limitedHits = hits.slice(0, Math.max(1, params.maxPackages ?? 20));

  const [transactions, decodedPackages] = await Promise.all([
    searchNameTransferTransactionsForSeller({
      sellerAddress: params.ownerAddress,
      maxPages: params.maxTxPages,
      pageSize: params.txPageSize,
    }),
    Promise.all(
      limitedHits.map(async (resource) => {
        try {
          const transfer = await fetchNbaTransferPackage(resource);
          if (transfer?.type !== 'qassets-nba-transfer') return null;
          return { resource, transfer };
        } catch {
          return null;
        }
      })
    ),
  ]);

  const items = await Promise.all(
    decodedPackages
      .filter((item): item is { resource: SimpleHit; transfer: NbaTransferPackage } =>
        Boolean(item)
      )
      .map(async ({ resource, transfer }) => {
        const ownership = await resolveTransferOwnershipState(transfer);
        const sellTransaction = findMatchingTransaction(transfer, transactions, 'SELL_NAME');
        const buyTransaction = findMatchingTransaction(transfer, transactions, 'BUY_NAME');
        const status: NbaTransferHistoryItem['status'] =
          ownership.state === 'transferee'
            ? 'completed'
            : ownership.state === 'other'
              ? 'intercepted'
              : sellTransaction
                ? buyTransaction
                  ? 'completed'
                  : 'sell-only'
                : buyTransaction
                  ? 'buy-only'
                  : 'pending';

        return {
          resource,
          transfer,
          ownership,
          sellTransaction,
          buyTransaction,
          status,
        };
      })
  );

  return items.sort(
    (left, right) => (right.transfer.createdAt || 0) - (left.transfer.createdAt || 0)
  );
}

export const buildNbaReceiveLink = (identifier?: string) => {
  const base = 'qortal://APP/Q-Assets/manage/data/name-assets/receive';
  if (!identifier) return base;
  return `${base}?identifier=${encodeURIComponent(identifier)}`;
};

export async function buildNbaTransferQmailMessage(params: {
  transferName: string;
  transferorName?: string | null;
  transferorAddress: string;
  transfereeAddress: string;
  packageIdentifier: string;
  amount: number;
}) {
  const transfereePrimaryName = await getPrimaryAccountName(params.transfereeAddress).catch(
    () => ''
  );
  const senderLabel = params.transferorName || params.transferorAddress;
  const recipientLabel = transfereePrimaryName || params.transfereeAddress;
  const lines = [
    `Q-Assets NBA transfer ready for ${params.transferName}`,
    '',
    `${senderLabel} prepared a name transfer package for ${recipientLabel}.`,
    `Requested sell price: ${params.amount} QORT`,
    '',
    `Open in Q-Assets: ${buildNbaReceiveLink(params.packageIdentifier)}`,
    `Transfer package identifier: ${params.packageIdentifier}`,
    '',
    'Review the package carefully before completing the transfer.',
  ];
  return lines.join('\n');
}
