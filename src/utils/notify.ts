import type { Service } from 'qapp-core';
import {
  addPrivateMagic,
  qAssetsRevenueAddress,
  stripPrivateMagic,
} from '../constants/qdeckIdentifiers';
import { buildNotificationIndexResource, IndexMode } from '../notifications/notifyIndex';
import {
  NotifPaymentProof,
  NotifPolicyV1,
  NotifRole,
  NotifScope,
  NotifV1,
} from '../types/notifications';
import { base64ToObject, objectToBase64 } from './data';
import { sendChatMessage } from './qchat';
import { getAccount, getTransactionInfoBySignature, transferAsset } from './qortalApi';
import { BatchPublishResource } from './useQdnBatchPublisher';
import { enqueueQdnPublishJob } from '../state/publishQueue';

export type NotifPriority = 'low' | 'normal' | 'high';
export type NotifScopeStr =
  | 'global'
  | `asset:${number}`
  | `group:${number}`
  | 'system'
  | `custom:${string}`;

export function quoteNotifFee(policy: NotifPolicyV1, payAssetId: number) {
  if (payAssetId && policy.discount?.assetId === payAssetId) {
    return { assetId: payAssetId, amount: policy.discount.price };
  }
  return { assetId: 0, amount: policy.basePriceQort }; // 0 = QORT
}

export function scopeToKey(scope: NotifScope): NotifScopeStr {
  switch (scope.kind) {
    case 'global':
      return 'global';
    case 'asset':
      return `asset:${scope.assetId}`;
    case 'group':
      return `group:${scope.groupId}`;
    case 'system':
      return 'system';
    case 'custom':
      return `custom:${scope.key}`;
    default:
      return 'global';
  }
}

const isPrivateGroupScope = (scope: NotifScope): scope is NotifScope & { kind: 'group' } =>
  scope.kind === 'group' && scope.privacy !== 'public';

const scopeKeyToGroupId = (scopeKey?: string | null): number | null => {
  if (!scopeKey) return null;
  const match = scopeKey.match(/^group:(\d+)$/);
  if (match) {
    const gid = Number(match[1]);
    return Number.isFinite(gid) ? gid : null;
  }
  return null;
};

const resolveServiceForScope = (
  scope: NotifScope
): { service: Service; encryption?: { groupId: number; adminsOnly?: boolean } } => {
  if (isPrivateGroupScope(scope)) {
    return {
      service: 'DOCUMENT_PRIVATE',
      encryption: { groupId: scope.groupId, adminsOnly: scope.adminsOnly },
    };
  }
  return { service: 'DOCUMENT' };
};

const normalizeIndexMode = (mode?: IndexMode): IndexMode[] => {
  if (!mode) return [];
  return [mode];
};

const DEFAULT_SCOPE_MODES: Record<NotifScope['kind'], IndexMode[]> = {
  global: ['admin'],
  system: ['admin'],
  asset: ['open'],
  group: ['open'],
  custom: ['open'],
};

const dedupeModes = (modes: IndexMode[]) => Array.from(new Set(modes));

export function getScopeIndexModes(scope: NotifScope): IndexMode[] {
  const explicit = normalizeIndexMode(scope.indexMode);
  if (explicit.length) return dedupeModes(explicit);
  return DEFAULT_SCOPE_MODES[scope.kind] || ['open'];
}

export function getScopeIndexModesFromKey(scopeKey: string): IndexMode[] {
  if (scopeKey === 'global') return ['admin'];
  if (scopeKey === 'system') return ['admin'];
  if (scopeKey.startsWith('asset:')) return ['open'];
  if (scopeKey.startsWith('group:')) return ['open'];
  if (scopeKey.startsWith('custom:')) return ['open'];
  return ['open'];
}

async function resolvePublisherName(preferred?: string): Promise<string> {
  if (preferred?.trim()) return preferred.trim();
  const me = await qortalRequest({ action: 'GET_USER_ACCOUNT' });
  const name = me?.name;
  if (typeof name === 'string' && name.trim()) return name.trim();
  throw new Error('Unable to resolve your Qortal name for publishing.');
}

async function encryptNotificationForGroup(
  base64: string,
  groupId: number,
  adminsOnly?: boolean
): Promise<string> {
  const encrypted = await qortalRequest({
    action: 'ENCRYPT_QORTAL_GROUP_DATA',
    base64,
    groupId,
    isAdmins: !!adminsOnly,
  });
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('Failed to encrypt notification payload for group.');
  }
  return addPrivateMagic(encrypted);
}
export async function verifyPayment(
  p: NotifPaymentProof,
  expected: { assetId: number; amount: string; payer: string }
) {
  // Lookup tx; (pseudo) adapt to Core API you use
  const tx = await getTransactionInfoBySignature(p.txSignature);
  // Basic invariants
  if (!tx) return false;
  if (tx.creatorAddress !== expected.payer) return false;
  if (Number(tx.amount) < Number(expected.amount)) return false;
  if ((tx.assetId ?? 0) !== expected.assetId) return false;
  // Optionally confirm block height >= p.blockHeight
  return true;
}

export async function publishNotification(args: {
  scope: NotifScope;
  title: string;
  bodyHtml: string;
  priority?: NotifPriority;
  links?: { label: string; href: string }[];
  payAssetId: number; // 0 = QORT, or your discounted asset
  policy: NotifPolicyV1;
  publisher: { name?: string; address: string; role?: NotifRole };
  chatGroupForGlobal?: number; // optional: group to broadcast a ping
}) {
  const { payAssetId, policy } = args;
  const { assetId, amount } = quoteNotifFee(policy, payAssetId);
  const appRevenueAddress = qAssetsRevenueAddress;
  const numericAmount = Number(amount) || 0;
  const shouldCollect = numericAmount > 0;
  let paymentSignature: string | null = null;
  let paymentBlockHeight = 0;

  // 1) Create and broadcast payment tx
  if (shouldCollect) {
    if (assetId === 0) {
      const payRes = await qortalRequest({
        action: 'SEND_COIN',
        coin: 'QORT',
        amount: numericAmount,
        recipient: appRevenueAddress,
      });
      paymentSignature = payRes?.signature ?? payRes?.txId ?? null;
    } else {
      const senderPublicKey = (await getAccount(args.publisher.address)).publicKey;
      const transferResponse = (await transferAsset(
        args.publisher.address,
        senderPublicKey,
        appRevenueAddress,
        assetId,
        numericAmount
      )) as Response | any;
      if (typeof transferResponse === 'string') {
        paymentSignature = transferResponse;
      } else if (transferResponse && typeof transferResponse === 'object') {
        paymentSignature = transferResponse.signature ?? transferResponse.txId ?? null;
        if (!paymentSignature && typeof transferResponse.text === 'function') {
          try {
            const txt = await transferResponse.text();
            paymentSignature = txt || null;
          } catch {
            paymentSignature = null;
          }
        }
      }
    }

    if (!paymentSignature) throw new Error('Failed to determine notification payment signature');

    const confirmed = await waitForConfirm<any>(paymentSignature, {
      minConfs: 1,
      timeoutMs: 180_000,
      onProgress: (p) => {
        console.log('confirm progress', p);
      },
    });
    paymentBlockHeight = Number(confirmed?.blockHeight ?? 0) || 0;
  }

  // 3) Build Notif JSON(DOCUMENT service)
  const createdAt = Date.now();
  const scopeStr = scopeToKey(args.scope);
  const scopeKey =
    scopeStr.startsWith('asset:') || scopeStr.startsWith('group:') ? scopeStr : 'global';
  const { service, encryption } = resolveServiceForScope(args.scope);
  const publisherName = await resolvePublisherName(args.publisher.name);

  const notifPublisher = { ...args.publisher, name: publisherName };
  const notif: NotifV1 = {
    version: 1,
    scope: scopeStr,
    title: args.title,
    bodyHtml: args.bodyHtml,
    links: args.links,
    priority: args.priority ?? 'normal',
    createdAt,
    publisher: notifPublisher,
    audit: shouldCollect
      ? {
          payment: {
            assetId,
            amount: numericAmount,
            txSignature: paymentSignature!,
            blockHeight: paymentBlockHeight,
          },
        }
      : undefined,
  };

  const id = `qassets_notif::${createdAt.toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
  const ridName = publisherName || args.publisher.address;
  const rid = `${service}/${ridName}/${id}`;

  const baseNotif64 = await objectToBase64(notif);
  let finalNotif64 = baseNotif64;
  let notifMetadata: Record<string, any> | undefined;
  let notifTags: string[] | undefined;

  if (encryption) {
    finalNotif64 = await encryptNotificationForGroup(
      baseNotif64,
      encryption.groupId,
      encryption.adminsOnly
    );
    notifMetadata = {
      encrypted: {
        mode: 'group',
        groupId: encryption.groupId,
        adminsOnly: Boolean(encryption.adminsOnly),
      },
    };
    notifTags = ['private', 'encrypted:group'];
  }

  const resources: BatchPublishResource[] = [
    {
      name: publisherName,
      service,
      identifier: id,
      data64: finalNotif64,
      metadata: notifMetadata,
      tags: notifTags,
    },
  ];

  const indexModes = getScopeIndexModes(args.scope);
  const indexOpts = args.scope.kind === 'group' ? { groupId: args.scope.groupId } : undefined;

  const targetModes: IndexMode[] = indexModes.length ? indexModes : (['admin'] as IndexMode[]);

  const indexResources = await Promise.all(
    targetModes.map((mode) =>
      buildNotificationIndexResource(
        scopeKey,
        {
          rid,
          createdAt,
          priority: notif.priority,
        },
        { ...indexOpts, mode }
      )
    )
  );

  for (const indexResource of indexResources) {
    resources.push({
      name: publisherName,
      service: indexResource.service as Service,
      identifier: indexResource.identifier,
      data64: indexResource.data64,
    });
  }

  const queued = enqueueQdnPublishJob({
    label: `Notification publish (${scopeKey})`,
    resources,
  });
  if (!queued) throw new Error('Unable to queue notification publish');
  await queued.completion;

  // 4) Optional: ping Q-Chat (feeless)
  if (scopeKey === 'global' && args.chatGroupForGlobal) {
    const ping = buildNotifPing({
      rid,
      scope: scopeKey as NotifScopeStr,
      priority: notif.priority as NotifPriority,
      title: notif.title,
      ts: createdAt,
    });

    await sendChatMessage({ groupId: args.chatGroupForGlobal, fullContent: ping });
  }

  return { id, notif };
}

type NotifItem = NotifV1 & { rid: string };

export function mergeNotifs(existing: Record<string, NotifItem>, incoming: NotifItem[]) {
  const out = { ...existing };
  for (const n of incoming) out[n.rid] = n;
  return out;
}

export function shouldDisplay(n: NotifV1, /*userPrefs: any,*/ policy: NotifPolicyV1) {
  // 1) TTL
  if (n.ttl && Date.now() - n.createdAt > n.ttl) return false;
  // 2) For global scope: require valid payment
  if (n.scope === 'global' && !n.audit?.payment) return false;
  // 3) Link allowlist (basic scan)
  const okLinks = (n.links || []).every((l) =>
    policy.linkAllowlist?.some((p) => l.href.startsWith(p))
  );
  if (policy.linkAllowlist?.length && !okLinks) return false;
  // 4) User prefs (asset filters, muted tags, etc)
  return true;
}

export interface NotifPingV1 {
  kind: 'notif';
  ver: 1;
  rid: string; // "JSON/<publisher>/qassets_notif::<id>"
  scope: NotifScopeStr; // "global" | "asset:123" | ...
  priority?: NotifPriority;
  title?: string; // optional microcopy for the toast
  ts: number; // ms
}

export function buildNotifPing(
  params: Omit<NotifPingV1, 'kind' | 'ver' | 'ts'> & { ts?: number }
): NotifPingV1 {
  const { rid, scope, priority, title, ts } = params;
  if (!rid || !scope) throw new Error('buildNotifPing: rid and scope are required');
  return { kind: 'notif', ver: 1, rid, scope, priority, title, ts: ts ?? Date.now() };
}

type ParsedRid = {
  service: 'JSON' | 'DOCUMENT' | 'DOCUMENT_PRIVATE';
  name: string;
  identifier: string;
};

function parseRid(rid: string): ParsedRid | null {
  if (!rid) return null;
  const m = rid.match(/^(JSON|DOCUMENT|DOCUMENT_PRIVATE)\/([^/]+)\/(.+)$/i);
  if (!m) return null;
  const [, serviceRaw, name, identifier] = m;
  const serviceUpper = serviceRaw.toUpperCase();
  if (serviceUpper !== 'DOCUMENT' && serviceUpper !== 'JSON' && serviceUpper !== 'DOCUMENT_PRIVATE')
    return null;
  const service = serviceUpper as ParsedRid['service'];
  return { service, name, identifier };
}

export async function fetchNotificationByRid(
  rid: string,
  opts?: { scopeKey?: string }
): Promise<NotifV1 | null> {
  const parsed = parseRid(rid);
  if (!parsed) return null;
  try {
    const res = await qortalRequest({
      action: 'FETCH_QDN_RESOURCE',
      service: parsed.service,
      name: parsed.name,
      identifier: parsed.identifier,
      encoding: 'base64',
    });
    let data64 = res?.data64 ?? res;
    if (!data64 || typeof data64 !== 'string') return null;
    if (parsed.service === 'DOCUMENT_PRIVATE') {
      const stripped = stripPrivateMagic(data64);
      if (!stripped) return null;
      const groupId = scopeKeyToGroupId(opts?.scopeKey);
      if (groupId != null) {
        const clear = await qortalRequest({
          action: 'DECRYPT_QORTAL_GROUP_DATA',
          base64: stripped,
          groupId,
          isAdmins: false,
        });
        if (!clear || typeof clear !== 'string') return null;
        data64 = clear;
      } else {
        const clear = await qortalRequest({
          action: 'DECRYPT_DATA',
          encryptedData: stripped,
        });
        if (!clear || typeof clear !== 'string') return null;
        data64 = clear;
      }
    }
    // const json = atob(data64);
    const notif = (await base64ToObject(data64)) as NotifV1;
    return notif;
  } catch {
    return null;
  }
}

// pseudo-code — adapt to your encryption API shape
export async function sendEncryptedNotifPing(opts: {
  groupId: number;
  ping: NotifPingV1;
  groupPublicKey: string; // if you have it available
}) {
  const plaintext = await objectToBase64(opts.ping);
  const { encryptedDataBase64 } = await qortalRequest({
    action: 'ENCRYPT_QORTAL_GROUP_DATA',
    base64: plaintext,
    groupId: opts.groupId,
    isAdmins: false,
  });

  return sendChatMessage({
    groupId: opts.groupId,
    fullContent: {
      type: 'encrypted',
      payload64: encryptedDataBase64,
      schema: 'qassets.notif.v1',
    },
  });
}

export function parseNotifPing(content: unknown): NotifPingV1 | null {
  if (!content || typeof content !== 'object') return null;
  const c: any = content;

  // direct envelope
  if (
    c.kind === 'notif' &&
    c.ver === 1 &&
    typeof c.rid === 'string' &&
    typeof c.scope === 'string'
  ) {
    return {
      kind: 'notif',
      ver: 1,
      rid: c.rid,
      scope: c.scope,
      priority: c.priority,
      title: c.title,
      ts: typeof c.ts === 'number' ? c.ts : Date.now(),
    };
  }

  // TipTap-wrapped form fallback (if you go that route)
  if (c.type === 'qassets-ping' && c.payload?.kind === 'notif') {
    return parseNotifPing(c.payload);
  }

  return null;
}

async function getCurrentBlockHeight(): Promise<number | null> {
  try {
    // @ts-expect-error qortalRequest is app-global in your codebase; import if needed.
    const h = await qortalRequest({ action: 'GET_BLOCK_HEIGHT' });
    return typeof h === 'number' && h > 0 ? h : null;
  } catch {
    return null;
  }
}

function sleep(ms: number, signal?: AbortSignal) {
  return new Promise<void>((resolve, reject) => {
    const id = setTimeout(resolve, ms);
    if (signal) {
      const onAbort = () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      if (signal.aborted) onAbort();
      signal.addEventListener('abort', onAbort, { once: true });
    }
  });
}

export interface WaitForConfirmOptions {
  /** How many confirmations are required before resolving. Default: 1 (included block). */
  minConfs?: number;
  /** Max time to wait before throwing. Default: 120_000 ms (2 min). */
  timeoutMs?: number;
  /** Base polling interval. Default: 3000 ms. */
  pollMs?: number;
  /** Add jitter to polling to avoid thundering herd. Default: 250 ms. */
  jitterMs?: number;
  /** Abort controller signal to cancel the wait. */
  signal?: AbortSignal;
  /** Progress hook for UI. */
  onProgress?: (info: {
    found: boolean;
    blockHeight?: number;
    confirmations?: number;
    currentHeight?: number | null;
    attempts: number;
    elapsedMs: number;
  }) => void;
}

/**
 * Polls the chain for a transaction by signature until it is confirmed,
 * then (optionally) waits for `minConfs` confirmations.
 *
 * Resolves with the tx object returned by `getTransactionInfoBySignature`.
 * Throws on timeout / abort / explicit rejection status.
 */
export async function waitForConfirm<
  TTx extends {
    signature: string;
    blockHeight?: number;
    approvalStatus?: string;
  },
>(signature: string, opts: WaitForConfirmOptions = {}): Promise<TTx> {
  const {
    minConfs = 1,
    timeoutMs = 120_000,
    pollMs = 3000,
    jitterMs = 250,
    signal,
    onProgress,
  } = opts;

  const started = Date.now();
  let attempts = 0;

  const deadline = started + timeoutMs;

  while (true) {
    attempts += 1;

    // 1) Fetch tx by signature
    const tx = (await getTransactionInfoBySignature(signature)) as unknown as TTx | null;

    if (tx) {
      // Some cores expose "REJECTED"/"INVALID" states; bail early if seen.
      if (typeof (tx as any).approvalStatus === 'string') {
        const st = String((tx as any).approvalStatus).toUpperCase();
        if (st.includes('REJECT') || st.includes('INVALID') || st.includes('CANCEL')) {
          throw new Error(`Transaction ${signature} not confirmed (status=${st})`);
        }
      }

      const includedHeight = Number((tx as any).blockHeight || 0);

      // If minConfs == 0 you could resolve immediately after propagation (not recommended)
      if (minConfs <= 1 && includedHeight > 0) {
        onProgress?.({
          found: true,
          blockHeight: includedHeight,
          confirmations: 1,
          currentHeight: includedHeight,
          attempts,
          elapsedMs: Date.now() - started,
        });
        return tx;
      }

      if (includedHeight > 0) {
        // 2) Wait for extra confirmations if requested
        const current = await getCurrentBlockHeight();
        const confs = current && includedHeight ? current - includedHeight + 1 : 1;

        onProgress?.({
          found: true,
          blockHeight: includedHeight,
          confirmations: confs || 1,
          currentHeight: current,
          attempts,
          elapsedMs: Date.now() - started,
        });

        if (confs !== null && confs >= minConfs) {
          return tx;
        }
      } else {
        // Found but not yet in a block
        onProgress?.({
          found: true,
          blockHeight: undefined,
          confirmations: 0,
          currentHeight: null,
          attempts,
          elapsedMs: Date.now() - started,
        });
      }
    } else {
      // Not found yet
      onProgress?.({
        found: false,
        attempts,
        elapsedMs: Date.now() - started,
      } as any);
    }

    // 3) Check timeout
    const now = Date.now();
    if (now >= deadline) {
      throw new Error(`Timed out waiting for tx ${signature} to confirm after ${timeoutMs} ms`);
    }

    // 4) Backoff with small jitter
    const jitter = Math.floor(Math.random() * jitterMs);
    const wait = pollMs + jitter;

    await sleep(wait, signal);
  }
}
