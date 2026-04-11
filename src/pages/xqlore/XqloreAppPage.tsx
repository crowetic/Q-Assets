import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Paper,
  Stack,
  Typography,
  Link as MuiLink,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link, useParams } from 'react-router-dom';
import { useXqloreAppIndex } from '../../hooks/useXqloreAppIndex';
import { useXqloreTxIndex } from '../../hooks/useXqloreTxIndex';
import { formatRelativeTime } from '../../utils/xqloreTx';
import XqloreTxDetailsDialog from '../../components/xqlore/XqloreTxDetailsDialog';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';

const matchesAppEntry = (identifier: string | undefined, entryPrefixes: string[], identifiers: string[]) => {
  if (!identifier) return false;
  const needle = identifier.toLowerCase();
  if (identifiers.some((id) => id.toLowerCase() === needle)) return true;
  return entryPrefixes.some((prefix) => needle.startsWith(prefix.toLowerCase()));
};

const XqloreAppPage = () => {
  const theme = useTheme();
  const { appName = '' } = useParams();
  const [selectedTx, setSelectedTx] = useState<any | null>(null);
  const [placeholder, setPlaceholder] = useState<string | null>(null);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const { index, registry } = useXqloreAppIndex();
  const { entries: indexEntries } = useXqloreTxIndex(registry);

  const appEntry = useMemo(() => {
    const needle = appName.toLowerCase();
    return index?.apps.find((app) => app.name.toLowerCase() === needle) ?? null;
  }, [index, appName]);

  const prefixes = appEntry?.prefixes ?? [];
  const identifiers = appEntry?.identifiers ?? [];
  const hasEntry = Boolean(appEntry);

  useEffect(() => {
    let active = true;
    if (!appEntry?.name || appEntry.iconUrl) {
      setAvatarUrl(appEntry?.iconUrl ?? null);
      return undefined;
    }
    (async () => {
      const fetched = await fetchAccountAvatarDataUrl(appEntry.name);
      if (active) setAvatarUrl(fetched);
    })();
    return () => {
      active = false;
    };
  }, [appEntry?.name, appEntry?.iconUrl]);

  const recentActivity = useMemo(() => {
    if (!appEntry) return [];
    return indexEntries
      .filter((entry) => matchesAppEntry(entry.identifier, prefixes, identifiers))
      .slice(0, 20);
  }, [appEntry, indexEntries, prefixes, identifiers]);

  const surfaceSx = {
    borderRadius: '24px',
    border: `1px solid ${alpha(theme.palette.divider, 0.8)}`,
    background: `linear-gradient(135deg, ${alpha(
      theme.palette.background.paper,
      0.92
    )} 0%, ${alpha(theme.palette.background.default, 0.9)} 100%)`,
    boxShadow: `0 20px 50px ${alpha(theme.palette.common.black, 0.18)}`,
    position: 'relative',
    overflow: 'hidden',
  } as const;

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100%',
        px: { xs: 2, md: 4 },
        py: { xs: 3, md: 5 },
        background: `radial-gradient(circle at 15% 10%, ${alpha(
          theme.palette.info.light,
          0.2
        )} 0%, transparent 45%), linear-gradient(180deg, ${alpha(
          theme.palette.background.default,
          0.98
        )} 0%, ${alpha(theme.palette.background.paper, 0.92)} 100%)`,
      }}
    >
      <Box sx={{ width: '85vw', maxWidth: 1600, mx: 'auto' }}>
        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 }, mb: 3 }}>
          <Stack spacing={1.5}>
            <Stack direction={{ xs: 'column', md: 'row' }} justifyContent="space-between" gap={2}>
              <Stack direction="row" spacing={2} alignItems="center">
                <Box
                  sx={{
                    width: 64,
                    height: 64,
                    borderRadius: '16px',
                    overflow: 'hidden',
                    backgroundColor: alpha(theme.palette.background.default, 0.6),
                    border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    fontFamily: 'Exo2',
                    fontWeight: 700,
                    color: theme.palette.text.secondary,
                  }}
                >
                  {avatarUrl ? (
                    <Box component="img" src={avatarUrl} alt={`${appEntry?.name || appName} avatar`} sx={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <span>{(appEntry?.label || appName || '?').slice(0, 1).toUpperCase()}</span>
                  )}
                </Box>
                <Box>
                  <Typography variant="h4" sx={{ fontFamily: 'Exo2' }}>
                    {appEntry?.label || appName}
                  </Typography>
                  <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                    {appEntry?.description || 'This app is not yet registered in the Xqlore index.'}
                  </Typography>
                </Box>
              </Stack>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button component={Link} to="/xqlore" variant="outlined">
                  Back to Xqlore
                </Button>
                {appEntry?.website && (
                  <Button component="a" href={appEntry.website} target="_blank" rel="noreferrer" variant="outlined">
                    Visit site
                  </Button>
                )}
              </Stack>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {!hasEntry && <Chip label="Unregistered" color="warning" variant="outlined" />}
              {prefixes.length === 0 && identifiers.length === 0 ? (
                <Chip label="No identifiers registered" variant="outlined" />
              ) : (
                [...prefixes, ...identifiers].map((item) => (
                  <Chip
                    key={item}
                    label={item}
                    variant="outlined"
                    clickable
                    onClick={() => setPlaceholder(item)}
                  />
                ))
              )}
            </Stack>
            {appEntry?.tags && appEntry.tags.length > 0 && (
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {appEntry.tags.map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    variant="outlined"
                    color="info"
                    clickable
                    onClick={() => setPlaceholder(tag)}
                  />
                ))}
              </Stack>
            )}
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 2.5, md: 3.5 } }}>
          <Typography variant="h5" sx={{ fontFamily: 'Exo2' }}>
            Recent app activity
          </Typography>
          <Divider sx={{ my: 2 }} />
          {recentActivity.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No indexed activity for this app yet.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {recentActivity.map((item) => (
                <Box
                  key={item.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setSelectedTx(item.raw)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') {
                      event.preventDefault();
                      setSelectedTx(item.raw);
                    }
                  }}
                  sx={{
                    width: '100%',
                    textAlign: 'left',
                    borderRadius: '16px',
                    p: 2,
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr', md: 'auto 1fr auto' },
                    gap: 2,
                    backgroundColor: alpha(theme.palette.background.default, 0.6),
                    border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                    cursor: 'pointer',
                  }}
                >
                  <Stack spacing={0.5}>
                    <Chip label={item.type} variant="outlined" />
                    <Typography variant="caption" color="text.secondary">
                      {formatRelativeTime(item.timestampMs)}
                    </Typography>
                  </Stack>
                  <Stack spacing={0.5}>
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      {item.summary}
                    </Typography>
                    <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                      {item.context}
                    </Typography>
                  </Stack>
                  <Stack spacing={0.5} alignItems={{ xs: 'flex-start', md: 'flex-end' }}>
                    {item.originFull && item.originFull !== 'Unknown' ? (
                      <MuiLink
                        component={Link}
                        to={`/xqlore/accounts/${item.originFull}`}
                        onClick={(event) => event.stopPropagation()}
                        underline="hover"
                      >
                        {item.origin}
                      </MuiLink>
                    ) : (
                      <Typography variant="caption" color="text.secondary">
                        {item.origin}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                      {item.identifier || '—'}
                    </Typography>
                  </Stack>
                </Box>
              ))}
            </Stack>
          )}
        </Paper>
      </Box>

      <XqloreTxDetailsDialog
        open={Boolean(selectedTx)}
        tx={selectedTx}
        onClose={() => setSelectedTx(null)}
        title="App activity"
      />

      <Dialog open={Boolean(placeholder)} onClose={() => setPlaceholder(null)}>
        <DialogTitle>Coming soon</DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            More details for “{placeholder}” will be available soon.
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPlaceholder(null)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default XqloreAppPage;
