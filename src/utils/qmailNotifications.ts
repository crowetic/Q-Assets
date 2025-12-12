import { objectToBase64 } from './data';
import { NotificationRecipient } from './notificationRecipients';
import { uniqueId6 } from './ids';
import type { Service } from 'qapp-core';
import { enqueueQmailPublishJob } from '../state/publishQueue';

const MAIL_SERVICE_TYPE: Service = 'MAIL_PRIVATE';
const QMAIL_IDENTIFIER_PREFIX = '_mail_qortal_qmail_';

type SendQmailParams = {
  senderName: string;
  recipients: NotificationRecipient[];
  subject: string;
  message: string;
  batchSize?: number;
  resumeFrom?: number;
};
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
  if (startIndex >= total) {
    return null;
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
        base64: await objectToBase64(payload),
      };
      return {
        resource,
        publicKey: recipient.publicKey,
      };
    })
  );

  const identifierKeyMap: Record<string, string> = {};
  resourcesWithKeys.forEach(({ resource, publicKey }) => {
    identifierKeyMap[resource.identifier] = publicKey;
  });

  const pendingResources = resourcesWithKeys.slice(startIndex).map((entry) => entry.resource);
  if (!pendingResources.length) {
    return null;
  }

  const queued = enqueueQmailPublishJob({
    label: subject,
    resources: pendingResources,
    fallbackPublicKeys,
    identifierKeyMap,
    chunkSize: batchSize,
    throttleDelayMs: DEFAULT_THROTTLE_DELAY,
    chunkTimeoutPerResourceMs: CHUNK_PUBLISH_TIMEOUT_PER_RESOURCE,
  });

  if (!queued) return null;
  await queued.completion;
  return queued.id;
}
