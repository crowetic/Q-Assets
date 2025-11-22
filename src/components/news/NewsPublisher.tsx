/* eslint-disable @typescript-eslint/no-explicit-any */
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
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import { assetNewsItemId } from '../../constants/qdnConstants';
import { isNameAdminOfGroupId } from '../../utils/access';
import { uniqueId6 } from '../../utils/ids';
import { useAlert } from '../alerts';
import { publishScopedNotification } from '../../utils/notificationPublisher';

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

  return (
    <>
      <Button variant="outlined" onClick={() => setOpen(true)}>
        Publish News Article
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} fullWidth maxWidth="md">
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
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!userName) return alert('You need a Qortal name to publish.');
              if (!(await canPublish()))
                return alert('Only issuer or primary group admins can publish News.');
              const payload = prepareHtmlForPublish(html, theme);

              // Unique history item
              const id6 = uniqueId6();
              const newsItemId = assetNewsItemId(assetId, id6);
              const b64 = btoa(payload);

              await qortalRequest({
                action: 'PUBLISH_QDN_RESOURCE',
                name: userName as string,
                service: 'DOCUMENT',
                identifier: newsItemId,
                data64: b64,
              } as any);

              const links = [
                {
                  label: 'View resource',
                  href: `qortal://DOCUMENT/${userName}/${newsItemId}`,
                },
              ];

              if (address) {
                if (notifyAppSubs) {
                  await publishScopedNotification({
                    scope: { kind: 'global' },
                    title: assetName ? `${assetName} news` : `Asset #${assetId} update`,
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
                    title: assetName
                      ? `${assetName} group notice`
                      : `Asset #${assetId} group notice`,
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
            }}
          >
            Publish
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
