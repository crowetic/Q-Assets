import type { QdnResource } from '../hooks/useQdnResources';
import { filterUserTags } from './qdnTags';
import { isPrivateService } from './qdnServices';

export type EncryptionMode = 'group' | 'direct' | null;

export type EncryptionInfo = {
  mode: EncryptionMode;
  publisher?: string | null;
  groupId?: number | null;
  userCount?: number | null;
  adminsOnly?: boolean;
  tags: string[];
  isPrivate: boolean;
};

export const ENCRYPTION_MODE_TAG_PREFIX = 'encryption - ';
export const PUBLISHER_TAG_PREFIX = 'publisher:';
export const GROUP_ID_TAG_PREFIX = 'groupId:';
export const USER_COUNT_TAG_PREFIX = 'userCount:';
export const LEGACY_ENCRYPTED_PREFIX = 'encrypted:';
export const PRIVATE_TAG = 'private';
export const ENC_METADATA_TAG_PREFIX = 'encmeta:';

const normalizePublisher = (publisher?: string | null) => (publisher || '').trim() || 'unknown';

const normalizeGroupId = (raw?: number | string | null) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return raw;
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
};

const normalizeUserCount = (raw?: number | string | null) => {
  if (typeof raw === 'number' && Number.isFinite(raw)) return Math.max(1, raw);
  if (typeof raw === 'string') {
    const parsed = Number(raw);
    if (Number.isFinite(parsed)) return Math.max(1, parsed);
  }
  return null;
};

const encodeEncMeta = (meta: Record<string, string | number | boolean | null | undefined>) => {
  const pairs = Object.entries(meta)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([key, value]) => `${key}=${encodeURIComponent(String(value))}`);
  return pairs.join('|');
};

export const buildEncryptionTagSet = (args: {
  mode: 'group' | 'direct';
  publisher?: string | null;
  groupId?: number | null;
  userCount?: number | null;
  adminsOnly?: boolean;
  includeLegacyTag?: boolean;
  includePrivateTag?: boolean;
}): string[] => {
  const tags: string[] = [];
  const publisher = normalizePublisher(args.publisher);
  tags.push(`${ENCRYPTION_MODE_TAG_PREFIX}${args.mode}`);
  const metaPayload = encodeEncMeta({
    publisher,
    groupId: args.mode === 'group' ? normalizeGroupId(args.groupId) : undefined,
    userCount: args.mode === 'direct' ? normalizeUserCount(args.userCount) : undefined,
    admins: args.mode === 'group' && args.adminsOnly ? 1 : undefined,
  });
  if (metaPayload) {
    tags.push(`${ENC_METADATA_TAG_PREFIX}${metaPayload}`);
  }
  if (args.includeLegacyTag) tags.push(`${LEGACY_ENCRYPTED_PREFIX}${args.mode}`);
  if (args.includePrivateTag) tags.push(PRIVATE_TAG);
  return tags;
};

const parseModeFromTag = (tag: string): EncryptionMode => {
  const trimmed = tag.trim();
  const lower = trimmed.toLowerCase();
  if (lower.startsWith(ENCRYPTION_MODE_TAG_PREFIX)) {
    const value = trimmed.slice(ENCRYPTION_MODE_TAG_PREFIX.length).trim().toLowerCase();
    return value === 'group' || value === 'direct' ? (value as EncryptionMode) : null;
  }
  if (lower.startsWith(LEGACY_ENCRYPTED_PREFIX)) {
    const value = trimmed.slice(LEGACY_ENCRYPTED_PREFIX.length).trim().toLowerCase();
    return value === 'group' || value === 'direct' ? (value as EncryptionMode) : null;
  }
  return null;
};

const parseNumberFromTag = (tag: string, prefix: string) => {
  if (!tag.toLowerCase().startsWith(prefix.toLowerCase())) return null;
  const raw = tag.slice(prefix.length);
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : null;
};

const parseEncMetaTag = (tag: string) => {
  if (!tag.startsWith(ENC_METADATA_TAG_PREFIX)) return null;
  const payload = tag.slice(ENC_METADATA_TAG_PREFIX.length);
  const entries = payload.split('|');
  const result: { [key: string]: string } = {};
  entries.forEach((entry) => {
    const [key, rawValue] = entry.split('=');
    if (!key) return;
    const value = rawValue ? decodeURIComponent(rawValue) : '';
    result[key.trim()] = value;
  });
  return result;
};

export const getEncryptionInfo = (resource: QdnResource): EncryptionInfo => {
  const metadata = (resource.metadata || {}) as any;
  const tags = filterUserTags(metadata.tags);
  let mode: EncryptionMode = null;
  let publisher: string | null = null;
  let groupId: number | null = null;
  let userCount: number | null = null;
  let adminsOnly = false;

  tags.forEach((tag) => {
    if (!mode) {
      const detected = parseModeFromTag(tag);
      if (detected) mode = detected;
    }
    if (!publisher && tag.toLowerCase().startsWith(PUBLISHER_TAG_PREFIX)) {
      publisher = tag.slice(PUBLISHER_TAG_PREFIX.length).trim();
    }
    if (tag.toLowerCase().startsWith(GROUP_ID_TAG_PREFIX)) {
      const parsed = parseNumberFromTag(tag, GROUP_ID_TAG_PREFIX);
      if (parsed != null) groupId = parsed;
    }
    if (tag.toLowerCase().startsWith(USER_COUNT_TAG_PREFIX)) {
      const parsed = parseNumberFromTag(tag, USER_COUNT_TAG_PREFIX);
      if (parsed != null) userCount = parsed;
    }
    if (tag.toLowerCase().startsWith('groupadmins:')) {
      const value = tag.slice('groupAdmins:'.length).trim().toLowerCase();
      if (value === 'admins-only' || value === 'true') adminsOnly = true;
    }
    if (tag.startsWith(ENC_METADATA_TAG_PREFIX)) {
      const data = parseEncMetaTag(tag);
      if (data) {
        if (!publisher && typeof data.publisher === 'string') {
          publisher = data.publisher;
        }
        if (!groupId && typeof data.groupId === 'string') {
          const parsed = Number(data.groupId);
          if (Number.isFinite(parsed)) groupId = parsed;
        }
        if (!userCount && typeof data.userCount === 'string') {
          const parsed = Number(data.userCount);
          if (Number.isFinite(parsed)) userCount = parsed;
        }
        if (!adminsOnly && data.admins === '1') adminsOnly = true;
      }
    }
  });

  const encryptedMeta = metadata.encrypted;
  if (!mode && encryptedMeta?.mode) {
    const metaMode = String(encryptedMeta.mode).toLowerCase();
    if (metaMode === 'group' || metaMode === 'direct') mode = metaMode as EncryptionMode;
  }
  if (!publisher && typeof encryptedMeta?.publisher === 'string') {
    publisher = encryptedMeta.publisher;
  }
  if (!groupId && encryptedMeta?.groupId) {
    const parsed = Number(encryptedMeta.groupId);
    if (Number.isFinite(parsed)) groupId = parsed;
  }
  if (!userCount && Array.isArray(encryptedMeta?.recipients)) {
    userCount = encryptedMeta.recipients.length;
  }
  if (encryptedMeta?.adminsOnly) adminsOnly = true;

  const shareTarget = metadata.qassetsShareTarget;
  if (!mode && shareTarget?.type === 'group') mode = 'group';
  if (!mode && shareTarget?.type === 'direct') mode = 'direct';
  if (!groupId && shareTarget?.groupId) {
    const parsed = Number(shareTarget.groupId);
    if (Number.isFinite(parsed)) groupId = parsed;
  }

  const isPrivate =
    Boolean(mode) || isPrivateService(resource.service) || tags.includes(PRIVATE_TAG);

  return {
    mode,
    publisher: publisher || null,
    groupId: groupId ?? null,
    userCount: userCount ?? null,
    adminsOnly,
    tags,
    isPrivate,
  };
};

export const resourceIsPrivate = (resource: QdnResource) => getEncryptionInfo(resource).isPrivate;
