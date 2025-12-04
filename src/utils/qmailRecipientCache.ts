import type { NotifScope } from '../types/notifications';
import type { NotificationRecipient } from './notificationRecipients';
import { resolveNotificationRecipients } from './notificationRecipients';

const CACHE_KEY = 'qassets_qmail_recipient_cache_v1';
const CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

type CacheRecord = {
  timestamp: number;
  recipients: NotificationRecipient[];
};

type CacheBucket = Record<string, CacheRecord>;

function makeScopeKey(scope: NotifScope): string {
  if (scope.kind === 'group') {
    return `scope:group:${scope.groupId}`;
  }
  if (scope.kind === 'global') {
    return 'scope:global';
  }
  return `scope:${scope.kind}`;
}

function readCache(): CacheBucket {
  if (typeof window === 'undefined' || !window.localStorage) return {};
  try {
    const json = window.localStorage.getItem(CACHE_KEY);
    if (!json) return {};
    return JSON.parse(json) as CacheBucket;
  } catch (e) {
    console.warn('Failed to read qmail recipient cache', e);
    return {};
  }
}

function writeCache(bucket: CacheBucket) {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(CACHE_KEY, JSON.stringify(bucket));
  } catch (e) {
    console.warn('Failed to write qmail recipient cache', e);
  }
}

function isFresh(record: CacheRecord): boolean {
  return Date.now() - record.timestamp < CACHE_TTL_MS;
}

export async function prepareQmailRecipients(
  scope: NotifScope,
  opts?: { forceRefresh?: boolean }
): Promise<NotificationRecipient[]> {
  const key = makeScopeKey(scope);
  const bucket = readCache();
  const cached = bucket[key];
  if (!opts?.forceRefresh && cached && isFresh(cached)) {
    return cached.recipients;
  }

  if (scope.kind === 'group' && !scope.groupId) {
    return [];
  }

  const recipients = await resolveNotificationRecipients(scope);
  bucket[key] = { timestamp: Date.now(), recipients };
  writeCache(bucket);
  return recipients;
}

export function clearQmailRecipientCache(scope?: NotifScope) {
  const bucket = readCache();
  if (!scope) {
    writeCache({});
    return;
  }
  const key = makeScopeKey(scope);
  if (key in bucket) {
    delete bucket[key];
    writeCache(bucket);
  }
}
