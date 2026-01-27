import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { useAuth } from 'qapp-core';
import { Link } from 'react-router-dom';
import { useAlert } from '../../components/alerts';
import { useActiveAccountName } from '../../hooks/useActiveAccountName';
import { useQdnBatchPublisher } from '../../utils/useQdnBatchPublisher';
import { getUserRoles, userHasPermission } from '../../utils/roles';
import {
  buildAppIndexHeadResource,
  buildAppIndexPublishResources,
  buildAppWhitelistPublishResource,
  fetchAppIndexCandidates,
  fetchAppIndexDoc,
  fetchAppIndexWhitelist,
  fetchLatestAppIndex,
  resolveAllowedAppIndexPublishers,
  type XqloreAppRegistryEntry,
} from '../../utils/xqloreIndex';

type AppRow = XqloreAppRegistryEntry & {
  rowId: string;
  rawPrefixes: string;
  rawIdentifiers: string;
  rawTags: string;
};

const splitList = (value: string) =>
  value
    .split(/[,\n]/)
    .map((item) => item.trim())
    .filter(Boolean);

const joinList = (value?: string[]) => (value && value.length ? value.join(', ') : '');

type AppEditorRowProps = {
  app: AppRow;
  index: number;
  onChange: (
    index: number,
    key: keyof XqloreAppRegistryEntry | 'rawPrefixes' | 'rawIdentifiers' | 'rawTags',
    value: string
  ) => void;
  onRemove: (index: number) => void;
};

const AppEditorRow = memo(function AppEditorRow({
  app,
  index,
  onChange,
  onRemove,
}: AppEditorRowProps) {
  const theme = useTheme();
  return (
    <Paper
      elevation={0}
      sx={{
        p: 2,
        borderRadius: 2,
        border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            label="App name"
            value={app.name ?? ''}
            onChange={(event) => onChange(index, 'name', event.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="Display label"
            value={app.label ?? ''}
            onChange={(event) => onChange(index, 'label', event.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
        <TextField
          label="Prefixes (comma or newline separated)"
          value={app.rawPrefixes}
          onChange={(event) => onChange(index, 'rawPrefixes', event.target.value)}
          fullWidth
          size="small"
        />
        <TextField
          label="Associated identifiers"
          value={app.rawIdentifiers}
          onChange={(event) => onChange(index, 'rawIdentifiers', event.target.value)}
          fullWidth
          size="small"
        />
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <TextField
            label="Website"
            value={app.website ?? ''}
            onChange={(event) => onChange(index, 'website', event.target.value)}
            fullWidth
            size="small"
          />
          <TextField
            label="Icon URL"
            value={app.iconUrl ?? ''}
            onChange={(event) => onChange(index, 'iconUrl', event.target.value)}
            fullWidth
            size="small"
          />
        </Stack>
        <TextField
          label="Description"
          value={app.description ?? ''}
          onChange={(event) => onChange(index, 'description', event.target.value)}
          fullWidth
          multiline
          minRows={2}
          size="small"
        />
        <TextField
          label="Tags"
          value={app.rawTags}
          onChange={(event) => onChange(index, 'rawTags', event.target.value)}
          fullWidth
          size="small"
        />
        <Button variant="outlined" color="error" onClick={() => onRemove(index)}>
          Remove app
        </Button>
      </Stack>
    </Paper>
  );
});

const XqloreAdminPage = () => {
  const theme = useTheme();
  const { address } = useAuth();
  const { alert } = useAlert();
  const { activeName, namesLoading } = useActiveAccountName({ autoAuth: true });
  const { publish } = useQdnBatchPublisher();

  const [isAdmin, setIsAdmin] = useState(false);
  const [loading, setLoading] = useState(false);
  const [apps, setApps] = useState<AppRow[]>([]);
  const [whitelist, setWhitelist] = useState<string[]>([]);
  const [candidateHits, setCandidateHits] = useState<any[]>([]);
  const [candidatePreview, setCandidatePreview] = useState<XqloreAppRegistryEntry[] | null>(null);
  const [newWhitelistName, setNewWhitelistName] = useState('');
  const rowCounter = useRef(0);

  const makeRowId = () => {
    rowCounter.current += 1;
    return `app-row-${rowCounter.current}`;
  };

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

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const allowed = await resolveAllowedAppIndexPublishers();
      const [{ index }, whitelistDoc, candidates] = await Promise.all([
        fetchLatestAppIndex(allowed),
        fetchAppIndexWhitelist(),
        fetchAppIndexCandidates(12),
      ]);
      const rows = (index?.apps ?? []).map((entry) => ({
        ...entry,
        rowId: makeRowId(),
        rawPrefixes: joinList(entry.prefixes),
        rawIdentifiers: joinList(entry.identifiers),
        rawTags: joinList(entry.tags),
      }));
      setApps(rows);
      setWhitelist(whitelistDoc.publishers ?? []);
      setCandidateHits(candidates);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    (async () => {
      try {
        const roles = await getUserRoles();
        if (active) setIsAdmin(userHasPermission(roles, 'permissions.manage.manifest'));
      } catch {
        if (active) setIsAdmin(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [address]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleAppChange = useCallback(
    (
      index: number,
      key: keyof XqloreAppRegistryEntry | 'rawPrefixes' | 'rawIdentifiers' | 'rawTags',
      value: string
    ) => {
      setApps((prev) => {
        const current = prev[index];
        if (!current) return prev;
        if ((current as any)[key] === value) return prev;
        const next = [...prev];
        next[index] = { ...current, [key]: value } as AppRow;
        return next;
      });
    },
    []
  );

  const addApp = useCallback(() => {
    setApps((prev) => [
      ...prev,
      {
        rowId: makeRowId(),
        name: '',
        label: '',
        description: '',
        prefixes: [],
        identifiers: [],
        tags: [],
        rawPrefixes: '',
        rawIdentifiers: '',
        rawTags: '',
      },
    ]);
  }, []);

  const removeApp = useCallback((index: number) => {
    setApps((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const handlePublishApps = async () => {
    if (!activeName) {
      await alert('Select an active publishing name before publishing.', 'Name required', {
        severity: 'warning',
      });
      return;
    }
    const cleaned = apps
      .map((entry) => ({
        name: entry.name.trim(),
        label: entry.label?.trim(),
        description: entry.description?.trim(),
        website: entry.website?.trim(),
        iconUrl: entry.iconUrl?.trim(),
        prefixes: splitList(entry.rawPrefixes),
        identifiers: splitList(entry.rawIdentifiers),
        tags: splitList(entry.rawTags),
      }))
      .filter((entry) => entry.name && entry.prefixes.length);

    if (!cleaned.length) {
      await alert('Add at least one app with a name and prefixes.', 'Missing data', {
        severity: 'warning',
      });
      return;
    }

    try {
      const resources = await buildAppIndexPublishResources({
        publisherName: activeName,
        publisherAddress: address ?? undefined,
        apps: cleaned,
      });
      await publish(resources);
      await alert('App registry published.', 'Success', { severity: 'success' });
      await load();
    } catch (err: any) {
      await alert(err?.message || 'Failed to publish app registry.', 'Publish error', {
        severity: 'error',
      });
    }
  };

  const handlePublishWhitelist = async () => {
    if (!activeName) {
      await alert('Select an active publishing name before publishing.', 'Name required', {
        severity: 'warning',
      });
      return;
    }
    try {
      const resource = await buildAppWhitelistPublishResource({
        publisherName: activeName,
        publishers: whitelist,
      });
      await publish([resource]);
      await alert('Whitelist published.', 'Success', { severity: 'success' });
      await load();
    } catch (err: any) {
      await alert(err?.message || 'Failed to publish whitelist.', 'Publish error', {
        severity: 'error',
      });
    }
  };

  const previewCandidate = async (hit: any) => {
    const doc = await fetchAppIndexDoc(hit);
    setCandidatePreview(doc?.apps ?? null);
  };

  const adoptCandidate = async (hit: any) => {
    if (!activeName) {
      await alert('Select an active publishing name before adopting.', 'Name required', {
        severity: 'warning',
      });
      return;
    }
    const doc = await fetchAppIndexDoc(hit);
    if (!doc) {
      await alert('Unable to load selected app index.', 'Missing data', { severity: 'error' });
      return;
    }
    const resource = await buildAppIndexHeadResource({
      publisherName: activeName,
      publisherAddress: address ?? undefined,
      latestIdentifier: hit.identifier,
      appCount: doc.apps.length,
    });
    try {
      await publish([resource]);
      await alert('App index head updated.', 'Success', { severity: 'success' });
      await load();
    } catch (err: any) {
      await alert(err?.message || 'Failed to publish head update.', 'Publish error', {
        severity: 'error',
      });
    }
  };

  const canPublish = isAdmin && Boolean(activeName);
  const availableNamesLabel = namesLoading ? 'Loading names...' : activeName || 'Select name';

  const whitelistDisplay = useMemo(() => whitelist.map((name) => name.trim()).filter(Boolean), [whitelist]);

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
              <Box>
                <Typography variant="h4" sx={{ fontFamily: 'Orbitron' }}>
                  Xqlore Admin
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Manage app registry data and approve community submissions.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button component={Link} to="/xqlore" variant="outlined">
                  Back to Xqlore
                </Button>
              </Stack>
            </Stack>
            {!isAdmin && (
              <Typography variant="body2" color="error">
                Admin access required. Join the Q-Assets-Management group to manage indexes.
              </Typography>
            )}
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Chip label={`Active name: ${availableNamesLabel}`} variant="outlined" />
              <Chip label={`Admin: ${isAdmin ? 'Yes' : 'No'}`} variant="outlined" color={isAdmin ? 'success' : 'warning'} />
            </Stack>
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 }, mb: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
              App registry
            </Typography>
            {loading && (
              <Typography variant="body2" color="text.secondary">
                Loading registry data...
              </Typography>
            )}
            {apps.length === 0 && !loading && (
              <Typography variant="body2" color="text.secondary">
                No app entries loaded yet.
              </Typography>
            )}
            <Stack spacing={2}>
              {apps.map((app, index) => (
                <AppEditorRow
                  key={app.rowId}
                  app={app}
                  index={index}
                  onChange={handleAppChange}
                  onRemove={removeApp}
                />
              ))}
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              <Button variant="outlined" onClick={addApp} disabled={!isAdmin}>
                Add app
              </Button>
              <Button variant="contained" onClick={handlePublishApps} disabled={!canPublish}>
                Publish app registry
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 }, mb: 3 }}>
          <Stack spacing={2}>
            <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
              Allowed publishers
            </Typography>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {whitelistDisplay.length === 0 ? (
                <Chip label="No extra publishers yet" variant="outlined" />
              ) : (
                whitelistDisplay.map((name) => (
                  <Chip
                    key={name}
                    label={name}
                    onDelete={isAdmin ? () => setWhitelist((prev) => prev.filter((item) => item !== name)) : undefined}
                    variant="outlined"
                  />
                ))
              )}
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
              <TextField
                label="Add publisher name"
                value={newWhitelistName}
                onChange={(event) => setNewWhitelistName(event.target.value)}
                size="small"
                fullWidth
              />
              <Button
                variant="outlined"
                onClick={() => {
                  if (!newWhitelistName.trim()) return;
                  setWhitelist((prev) => Array.from(new Set([...prev, newWhitelistName.trim()])));
                  setNewWhitelistName('');
                }}
                disabled={!isAdmin}
              >
                Add publisher
              </Button>
              <Button variant="contained" onClick={handlePublishWhitelist} disabled={!canPublish}>
                Publish whitelist
              </Button>
            </Stack>
          </Stack>
        </Paper>

        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 3, md: 4 } }}>
          <Stack spacing={2}>
            <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
              Candidate app indexes
            </Typography>
            <Typography variant="body2" color="text.secondary">
              Review app indexes published by the community. You can preview and adopt them by
              updating the head pointer.
            </Typography>
            <Divider />
            <Stack spacing={1.5}>
              {candidateHits.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No candidate indexes found.
                </Typography>
              )}
              {candidateHits.map((hit: any) => (
                <Paper key={`${hit.name}-${hit.identifier}`} elevation={0} sx={{ p: 2, borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>
                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems={{ md: 'center' }} justifyContent="space-between">
                    <Box>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {hit.identifier}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Publisher: {hit.name || 'Unknown'}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1}>
                      <Button variant="outlined" onClick={() => previewCandidate(hit)}>
                        Preview
                      </Button>
                      <Button variant="contained" onClick={() => adoptCandidate(hit)} disabled={!canPublish}>
                        Adopt
                      </Button>
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
            {candidatePreview && (
              <Paper elevation={0} sx={{ p: 2, borderRadius: 2, border: `1px solid ${alpha(theme.palette.divider, 0.5)}` }}>
                <Typography variant="subtitle1" sx={{ mb: 1 }}>
                  Preview apps ({candidatePreview.length})
                </Typography>
                <Stack direction="row" spacing={1} flexWrap="wrap">
                  {candidatePreview.map((entry) => (
                    <Chip key={entry.name} label={entry.name} variant="outlined" />
                  ))}
                </Stack>
              </Paper>
            )}
          </Stack>
        </Paper>
      </Box>
    </Box>
  );
};

export default XqloreAdminPage;
