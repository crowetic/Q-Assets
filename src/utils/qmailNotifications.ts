import { objectToBase64 } from './data';
import { NotificationRecipient } from './notificationRecipients';
import { uniqueId6 } from './ids';
import type { Service } from 'qapp-core';
import { enqueueQdnPublishJob } from '../state/publishQueue';

declare function qortalRequest<T = any>(request: any): Promise<T>;

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

const DEFAULT_BATCH = 50;
const DEFAULT_THROTTLE_DELAY = 60_000;

export async function sendQmailNotifications(params: SendQmailParams) {
  const { senderName, recipients, subject, message } = params;
  if (!senderName) throw new Error('Missing sender name for Q-Mail notification');
  if (!Array.isArray(recipients) || recipients.length === 0) return;

  const validRecipients = recipients.filter(
    (recipient) => recipient?.name && recipient?.publicKey && recipient?.address
  );
  if (!validRecipients.length) return;

  const batchSize = params.batchSize && params.batchSize > 0 ? params.batchSize : DEFAULT_BATCH;
  const total = validRecipients.length;
  const startIndex = Math.min(total, Math.max(0, params.resumeFrom ?? 0));
  if (startIndex >= total) {
    return null;
  }

  const pendingRecipients = validRecipients.slice(startIndex);
  if (!pendingRecipients.length) return null;

  const resources = await Promise.all(
    pendingRecipients.map(async (recipient) => {
      const payload = {
        subject,
        createdAt: Date.now(),
        version: 1,
        attachments: [],
        textContentV2: message,
        generalData: { thread: [], threadV2: [] },
        recipient: recipient.name,
      };
      const base64 = await objectToBase64(payload);
      const encrypted = await qortalRequest({
        action: 'ENCRYPT_DATA',
        base64,
        publicKeys: [recipient.publicKey],
      });
      if (!encrypted || typeof encrypted !== 'string') {
        throw new Error('Unable to encrypt Q-Mail payload.');
      }
      return {
        name: senderName,
        service: MAIL_SERVICE_TYPE,
        identifier: buildIdentifier(recipient.name, recipient.address),
        base64: encrypted,
      };
    })
  );

  const queued = enqueueQdnPublishJob({
    label: subject,
    resources,
    chunkSize: batchSize,
    throttleDelayMs: DEFAULT_THROTTLE_DELAY,
  });

  if (!queued) return null;
  await queued.completion;
  return queued.id;
}
