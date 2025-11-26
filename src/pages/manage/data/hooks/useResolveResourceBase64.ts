import { useCallback } from 'react';
import type { QdnResource } from '../../../../hooks/useQdnResources';
import type { GroupSummary } from '../../../../utils/qortalApi';
import {
  addPrivateMagic,
  stripPrivateMagic,
  PRIVATE_MAGIC_B64,
} from '../../../../constants/qdeckIdentifiers';
import { isPrivateService } from '../viewHelpers';

declare function qortalRequest<T = any>(req: any): Promise<T>;

export const hasPrivateMagicPrefix = (base64: string) => base64.startsWith(PRIVATE_MAGIC_B64);

export const applyPrivateMagicIfNeeded = (base64: string, service?: string) => {
  if (isPrivateService(service)) return base64;
  return hasPrivateMagicPrefix(base64) ? base64 : addPrivateMagic(base64);
};

export const stripPrivateMagicIfNeeded = (base64: string, _service?: string) => {
  console.log('removing private magic', base64, 'from service (if passed)', _service);
  return stripPrivateMagic(base64);
};

type GroupDecryptAttempt = {
  groupId: number;
  isAdmins: boolean;
};

const buildGroupDecryptAttempts = (
  groups: GroupSummary[],
  priority?: { groupId?: number | null; adminBias?: boolean | null }
): GroupDecryptAttempt[] => {
  const attempts: GroupDecryptAttempt[] = [];
  const seen = new Set<string>();
  const pushAttempt = (groupId?: number | null, isAdmins = false) => {
    if (!groupId || !Number.isFinite(groupId)) return;
    const key = `${groupId}:${isAdmins ? 1 : 0}`;
    if (seen.has(key)) return;
    seen.add(key);
    attempts.push({ groupId, isAdmins });
  };

  if (priority?.groupId) {
    pushAttempt(priority.groupId, !!priority.adminBias);
    pushAttempt(priority.groupId, false);
    pushAttempt(priority.groupId, true);
  }

  groups.forEach((grp) => {
    pushAttempt(grp.groupId, false);
    pushAttempt(grp.groupId, true);
  });

  return attempts;
};

const tryGroupDecryptSequence = async (
  payload: string,
  attempts: GroupDecryptAttempt[]
): Promise<string | null> => {
  for (const attempt of attempts) {
    try {
      const clear = await qortalRequest({
        action: 'DECRYPT_QORTAL_GROUP_DATA',
        base64: payload,
        groupId: attempt.groupId,
        isAdmins: attempt.isAdmins,
      });
      if (clear) return clear;
    } catch {
      // continue trying other combos
    }
  }
  return null;
};

export const normalizeData64 = (payload: any): string | null => {
  if (!payload) return null;
  if (typeof payload === 'string') return payload;
  if (typeof payload.data64 === 'string') return payload.data64;
  if (typeof payload.base64 === 'string') return payload.base64;
  return null;
};

export async function fetchResourceBase64(resource: QdnResource) {
  const res = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    service: resource.service as any,
    identifier: resource.identifier,
    name: resource.name,
    encoding: 'base64',
  });
  const data64 = normalizeData64(res);
  if (!data64) throw new Error('Unable to fetch resource data.');
  return data64;
}

export async function fetchPrivateBase64(resource: QdnResource): Promise<string> {
  const res = await qortalRequest({
    action: 'FETCH_QDN_RESOURCE',
    name: resource.name,
    service: resource.service as any,
    identifier: resource.identifier,
    encoding: 'base64',
  });
  const data64 = normalizeData64(res);
  if (!data64) throw new Error('Unable to load encrypted resource.');
  return data64;
}

async function decryptPrivateBase64(
  resource: QdnResource,
  encryptedWithMagic: string,
  groups: GroupSummary[]
): Promise<string> {
  const meta = (resource.metadata || {}) as any;
  const encryptedMeta = meta.encrypted;
  const shareTarget = meta.qassetsShareTarget;

  let mode: 'group' | 'direct' | null = null;
  let groupId: number | null = null;
  let adminsOnly = false;

  if (encryptedMeta?.mode === 'group') {
    mode = 'group';
    groupId = Number(encryptedMeta.groupId);
    adminsOnly = !!encryptedMeta.adminsOnly;
  } else if (encryptedMeta?.mode === 'direct') {
    mode = 'direct';
  } else if (shareTarget?.type === 'group') {
    mode = 'group';
    groupId = Number(shareTarget.groupId);
  } else if (shareTarget?.type === 'direct') {
    mode = 'direct';
  }

  const encryptedPayload = stripPrivateMagicIfNeeded(encryptedWithMagic, resource.service);

  try {
    const direct = await qortalRequest({
      action: 'DECRYPT_DATA',
      encryptedData: encryptedPayload,
    });
    if (direct) return direct;
  } catch {
    // ignore; fall through
  }

  if (mode === 'group' && groupId) {
    const preferredAttempts = buildGroupDecryptAttempts(groups, {
      groupId,
      adminBias: adminsOnly,
    });
    const clear = await tryGroupDecryptSequence(encryptedPayload, preferredAttempts);
    if (clear) return clear;
  }

  if (mode === 'direct') {
    const clear = await qortalRequest({
      action: 'DECRYPT_DATA',
      encryptedData: encryptedPayload,
    });
    if (!clear) throw new Error('Unable to decrypt direct resource.');
    return clear;
  }

  const fallbackAttempts = buildGroupDecryptAttempts(groups);
  const fallbackClear = await tryGroupDecryptSequence(encryptedPayload, fallbackAttempts);
  if (fallbackClear) return fallbackClear;

  throw new Error('Unable to decrypt this resource with your current keys.');
}

const tryDecryptLegacyBase64 = async (
  base64: string,
  groups: GroupSummary[]
): Promise<string | null> => {
  const payload = hasPrivateMagicPrefix(base64) ? stripPrivateMagic(base64) : base64;
  try {
    const direct = await qortalRequest({
      action: 'DECRYPT_DATA',
      encryptedData: payload,
    });
    if (direct) return direct;
  } catch {
    // ignore direct failure; try groups
  }
  const attempts = buildGroupDecryptAttempts(groups);
  return tryGroupDecryptSequence(payload, attempts);
};

export const useResolveResourceBase64 = (groups: GroupSummary[]) =>
  useCallback(
    async (
      resource: QdnResource,
      onStep?: (
        step: 'fetch' | 'decrypt',
        status: 'pending' | 'active' | 'success' | 'error',
        message?: string
      ) => void
    ): Promise<string> => {
      let base64: string | null = null;
      try {
        onStep?.('fetch', 'active');
        if (isPrivateService(resource.service)) {
          const encrypted = await fetchPrivateBase64(resource);
          onStep?.('fetch', 'success');
          onStep?.('decrypt', 'active');
          base64 = await decryptPrivateBase64(resource, encrypted, groups);
          onStep?.('decrypt', 'success');
        } else {
          base64 = await fetchResourceBase64(resource);
          onStep?.('fetch', 'success');
          if (base64 && hasPrivateMagicPrefix(base64)) {
            onStep?.('decrypt', 'active');
            const legacy = await tryDecryptLegacyBase64(base64, groups);
            if (!legacy) {
              onStep?.('decrypt', 'error', 'Encrypted resource could not be decrypted.');
              throw new Error('Encrypted resource could not be decrypted with your keys.');
            }
            base64 = legacy;
            onStep?.('decrypt', 'success');
          } else {
            onStep?.('decrypt', 'success');
          }
        }
      } catch (e: any) {
        if (!base64) onStep?.('fetch', 'error', e?.message || 'Unable to fetch resource.');
        throw e;
      }
      if (!base64) throw new Error('Unable to load resource data.');
      return base64;
    },
    [groups]
  );
