import { useEffect, useState } from 'react';
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
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import { useAuth } from 'qapp-core';
import type { Service } from 'qapp-core';
import TiptapEditor from '../TipTapEditor';
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import { assetNewsItemId } from '../../constants/qdnConstants';
import { isNameAdminOfGroupId } from '../../utils/access';
import { uniqueId6 } from '../../utils/ids';
import { useAlert } from '../alerts';
import { publishScopedNotification } from '../../utils/notificationPublisher';
import { objectToBase64 } from '../../utils/data';
import { resolveAssetPublicationById } from '../../utils/resolveAssetPublication';
import { resolveGroupPublishService } from '../../utils/groupEncryption';
import { useQdnBatchPublisher } from '../../utils/useQdnBatchPublisher';
import PublishQueueStatus from '../common/PublishQueueStatus';
// import { addPrivateMagic } from '../../constants/qdeckIdentifiers';
import { useActiveAccountName } from '../../hooks/useActiveAccountName';

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
  const { activeName, availableNames, namesLoading } = useActiveAccountName();
  const [useGlobalName, setUseGlobalName] = useState(true);
  const [overrideName, setOverrideName] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState('');
  const [notifyAppSubs, setNotifyAppSubs] = useState(false);
  const [notifyGroupSubs, setNotifyGroupSubs] = useState(true);
  const [publishing, setPublishing] = useState(false);
  const theme = useTheme();
  const globalName = activeName ?? userName ?? null;
  const publisherName = useGlobalName ? globalName : overrideName;
  const normalizedGroupId =
    typeof primaryGroupId === 'number' && Number.isFinite(primaryGroupId)
      ? Number(primaryGroupId)
      : null;
  const { publish } = useQdnBatchPublisher();

  useEffect(() => {
    if (useGlobalName) return;
    if (overrideName && availableNames.includes(overrideName)) return;
    const fallback = activeName ?? availableNames[0] ?? null;
    if (fallback) setOverrideName(fallback);
  }, [useGlobalName, overrideName, activeName, availableNames]);

  const canPublish = async (groupId?: number | null) => {
    if (!publisherName) authenticateUser();
    if (isIssuer) return true;
    if (!groupId) return false;
    return isNameAdminOfGroupId(publisherName as string, groupId);
  };

  const { alert } = useAlert();
  const handlePublish = async () => {
    if (!publisherName) {
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
    const service: Service = isPrivate
      ? resolveGroupPublishService('group')
      : ('DOCUMENT' as Service);
    let base64 = raw64;
    if (isPrivate) {
      try {
        const encrypted = await qortalRequest({
          action: 'ENCRYPT_QORTAL_GROUP_DATA',
          base64: raw64,
          groupId: effectiveGroupId!,
          isAdmins: false,
        });
        base64 = encrypted;
      } catch (e: any) {
        const msg = typeof e?.message === 'string' ? e.message : 'Failed to encrypt for group.';
        await alert(msg, 'Publish failed', { severity: 'error' });
        return;
      }
    }

    setPublishing(true);
    try {
      await publish([
        {
          name: publisherName as string,
          service,
          identifier: newsItemId,
          base64,
          // disableEncrypt: isPrivate,
          privateMode: isPrivate ? 'group' : undefined,
        },
      ]);

      const assetLink = `qortal://APP/Q-Assets/assetexplorer/${assetId}`;
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
            publisher: { name: publisherName, address, role: 'admin' },
            qdnResource: { publisher: publisherName, identifier: newsItemId },
            sendMail: true,
            links,
          });
        }
        if (notifyGroupSubs && effectiveGroupId) {
          await publishScopedNotification({
            scope: { kind: 'group', groupId: effectiveGroupId },
            title: assetName ? `${assetName} group notice` : `Asset #${assetId} group notice`,
            html: payload,
            publisher: { name: publisherName, address, role: 'admin' },
            qdnResource: { publisher: publisherName, identifier: newsItemId },
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
      const message =
        typeof e?.message === 'string' ? e.message : 'Failed to publish news article.';
      await alert(message, 'Publish failed', { severity: 'error' });
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
          <Box sx={{ mt: 1.5, display: 'flex', gap: 2, flexWrap: 'wrap', alignItems: 'center' }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={useGlobalName}
                  onChange={(e) => setUseGlobalName(e.target.checked)}
                  disabled={namesLoading}
                />
              }
              label="Use global active name"
            />
            {useGlobalName ? (
              <Typography variant="body2" color={publisherName ? 'text.secondary' : 'error'}>
                {publisherName ? `Publishing as: ${publisherName}` : 'No active name selected'}
              </Typography>
            ) : (
              <FormControl size="small" sx={{ minWidth: 220 }}>
                <InputLabel id="asset-news-name">Publish as</InputLabel>
                <Select
                  labelId="asset-news-name"
                  label="Publish as"
                  value={overrideName || ''}
                  onChange={(e) => {
                    const next = e.target.value ? String(e.target.value) : '';
                    setOverrideName(next || null);
                  }}
                  disabled={namesLoading || availableNames.length === 0}
                  displayEmpty
                >
                  {availableNames.length === 0 && (
                    <MenuItem value="" disabled>
                      {namesLoading ? 'Loading names...' : 'No names available'}
                    </MenuItem>
                  )}
                  {availableNames.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))}
                </Select>
              </FormControl>
            )}
          </Box>
          <div style={{ marginTop: 16 }}>
            <TiptapEditor value={html} onChange={setHtml} />
          </div>
          <Box sx={{ mt: 2, display: 'grid', gap: 1 }}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={notifyAppSubs}
                  onChange={(e) => setNotifyAppSubs(e.target.checked)}
                  disabled={!publisherName}
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
                  disabled={!publisherName || !normalizedGroupId}
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
          <Button
            variant="contained"
            onClick={handlePublish}
            disabled={publishing || !publisherName}
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
