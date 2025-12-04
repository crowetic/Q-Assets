import { useEffect, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  Typography,
  useTheme,
  useMediaQuery,
  FormControlLabel,
  Checkbox,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  CircularProgress,
  FormHelperText,
  type SelectChangeEvent,
} from '@mui/material';
import { useAuth } from 'qapp-core';
import TiptapEditor from '../TipTapEditor';
import QdnPublishStatus from '../common/QdnPublishStatus';
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import { objectToBase64 } from '../../utils/data';
import { sendNotification } from '../../notifications/notificationService';
import { NOTIF_GROUP_ID } from '../../notifications/notifyIndex';
import { qaAnnouncementPrefix } from '../../constants/qdnConstants';
import { uniqueId6 } from '../../utils/ids';
import { getAccountGroups, type GroupSummary } from '../../utils/qortalApi';
import type { NotifScope } from '../../types/notifications';
import { QmailPartialError } from '../../utils/qmailNotifications';
import type { NotificationRecipient } from '../../utils/notificationRecipients';
import { prepareQmailRecipients } from '../../utils/qmailRecipientCache';
import { useQdnProgressivePublisher } from '../../hooks/useQdnProgressivePublisher';
import { PublishJobError } from '../../utils/qdnProgressivePublisher';

type Props = {
  open: boolean;
  onClose: () => void;
  publishIdentifierPrefix?: string;
};

const APP_HOME_LINK = 'qortal://APP/Q-Assets';

type QmailPartial = {
  title: string;
  identifier: string;
  sent: number;
  total: number;
  savedAt: number;
};

function saveQmailPartial(info: QmailPartial) {
  try {
    localStorage.setItem('qassets_qmail_partial', JSON.stringify(info));
  } catch {
    /* ignore */
  }
}

export default function AnnouncementDialog({
  open,
  onClose,
  publishIdentifierPrefix = qaAnnouncementPrefix,
}: Props) {
  const [title, setTitle] = useState('');
  const [contentHtml, setContentHtml] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const { name: userName, address, authenticateUser } = useAuth();
  const [notifyMail, setNotifyMail] = useState(false);
  const [notifyChat, setNotifyChat] = useState(false);
  const [groupOptions, setGroupOptions] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [notificationGroupId, setNotificationGroupId] = useState<number | ''>('');
  const {
    publish: publishAnnouncementResources,
    progress: qdnProgress,
    throttle: qdnThrottle,
  } = useQdnProgressivePublisher();
  const [qmailThrottle, setQmailThrottle] = useState<{
    sent: number;
    total: number;
    secondsLeft: number;
    resolver: (v: boolean) => void;
    identifier: string;
    title: string;
  } | null>(null);

  useEffect(() => {
    if (!qmailThrottle) return;
    const id = setInterval(() => {
      setQmailThrottle((prev) => {
        if (!prev) return prev;
        const next = prev.secondsLeft - 1;
        if (next <= 0) {
          prev.resolver(true);
          return null;
        }
        return { ...prev, secondsLeft: next };
      });
    }, 1000);
    return () => clearInterval(id);
  }, [qmailThrottle]);

  const cancelQmailThrottle = () => {
    if (!qmailThrottle) return;
    saveQmailPartial({
      title: qmailThrottle.title,
      identifier: qmailThrottle.identifier,
      sent: qmailThrottle.sent,
      total: qmailThrottle.total,
      savedAt: Date.now(),
    });
    qmailThrottle.resolver(false);
    setQmailThrottle(null);
    setBusy(false);
    setErr(
      `Q-Mail paused after ${qmailThrottle.sent}/${qmailThrottle.total}. Saved for re-publish later.`
    );
  };

  useEffect(() => {
    if (!address) {
      setGroupOptions([]);
      return;
    }
    let aborted = false;
    (async () => {
      try {
        setGroupsLoading(true);
        const groups = await getAccountGroups(address);
        if (!aborted) setGroupOptions(groups);
      } catch {
        if (!aborted) setGroupOptions([]);
      } finally {
        if (!aborted) setGroupsLoading(false);
      }
    })();
    return () => {
      aborted = true;
    };
  }, [address]);

  async function handlePublish() {
    setErr(null);

    const prepared = prepareHtmlForPublish(contentHtml, theme);
    if (!title?.trim() || !prepared.trim()) {
      setErr('Title and content required.');
      return;
    }
    if (!userName) {
      authenticateUser();
      setErr('You must be logged in with a Qortal name to publish.');
      return;
    }
    let identifier = '';
    try {
      setBusy(true);

      const annPayload = {
        title,
        html: prepared,
        createdAt: Date.now(),
        kind: 'QASSETS_ANNOUNCEMENT',
      };

      const prefix = publishIdentifierPrefix || qaAnnouncementPrefix;
      identifier = `${prefix}${uniqueId6()}`;

      const announcementBase64 = await objectToBase64(annPayload);

      await publishAnnouncementResources({
        label: 'Announcement publish',
        resources: [
          {
            name: userName,
            service: 'DOCUMENT',
            identifier,
            data64: announcementBase64,
          },
        ],
      });

      const qmailOptions = () => ({
        batchSize: 10,
        onThrottle: (ctx: { sent: number; total: number; delayMs: number; nextIndex: number }) =>
          new Promise<boolean>((resolve) => {
            setQmailThrottle({
              sent: ctx.sent,
              total: ctx.total,
              secondsLeft: Math.ceil(ctx.delayMs / 1000),
              resolver: resolve,
              identifier,
              title,
            });
          }),
        onProgress: ({ sent, total }: { sent: number; total: number }) =>
          setQmailThrottle((prev) => (prev ? { ...prev, sent, total } : prev)),
      });

      if ((notifyMail || notifyChat) && address) {
        const extraGroupId =
          notificationGroupId && Number.isFinite(Number(notificationGroupId))
            ? Number(notificationGroupId)
            : null;
        const extraGroup =
          extraGroupId != null ? groupOptions.find((g) => g.groupId === extraGroupId) : null;
        const extraGroupScope: Extract<NotifScope, { kind: 'group' }> | null =
          extraGroupId && extraGroup
            ? {
                kind: 'group',
                groupId: extraGroupId,
                privacy: extraGroup.isOpen ? 'public' : 'private',
              }
            : extraGroupId
              ? { kind: 'group', groupId: extraGroupId }
              : null;
        const links = [
          {
            label: 'View resource',
            href: `qortal://DOCUMENT/${userName}/${identifier}`,
          },
          {
            label: 'Open Q-Assets',
            href: APP_HOME_LINK,
          },
        ];
        const publisher = { name: userName, address, role: 'admin' as const };
        const notifyTasks: Array<() => Promise<unknown>> = [];

        let globalRecipients: NotificationRecipient[] = [];
        let extraGroupRecipients: NotificationRecipient[] = [];
        if (notifyMail) {
          globalRecipients = await prepareQmailRecipients({ kind: 'global' });
          if (
            extraGroupScope &&
            extraGroupScope.groupId &&
            extraGroupScope.groupId !== NOTIF_GROUP_ID
          ) {
            extraGroupRecipients = await prepareQmailRecipients(extraGroupScope);
          }
        }
        const qmailSubject = `Q-Assets: ${title}`;

        notifyTasks.push(() =>
          sendNotification({
            scope: { kind: 'global' },
            title,
            bodyHtml: prepared,
            publisher,
            qdnResource: { publisher: userName, identifier },
            links,
            qmailOptions: qmailOptions(),
            deliveries: {
              internal: { enabled: true, chatPingGroupId: notifyChat ? NOTIF_GROUP_ID : undefined },
              qmail: notifyMail
                ? {
                    enabled: true,
                    includeScopeSubscribers: true,
                    subject: qmailSubject,
                    ...(globalRecipients.length ? { recipients: globalRecipients } : {}),
                  }
                : undefined,
              chat: notifyChat ? { groups: [NOTIF_GROUP_ID] } : undefined,
            },
          })
        );

        if (extraGroupScope && extraGroupScope.groupId !== NOTIF_GROUP_ID) {
          notifyTasks.push(() =>
            sendNotification({
              scope: extraGroupScope,
              title,
              bodyHtml: prepared,
              publisher,
              qdnResource: { publisher: userName, identifier },
              links,
              qmailOptions: qmailOptions(),
              deliveries: {
                internal: { enabled: true },
                qmail: notifyMail
                  ? {
                      enabled: true,
                      includeScopeSubscribers: true,
                      subject: qmailSubject,
                      ...(extraGroupRecipients.length ? { recipients: extraGroupRecipients } : {}),
                    }
                  : undefined,
                chat: notifyChat ? { groups: [extraGroupScope.groupId] } : undefined,
              },
            })
          );
        }

        if (notifyTasks.length) {
          for (const task of notifyTasks) {
            await task();
          }
        }
      }

      onClose();
      setNotifyMail(false);
      setNotifyChat(false);
      setNotificationGroupId('');
      setContentHtml('');
      setTitle('');
    } catch (e: any) {
      const msg = typeof e?.message === 'string' ? e.message : '';
      const lower = msg.toLowerCase();
      const declineReported = lower.includes('user declined request');
      if (e instanceof PublishJobError) {
        setErr(e.message || 'Announcement publishing cancelled.');
      } else if (e instanceof QmailPartialError || e?.code === 'QMAIL_PARTIAL') {
        saveQmailPartial({
          title,
          identifier,
          sent: e.sent ?? 0,
          total: e.total ?? 0,
          savedAt: Date.now(),
        });
        setErr(
          e?.message ||
            `Q-Mail paused after ${e.sent ?? 0}/${e.total ?? 0}. Saved progress for re-publish.`
        );
      } else {
        setErr(
          declineReported
            ? 'A Qortal request was declined while fetching recipient info. Please approve the prompt in Qortal (if it is behind other windows) and re-try.'
            : e?.message || 'Failed to publish announcement.'
        );
      }
    } finally {
      if (!qmailThrottle && !qdnThrottle) setBusy(false);
    }
  }

  return (
    <Dialog
      open={open}
      onClose={busy ? undefined : onClose}
      fullScreen={isXs}
      fullWidth
      maxWidth={isXs ? 'md' : 'lg'}
      slotProps={{
        paper: {
          sx: {
            width: { xs: '100%', md: '80vw' },
            maxWidth: '1200px',
          },
        },
      }}
    >
      <DialogTitle>New Q-Assets Announcement</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'grid', gap: 2 }}>
          <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
          <Box>
            <Typography variant="caption" color="text.secondary">
              Use the rich text editor to format your announcement.
            </Typography>
            <Box sx={{ mt: 1 }}>
              <TiptapEditor value={contentHtml} onChange={setContentHtml} />
            </Box>
          </Box>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={notifyMail}
                  onChange={(e) => setNotifyMail(e.target.checked)}
                  disabled={!userName}
                />
              }
              label={
                <Tooltip title="Send encrypted Q-Mail copies to notification subscribers. Each recipient incurs a publish fee.">
                  <span>Notify via Q-Mail</span>
                </Tooltip>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={notifyChat}
                  onChange={(e) => setNotifyChat(e.target.checked)}
                  disabled={!userName}
                />
              }
              label={
                <Tooltip title="Send a short Q-Chat ping to the Q-Assets notifications group.">
                  <span>Notify via Q-Chat</span>
                </Tooltip>
              }
            />
          </Box>
          <Box sx={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
            <FormControl sx={{ minWidth: 260 }}>
              <InputLabel id="announcement-group-select">Additional group (optional)</InputLabel>
              <Select
                labelId="announcement-group-select"
                label="Additional group (optional)"
                value={notificationGroupId === '' ? '' : notificationGroupId}
                onChange={(e: SelectChangeEvent<number | ''>) => {
                  const val = e.target.value;
                  setNotificationGroupId(val === '' ? '' : Number(val));
                }}
                disabled={groupsLoading || !address}
              >
                <MenuItem value="">
                  {notifyMail || notifyChat
                    ? 'None (global subscribers only)'
                    : 'Enable mail or chat to send notifications'}
                </MenuItem>
                {groupsLoading && (
                  <MenuItem value="" disabled>
                    <CircularProgress size={16} sx={{ mr: 1 }} /> Loading groups…
                  </MenuItem>
                )}
                {!groupsLoading && groupOptions.length === 0 && (
                  <MenuItem value="" disabled>
                    No groups found for your account
                  </MenuItem>
                )}
                {groupOptions.map((g) => (
                  <MenuItem key={g.groupId} value={g.groupId}>
                    {g.groupName} (#{g.groupId}) {g.isAdmin ? '— admin' : ''}{' '}
                    {g.isOpen ? '(Public)' : '(Private)'}
                  </MenuItem>
                ))}
              </Select>
              <FormHelperText>
                Send announcement notifications to a specific group in addition to Q-Assets
                subscribers.
              </FormHelperText>
            </FormControl>
          </Box>
          <QdnPublishStatus
            progress={qdnProgress}
            throttle={qdnThrottle}
            contextLabel="Publishing announcement"
          />
          {qmailThrottle && (
            <Box
              sx={{
                p: 1,
                border: (t) => `1px solid ${t.palette.warning.main}`,
                borderRadius: 1,
                bgcolor: (t) => t.palette.warning.light,
                color: (t) => t.palette.getContrastText(t.palette.warning.light),
              }}
            >
              <Typography variant="body2" fontWeight={700}>
                Q-Mail throttled
              </Typography>
              <Typography variant="body2">
                Sent {qmailThrottle.sent}/{qmailThrottle.total}. Auto-retrying in{' '}
                {qmailThrottle.secondsLeft}s.
              </Typography>
              <Box sx={{ mt: 1, display: 'flex', gap: 1 }}>
                <Button variant="contained" color="warning" onClick={cancelQmailThrottle}>
                  Cancel / Pause
                </Button>
              </Box>
            </Box>
          )}
          {err && <Box sx={{ color: 'error.main', fontSize: 13 }}>{err}</Box>}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={handlePublish} disabled={busy} variant="contained">
          {busy ? 'Publishing…' : 'Publish'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
