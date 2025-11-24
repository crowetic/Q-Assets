import { NotifScope, NotifRole } from '../types/notifications';
import { sendNotification } from '../notifications/notificationService';

export async function publishScopedNotification(opts: {
  scope: NotifScope;
  title: string;
  html: string;
  publisher: { name: string; address: string; role?: NotifRole };
  qdnResource: { publisher: string; identifier: string };
  sendMail?: boolean;
  links?: { label: string; href: string }[];
}) {
  return sendNotification({
    scope: opts.scope,
    title: opts.title,
    bodyHtml: opts.html,
    links: opts.links,
    publisher: opts.publisher,
    qdnResource: opts.qdnResource,
    deliveries: {
      internal: { enabled: true },
      qmail: { enabled: opts.sendMail },
    },
  });
}
