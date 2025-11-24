import { useState } from 'react';
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
} from '@mui/material';
import { useAuth } from 'qapp-core';
import TiptapEditor from '../TipTapEditor';
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import { objectToBase64 } from '../../utils/data';
import { sendNotification } from '../../notifications/notificationService';
import { NOTIF_GROUP_ID } from '../../notifications/notifyIndex';

type Props = {
  open: boolean;
  onClose: () => void;
  publishIdentifierPrefix?: string; // e.g. "qassets_announce"
};

export default function AnnouncementDialog({
  open,
  onClose,
  publishIdentifierPrefix = 'qassets_announce',
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
    try {
      setBusy(true);

      const blogPayload = {
        title,
        html: prepared,
        createdAt: Date.now(),
        kind: 'QASSETS_ANNOUNCEMENT',
      };

      const identifier = `${publishIdentifierPrefix}_${Date.now()}`;

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'BLOG_POST',
        identifier,
        data64: await objectToBase64(blogPayload),
      });

      if ((notifyMail || notifyChat) && address) {
        await sendNotification({
          scope: { kind: 'global' },
          title,
          bodyHtml: prepared,
          publisher: { name: userName, address, role: 'admin' },
          qdnResource: { publisher: userName, identifier },
          links: [
            {
              label: 'View resource',
              href: `qortal://DOCUMENT/${userName}/${identifier}`,
            },
          ],
          deliveries: {
            internal: { enabled: true, chatPingGroupId: notifyChat ? NOTIF_GROUP_ID : undefined },
            qmail: notifyMail
              ? {
                  enabled: true,
                  includeScopeSubscribers: true,
                  subject: `Q-Assets: ${title}`,
                }
              : undefined,
            chat: notifyChat ? { groups: [NOTIF_GROUP_ID] } : undefined,
          },
        });
      }

      onClose();
      setNotifyMail(false);
      setNotifyChat(false);
      setContentHtml('');
      setTitle('');
    } catch (e: any) {
      setErr(e?.message || 'Failed to publish announcement.');
    } finally {
      setBusy(false);
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
