import { useCallback, useEffect } from 'react';
import { usePublish } from 'qapp-core';
import type { Service } from 'qapp-core';
import { useAlert } from '../components/alerts';
import { ENCRYPTION_MODE_TAG_PREFIX, ENC_METADATA_TAG_PREFIX } from './qdnEncryption';
import { isPrivateService } from './qdnServices';
// import { PRIVATE_MAGIC_B64 } from '../constants/qdeckIdentifiers';

declare function qortalRequest<T = any>(request: any): Promise<T>;

type PublishableResource = {
  name: string;
  service: Service;
  identifier: string;
  base64: string;
  title?: string;
  description?: string;
  tags?: string[];
  category?: string;
  filename?: string;
  disableEncrypt?: boolean;
};

export type BatchPublishResource = PublishableResource & {
  metadata?: Record<string, any>;
  privateMode?: 'group' | 'direct';
  groupId?: number;
  isAdmins?: boolean;
  recipients?: string[];
};

type PublishExecutor = (resources: PublishableResource[]) => Promise<void>;

let activePublishExecutor: PublishExecutor | null = null;

const registerPublishExecutor = (executor: PublishExecutor | null) => {
  activePublishExecutor = executor;
};

const fallbackPublishExecutor: PublishExecutor = async (resources) => {
  if (!resources.length) return;
  console.warn(
    '[useQdnBatchPublisher] publish executor not initialized, falling back to direct PUBLISH_MULTIPLE_QDN_RESOURCES'
  );
  await qortalRequest({
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    resources,
  });
};

const getPublishExecutor = (): PublishExecutor => {
  if (!activePublishExecutor) {
    return fallbackPublishExecutor;
  }
  return activePublishExecutor;
};

const KB = 1024;
const MB = KB * KB;
const GB = MB * 1024;
const MAX_TAGS = 5;

// QDN service limits (bytes). Private variants fall back to half of their public counterpart.
const BASE_SERVICE_LIMITS: Partial<Record<Service, number>> = {
  ARBITRARY_DATA: 2 * GB,
  QCHAT_ATTACHMENT: 1 * MB,
  ATTACHMENT: 50 * MB,
  FILE: 2 * GB,
  FILES: 2 * GB,
  CHAIN_DATA: 239,
  WEBSITE: 2 * GB,
  IMAGE: 10 * MB,
  THUMBNAIL: 500 * KB,
  QCHAT_IMAGE: 500 * KB,
  VIDEO: 2 * GB,
  AUDIO: 2 * GB,
  QCHAT_AUDIO: 10 * MB,
  QCHAT_VOICE: 10 * MB,
  VOICE: 10 * MB,
  PODCAST: 2 * GB,
  BLOG: 2 * GB,
  BLOG_POST: 2 * GB,
  BLOG_COMMENT: 500 * KB,
  DOCUMENT: 2 * GB,
  LIST: 2 * GB,
  PLAYLIST: 2 * GB,
  APP: 50 * MB,
  METADATA: 2 * GB,
  JSON: 25 * KB,
  GIF_REPOSITORY: 25 * MB,
  STORE: 2 * GB,
  PRODUCT: 2 * GB,
  OFFER: 2 * GB,
  COUPON: 2 * GB,
  CODE: 2 * GB,
  PLUGIN: 2 * GB,
  EXTENSION: 2 * GB,
  GAME: 2 * GB,
  ITEM: 2 * GB,
  NFT: 2 * GB,
  DATABASE: 2 * GB,
  SNAPSHOT: 2 * GB,
  COMMENT: 500 * KB,
  CHAIN_COMMENT: 239,
  MAIL: 1 * MB,
  MESSAGE: 1 * MB,
  IMAGE_PRIVATE: 10 * MB,
  VOICE_PRIVATE: 10 * MB,
  MESSAGE_PRIVATE: 1 * MB,
  QCHAT_ATTACHMENT_PRIVATE: 1 * MB,
  ATTACHMENT_PRIVATE: 50 * MB,
};

const DEFAULT_SERVICE_LIMIT = 2 * GB;

const deriveLimit = (service: Service): number => {
  if (BASE_SERVICE_LIMITS[service]) return BASE_SERVICE_LIMITS[service]!;
  if (service.endsWith('_PRIVATE')) {
    const publicService = service.replace('_PRIVATE', '') as Service;
    const base = BASE_SERVICE_LIMITS[publicService];
    if (base) return Math.floor(base / 2);
  }
  return DEFAULT_SERVICE_LIMIT;
};

export const getServiceLimit = (service: Service): number => deriveLimit(service);

// const isPrivateService = (service: Service): boolean =>
//   service === 'DOCUMENT_PRIVATE' || service.endsWith('_PRIVATE');

const estimateBase64Bytes = (data64: string) => {
  const padding = data64.endsWith('==') ? 2 : data64.endsWith('=') ? 1 : 0;
  return Math.floor((data64.length * 3) / 4) - padding;
};

const formatBytes = (value: number) => {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[unit]}`;
};

// const ensurePrivateMagicPrefix = (res: BatchPublishResource) => {
//   if (!isPrivateService(res.service)) return;
//   if (!res.data64.startsWith(PRIVATE_MAGIC_B64)) {
//     res.data64 = PRIVATE_MAGIC_B64 + res.data64;
//   }
// };

const normalizeBase64 = (resource: BatchPublishResource): BatchPublishResource => {
  if (typeof resource.base64 === 'string') return resource;
  const legacy = (resource as BatchPublishResource & { data64?: unknown }).data64;
  if (typeof legacy === 'string') {
    console.warn('[useQdnBatchPublisher] resource missing base64, using data64', {
      name: resource.name,
      service: resource.service,
      identifier: resource.identifier,
    });
    return { ...resource, base64: legacy };
  }
  throw new Error(
    `Missing base64 data for ${resource.identifier} (${resource.service}).`
  );
};

const validateResources = (resources: BatchPublishResource[]) => {
  resources.forEach((res) => {
    // ensurePrivateMagicPrefix(res);
    const limit = deriveLimit(res.service);
    const size = estimateBase64Bytes(res.base64);
    if (size > limit) {
      throw new Error(
        `Resource ${res.identifier} exceeds the ${formatBytes(limit)} limit for ${
          res.service
        }. Size is ${formatBytes(size)}.`
      );
    }
  });
};

const normalizeTagList = (tags?: string[]) =>
  Array.isArray(tags)
    ? tags
        .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter((tag) => Boolean(tag && tag.length))
    : [];

const TAG_PRIORITY_RULES: Array<(tag: string) => boolean> = [
  (tag) => tag.startsWith('qassets-'),
  (tag) => tag.startsWith('fs-path:') || tag.startsWith('fs-name:') || tag.startsWith('fs-folder:'),
  (tag) => tag.startsWith('share:'),
  (tag) => tag.startsWith(ENCRYPTION_MODE_TAG_PREFIX),
  (tag) => tag.startsWith(ENC_METADATA_TAG_PREFIX),
];

const splitTagsByPriority = (tags?: string[]) => {
  const normalized = normalizeTagList(tags);
  const kept: string[] = [];
  const used = new Array(normalized.length).fill(false);
  const addIndex = (idx: number) => {
    if (kept.length >= MAX_TAGS) return;
    kept.push(normalized[idx]);
    used[idx] = true;
  };

  TAG_PRIORITY_RULES.forEach((rule) => {
    if (kept.length >= MAX_TAGS) return;
    normalized.forEach((tag, idx) => {
      if (kept.length >= MAX_TAGS || used[idx]) return;
      if (rule(tag)) addIndex(idx);
    });
  });

  if (kept.length < MAX_TAGS) {
    normalized.forEach((_, idx) => {
      if (kept.length >= MAX_TAGS || used[idx]) return;
      addIndex(idx);
    });
  }

  const overflow = normalized.filter((_, idx) => !used[idx]);
  return { kept, overflow };
};

const stringifyExtra = (label: string, value: unknown) => {
  if (value == null) return '';
  try {
    return `${label}:\n${JSON.stringify(value, null, 2)}`;
  } catch {
    return `${label}: ${String(value)}`;
  }
};

const sanitizeResource = (resource: BatchPublishResource): PublishableResource => {
  const {
    name,
    service,
    identifier,
    base64,
    title,
    description,
    tags,
    category,
    filename,
    disableEncrypt,
    metadata,
    privateMode,
    groupId,
    isAdmins,
    recipients,
  } = resource;

  const { kept: limitedTags, overflow: extraTags } = splitTagsByPriority(tags);
  const extraSegments: string[] = [];
  if (metadata && Object.keys(metadata).length) {
    extraSegments.push(stringifyExtra('Metadata', metadata));
  }
  if (privateMode) extraSegments.push(`Private mode: ${privateMode}`);
  if (typeof groupId !== 'undefined') {
    extraSegments.push(`Group ID: ${groupId}`);
  }
  if (typeof isAdmins !== 'undefined') {
    extraSegments.push(`Admins only: ${isAdmins ? 'yes' : 'no'}`);
  }
  if (recipients && recipients.length) {
    extraSegments.push(stringifyExtra('Recipients', recipients));
  }
  if (extraTags.length) {
    extraSegments.push(`Additional tags: ${extraTags.join(', ')}`);
  }

  const combinedDescription = [description?.trim(), extraSegments.join('\n')?.trim()]
    .filter(Boolean)
    .join('\n\n');

  return {
    name,
    service,
    identifier,
    base64,
    title,
    description: combinedDescription || undefined,
    tags: limitedTags.length ? limitedTags : undefined,
    category,
    filename,
    disableEncrypt,
  };
};

const isPrivatePublish = (
  resource: BatchPublishResource,
  sanitized: PublishableResource
): boolean => {
  if (resource.privateMode === 'direct') return true;
  if (isPrivateService(resource.service) || isPrivateService(sanitized.service)) return true;
  if (sanitized.disableEncrypt && sanitized.service && isPrivateService(sanitized.service)) {
    return true;
  }
  return false;
};

const summarizeResourceForLog = (resource: PublishableResource) => ({
  name: resource.name,
  service: resource.service,
  identifier: resource.identifier,
  disableEncrypt: Boolean(resource.disableEncrypt),
  tagCount: resource.tags?.length ?? 0,
  hasTitle: Boolean(resource.title),
  hasDescription: Boolean(resource.description),
  bytes: estimateBase64Bytes(resource.base64),
});

export async function publishQdnResources(resources: BatchPublishResource[]): Promise<void> {
  if (!resources.length) return;

  const normalized = resources.map(normalizeBase64);

  validateResources(normalized);

  const publishable: { original: BatchPublishResource; sanitized: PublishableResource }[] =
    normalized.map((res) => ({
      original: res,
      sanitized: sanitizeResource(res),
    }));

  const executor = getPublishExecutor();
  const allResources = publishable.map(({ sanitized }) => sanitized);
  try {
    await executor(allResources);
    return;
  } catch (err) {
    console.error('[useQdnBatchPublisher] executor publish failed', {
      error: err,
      resources: allResources.map(summarizeResourceForLog),
    });
    console.warn('usePublish publishMultipleResources failed, falling back to direct publish', err);
  }

  const privateResources: PublishableResource[] = [];
  const publicResources: PublishableResource[] = [];
  publishable.forEach(({ original, sanitized }) => {
    if (isPrivatePublish(original, sanitized)) privateResources.push(sanitized);
    else publicResources.push(sanitized);
  });

  if (privateResources.length >= 4) {
    try {
      await qortalRequest({
        action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
        resources: privateResources,
      });
    } catch (error) {
      console.error('[useQdnBatchPublisher] private fallback publish failed', {
        error,
        resources: privateResources.map(summarizeResourceForLog),
      });
      throw error;
    }
  } else if (privateResources.length) {
    try {
      await Promise.all(
        privateResources.map(
          async (res) =>
            await qortalRequest({
              action: 'PUBLISH_QDN_RESOURCE',
              name: res.name,
              service: res.service,
              identifier: res.identifier,
              base64: res.base64,
              title: res.title,
              description: res.description,
              tags: res.tags,
              category: res.category,
              filename: res.filename,
              // disableEncrypt: res.disableEncrypt
            })
        )
      );
    } catch (error) {
      console.error('[useQdnBatchPublisher] private fallback publish failed', {
        error,
        resources: privateResources.map(summarizeResourceForLog),
      });
      throw error;
    }
  }

  if (publicResources.length) {
    try {
      await qortalRequest({
        action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
        resources: publicResources,
      });
    } catch (fallbackErr) {
      console.error('[useQdnBatchPublisher] fallback publish failed', {
        error: fallbackErr,
        resources: publicResources.map(summarizeResourceForLog),
      });
      throw fallbackErr;
    }
  }
}

export function useQdnBatchPublisher() {
  const { alert } = useAlert();
  const { publishMultipleResources } = usePublish();

  useEffect(() => {
    const executor: PublishExecutor = async (mappedResources) => {
      await publishMultipleResources(mappedResources);
    };
    registerPublishExecutor(executor);
    return () => {
      if (activePublishExecutor === executor) {
        registerPublishExecutor(null);
      }
    };
  }, [publishMultipleResources]);

  const publish = useCallback(
    async (resources: BatchPublishResource[]) => {
      console.log('resources to publish in batch mode', resources);
      if (!resources.length) return;
      try {
        await publishQdnResources(resources);
      } catch (e: any) {
        await alert(e?.message || 'Failed to publish resources.', 'Publish error', {
          severity: 'error',
        });
        throw e;
      }
    },
    [alert]
  );

  return { publish };
}
