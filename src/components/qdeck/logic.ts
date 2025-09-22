import { upvoteCard as _upvoteCard, contributeBounty as _contrib } from './qdeckFunctions';
import { getAccountGroups } from '../../utils/qortalApi';

export async function upvoteCard(args: Parameters<typeof _upvoteCard>[0]) {
  return _upvoteCard(args);
}

export async function contributeBounty(args: Parameters<typeof _contrib>[0]) {
  return _contrib(args);
}


type MyGroup = { id?: number; name: string; role?: 'ADMIN'|'MEMBER'|'OWNER'|string };

export async function fetchMyGroups(): Promise<MyGroup[]> {
  try {
    const me = await qortalRequest({action: 'GET_USER_ACCOUNT'})
    // Option A:
    const groupsA = await getAccountGroups(me.address);
    if (Array.isArray(groupsA)) {
      return groupsA.map((g: any) => ({
        id: g.groupId ?? g.id,
        name: g.groupName ?? g.name ?? '',
        isAdmin: g.isAdmin,
        isOpen: g.isOpen
      })).filter(g => g.name);
    }
  } catch {}
  return [];
}