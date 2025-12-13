import type { Service } from 'qapp-core';

export const PRIVATE_SERVICE_FALLBACK: Service = 'DOCUMENT_PRIVATE';

export const isPrivateService = (service?: string) => {
  if (!service) return false;
  return service.toUpperCase().includes('PRIVATE');
};

export const ensurePrivateService = (service?: string): Service => {
  if (service && service.toUpperCase().includes('PRIVATE')) return service as Service;
  return PRIVATE_SERVICE_FALLBACK;
};

export const ensurePublicService = (service?: string): Service => {
  if (!service) return 'DOCUMENT';
  const upper = service.toUpperCase();
  if (upper.endsWith('_PRIVATE')) {
    return service.slice(0, service.toUpperCase().lastIndexOf('_PRIVATE')) as Service;
  }
  return service as Service;
};

export type EncryptionPublishMode = 'group' | 'direct' | null | undefined;

export const resolveServiceForEncryptionMode = (
  service?: string,
  mode?: EncryptionPublishMode
): Service => {
  if (mode === 'group') return ensurePublicService(service);
  if (mode === 'direct') return ensurePrivateService(service);
  return (service as Service) || 'DOCUMENT';
};
