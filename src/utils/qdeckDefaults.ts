import { QDeckBoard, QDeckList } from '../types/qdeck';
import type { QDeckVisibility } from '../types/qdeck';
import { uniqueId6 } from './ids';

export function defaultLists(): QDeckList[] {
  const mk = (order: number, title: string, color: string): QDeckList => ({
    listId: title.toLowerCase().replace(/\s+/g, '_'),
    title, order, faintColor: color
  });
  return [
    mk(0, 'NEW', 'rgba(0, 255, 255, 0.06)'),
    mk(1, 'IN-PROGRESS',      'rgba(0, 255, 115, 0.06)'),
    mk(2, 'LONG-TERM',     'rgba(0, 119, 255, 0.06)'),
    mk(3, 'DENIED',      'rgba(200, 0, 0, 0.06)'),
    mk(4, 'DONE',        'rgba(15, 26, 16, 0.03)'),
  ];
}


type CreateBoardInput = {
  title: string;
  createdBy: string;
  createdByAddress: string;
  groupsAllowed: number[];
  usersAllowed?: string[];
  // new unified inputs
  visibility?: QDeckVisibility;
  groupId?: number;      // when private
  isAdmins?: boolean;    // when private
  adminOverride?: boolean;
  // legacy (optional) – keep for backward compatibility
  isPrivate?: boolean;
  mode?: 'direct' | 'group',
  recipients?: string[];
};

export async function createBoard(args: CreateBoardInput): Promise<QDeckBoard> {
  // derive from visibility if provided; fall back to legacy isPrivate
  const visibility = args.visibility ?? (args.isPrivate ? 'private' : 'public');
  const isPrivate = visibility === 'private';
  const boardId = uniqueId6() + uniqueId6()

  if (isPrivate && args.groupId == null) {
    throw new Error('Private boards require groupId');
  }
  
  const now = Date.now();
  const board: QDeckBoard = {
    _type: 'QDECK_BOARD',
    version: 1,
    boardId, // or your uniqueId6() if you prefer
    title: args.title,
    createdBy: args.createdBy,
    creatorAddress: args.createdByAddress,
    createdAt: now,
    updatedAt: now,
    groupsAllowed: args.groupsAllowed ?? [],
    usersAllowed: args.usersAllowed,
    adminOverride: !!args.adminOverride,
    lists: defaultLists(),
    seq: 1,
    visibility,
    service: isPrivate ? 'DOCUMENT_PRIVATE' : 'DOCUMENT',
    privateMeta: isPrivate
      ? { groupId: args.groupId!, isAdmins: args.isAdmins, mode: args.mode, recipients: args.recipients }
      : undefined,
  };

  return board;
}
