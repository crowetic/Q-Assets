import type { QdnResource } from '../../../hooks/useQdnResources';
import { coerceTags, filterUserTags } from '../../../utils/qdnTags';
import { ensurePrivateService, isPrivateService } from '../../../utils/qdnServices';

export { isPrivateService, ensurePrivateService };

const deriveServiceLabel = (upper: string, original: string) => {
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
  return original;
};

export const serviceLabels = (service?: string) => {
  if (!service) return 'Unlabeled';
  const upper = service.toUpperCase();
  const baseLabel = deriveServiceLabel(upper, service);
  return isPrivateService(service) ? `Private ${baseLabel}` : baseLabel;
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

export const getResourceUpdatedAt = (resource: QdnResource) => {
  const meta = (resource.metadata as any) || {};
  const fromSource = Number(meta.qassetsSource?.updated);
  if (fromSource) return fromSource;
  const tags: string[] = coerceTags(meta.tags);
  const tag = tags.find((t) => t.startsWith('fs-source-updated:'));
  if (tag) {
    const ts = Number(tag.slice('fs-source-updated:'.length));
    if (ts) return ts;
  }
  return typeof resource.updated === 'number' ? resource.updated : undefined;
};
