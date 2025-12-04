import { objectToBase64 } from './data';
import { NotificationRecipient } from './notificationRecipients';
import { uniqueId6 } from './ids';
import type { Service } from 'qapp-core';
import { publishResourcesWithProgress } from './qdnProgressivePublisher';

const MAIL_SERVICE_TYPE: Service = 'MAIL_PRIVATE';
const QMAIL_IDENTIFIER_PREFIX = '_mail_qortal_qmail_';

type SendQmailParams = {
  senderName: string;
  recipients: NotificationRecipient[];
  subject: string;
  message: string;
  batchSize?: number;
  resumeFrom?: number;
  onThrottle?: (ctx: {
    sent: number;
    total: number;
    nextIndex: number;
    attempt: number;
    delayMs: number;
    error: any;
  }) => Promise<boolean> | boolean;
  onProgress?: (ctx: { sent: number; total: number }) => void;
};
export class QmailPartialError extends Error {
  code = 'QMAIL_PARTIAL';
  sent: number;
  total: number;
  nextIndex: number;
  constructor(msg: string, sent: number, total: number, nextIndex: number) {
    super(msg);
    this.sent = sent;
    this.total = total;
    this.nextIndex = nextIndex;
  }
}

function buildIdentifier(recipientName: string, address: string) {
  const safeName = (recipientName || '').slice(0, 20).replace(/\s+/g, '');
  const suffix = (address || '').slice(-6) || '000000';
  const rand = `${uniqueId6()}${uniqueId6()}`;
  return `${QMAIL_IDENTIFIER_PREFIX}${safeName}_${suffix}_mail_${rand}`;
}

const DEFAULT_BATCH = 10;
const CHUNK_PUBLISH_TIMEOUT_PER_RESOURCE = 12e5; // 20 minutes per resource, similar to qapp-core
const DEFAULT_THROTTLE_DELAY = 60_000;

export async function sendQmailNotifications(params: SendQmailParams) {
  const { senderName, recipients, subject, message } = params;
  if (!senderName) throw new Error('Missing sender name for Q-Mail notification');
  if (!Array.isArray(recipients) || recipients.length === 0) return;

  const validRecipients = recipients.filter(
    (recipient) => recipient?.name && recipient?.publicKey && recipient?.address
  );
  if (!validRecipients.length) return;

  const fallbackPublicKeys = Array.from(
    new Set(validRecipients.map((recipient) => recipient.publicKey))
  );
  if (!fallbackPublicKeys.length) return;

  const batchSize = params.batchSize && params.batchSize > 0 ? params.batchSize : DEFAULT_BATCH;
  const total = validRecipients.length;
  const startIndex = Math.min(total, Math.max(0, params.resumeFrom ?? 0));
  if (startIndex > 0) {
    params.onProgress?.({ sent: startIndex, total });
  }
  if (startIndex >= total) {
    params.onProgress?.({ sent: total, total });
    return;
  }

  const resourcesWithKeys = await Promise.all(
    validRecipients.map(async (recipient) => {
      const payload = {
        subject,
        createdAt: Date.now(),
        version: 1,
        attachments: [],
        textContentV2: message,
        generalData: { thread: [], threadV2: [] },
        recipient: recipient.name,
      };
      const resource = {
        name: senderName,
        service: MAIL_SERVICE_TYPE,
        identifier: buildIdentifier(recipient.name, recipient.address),
        data64: await objectToBase64(payload),
      };
      return {
        resource,
        publicKey: recipient.publicKey,
      };
    })
  );

  const identifierToKey = new Map(
    resourcesWithKeys.map(({ resource, publicKey }) => [resource.identifier, publicKey])
  );

  const pendingResources = resourcesWithKeys.slice(startIndex).map((entry) => entry.resource);
  if (!pendingResources.length) {
    params.onProgress?.({ sent: total, total });
    return;
  }

  let latestSent = startIndex;
  let userCancelled = false;

  const toGlobalCount = (completedResources: number) =>
    Math.min(total, startIndex + completedResources);

  try {
    await publishResourcesWithProgress(
      {
        label: 'Q-Mail notifications',
        resources: pendingResources,
      },
      {
        chunkSize: batchSize,
        throttleDelayMs: DEFAULT_THROTTLE_DELAY,
        onProgress: (ctx) => {
          latestSent = toGlobalCount(ctx.completedResources);
          params.onProgress?.({ sent: latestSent, total });
        },
        onThrottle: async (ctx) => {
          const sent = toGlobalCount(ctx.completedResources);
          latestSent = sent;
          const proceed =
            (await params.onThrottle?.({
              sent,
              total,
              nextIndex: sent,
              attempt: ctx.attempt,
              delayMs: ctx.delayMs,
              error: ctx.error,
            })) ?? true;
          if (!proceed) {
            userCancelled = true;
          }
          return proceed;
        },
        executeChunk: async (chunk) => {
          const chunkKeys = new Set<string>();
          for (const res of chunk) {
            const key = identifierToKey.get(res.identifier);
            if (key) chunkKeys.add(key);
          }
          const keysToUse = chunkKeys.size ? Array.from(chunkKeys) : fallbackPublicKeys;
          const timeoutMs = Math.max(
            CHUNK_PUBLISH_TIMEOUT_PER_RESOURCE,
            chunk.length * CHUNK_PUBLISH_TIMEOUT_PER_RESOURCE
          );
          await qortalRequestWithTimeout(
            {
              action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
              resources: chunk,
              encrypt: true,
              publicKeys: keysToUse,
            },
            timeoutMs
          );
        },
      }
    );
  } catch (e: any) {
    if (userCancelled) {
      throw new QmailPartialError('Q-Mail sending cancelled', latestSent, total, latestSent);
    }
    throw e;
  }
}
