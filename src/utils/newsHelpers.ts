import { Q_ASSETS_MANAGEMENT_GROUP_ID } from '../constants/qdnConstants';
import { getAccountGroups, getNameDataCached } from './qortalApi';

const nameAddressCache = new Map<string, string | null>();
const adminCache = new Map<string, boolean>();

const looksLikeAddressRegex = /^Q[1-9A-HJ-NP-Za-km-z]{20,}$/;

export const looksLikeAddress = (value: string) => looksLikeAddressRegex.test((value || '').trim());

export async function resolvePublisherAddress(publisher?: string): Promise<string | null> {
  if (!publisher) return null;
  const key = publisher.toLowerCase();
  if (nameAddressCache.has(key)) return nameAddressCache.get(key)!;

  if (looksLikeAddress(publisher)) {
    nameAddressCache.set(key, publisher);
    return publisher;
  }

  try {
    const data = await getNameDataCached(publisher);
    const owner = data?.owner ? String(data.owner) : null;
    nameAddressCache.set(key, owner);
    return owner;
  } catch {
    nameAddressCache.set(key, null);
    return null;
  }
}

export async function isManagementAdminPublisher(publisher?: string): Promise<boolean> {
  if (!publisher) return false;
  const key = publisher.toLowerCase();
  if (adminCache.has(key)) return adminCache.get(key)!;

  const address = await resolvePublisherAddress(publisher);
  if (!address) {
    adminCache.set(key, false);
    return false;
  }

  try {
    const groups = await getAccountGroups(address);
    const ok = groups.some((g) => g.groupId === Q_ASSETS_MANAGEMENT_GROUP_ID && Boolean(g.isAdmin));
    adminCache.set(key, ok);
    return ok;
  } catch {
    adminCache.set(key, false);
    return false;
  }
}

export function stripHtml(html: string): string {
  if (!html) return '';
  return html
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function extractTitleFromHtml(html: string, fallback: string): string {
  if (!html) return fallback;
  const match = html.match(/<h[12][^>]*>(.*?)<\/h[12]>/i);
  if (match && match[1]) {
    return stripHtml(match[1]);
  }
  return fallback;
}
