import { qAssetsRevenueAddress } from "../constants/qdeckIdentifiers";
import { appendToIndex } from "../notifications/notifyIndex";
import { NotifPaymentProof, NotifPolicyV1, NotifRole, NotifScope, NotifV1 } from "../types/notifications";
import { objectToBase64 } from "./data";
import { sendChatMessage } from "./qchat";
import { getAccount, getTransactionInfoBySignature, transferAsset } from "./qortalApi";

export function quoteNotifFee(policy: NotifPolicyV1, payAssetId: number) {
  if (payAssetId && policy.discount?.assetId === payAssetId) {
    return { assetId: payAssetId, amount: policy.discount.price };
  }
  return { assetId: 0, amount: policy.basePriceQort }; // 0 = QORT
}


export async function verifyPayment(p: NotifPaymentProof, expected: { assetId: number; amount: string; payer: string }) {
  // Lookup tx; (pseudo) adapt to Core API you use
  const tx = await getTransactionInfoBySignature( p.txSignature );
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
  payAssetId: number;                  // 0 = QORT, or your discounted asset
  policy: NotifPolicyV1;
  publisher: { name?: string; address: string; role?: NotifRole };
  chatGroupForGlobal?: number;         // optional: group to broadcast a ping
}) {
  const { payAssetId, policy } = args;
  const { assetId, amount } = quoteNotifFee(policy, payAssetId);
  const appRevenueAddress = qAssetsRevenueAddress

  // 1) Create and broadcast payment tx
  let payTx
  if (assetId === 0) {
    payTx = await qortalRequest({
      action: 'SEND_COIN', // or SEND_ASSET
      coin: 'QORT',
      amount,
      recipient: appRevenueAddress, // set this
    });
  } else {
    const senderPublicKey = (await getAccount(args.publisher.address)).publicKey
    
    payTx = await transferAsset(
        args.publisher.address,
        senderPublicKey,
        appRevenueAddress,
        assetId,
        amount,
      );
  }



  // 2) Wait confirm (or N blocks)
  await waitForConfirm(payTx.signature, {
  minConfs: 1,          // or 2-3 if you want extra safety
  timeoutMs: 180_000,   // 3 minutes
  onProgress: (p) => {
    // optional: hook into your useFetchTracker / toast
    console.log('confirm progress', p);
  },
});

  // 3) Build Notif JSON
  const createdAt = Date.now();
  const scopeStr =
    args.scope.kind === 'global'
      ? 'global'
      : args.scope.kind === 'asset'
      ? `asset:${args.scope.assetId}`
      : args.scope.kind === 'group'
      ? `group:${args.scope.groupId}`
      : args.scope.kind === 'system'
      ? 'system'
      : `custom:${args.scope.key}`;

  const notif: NotifV1 = {
    version: 1,
    scope: scopeStr,
    title: args.title,
    bodyHtml: args.bodyHtml,
    links: args.links,
    priority: args.priority ?? 'normal',
    createdAt,
    publisher: args.publisher,
    audit: {
      payment: {
        assetId,
        amount,
        txSignature: payTx.signature,
        blockHeight: payTx.blockHeight ?? 0,
      },
    },
  };

  // 4) Publish Notif JSON
  const id = `qassets_notif::${createdAt.toString(36)}_${Math.random().toString(36).slice(2,8)}`;

  await qortalRequest({
    action: 'PUBLISH_QDN_RESOURCE',
    service: 'DOCUMENT',
    identifier: id,
    data64: await objectToBase64(notif),
    // name = publisher's name; defaulted by core if omitted
  });

  // 5) Append pointer to scope index
  const scopeKey = scopeStr.startsWith('asset:') || scopeStr.startsWith('group:')
    ? scopeStr
    : 'global';

  await appendToIndex(scopeKey, {
    rid: `JSON/${args.publisher.name || args.publisher.address}/${id}`,
    createdAt,
    priority: notif.priority,
  });

  // 6) Optional: ping Q-Chat (feeless)
  if (scopeKey === 'global' && args.chatGroupForGlobal) {
    const ping = buildNotifPing({
      rid: `JSON/${args.publisher.name || args.publisher.address}/${id}`,
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
  const okLinks = (n.links || []).every(l => policy.linkAllowlist?.some(p => l.href.startsWith(p)));
  if (policy.linkAllowlist?.length && !okLinks) return false;
  // 4) User prefs (asset filters, muted tags, etc)
  return true;
}

export type NotifPriority = 'low' | 'normal' | 'high';
export type NotifScopeStr = 'global' | `asset:${number}` | `group:${number}` | `system` | `custom:${string}`;

export interface NotifPingV1 {
  kind: 'notif';
  ver: 1;
  rid: string;            // "JSON/<publisher>/qassets_notif::<id>"
  scope: NotifScopeStr;   // "global" | "asset:123" | ...
  priority?: NotifPriority;
  title?: string;         // optional microcopy for the toast
  ts: number;             // ms
}

export function buildNotifPing(params: Omit<NotifPingV1, 'kind' | 'ver' | 'ts'> & { ts?: number }): NotifPingV1 {
  const { rid, scope, priority, title, ts } = params;
  if (!rid || !scope) throw new Error('buildNotifPing: rid and scope are required');
  return { kind: 'notif', ver: 1, rid, scope, priority, title, ts: ts ?? Date.now() };
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
    base64: plaintext ,
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
  if (c.kind === 'notif' && c.ver === 1 && typeof c.rid === 'string' && typeof c.scope === 'string') {
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
      const onAbort = () => { clearTimeout(id); reject(new DOMException('Aborted', 'AbortError')); };
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
export async function waitForConfirm<TTx extends {
  signature: string;
  blockHeight?: number;
  approvalStatus?: string;
}>(signature: string, opts: WaitForConfirmOptions = {}): Promise<TTx> {
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
    const tx = await getTransactionInfoBySignature(signature) as unknown as TTx | null;

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