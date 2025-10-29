import {
  Box,
  Typography,
  Paper,
  Stack,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  IconButton,
  Tooltip,
  Chip,
  Divider,
  Button,
  LinearProgress,
  ToggleButton,
  ToggleButtonGroup,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import DeleteForeverRoundedIcon from '@mui/icons-material/DeleteForeverRounded';
import EditRoundedIcon from '@mui/icons-material/EditRounded';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import ArticleRoundedIcon from '@mui/icons-material/ArticleRounded';
import ImageRoundedIcon from '@mui/icons-material/ImageRounded';
import AllInboxRoundedIcon from '@mui/icons-material/AllInboxRounded';
import { useAuth } from 'qapp-core';
import { useAlert } from '../../../components/alerts';
import { objectToBase64 } from 'qapp-core';
import { Service } from 'qapp-core';
import { useCallback, useEffect, useMemo, useState } from 'react';

type QdnStatus = {
  status: string;
  id: string;
  title: string;
  description: string;
};

type QdnResource = {
  name: string;
  service: string;
  identifier: string;
  status?: QdnStatus;
  size?: number;
  created?: number;
  // metadata is optional; structure varies by publisher/app
  metadata?: Record<string, any>;
};

type AccountName = { name: string; owner: string };

type ViewMode = 'flat' | 'service' | 'app';

/** ---------- utilities ---------- */
const formatBytes = (n?: number) => {
  if (!n && n !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v.toFixed(v >= 100 ? 0 : v >= 10 ? 1 : 2)} ${units[i]}`;
};

const formatTs = (ts?: number) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
};

type TombstoneArgs = { name: string; service: string; identifier: string; reason?: string };

export async function deletePublishedData({ name, service, identifier, reason }: TombstoneArgs) {
  const { alert } = useAlert();
  const tombstone = {
    qassets: { tombstone: true, version: 1 },
    deleted: true,
    deletedAt: Date.now(),
    name,
    service: service as Service,
    identifier,
    reason: reason || 'user-request',
  };

  const data64 = objectToBase64(tombstone);

  // Standard QDN publish path for Q-Apps
  // Some cores expect `mimeType`, and accept either `data64` (preferred) or `data` (Uint8Array).
  try {
    await qortalRequest({
      action: 'PUBLISH_QDN_RESOURCE',
      name,
      service: service as Service,
      identifier,
      data64,
      title: 'TOMBSTONE',
      description: 'Resource removed by publisher',
      encrypt: false,
    } as any);
  } catch (e) {
    alert(`${e}`);
  }
}

/** ---------- hooks ---------- */

/** Load all names on the account */
function useAccountNames() {
  const [entries, setEntries] = useState<AccountName[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const { address: userAddress, authenticateUser } = useAuth();
  const { alert } = useAlert();

  // Ensure auth once
  useEffect(() => {
    (async () => {
      try {
        if (!userAddress) await authenticateUser();
      } catch (e: any) {
        alert(e?.message || 'Authentication failed');
      }
    })();
  }, [userAddress, authenticateUser, alert]);

  const load = useCallback(async () => {
    if (!userAddress) return;
    setLoading(true);
    setError(null);
    try {
      const res = await qortalRequest({ action: 'GET_ACCOUNT_NAMES', address: userAddress });
      // Expect: [{ name, owner }, ...]
      const arr = Array.isArray(res) ? res : (res?.names ?? []);
      const normalized: AccountName[] = (arr as any[])
        .map((x) =>
          x && typeof x.name === 'string' && typeof x.owner === 'string'
            ? { name: x.name, owner: x.owner }
            : null
        )
        .filter(Boolean) as AccountName[];
      setEntries(normalized);
    } catch (e: any) {
      setError(e?.message || 'Failed to load names');
      setEntries([]);
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    if (userAddress) void load();
  }, [userAddress, load]);

  return { entries, loading, error, reload: load };
}

/** Fetch QDN resources for a given name with paging and filters */
function useQdnResources(name: string | null) {
  const [rows, setRows] = useState<QdnResource[]>([]);
  const [loading, setLoading] = useState(false);
  const [hasMore, setHasMore] = useState(false);
  const [offset, setOffset] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const PAGE = 500;

  const reset = useCallback(() => {
    setRows([]);
    setOffset(0);
    setHasMore(false);
    setError(null);
  }, []);

  const loadMore = useCallback(async () => {
    if (!name) return;
    setLoading(true);
    setError(null);
    try {
      const res = await qortalRequest({
        action: 'LIST_QDN_RESOURCES',
        name,
        default: false,
        includeStatus: true,
        includeMetadata: true,
        followedOnly: false,
        excludeBlocked: false,
        limit: PAGE,
        offset,
        reverse: true,
      });
      const list: QdnResource[] = Array.isArray(res) ? res : [];
      setRows((prev) => prev.concat(list));
      const more = list.length === PAGE;
      setHasMore(more);
      if (more) setOffset((o) => o + PAGE);
    } catch (e: any) {
      setError(e?.message || 'Failed to list resources');
    } finally {
      setLoading(false);
    }
  }, [name, offset]);

  useEffect(() => {
    reset();
  }, [name, reset]);

  useEffect(() => {
    // auto-load first page when name changes
    if (name) void loadMore();
  }, [name, loadMore]);

  return { rows, loading, hasMore, loadMore, error, reset };
}

/** ---------- icons by heuristic service ---------- */
function serviceIcon(service?: string) {
  if (!service) return <AllInboxRoundedIcon fontSize="small" />;
  const s = service.toUpperCase();
  if (s.includes('IMAGE')) return <ImageRoundedIcon fontSize="small" />;
  if (s.includes('BLOG')) return <ArticleRoundedIcon fontSize="small" />;
  if (s.includes('JSON') || s.includes('DATA')) return <FolderRoundedIcon fontSize="small" />;
  return <AllInboxRoundedIcon fontSize="small" />;
}

/** Try to pull "app" name from metadata (best-effort, schema varies by publisher) */
function getPublisherApp(r: QdnResource): string {
  const md = (r as any).metadata || {};
  return (
    md.app ||
    md.publisher ||
    md.qApp ||
    md.application ||
    md.qdnApp ||
    (md.source && typeof md.source === 'string' ? md.source : '') ||
    'Unknown'
  );
}

/** ---------- row components ---------- */

function ResourceRow({
  res,
  onDelete,
  onEdit,
}: {
  res: QdnResource;
  onDelete: (r: QdnResource) => void;
  onEdit: (r: QdnResource) => void;
}) {
  const app = getPublisherApp(res);
  return (
    <Paper variant="outlined" sx={{ p: 1.25, borderRadius: 2 }}>
      <Stack direction="row" alignItems="center" spacing={1.25}>
        <Chip
          size="small"
          icon={serviceIcon(res.service)}
          label={res.service ?? '—'}
          variant="outlined"
        />
        <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
          {res.identifier}
        </Typography>

        <Box sx={{ flex: 1 }} />

        {app && app !== 'Unknown' && (
          <Chip size="small" color="default" variant="outlined" label={app} />
        )}
        <Chip size="small" variant="outlined" label={formatBytes(res.size)} sx={{ ml: 0.5 }} />
        <Typography variant="caption" sx={{ opacity: 0.7, ml: 1 }}>
          {formatTs(res.created)}
        </Typography>

        <Tooltip title="Edit">
          <IconButton size="small" onClick={() => onEdit(res)}>
            <EditRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
        <Tooltip title="Delete">
          <IconButton size="small" color="error" onClick={() => onDelete(res)}>
            <DeleteForeverRoundedIcon fontSize="small" />
          </IconButton>
        </Tooltip>
      </Stack>
    </Paper>
  );
}

/** ---------- main page ---------- */

export default function MyPublishedData() {
  // load available names
  const {
    entries,
    loading: loadingNames,
    error: namesError,
    reload: reloadNames,
  } = useAccountNames();
  const [selectedName, setSelectedName] = useState<string | null>(null);

  // pick first name once entries load
  useEffect(() => {
    if (!selectedName && entries.length > 0) setSelectedName(entries[0].name);
  }, [entries, selectedName]);

  // list resources for selected name
  const {
    rows,
    loading,
    hasMore,
    loadMore,
    error: listError,
    reset,
  } = useQdnResources(selectedName);

  // view & arrangement
  const [view, setView] = useState<ViewMode>('flat');
  const [serviceFilter, setServiceFilter] = useState<string>('ALL');

  const services = useMemo(() => {
    const s = new Set<string>();
    rows.forEach((r) => r.service && s.add(r.service));
    return ['ALL', ...Array.from(s).sort()];
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (serviceFilter === 'ALL') return rows;
    return rows.filter((r) => r.service === serviceFilter);
  }, [rows, serviceFilter]);

  // groupers
  const byService = useMemo(() => {
    const m = new Map<string, QdnResource[]>();
    filteredRows.forEach((r) => {
      const key = r.service || 'UNKNOWN';
      const arr = m.get(key) || [];
      arr.push(r);
      m.set(key, arr);
    });
    return m;
  }, [filteredRows]);

  const byApp = useMemo(() => {
    const m = new Map<string, QdnResource[]>();
    filteredRows.forEach((r) => {
      const key = getPublisherApp(r) || 'Unknown';
      const arr = m.get(key) || [];
      arr.push(r);
      m.set(key, arr);
    });
    return m;
  }, [filteredRows]);

  // actions
  const handleDelete = useCallback(
    async (r: QdnResource) => {
      if (!selectedName) return;
      const ok = confirm(
        `Delete resource?\n\nName: ${selectedName}\nService: ${r.service}\nIdentifier: ${r.identifier}`
      );
      if (!ok) return;
      try {
        await deletePublishedData({
          name: selectedName,
          service: r.service,
          identifier: r.identifier,
        });

        // drop from UI
        reset();
        await loadMore(); // reload first page
      } catch (e: any) {
        alert(`Delete failed: ${e?.message || e}`);
      }
    },
    [selectedName, reset, loadMore]
  );

  const handleEdit = useCallback(
    (r: QdnResource) => {
      // For now, route them to Data -> Publish page with prefill intent.
      // You likely have a shared editor; we can wire in a proper editor component later.
      // store selection in sessionStorage for the editor to pick up:
      sessionStorage.setItem(
        'qassets.data.editTarget',
        JSON.stringify({ name: selectedName, service: r.service, identifier: r.identifier })
      );
      // navigate by setting window.location to the relative route:
      window.location.hash = ''; // neutralize hash issues in QDN
      window.history.pushState({}, '', `${window.location.pathname.replace(/\/$/, '')}/publish`);
      // soft reload (optional) — or use your SPA router navigate if you have hooks here
      window.dispatchEvent(new PopStateEvent('popstate'));
    },
    [selectedName]
  );

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: '1200px' }}>
      <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 2 }}>
        <Typography variant="h4" sx={{ lineHeight: 1.15 }}>
          My Published Data
        </Typography>
        <Box sx={{ flex: 1 }} />
        <Tooltip title="Reload names">
          <span>
            <IconButton onClick={reloadNames} disabled={loadingNames}>
              <RefreshRoundedIcon />
            </IconButton>
          </span>
        </Tooltip>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2, borderRadius: 2 }}>
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="name-select-label">Name</InputLabel>
              <Select
                labelId="name-select-label"
                label="Name"
                value={selectedName ?? ''}
                onChange={(e) => setSelectedName(String(e.target.value) || null)}
                renderValue={(v) => v || '—'}
              >
                {entries.map(({ name, owner }) => (
                  <MenuItem key={name} value={name}>
                    <Stack sx={{ width: '100%' }}>
                      <Typography variant="body2">{name}</Typography>
                      <Typography variant="caption" sx={{ opacity: 0.7, fontFamily: 'monospace' }}>
                        {owner}
                      </Typography>
                    </Stack>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12, sm: 6, md: 4 }}>
            <FormControl fullWidth size="small">
              <InputLabel id="service-select-label">Service</InputLabel>
              <Select
                labelId="service-select-label"
                label="Service"
                value={serviceFilter}
                onChange={(e) => setServiceFilter(String(e.target.value))}
              >
                {services.map((s) => (
                  <MenuItem key={s} value={s}>
                    {s}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          </Grid>

          <Grid size={{ xs: 12, sm: 12, md: 4 }}>
            <Stack direction="row" justifyContent={{ xs: 'flex-start', md: 'flex-end' }}>
              <ToggleButtonGroup
                size="small"
                color="primary"
                value={view}
                exclusive
                onChange={(_, v) => v && setView(v)}
              >
                <ToggleButton value="flat">Flat</ToggleButton>
                <ToggleButton value="service">By Service</ToggleButton>
                <ToggleButton value="app">By App</ToggleButton>
              </ToggleButtonGroup>
            </Stack>
          </Grid>
        </Grid>

        {(loadingNames || !entries.length) && (
          <Box sx={{ mt: 1.5 }}>
            {loadingNames ? <LinearProgress /> : <Typography>No names on this account.</Typography>}
          </Box>
        )}
        {namesError && (
          <Typography color="error" sx={{ mt: 1 }}>
            {namesError}
          </Typography>
        )}
      </Paper>

      {/* Results */}
      {!selectedName ? (
        <Typography variant="body2" sx={{ opacity: 0.8 }}>
          Select a name to view its published resources.
        </Typography>
      ) : (
        <Box>
          {/* FLAT VIEW */}
          {view === 'flat' && (
            <Stack spacing={1.0}>
              {filteredRows.map((r) => (
                <ResourceRow
                  key={`${r.service}:${r.identifier}`}
                  res={r}
                  onDelete={handleDelete}
                  onEdit={handleEdit}
                />
              ))}
              {loading && <LinearProgress />}
              <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                {hasMore && (
                  <Button onClick={loadMore} disabled={loading} variant="outlined">
                    Load more
                  </Button>
                )}
                {!rows.length && !loading && (
                  <Typography variant="body2" sx={{ opacity: 0.7 }}>
                    No resources found for “{selectedName}”.
                  </Typography>
                )}
                {listError && (
                  <Typography variant="body2" color="error">
                    {listError}
                  </Typography>
                )}
              </Stack>
            </Stack>
          )}

          {/* BY SERVICE */}
          {view === 'service' && (
            <Stack spacing={2}>
              {Array.from(byService.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([service, items]) => (
                  <Box key={service}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Typography variant="h6">{service}</Typography>
                      <Chip size="small" label={items.length} />
                    </Stack>
                    <Stack spacing={1}>
                      {items.map((r) => (
                        <ResourceRow
                          key={`${r.service}:${r.identifier}`}
                          res={r}
                          onDelete={handleDelete}
                          onEdit={handleEdit}
                        />
                      ))}
                    </Stack>
                    <Divider sx={{ my: 1.5 }} />
                  </Box>
                ))}
              {loading && <LinearProgress />}
              {listError && (
                <Typography variant="body2" color="error">
                  {listError}
                </Typography>
              )}
            </Stack>
          )}

          {/* BY APP */}
          {view === 'app' && (
            <Stack spacing={2}>
              {Array.from(byApp.entries())
                .sort(([a], [b]) => a.localeCompare(b))
                .map(([app, items]) => (
                  <Box key={app}>
                    <Stack direction="row" alignItems="center" spacing={1} sx={{ mb: 1 }}>
                      <Typography variant="h6">{app}</Typography>
                      <Chip size="small" label={items.length} />
                    </Stack>
                    <Stack spacing={1}>
                      {items.map((r) => (
                        <ResourceRow
                          key={`${r.service}:${r.identifier}`}
                          res={r}
                          onDelete={handleDelete}
                          onEdit={handleEdit}
                        />
                      ))}
                    </Stack>
                    <Divider sx={{ my: 1.5 }} />
                  </Box>
                ))}
              {loading && <LinearProgress />}
              {listError && (
                <Typography variant="body2" color="error">
                  {listError}
                </Typography>
              )}
            </Stack>
          )}

          {/* footer controls */}
          {view !== 'flat' && (
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              {hasMore && (
                <Button onClick={loadMore} disabled={loading} variant="outlined">
                  Load more
                </Button>
              )}
              {!rows.length && !loading && (
                <Typography variant="body2" sx={{ opacity: 0.7 }}>
                  No resources found for “{selectedName}”.
                </Typography>
              )}
            </Stack>
          )}
        </Box>
      )}
    </Box>
  );
}
