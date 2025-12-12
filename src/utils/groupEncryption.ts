import type { Service } from 'qapp-core';
import { fetchCurrentBlockHeight } from './blockHeight';

export const GROUP_ENCRYPTION_SERVICE: Service = 'DOCUMENT';
export const LEGACY_GROUP_ENCRYPTION_SERVICE: Service = 'DOCUMENT_PRIVATE';

const GROUP_ENCRYPTION_SWITCH_BLOCK =
  Number(
    (typeof import.meta !== 'undefined' &&
      (import.meta as any)?.env?.VITE_GROUP_ENCRYPTION_SWITCH_BLOCK) ||
      0
  ) || 0;

let includeLegacyResult: boolean | null = GROUP_ENCRYPTION_SWITCH_BLOCK === 0 ? true : null;
let includeLegacyPromise: Promise<boolean> | null = null;

export function resolveGroupPublishService(mode: 'group' | 'direct' = 'group'): Service {
  return mode === 'group' ? GROUP_ENCRYPTION_SERVICE : LEGACY_GROUP_ENCRYPTION_SERVICE;
}

export async function shouldQueryLegacyGroupResources(): Promise<boolean> {
  if (GROUP_ENCRYPTION_SWITCH_BLOCK === 0) return true;
  if (includeLegacyResult != null) return includeLegacyResult;

  if (!includeLegacyPromise) {
    includeLegacyPromise = (async () => {
      try {
        const height = await fetchCurrentBlockHeight();
        includeLegacyResult = height < GROUP_ENCRYPTION_SWITCH_BLOCK;
      } catch (error) {
        console.warn('Unable to determine QDN group encryption switch block', error);
        includeLegacyResult = true;
      } finally {
        includeLegacyPromise = null;
      }
      return includeLegacyResult!;
    })();
  }

  return includeLegacyPromise;
}

export async function getGroupResourceServices(): Promise<Service[]> {
  const includeLegacy = await shouldQueryLegacyGroupResources();
  return includeLegacy
    ? [GROUP_ENCRYPTION_SERVICE, LEGACY_GROUP_ENCRYPTION_SERVICE]
    : [GROUP_ENCRYPTION_SERVICE];
}

export function shouldUseLegacyPrivateMagic(
  service?: Service | string,
  mode?: 'group' | 'direct' | null
): boolean {
  if (mode !== 'group') return false;
  if (typeof service !== 'string') return false;
  const normalized = service.toUpperCase();
  return normalized === LEGACY_GROUP_ENCRYPTION_SERVICE;
}
