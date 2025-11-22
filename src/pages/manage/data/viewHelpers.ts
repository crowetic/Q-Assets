import { PRIVATE_SERVICE_FALLBACK } from './constants';
import type { QdnResource } from '../../../hooks/useQdnResources';

const SYSTEM_TAGS = new Set(['qassets-fs', 'qassets-fs-folder']);
const SYSTEM_TAG_PREFIXES = ['fs-path:', 'fs-name:', 'fs-folder:', 'fs-source-created:'];

const coerceTags = (value: any): string[] =>
  Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
    : [];

export const isSystemTag = (tag: string) =>
  SYSTEM_TAGS.has(tag) || SYSTEM_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix));

export const filterUserTags = (tags?: string[]) => coerceTags(tags).filter((tag) => !isSystemTag(tag));

export const serviceLabels = (service?: string) => {
  if (!service) return 'Unlabeled';
  const upper = service.toUpperCase();
  if (upper.includes('DOCUMENT')) return 'Documents';
  if (upper.includes('IMAGE')) return 'Images';
  if (upper.includes('BLOG')) return 'Blogs';
  if (upper.includes('DATA') || upper.includes('JSON') || upper.includes('DATABASE')) return 'Data';
  if (upper.includes('ARCHIVE') || upper.includes('SNAPSHOT')) return 'Archives';
  if (upper.includes('VIDEO')) return 'Video';
  if (upper.includes('AUDIO') || upper.includes('VOICE') || upper.includes('PODCAST'))
    return 'Audio';
  if (upper.includes('MAIL') || upper.includes('MESSAGE')) return 'Messaging';
  if (upper.includes('WEBSITE')) return 'Websites';
  if (
    upper.includes('APP') ||
    upper.includes('PLUGIN') ||
    upper.includes('EXTENSION') ||
    upper.includes('GAME')
  )
    return 'Apps';
  if (upper.includes('FILE')) return 'Files';
  if (
    upper.includes('STORE') ||
    upper.includes('PRODUCT') ||
    upper.includes('OFFER') ||
    upper.includes('COUPON')
  )
    return 'Storefront';
  if (upper.includes('NFT')) return 'NFTs';
  if (upper.includes('LIST')) return 'Lists';
  if (upper.includes('CHAIN')) return 'Chain Data';
  if (upper.includes('THUMBNAIL')) return 'Thumbnails';
  if (upper.includes('AUTO_UPDATE')) return 'Auto Updates';
  return service;
};

export const isPrivateService = (service?: string) => {
  if (!service) return false;
  return service.toUpperCase().includes('PRIVATE');
};

export const ensurePrivateService = (service?: string) => {
  if (service && service.toUpperCase().includes('PRIVATE')) return service;
  return PRIVATE_SERVICE_FALLBACK;
};

export const formatBytes = (value?: number) => {
  if (!value && value !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let n = value;
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n >= 100 ? 0 : n >= 10 ? 1 : 2)} ${units[i]}`;
};

export const formatDate = (value?: number) => {
  if (!value) return '—';
  try {
    return new Date(value).toLocaleString();
  } catch {
    return String(value);
  }
};

export const getResourceLabel = (resource: QdnResource) => {
  const title = resource.metadata?.title;
  if (typeof title === 'string' && title.trim().length) return title.trim();
  const fsName = (resource.metadata as any)?.qassetsFs?.fileName;
  if (typeof fsName === 'string' && fsName.trim().length) return fsName.trim();
  return resource.identifier;
};

export const getResourceStatus = (resource: QdnResource) => resource.status?.status || 'Published';

export const getDisplayTags = (resource: QdnResource) =>
  filterUserTags((resource.metadata as any)?.tags);

export const getResourceCreatedAt = (resource: QdnResource) => {
  const meta = (resource.metadata as any) || {};
  const fromSource = Number(meta.qassetsSource?.created);
  if (fromSource) return fromSource;
  const tags: string[] = coerceTags(meta.tags);
  const tag = tags.find((t) => t.startsWith('fs-source-created:'));
  if (tag) {
    const ts = Number(tag.slice('fs-source-created:'.length));
    if (ts) return ts;
  }
  return resource.created;
};
