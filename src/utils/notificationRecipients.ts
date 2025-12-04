import pLimit from 'p-limit';
import { fetchGroupMembers } from './access';
import { NOTIF_GROUP_ID } from '../notifications/notifyIndex';
import { getAccount, getAllAccountNames, getPrimaryAccountName } from './qortalApi';
import { NotifScope } from '../types/notifications';

export type NotificationRecipient = {
  name: string;
  address: string;
  publicKey: string;
};

const norm = (s?: string | null) => (typeof s === 'string' ? s.trim() : '');

async function resolveName(address: string): Promise<string | null> {
  const primary = await getPrimaryAccountName(address).catch(() => '');
  if (primary && primary.trim()) return primary.trim();

  const names = await getAllAccountNames(address).catch(() => []);
  if (Array.isArray(names) && names.length > 0) {
    const first = names.find((n) => typeof n === 'string' && n.trim().length > 0);
    if (first) return norm(first);
  }
  return null;
}

export async function resolveNotificationRecipients(
  scope: NotifScope
): Promise<NotificationRecipient[]> {
  let groupId: number | null = null;
  if (scope.kind === 'global') groupId = NOTIF_GROUP_ID;
  else if (scope.kind === 'group') groupId = scope.groupId;
  else groupId = null;

  if (!groupId) return [];

  const rows = await fetchGroupMembers(false, groupId).catch(() => []);
  if (!rows?.length) return [];

  const limit = pLimit(20);
  const seen = new Set<string>();
  const recipients: NotificationRecipient[] = [];

  await Promise.all(
    rows.map((row) =>
      limit(async () => {
        const address = norm(row.member || row.address);
        if (!address || seen.has(address)) return;
        seen.add(address);

        const account = await getAccount(address).catch(() => null);
        const publicKey = account?.publicKey;
        if (!publicKey) return;

        const name = await resolveName(address);
        if (!name) return;

        recipients.push({ name, address, publicKey });
      })
    )
  );

  return recipients.sort((a, b) => a.name.localeCompare(b.name));
}
