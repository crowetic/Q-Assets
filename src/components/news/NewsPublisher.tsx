import { useState } from 'react';
import {
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useTheme,
  FormControlLabel,
  Checkbox,
  Tooltip,
} from '@mui/material';
import { useAuth } from 'qapp-core';
import TiptapEditor from '../TipTapEditor';
import PublishQueueStatus from '../common/PublishQueueStatus';
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import { assetNewsItemId } from '../../constants/qdnConstants';
import { isNameAdminOfGroupId } from '../../utils/access';
import { uniqueId6 } from '../../utils/ids';
import { useAlert } from '../alerts';
import { publishScopedNotification } from '../../utils/notificationPublisher';
import { objectToBase64 } from '../../utils/data';
import { enqueueQdnPublishJob } from '../../state/publishQueue';
import { PublishJobError } from '../../utils/qdnProgressivePublisher';

export default function NewsPublisher({
  assetId,
  assetName,
  primaryGroupId,
  isIssuer,
  onPublished,
}: {
  assetId: number;
  assetName?: string;
  primaryGroupId?: number;
  isIssuer: boolean;
  onPublished?: () => void;
}) {
  const { name: userName, address, authenticateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState('');
  const [notifyAppSubs, setNotifyAppSubs] = useState(false);
  const [notifyGroupSubs, setNotifyGroupSubs] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const theme = useTheme();
  const normalizedGroupId =
    typeof primaryGroupId === 'number' && Number.isFinite(primaryGroupId)
      ? Number(primaryGroupId)
      : null;

  const canPublish = async () => {
    if (!userName) authenticateUser();
    if (isIssuer) return true;
    if (!primaryGroupId) return false;
    return isNameAdminOfGroupId(userName as string, primaryGroupId);
  };

  const { alert } = useAlert();
  const handlePublish = async () => {
    if (!userName) {
      await alert('You need a Qortal name to publish.');
      return;
    }
    if (!(await canPublish())) {
      await alert('Only issuer or primary group admins can publish News.');
      return;
    }

    const payload = prepareHtmlForPublish(html, theme);
    const id6 = uniqueId6();
    const newsItemId = assetNewsItemId(assetId, id6);
    const newsTitle = assetName ? `${assetName} news` : `Asset #${assetId} update`;
    const payloadObj = {
      html: payload,
      title: newsTitle,
      createdAt: Date.now(),
    };
    const b64 = await objectToBase64(payloadObj);

    setPublishing(true);
    try {
      const queued = enqueueQdnPublishJob({
        label: 'Asset news publish',
        resources: [
          {
            name: userName as string,
            service: 'DOCUMENT',
            identifier: newsItemId,
            data64: b64,
          },
        ],
      });
      if (!queued) throw new Error('Unable to queue news publish');
      await queued.completion;

      const assetLink = `qortal://APP/Q-Assets/assets/${assetId}`;
      const links = [
        {
          label: 'View News Publication on Q-Assets',
          href: `qortal://APP/Q-Assets`,
        },
        {
          label: assetName ? `View ${assetName}` : `View Asset #${assetId}`,
          href: assetLink,
        },
      ];

      if (address) {
        if (notifyAppSubs) {
          await publishScopedNotification({
            scope: { kind: 'global' },
            title: newsTitle,
            html: payload,
            publisher: { name: userName, address, role: 'admin' },
            qdnResource: { publisher: userName, identifier: newsItemId },
            sendMail: true,
            links,
          });
        }
        if (notifyGroupSubs && normalizedGroupId) {
          await publishScopedNotification({
            scope: { kind: 'group', groupId: normalizedGroupId },
            title: assetName ? `${assetName} group notice` : `Asset #${assetId} group notice`,
            html: payload,
            publisher: { name: userName, address, role: 'admin' },
            qdnResource: { publisher: userName, identifier: newsItemId },
            sendMail: true,
            links,
          });
        }
      }

      setHtml('');
      setNotifyAppSubs(false);
      setNotifyGroupSubs(false);
      setOpen(false);
      onPublished?.();
    } catch (e: any) {
      if (e instanceof PublishJobError) {
        await alert(e.message || 'News publishing cancelled.');
      } else {
        const message =
          typeof e?.message === 'string' ? e.message : 'Failed to publish news article.';
        await alert(message, 'Publish failed', { severity: 'error' });
      }
    } finally {
      setPublishing(false);
    }
  };

  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>
        Publish News Article
      </Button>
      <Dialog
        open={open}
        onClose={publishing ? undefined : () => setOpen(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Publish News Article</DialogTitle>
        <DialogContent dividers>
          <Typography variant="caption" color="text.secondary">
            Issuer or primary group admins can publish News.
          </Typography>
          <div style={{ marginTop: 16 }}>
            <TiptapEditor value={html} onChange={setHtml} />
          </div>
          <Box sx={{ mt: 2, display: 'grid', gap: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={notifyAppSubs}
                  onChange={(e) => setNotifyAppSubs(e.target.checked)}
                  disabled={!userName}
                />
              }
              label={
                <Tooltip title="Send Q-Assets-wide notifications (with encrypted Q-Mail) to Announcement watchers.">
                  <span>Notify Q-Assets subscribers</span>
                </Tooltip>
              }
            />
            <FormControlLabel
              control={
                <Checkbox
                  checked={notifyGroupSubs}
                  onChange={(e) => setNotifyGroupSubs(e.target.checked)}
                  disabled={!userName || !normalizedGroupId}
                />
              }
              label={
                <Tooltip title="Send notifications and Q-Mail to this asset's primary group members.">
                  <span>Notify asset primary group</span>
                </Tooltip>
              }
            />
          </Box>
          <PublishQueueStatus fallbackLabel="Publishing news article" />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)} disabled={publishing}>
            Cancel
          </Button>
          <Button variant="contained" onClick={handlePublish} disabled={publishing}>
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
