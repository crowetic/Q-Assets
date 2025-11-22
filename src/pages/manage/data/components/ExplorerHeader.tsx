import { Alert, Box, Button, Stack, Tooltip, Typography } from '@mui/material';
import type { ManifestDoc } from '../DataExplorer.types';
import { formatDate } from '../viewHelpers';

export type ExplorerHeaderProps = {
  activeName: string | null;
  manifestDoc: ManifestDoc | null;
  manifestDirty: boolean;
  manifestPublishing: boolean;
  manifestError: string | null;
  onPublishManifest: () => void;
};

export function ExplorerHeader({
  activeName,
  manifestDoc,
  manifestDirty,
  manifestPublishing,
  manifestError,
  onPublishManifest,
}: ExplorerHeaderProps) {
  return (
    <Box>
      <Stack spacing={1}>
        <Typography variant="h4" sx={{ lineHeight: 1.25 }}>
          Data Explorer
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Manage every QDN resource you publish. Navigate by name, service, or identifier and keep
          folders aligned with your publishing strategy.
        </Typography>
      </Stack>

      {manifestDoc && !manifestDirty && activeName && (
        <Alert severity="success" sx={{ mt: 2 }}>
          Manifest loaded for <strong>{activeName}</strong> • {manifestDoc.totals.resources}{' '}
          resources / {manifestDoc.totals.structuredFiles} structured files • generated{' '}
          {formatDate(manifestDoc.generatedAt)}
          {manifestDoc.lastSynced ? ` • cached through ${formatDate(manifestDoc.lastSynced)}` : ''}
        </Alert>
      )}

      {manifestDirty && activeName && (
        <Alert
          severity="info"
          sx={{ mt: 2 }}
          action={
            <Stack direction="row" spacing={1} alignItems="center">
              <Tooltip title="Publishing manifests improves load times by caching service counts/folders on QDN.">
                <span>
                  <Button
                    variant="contained"
                    size="small"
                    onClick={() => onPublishManifest()}
                    disabled={manifestPublishing}
                  >
                    {manifestPublishing ? 'Publishing…' : 'Publish manifest'}
                  </Button>
                </span>
              </Tooltip>
            </Stack>
          }
        >
          New data has been detected since your last manifest. Publishing a manifest lets Q-Assets
          and other apps load your resources faster.
        </Alert>
      )}

      {manifestError && (
        <Alert severity="warning" sx={{ mt: 1 }}>
          {manifestError}
        </Alert>
      )}
    </Box>
  );
}
