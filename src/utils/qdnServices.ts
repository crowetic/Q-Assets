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
