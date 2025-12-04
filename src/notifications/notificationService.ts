import { NotifScope, NotifRole, NotifPolicyV1 } from '../types/notifications';
import { publishNotification } from '../utils/notify';
import {
  resolveNotificationRecipients,
  NotificationRecipient,
} from '../utils/notificationRecipients';
import { sendQmailNotifications } from '../utils/qmailNotifications';
import { sendChatMessage } from '../utils/qchat';
import type { NotifPriority } from '../types/notifications';

const DEFAULT_POLICY: NotifPolicyV1 = {
  version: 1,
  basePriceQort: 0,
};

const DEFAULT_APP_LINK = 'qortal://APP/Q-Assets';

const stripHtml = (html: string) =>
  (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const buildResourceUrl = (resource?: { publisher: string; identifier: string }) =>
  resource ? `qortal://DOCUMENT/${resource.publisher}/${resource.identifier}` : null;

const buildQmailMessage = (params: {
  title: string;
  bodyHtml: string;
  resource?: { publisher: string; identifier: string };
}) => {
  const excerpt = stripHtml(params.bodyHtml).slice(0, 400);
  const resourceUrl = buildResourceUrl(params.resource);
  const lines = [
    `New Q-Assets update: ${params.title}`,
    '',
    excerpt,
    '',
    `Open in Q-Assets: ${DEFAULT_APP_LINK}`,
  ];
  if (resourceUrl) {
    lines.push(`Resource: ${resourceUrl}`);
  }
  return lines.join('\n');
};

const buildChatMessage = (params: {
  title: string;
  bodyHtml: string;
  resource?: { publisher: string; identifier: string };
}) => {
  const excerpt = stripHtml(params.bodyHtml).slice(0, 280);
  const resourceUrl = buildResourceUrl(params.resource);
  const parts = [`🔔 ${params.title}`, '', excerpt];
  if (resourceUrl) {
    parts.push('', `Link: ${resourceUrl}`);
  }
  parts.push('', `Open Q-Assets: ${DEFAULT_APP_LINK}`);
  return parts.join('\n');
};

export type NotificationPublisher = { name?: string; address: string; role?: NotifRole };

export type NotificationDeliveryRequest = {
  scope: NotifScope;
  title: string;
  bodyHtml: string;
  publisher: NotificationPublisher;
  qdnResource?: { publisher: string; identifier: string };
  links?: { label: string; href: string }[];
  policy?: NotifPolicyV1;
  payAssetId?: number;
  qmailOptions?: {
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
  deliveries?: {
    internal?: { enabled?: boolean; chatPingGroupId?: number; priority?: NotifPriority };
    qmail?: {
      enabled?: boolean;
      recipients?: NotificationRecipient[];
      includeScopeSubscribers?: boolean;
      subject?: string;
      message?: string;
    };
    chat?: {
      groups?: number[];
      message?: string;
    };
  };
};

export type NotificationDeliveryResult = {
  internal?: { rid: string };
  qmail?: { recipients: number };
  chat?: { groups: number };
};

export async function sendNotification(
  request: NotificationDeliveryRequest
): Promise<NotificationDeliveryResult> {
  const results: NotificationDeliveryResult = {};
  const deliveries = request.deliveries || {};

  if (deliveries.internal?.enabled !== false) {
    const { id } = await publishNotification({
      scope: request.scope,
      title: request.title,
      bodyHtml: request.bodyHtml,
      links: request.links,
      payAssetId: request.payAssetId ?? 0,
      policy: request.policy ?? DEFAULT_POLICY,
      publisher: request.publisher,
      chatGroupForGlobal: deliveries.internal?.chatPingGroupId,
    });
    results.internal = { rid: id };
  }

  if (deliveries.qmail?.enabled) {
    const senderName = request.publisher.name;
    if (!senderName) {
      console.warn('Unable to send Q-Mail notification without publisher name');
    } else {
      let recipients: NotificationRecipient[] = [];
      if (Array.isArray(deliveries.qmail.recipients)) {
        recipients = deliveries.qmail.recipients;
      } else if (deliveries.qmail.includeScopeSubscribers === false) {
        recipients = [];
      } else {
        recipients = await resolveNotificationRecipients(request.scope);
      }
      if (recipients.length) {
        const subject = deliveries.qmail.subject || `Q-Assets: ${request.title}`;
        const message =
          deliveries.qmail.message ||
          buildQmailMessage({
            title: request.title,
            bodyHtml: request.bodyHtml,
            resource: request.qdnResource,
          });
        await sendQmailNotifications({
          senderName,
          recipients,
          subject,
          message,
          batchSize: request.qmailOptions?.batchSize,
          resumeFrom: request.qmailOptions?.resumeFrom,
        });
        results.qmail = { recipients: recipients.length };
      }
    }
  }

  if (deliveries.chat?.groups?.length) {
    const message =
      deliveries.chat.message ||
      buildChatMessage({
        title: request.title,
        bodyHtml: request.bodyHtml,
        resource: request.qdnResource,
      });
    const chatPayload = { text: message };
    await Promise.all(
      deliveries.chat.groups.map((groupId) =>
        sendChatMessage({ groupId, fullContent: chatPayload })
      )
    );
    results.chat = { groups: deliveries.chat.groups.length };
  }

  return results;
}
