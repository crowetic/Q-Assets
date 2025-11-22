import { NotifPolicyV1 } from '../types/notifications';
import { publishNotification } from './notify';
import { NotifScope } from '../types/notifications';
import { resolveNotificationRecipients } from './notificationRecipients';
import { sendQmailNotifications } from './qmailNotifications';
import type { NotifRole } from '../types/notifications';

const DEFAULT_POLICY: NotifPolicyV1 = {
  version: 1,
  basePriceQort: 0,
};

const stripHtml = (html: string) =>
  (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

type PublisherInfo = {
  name: string;
  address: string;
  role?: NotifRole;
};

async function notifyByMail(opts: {
  scope: NotifScope;
  title: string;
  html: string;
  sender: PublisherInfo;
  resource: { publisher: string; identifier: string };
}) {
  if (!opts.sender.name) return;
  const recipients = await resolveNotificationRecipients(opts.scope);
  if (!recipients.length) return;
  const excerpt = stripHtml(opts.html).slice(0, 400);
  const lines = [
    `New Q-Assets update: ${opts.title}`,
    '',
    excerpt,
    '',
    `Open in Q-Assets: qortal://APP/Q-Assets`,
    `Resource: qortal://DOCUMENT/${opts.resource.publisher}/${opts.resource.identifier}`,
  ];

  await sendQmailNotifications({
    senderName: opts.sender.name,
    recipients,
    subject: `Q-Assets: ${opts.title}`,
    message: lines.join('\n'),
  });
}

export async function publishScopedNotification(opts: {
  scope: NotifScope;
  title: string;
  html: string;
  publisher: PublisherInfo;
  qdnResource: { publisher: string; identifier: string };
  sendMail?: boolean;
  links?: { label: string; href: string }[];
}) {
  await publishNotification({
    scope: opts.scope,
    title: opts.title,
    bodyHtml: opts.html,
    links: opts.links,
    payAssetId: 0,
    policy: DEFAULT_POLICY,
    publisher: opts.publisher,
  });

  if (opts.sendMail) {
    await notifyByMail({
      scope: opts.scope,
      title: opts.title,
      html: opts.html,
      sender: opts.publisher,
      resource: opts.qdnResource,
    });
  }
}
