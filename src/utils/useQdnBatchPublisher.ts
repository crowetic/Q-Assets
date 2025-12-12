import { useCallback, useEffect } from 'react';
import { usePublish } from 'qapp-core';
import type { Service } from 'qapp-core';
import { useAlert } from '../components/alerts';
// import { PRIVATE_MAGIC_B64 } from '../constants/qdeckIdentifiers';

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

const getPublishExecutor = (): PublishExecutor => {
  if (!activePublishExecutor) {
    throw new Error(
      'QDN publishing is not initialized. Mount useQdnBatchPublisher (which wires qapp-core usePublish) before publishing.'
    );
  }
  return activePublishExecutor;
};

const KB = 1024;
const MB = KB * KB;
const GB = MB * 1024;

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

export async function publishQdnResources(resources: BatchPublishResource[]): Promise<void> {
  if (!resources.length) return;

  validateResources(resources);

  const publishable: PublishableResource[] = resources.map(
    ({
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
    }) => ({
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
    })
  );

  const executor = getPublishExecutor();
  await executor(publishable);
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
