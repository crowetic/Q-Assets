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
import { resolveAssetPublicationById } from '../../utils/resolveAssetPublication';
import { addPrivateMagic } from '../../constants/qdeckIdentifiers';

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

  const canPublish = async (groupId?: number | null) => {
    if (!userName) authenticateUser();
    if (isIssuer) return true;
    if (!groupId) return false;
    return isNameAdminOfGroupId(userName as string, groupId);
  };

  const { alert } = useAlert();
  const handlePublish = async () => {
    if (!userName) {
      await alert('You need a Qortal name to publish.');
      return;
    }
    const privacy = assetId
      ? await resolveAssetPublicationById(assetId).catch(() => ({ publication: null }))
      : { publication: null };
    const isPrivate = Boolean(privacy.publication?.privateAsset);
    const privateGroupIdRaw =
      privacy.publication?.privateGroupId ?? privacy.publication?.primaryGroup?.id;
    const privateGroupId =
      privateGroupIdRaw != null && Number.isFinite(Number(privateGroupIdRaw))
        ? Number(privateGroupIdRaw)
        : null;
    const effectiveGroupId = privateGroupId ?? normalizedGroupId;

    if (!(await canPublish(effectiveGroupId))) {
      await alert('Only issuer or authorized group admins can publish News.');
      return;
    }

    if (isPrivate && !effectiveGroupId) {
      await alert('Private assets require a private group to publish news.');
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
    const raw64 = await objectToBase64(payloadObj);

    // Encrypt for private assets
    const service: 'DOCUMENT' | 'DOCUMENT_PRIVATE' = isPrivate ? 'DOCUMENT_PRIVATE' : 'DOCUMENT';
    let data64 = raw64;
    if (isPrivate) {
      try {
        const encrypted = await qortalRequest({
          action: 'ENCRYPT_QORTAL_GROUP_DATA',
          base64: raw64,
          groupId: effectiveGroupId!,
          isAdmins: false,
        });
        data64 = addPrivateMagic(encrypted);
      } catch (e: any) {
        const msg = typeof e?.message === 'string' ? e.message : 'Failed to encrypt for group.';
        await alert(msg, 'Publish failed', { severity: 'error' });
        return;
      }
    }

    setPublishing(true);
    try {
      const queued = enqueueQdnPublishJob({
        label: 'Asset news publish',
        resources: [
          {
            name: userName as string,
            service,
            identifier: newsItemId,
            data64,
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
        // For private assets, avoid global notifications; only group scope.
        if (!isPrivate && notifyAppSubs) {
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
        if (notifyGroupSubs && effectiveGroupId) {
          await publishScopedNotification({
            scope: { kind: 'group', groupId: effectiveGroupId },
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
