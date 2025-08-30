/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from 'react';
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Typography,
  useTheme,
} from '@mui/material';
import { useAuth } from 'qapp-core';
import TiptapEditor from '../TipTapEditor';
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import { assetNewsItemId } from '../../constants/qdnConstants';
import { isNameAdminOfGroupId } from '../../utils/access';
import { uniqueId6 } from '../../utils/ids';
import { useAlert } from '../alerts';

export default function NewsPublisher({
  assetId,
  primaryGroupId,
  isIssuer,
  onPublished,
}: {
  assetId: number;
  primaryGroupId?: number;
  isIssuer: boolean;
  onPublished?: () => void;
}) {
  const { name: userName, authenticateUser } = useAuth();
  const [open, setOpen] = useState(false);
  const [html, setHtml] = useState('');
  const theme = useTheme();

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

              setHtml('');
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
