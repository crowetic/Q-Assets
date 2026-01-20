import type { XqloreAppRegistryEntry } from './xqloreIndex';

export type XqloreAppRegistryLookup = {
  byPrefix: Array<{ prefix: string; app: string }>;
  byIdentifier: Map<string, string>;
  entries: XqloreAppRegistryEntry[];
};

export type NormalizedTx = {
  id: string;
  type: string;
  timestampMs: number;
  identifier?: string;
  displayIdentifier?: string;
  app: string;
  summary: string;
  context: string;
  tags: string[];
  origin: string;
  originFull: string;
  raw: any;
};

const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

const TYPE_SUMMARY: Record<string, string> = {
  ARBITRARY: 'QDN publish',
  TRANSFER_ASSET: 'Asset transfer',
  ISSUE_ASSET: 'Asset issued',
  REGISTER_NAME: 'Name registered',
  UPDATE_NAME: 'Name updated',
  CREATE_ASSET_ORDER: 'Asset order created',
  CANCEL_ASSET_ORDER: 'Asset order canceled',
  PAYMENT: 'QORT payment',
  MULTI_PAYMENT: 'Multi-payment',
  CREATE_GROUP: 'Group created',
  JOIN_GROUP: 'Group join',
  LEAVE_GROUP: 'Group leave',
  DEPLOY_AT: 'AT deployment',
  AT: 'AT execution',
  MESSAGE: 'Message',
};

export const toMs = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num < 1e12 ? num * 1000 : num;
};

export const formatRelativeTime = (tsMs: number) => {
  const diffSeconds = Math.round((tsMs - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  for (const { unit, seconds } of RELATIVE_TIME_UNITS) {
    if (absSeconds >= seconds || unit === 'second') {
      const value = Math.round(diffSeconds / seconds);
      return relativeTimeFormat.format(value, unit);
    }
  }
  return '';
};

export const formatNumber = (value: unknown, maxFraction = 8) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return '—';
  return num.toLocaleString(undefined, { maximumFractionDigits: maxFraction });
};

export const formatBytes = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let size = num;
  let idx = 0;
  while (size >= 1024 && idx < units.length - 1) {
    size /= 1024;
    idx += 1;
  }
  const digits = size >= 100 ? 0 : size >= 10 ? 1 : 2;
  return `${size.toFixed(digits)} ${units[idx]}`;
};

export const shortenValue = (value: string, head = 4, tail = 4) => {
  if (!value) return '—';
  if (value.length <= head + tail + 3) return value;
  return `${value.slice(0, head)}...${value.slice(-tail)}`;
};

export const getTxType = (tx: any) => String(tx?.type ?? tx?.txType ?? 'UNKNOWN').toUpperCase();

export const getIdentifier = (tx: any, type: string) => {
  if (type === 'ARBITRARY') {
    const raw = tx?.identifier ?? tx?.data?.identifier;
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value || 'unknown identifier';
  }
  return undefined;
};

export const getDisplayIdentifier = (tx: any, type: string) => {
  if (type === 'ARBITRARY') return getIdentifier(tx, type);
  if (type.includes('NAME')) {
    const raw = tx?.name ?? tx?.newName ?? tx?.registeredName;
    const value = typeof raw === 'string' ? raw.trim() : '';
    return value || undefined;
  }
  if (type === 'ISSUE_ASSET') {
    const name = typeof tx?.name === 'string' ? tx.name.trim() : '';
    if (name) return name;
    const assetId = Number(tx?.assetId ?? tx?.assetIdCreated ?? tx?.assetIdIssued);
    return Number.isFinite(assetId) ? `Asset #${assetId}` : undefined;
  }
  if (type === 'TRANSFER_ASSET') {
    const assetId = Number(tx?.assetId);
    const assetName = typeof tx?.assetName === 'string' ? tx.assetName.trim() : '';
    return assetName || (Number.isFinite(assetId) ? `Asset #${assetId}` : undefined);
  }
  if (type === 'CREATE_ASSET_ORDER' || type === 'CANCEL_ASSET_ORDER') {
    const orderId = typeof tx?.orderId === 'string' ? tx.orderId.trim() : '';
    return orderId || undefined;
  }
  if (type.includes('GROUP')) {
    const groupId = tx?.groupId ?? tx?.txGroupId;
    return Number.isFinite(groupId) ? `Group #${groupId}` : undefined;
  }
  if (type === 'DEPLOY_AT' || type === 'AT') {
    const addr = typeof tx?.atAddress === 'string' ? tx.atAddress.trim() : '';
    return addr || undefined;
  }
  if (type === 'PAYMENT' || type === 'MULTI_PAYMENT') {
    const amount = formatNumber(tx?.amount ?? tx?.total);
    return amount !== '—' ? `${amount} QORT` : undefined;
  }
  return undefined;
};

export const getService = (tx: any) => {
  const raw = tx?.service ?? tx?.data?.service ?? tx?.arbitrary?.service;
  const value = typeof raw === 'string' ? raw.trim() : '';
  return value || undefined;
};

export function buildAppRegistryLookup(
  entries: XqloreAppRegistryEntry[] = []
): XqloreAppRegistryLookup {
  const byIdentifier = new Map<string, string>();
  const byPrefix: Array<{ prefix: string; app: string }> = [];
  entries.forEach((entry) => {
    const app = entry.name;
    (entry.identifiers || []).forEach((identifier) => {
      if (identifier) byIdentifier.set(identifier.toLowerCase(), app);
    });
    entry.prefixes.forEach((prefix) => {
      if (prefix) byPrefix.push({ prefix: prefix.toLowerCase(), app });
    });
  });
  return { byPrefix, byIdentifier, entries };
}

export function resolveAppFromRegistry(
  identifier: string | undefined,
  registry?: XqloreAppRegistryLookup
): string | null {
  if (!identifier || !registry) return null;
  const key = identifier.toLowerCase();
  const direct = registry.byIdentifier.get(key);
  if (direct) return direct;
  const prefixMatch = registry.byPrefix.find((entry) => key.startsWith(entry.prefix));
  return prefixMatch ? prefixMatch.app : null;
}

export function resolveAppFromTx(
  type: string,
  identifier?: string,
  registry?: XqloreAppRegistryLookup
) {
  if (type !== 'ARBITRARY') return type || 'Qortal Core';
  const app = resolveAppFromRegistry(identifier, registry);
  if (app) return app;
  return 'Unmapped';
}

export function buildTags(tx: any, type: string, service?: string) {
  const tags = new Set<string>();
  if (type === 'ARBITRARY') {
    tags.add('qdn');
    tags.add('publish');
    if (service) tags.add(service.toLowerCase());
    const isPrivate =
      Boolean(tx?.isEncrypted) ||
      Boolean(tx?.isPrivate) ||
      (service && service.toUpperCase().includes('PRIVATE'));
    if (isPrivate) tags.add('private');
  }
  if (type.includes('ASSET')) tags.add('asset');
  if (type.includes('NAME')) tags.add('identity');
  if (type.includes('GROUP')) tags.add('group');
  if (type === 'PAYMENT' || type === 'MULTI_PAYMENT') tags.add('qort');
  if (type.includes('ORDER')) tags.add('trade');
  if (type.includes('AT')) tags.add('automation');
  if (type === 'MESSAGE') tags.add('message');
  return Array.from(tags);
}

export function buildContext(tx: any, type: string, identifier?: string, service?: string) {
  if (type === 'ARBITRARY') {
    const size = formatBytes(tx?.dataSize ?? tx?.size ?? tx?.payloadSize ?? tx?.dataLength);
    const groupId = tx?.txGroupId ?? tx?.groupId;
    const scope =
      typeof groupId === 'number' && Number.isFinite(groupId) ? `group ${groupId}` : null;
    const visibility =
      Boolean(tx?.isEncrypted) ||
      Boolean(tx?.isPrivate) ||
      (service && service.toUpperCase().includes('PRIVATE'))
        ? 'private'
        : 'public';
    return [service ? service.toUpperCase() : 'QDN', size, scope, visibility]
      .filter(Boolean)
      .join(' - ');
  }
  if (type === 'TRANSFER_ASSET') {
    const amount = formatNumber(tx?.amount ?? tx?.amountAsset);
    const assetId = Number(tx?.assetId);
    const assetLabel = Number.isFinite(assetId) ? `Asset #${assetId}` : 'Asset';
    return `${amount} units - ${assetLabel}`;
  }
  if (type === 'ISSUE_ASSET') {
    const qty = formatNumber(tx?.quantity);
    const divisible = tx?.isDivisible ? 'divisible' : 'indivisible';
    return `Supply ${qty} - ${divisible}`;
  }
  if (type === 'CREATE_ASSET_ORDER') {
    const have = formatNumber(tx?.amount ?? tx?.amountHave);
    const price = formatNumber(tx?.price ?? tx?.pricePerUnit, 8);
    const haveAsset = Number.isFinite(tx?.haveAssetId) ? `#${tx.haveAssetId}` : 'asset';
    const wantAsset = Number.isFinite(tx?.wantAssetId) ? `#${tx.wantAssetId}` : 'asset';
    return `${have} ${haveAsset} at ${price} for ${wantAsset}`;
  }
  if (type === 'PAYMENT' || type === 'MULTI_PAYMENT') {
    const amount = formatNumber(tx?.amount ?? tx?.total);
    return `${amount} QORT`;
  }
  if (type.includes('NAME')) {
    return identifier ? `Name: ${identifier}` : 'Name event';
  }
  if (type.includes('GROUP')) {
    const groupId = tx?.groupId ?? tx?.txGroupId;
    return Number.isFinite(groupId) ? `Group #${groupId}` : 'Group activity';
  }
  if (type.includes('AT')) {
    return identifier ? `AT ${identifier}` : 'Automated transaction';
  }
  return 'View transaction details';
}

export function normalizeTx(tx: any, registry?: XqloreAppRegistryLookup): NormalizedTx | null {
  const id = String(tx?.signature ?? tx?.txId ?? tx?.id ?? '').trim();
  if (!id) return null;
  const type = getTxType(tx);
  const tsMs = toMs(tx?.timestamp ?? tx?.time ?? tx?.created ?? tx?.createdAt) ?? Date.now();
  const identifier = getIdentifier(tx, type);
  const displayIdentifier = getDisplayIdentifier(tx, type);
  const service = getService(tx);
  const app = resolveAppFromTx(type, identifier, registry);
  const summary = TYPE_SUMMARY[type] ?? (type || 'Transaction');
  const context = buildContext(tx, type, identifier, service);
  const tags = buildTags(tx, type, service);
  const originFull = String(
    tx?.creatorAddress ?? tx?.sender ?? tx?.creator ?? tx?.owner ?? tx?.senderAddress ?? ''
  ).trim();
  const origin = shortenValue(originFull || 'Unknown');
  return {
    id,
    type,
    timestampMs: tsMs,
    identifier,
    displayIdentifier,
    app,
    summary,
    context,
    tags,
    origin,
    originFull: originFull || 'Unknown',
    raw: tx,
  };
}
