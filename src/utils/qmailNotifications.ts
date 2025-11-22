import { objectToBase64 } from './data';
import { NotificationRecipient } from './notificationRecipients';
import { uniqueId6 } from './ids';

const MAIL_SERVICE_TYPE: 'MAIL_PRIVATE' = 'MAIL_PRIVATE';
const QMAIL_IDENTIFIER_PREFIX = '_mail_qortal_qmail_';

type SendQmailParams = {
  senderName: string;
  recipients: NotificationRecipient[];
  subject: string;
  message: string;
};

function buildIdentifier(recipientName: string, address: string) {
  const safeName = (recipientName || '').slice(0, 20).replace(/\s+/g, '');
  const suffix = (address || '').slice(-6) || '000000';
  const rand = `${uniqueId6()}${uniqueId6()}`;
  return `${QMAIL_IDENTIFIER_PREFIX}${safeName}_${suffix}_mail_${rand}`;
}

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

  await qortalRequest({
    action: 'PUBLISH_MULTIPLE_QDN_RESOURCES',
    resources,
    encrypt: true,
    publicKeys: Array.from(keySet),
  });
}
