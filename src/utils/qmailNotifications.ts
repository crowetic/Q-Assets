import { objectToBase64 } from './data';
import { NotificationRecipient } from './notificationRecipients';
import { uniqueId6 } from './ids';

const MAIL_SERVICE_TYPE = 'MAIL_PRIVATE';
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

const DEFAULT_BATCH = 60;

const delay = (ms: number) => new Promise((res) => setTimeout(res, ms));

export async function sendQmailNotifications(params: SendQmailParams) {
  const { senderName, recipients, subject, message } = params;
  if (!senderName) throw new Error('Missing sender name for Q-Mail notification');
  if (!Array.isArray(recipients) || recipients.length === 0) return;

  const resources: Array<{
    name: string;
    service: typeof MAIL_SERVICE_TYPE;
    identifier: string;
    data64: string;
  }> = [];
  const keySet = new Set<string>();

  for (const recipient of recipients) {
    if (!recipient?.name || !recipient?.publicKey) continue;
    const identifier = buildIdentifier(recipient.name, recipient.address);
    const payload = {
      subject,
      createdAt: Date.now(),
      version: 1,
      attachments: [],
      textContentV2: message,
      generalData: { thread: [], threadV2: [] },
      recipient: recipient.name,
    };
    const data64 = await objectToBase64(payload);
    resources.push({
      name: senderName,
      service: MAIL_SERVICE_TYPE,
      identifier,
      data64,
    });
    keySet.add(recipient.publicKey);
  }

  if (!resources.length || !keySet.size) return;

  const batchSize = params.batchSize && params.batchSize > 0 ? params.batchSize : DEFAULT_BATCH;
  let sent = Math.max(0, params.resumeFrom ?? 0);
  let attempt = 0;

  while (sent < resources.length) {
    const nextBatch = resources.slice(sent, sent + batchSize);
    const batchKeys = new Set<string>();
    nextBatch.forEach((r) => {
      // find matching recipient publicKey based on identifier suffix
      const rec = recipients.find((rr) => r.identifier.includes(rr.address?.slice(-6) || ''));
      if (rec?.publicKey) batchKeys.add(rec.publicKey);
    });
    try {
      await qortalRequest({
        action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
        resources: nextBatch,
        encrypt: true,
        publicKeys: Array.from(batchKeys.size ? batchKeys : keySet),
      });
      sent += nextBatch.length;
      params.onProgress?.({ sent, total: resources.length });
    } catch (e: any) {
      const msg = `${e?.message || e}`.toLowerCase();
      const isThrottle = msg.includes('too many unconfirmed');
      if (isThrottle) {
        attempt += 1;
        const delayMs = 60_000;
        const proceed =
          (await params.onThrottle?.({
            sent,
            total: resources.length,
            nextIndex: sent,
            attempt,
            delayMs,
            error: e,
          })) ?? true;
        if (!proceed)
          throw new QmailPartialError('Q-Mail sending cancelled', sent, resources.length, sent);
        await delay(delayMs);
        continue;
      }
      throw e;
    }
  }
}
