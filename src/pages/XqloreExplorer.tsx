import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  LinearProgress,
  Link as MuiLink,
  Paper,
  Stack,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import XqloreTxDetailsDialog from '../components/xqlore/XqloreTxDetailsDialog';
import { useXqloreAppIndex } from '../hooks/useXqloreAppIndex';
import { useXqloreTxIndex } from '../hooks/useXqloreTxIndex';
import { isAddressAdminInManagementGroup } from '../utils/access';
import {
  formatRelativeTime,
  formatNumber,
  normalizeTx,
  type NormalizedTx,
} from '../utils/xqloreTx';

const TIME_RANGE_MS: Record<string, number> = {
  '15m': 15 * 60 * 1000,
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000,
};

const LIVE_POLL_MS = 15_000;

const TX_TYPES = [
  'ARBITRARY',
  'PAYMENT',
  'MULTI_PAYMENT',
  'TRANSFER_ASSET',
  'ISSUE_ASSET',
  'CREATE_ASSET_ORDER',
  'CANCEL_ASSET_ORDER',
  'REGISTER_NAME',
  'UPDATE_NAME',
  'CREATE_GROUP',
  'JOIN_GROUP',
  'LEAVE_GROUP',
  'DEPLOY_AT',
  'AT',
  'MESSAGE',
] as const;

const TYPE_COLORS: Record<string, 'info' | 'success' | 'warning' | 'error' | 'secondary'> = {
  ARBITRARY: 'info',
  TRANSFER_ASSET: 'success',
  REGISTER_NAME: 'warning',
  ISSUE_ASSET: 'secondary',
  DEPLOY_AT: 'error',
  AT: 'error',
  PAYMENT: 'success',
  MULTI_PAYMENT: 'success',
};

type LinkTarget =
  | { kind: 'tx'; tx: any; title: string }
  | { kind: 'comingSoon'; title: string; description?: string; meta?: Array<[string, string]> };

const sortByTimestamp = (a: NormalizedTx, b: NormalizedTx) => b.timestampMs - a.timestampMs;

const XqloreExplorer = () => {
  const theme = useTheme();
  const { address } = useAuth();
  const [timeRange, setTimeRange] = useState('1h');
  const [viewMode, setViewMode] = useState('pulse');
  const [live, setLive] = useState(true);
  const [query, setQuery] = useState('');
  const [transactions, setTransactions] = useState<NormalizedTx[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [linkTarget, setLinkTarget] = useState<LinkTarget | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const loadingRef = useRef(false);

  const { registry } = useXqloreAppIndex();
  const {
    index: txIndex,
    entries: indexEntries,
    loading: indexLoading,
  } = useXqloreTxIndex(registry);

  useEffect(() => {
    let active = true;
    if (!address) {
      setIsAdmin(false);
      return undefined;
    }
    (async () => {
      const ok = await isAddressAdminInManagementGroup(address);
      if (active) setIsAdmin(ok);
    })();
    return () => {
      active = false;
    };
  }, [address]);

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

  const softGlow = `linear-gradient(135deg, ${alpha(
    theme.palette.primary.light,
    0.18
  )}, ${alpha(theme.palette.info.light, 0.12)})`;

  const loadActivity = useCallback(
    async ({ silent }: { silent?: boolean } = {}) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      if (!silent) setLoading(true);
      setError(null);
      try {
        const res = await qortalRequest({
          action: 'SEARCH_TRANSACTIONS',
          confirmationStatus: 'BOTH',
          limit: 20,
          offset: 0,
          reverse: true,
          txType: [...TX_TYPES],
        });
        const rows = Array.isArray(res) ? res : res && typeof res === 'object' ? [res] : [];
        const normalized = rows
          .map((tx) => normalizeTx(tx, registry))
          .filter((tx): tx is NormalizedTx => Boolean(tx));
        setTransactions(normalized);
        setLastUpdated(Date.now());
      } catch (err: any) {
        console.error('Xqlore activity fetch failed', err);
        setError(err?.message ?? 'Failed to load chain activity.');
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [registry]
  );

  useEffect(() => {
    void loadActivity();
  }, [loadActivity]);

  useEffect(() => {
    if (!live) return;
    const id = window.setInterval(() => {
      void loadActivity({ silent: true });
    }, LIVE_POLL_MS);
    return () => window.clearInterval(id);
  }, [live, loadActivity]);

  const combinedTxs = useMemo(() => {
    const seen = new Set<string>();
    const merged = [...transactions, ...indexEntries]
      .filter((item) => {
        if (seen.has(item.id)) return false;
        seen.add(item.id);
        return true;
      })
      .sort(sortByTimestamp);
    return merged;
  }, [transactions, indexEntries]);

  const timeWindowMs = TIME_RANGE_MS[timeRange] ?? TIME_RANGE_MS['1h'];
  const cutoff = Date.now() - timeWindowMs;
  const queryLower = query.trim().toLowerCase();

  const filteredTxs = useMemo(() => {
    return combinedTxs.filter((tx) => {
      if (tx.timestampMs < cutoff) return false;
      if (!queryLower) return true;
      return (
        tx.identifier?.toLowerCase().includes(queryLower) ||
        tx.app.toLowerCase().includes(queryLower) ||
        tx.summary.toLowerCase().includes(queryLower) ||
        tx.originFull.toLowerCase().includes(queryLower) ||
        tx.type.toLowerCase().includes(queryLower)
      );
    });
  }, [combinedTxs, cutoff, queryLower]);

  const activityItems = useMemo(() => {
    return filteredTxs.map((tx) => ({
      ...tx,
      time: formatRelativeTime(tx.timestampMs),
    }));
  }, [filteredTxs]);

  const metrics = useMemo(() => {
    const total = filteredTxs.length;
    const qdnPublishes = filteredTxs.filter((tx) => tx.type === 'ARBITRARY').length;
    const assetMoves = filteredTxs.filter((tx) => tx.type.includes('ASSET')).length;
    const apps = new Set(filteredTxs.map((tx) => tx.app));
    return [
      { label: 'Tx Pulse', value: formatNumber(total, 0), detail: `${total} in range` },
      {
        label: 'QDN Publishes',
        value: formatNumber(qdnPublishes, 0),
        detail: `${qdnPublishes} arbitrary publishes`,
      },
      {
        label: 'Active Apps',
        value: formatNumber(apps.size, 0),
        detail: `${Math.max(apps.size - 1, 0)} mapped identifiers`,
      },
      {
        label: 'Asset Moves',
        value: formatNumber(assetMoves, 0),
        detail: `${assetMoves} asset-layer events`,
      },
    ];
  }, [filteredTxs]);

  const appAttribution = useMemo(() => {
    const counts = new Map<string, number>();
    filteredTxs.forEach((tx) => {
      counts.set(tx.app, (counts.get(tx.app) ?? 0) + 1);
    });
    const total = filteredTxs.length || 1;
    return Array.from(counts.entries())
      .map(([name, count]) => ({
        name,
        count,
        share: Math.round((count / total) * 100),
      }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
  }, [filteredTxs]);

  const tagMatrix = useMemo(() => {
    const counts = new Map<string, number>();
    filteredTxs.forEach((tx) => {
      tx.tags.forEach((tag) => counts.set(tag, (counts.get(tag) ?? 0) + 1));
    });
    return Array.from(counts.entries())
      .map(([label, count]) => ({ label, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 8);
  }, [filteredTxs]);

  const identifierRadar = useMemo(() => {
    const seen = new Set<string>();
    const items: Array<{ id: string; app: string; status: string; tx?: any }> = [];
    for (const tx of filteredTxs) {
      if (!tx.identifier) continue;
      if (seen.has(tx.identifier)) continue;
      seen.add(tx.identifier);
      items.push({
        id: tx.identifier,
        app: tx.app,
        status: tx.app === 'Unmapped' ? 'unknown' : 'verified',
        tx: tx.raw,
      });
      if (items.length >= 5) break;
    }
    return items;
  }, [filteredTxs]);

  const signalStats = useMemo(() => {
    const total = Math.max(filteredTxs.length, 1);
    const mapped = filteredTxs.filter((tx) => tx.app !== 'Unmapped').length;
    const unmapped = filteredTxs.filter((tx) => tx.app === 'Unmapped').length;
    const encrypted = filteredTxs.filter((tx) => tx.tags.includes('private')).length;
    return [
      { label: 'Identifier matches', value: mapped, pct: Math.round((mapped / total) * 100) },
      { label: 'Unmapped apps', value: unmapped, pct: Math.round((unmapped / total) * 100) },
      {
        label: 'Encrypted payloads',
        value: encrypted,
        pct: Math.round((encrypted / total) * 100),
      },
    ];
  }, [filteredTxs]);

  const openTxDetails = (tx: any, title: string) => {
    setLinkTarget({ kind: 'tx', tx, title });
  };

  const openComingSoon = (title: string, description?: string, meta?: Array<[string, string]>) => {
    setLinkTarget({ kind: 'comingSoon', title, description, meta });
  };

  const closeDialog = () => setLinkTarget(null);

  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '100%',
        px: { xs: 2, md: 4 },
        py: { xs: 3, md: 5 },
        background: `radial-gradient(circle at 15% 10%, ${alpha(
          theme.palette.info.light,
          0.22
        )} 0%, transparent 45%), radial-gradient(circle at 85% 20%, ${alpha(
          theme.palette.warning.light,
          0.2
        )} 0%, transparent 40%), linear-gradient(180deg, ${alpha(
          theme.palette.background.default,
          0.98
        )} 0%, ${alpha(theme.palette.background.paper, 0.92)} 100%)`,
        overflow: 'hidden',
        '@keyframes xqlore-rise': {
          from: { opacity: 0, transform: 'translateY(16px)' },
          to: { opacity: 1, transform: 'translateY(0)' },
        },
        '@keyframes xqlore-glow': {
          '0%': { opacity: 0.4 },
          '50%': { opacity: 0.9 },
          '100%': { opacity: 0.4 },
        },
      }}
    >
      <Box
        sx={{
          position: 'absolute',
          inset: 0,
          backgroundImage:
            'linear-gradient(120deg, rgba(255,255,255,0.08) 0%, rgba(255,255,255,0) 50%, rgba(255,255,255,0.08) 100%)',
          opacity: 0.4,
          pointerEvents: 'none',
        }}
      />
      <Box sx={{ maxWidth: 1400, mx: 'auto', position: 'relative', zIndex: 1 }}>
        <Paper
          elevation={0}
          sx={{
            ...surfaceSx,
            p: { xs: 3, md: 4 },
            mb: { xs: 3, md: 4 },
            backgroundImage: `${softGlow}, linear-gradient(160deg, ${alpha(
              theme.palette.background.default,
              0.92
            )} 0%, ${alpha(theme.palette.background.paper, 0.95)} 100%)`,
            animation: 'xqlore-rise 700ms ease-out',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              top: -60,
              right: -80,
              width: 220,
              height: 220,
              borderRadius: '50%',
              background: `radial-gradient(circle, ${alpha(
                theme.palette.primary.light,
                0.45
              )} 0%, transparent 70%)`,
              animation: 'xqlore-glow 6s ease-in-out infinite',
            }}
          />
          <Stack spacing={2}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={2}
              alignItems={{ md: 'center' }}
              justifyContent="space-between"
            >
              <Box>
                <Typography
                  variant="h3"
                  sx={{
                    fontFamily: 'Orbitron',
                    letterSpacing: '0.08em',
                    textTransform: 'uppercase',
                  }}
                >
                  Xqlore
                </Typography>
                <Typography variant="h6" sx={{ mt: 1, color: theme.palette.text.secondary }}>
                  Next-gen Q-Assets explorer for full-spectrum Qortal activity.
                </Typography>
                <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                  {lastUpdated
                    ? `Last sync ${new Date(lastUpdated).toLocaleTimeString()}`
                    : 'Awaiting first sync'}
                  {txIndex?.blockEnd
                    ? ` · Index blocks ${txIndex.blockStart}-${txIndex.blockEnd}`
                    : ''}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                <ToggleButtonGroup
                  value={timeRange}
                  exclusive
                  onChange={(_, next) => next && setTimeRange(next)}
                  size="small"
                  sx={{
                    background: alpha(theme.palette.background.default, 0.7),
                    borderRadius: '999px',
                    p: 0.5,
                  }}
                >
                  {['15m', '1h', '24h', '7d'].map((range) => (
                    <ToggleButton key={range} value={range} sx={{ textTransform: 'none' }}>
                      {range}
                    </ToggleButton>
                  ))}
                </ToggleButtonGroup>
                <Button
                  variant="contained"
                  color={live ? 'success' : 'primary'}
                  sx={{ textTransform: 'none' }}
                  onClick={() => setLive((prev) => !prev)}
                >
                  {live ? 'Live scan on' : 'Enable live scan'}
                </Button>
                <Button
                  variant="outlined"
                  sx={{ textTransform: 'none' }}
                  onClick={() => loadActivity()}
                >
                  Refresh
                </Button>
                {isAdmin && (
                  <Button
                    variant="outlined"
                    component={Link}
                    to="/xqlore/admin"
                    sx={{ textTransform: 'none' }}
                  >
                    Admin console
                  </Button>
                )}
              </Stack>
            </Stack>
            <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} alignItems="center">
              <TextField
                placeholder="Search identifier, name, address, or signature"
                size="small"
                fullWidth
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                sx={{
                  backgroundColor: alpha(theme.palette.background.default, 0.75),
                  borderRadius: '12px',
                }}
              />
              <Stack direction="row" spacing={1} flexWrap="wrap">
                {['ARBITRARY', 'ASSET', 'NAMES', 'AT', 'QDN'].map((tag) => (
                  <Chip
                    key={tag}
                    label={tag}
                    variant="outlined"
                    clickable
                    onClick={() =>
                      openComingSoon('Filter coming soon', `${tag} filtering will be added soon.`)
                    }
                  />
                ))}
              </Stack>
            </Stack>
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {[
                'Identifier to app attribution',
                'Live chain pulse',
                'Tagged activity context',
                'Multi-service lens',
              ].map((text) => (
                <Chip
                  key={text}
                  label={text}
                  size="small"
                  clickable
                  onClick={() => openComingSoon(text, 'Expanded insights are coming soon.')}
                  sx={{ backgroundColor: alpha(theme.palette.primary.light, 0.15) }}
                />
              ))}
              <Chip component={Link} to="/xqlore/minting" label="Minting" clickable size="small" />
              <Chip component={Link} to="/xqlore/trading" label="Trading" clickable size="small" />
            </Stack>
          </Stack>
        </Paper>

        {error && (
          <Paper elevation={0} sx={{ ...surfaceSx, p: 2, mb: 3 }}>
            <Typography color="error" variant="body2">
              {error}
            </Typography>
          </Paper>
        )}

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(4, 1fr)' },
            gap: 2,
            mb: { xs: 3, md: 4 },
          }}
        >
          {metrics.map((metric, index) => (
            <Paper
              key={metric.label}
              elevation={0}
              sx={{
                ...surfaceSx,
                p: 0,
                animation: 'xqlore-rise 700ms ease-out',
                animationDelay: `${150 + index * 100}ms`,
                animationFillMode: 'both',
              }}
            >
              <ButtonBase
                onClick={() =>
                  openComingSoon(metric.label, 'Metric drill-down is coming soon.', [
                    ['Current', String(metric.value)],
                    ['Detail', metric.detail],
                  ])
                }
                sx={{
                  width: '100%',
                  textAlign: 'left',
                  p: 2.5,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                }}
              >
                <Typography variant="overline" sx={{ letterSpacing: '0.16em' }}>
                  {metric.label}
                </Typography>
                <Typography variant="h4" sx={{ fontFamily: 'Orbitron', mt: 0.5 }}>
                  {metric.value}
                </Typography>
                <Typography variant="body2" sx={{ color: theme.palette.text.secondary }}>
                  {metric.detail}
                </Typography>
              </ButtonBase>
            </Paper>
          ))}
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', lg: '2fr 1fr' },
            gap: 2,
            mb: { xs: 3, md: 4 },
          }}
        >
          <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 2.5, md: 3.5 } }}>
            <Stack direction="row" spacing={2} alignItems="center" justifyContent="space-between">
              <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
                Activity stream
              </Typography>
              <ToggleButtonGroup
                value={viewMode}
                exclusive
                onChange={(_, next) => next && setViewMode(next)}
                size="small"
              >
                {['pulse', 'map', 'timeline'].map((mode) => (
                  <ToggleButton key={mode} value={mode} sx={{ textTransform: 'capitalize' }}>
                    {mode}
                  </ToggleButton>
                ))}
              </ToggleButtonGroup>
            </Stack>
            <Divider sx={{ my: 2 }} />
            {loading && transactions.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                Loading live activity...
              </Typography>
            ) : activityItems.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No activity found for this window yet.
              </Typography>
            ) : (
              <Stack spacing={2}>
                {activityItems.map((item, index) => (
                  <ButtonBase
                    key={item.id}
                    onClick={() => openTxDetails(item.raw, `Transaction ${item.id}`)}
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
                      animation: 'xqlore-rise 700ms ease-out',
                      animationDelay: `${200 + index * 80}ms`,
                      animationFillMode: 'both',
                    }}
                  >
                    <Stack spacing={1}>
                      <Chip
                        label={item.type}
                        color={TYPE_COLORS[item.type] ?? 'info'}
                        variant="outlined"
                      />
                      <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                        {item.time}
                      </Typography>
                    </Stack>
                    <Stack spacing={1}>
                      <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                        {item.summary}
                      </Typography>
                      <MuiLink
                        component="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          openComingSoon(
                            'Identifier details',
                            'Identifier drill-down is coming soon.',
                            [['Identifier', item.identifier || '—']]
                          );
                        }}
                        underline="hover"
                        sx={{
                          fontFamily: 'monospace',
                          color: theme.palette.text.secondary,
                          textAlign: 'left',
                        }}
                      >
                        {item.identifier || '—'}
                      </MuiLink>
                      <Typography variant="body2">{item.context}</Typography>
                      <Stack direction="row" spacing={1} flexWrap="wrap">
                        {item.tags.map((tag) => (
                          <Chip
                            key={tag}
                            label={tag}
                            size="small"
                            variant="outlined"
                            clickable
                            onClick={(event) => {
                              event.stopPropagation();
                              openComingSoon('Tag filter', `Filtering by ${tag} is coming soon.`);
                            }}
                          />
                        ))}
                      </Stack>
                    </Stack>
                    <Stack spacing={1} alignItems={{ xs: 'flex-start', md: 'flex-end' }}>
                      <MuiLink
                        component={Link}
                        to={`/xqlore/apps/${encodeURIComponent(item.app)}`}
                        onClick={(event) => event.stopPropagation()}
                        underline="hover"
                        sx={{ fontWeight: 600 }}
                      >
                        {item.app}
                      </MuiLink>
                      {item.originFull && item.originFull !== 'Unknown' ? (
                        <MuiLink
                          component={Link}
                          to={`/xqlore/accounts/${item.originFull}`}
                          onClick={(event) => event.stopPropagation()}
                          underline="hover"
                          sx={{ color: theme.palette.text.secondary }}
                        >
                          {item.origin}
                        </MuiLink>
                      ) : (
                        <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                          {item.origin}
                        </Typography>
                      )}
                    </Stack>
                  </ButtonBase>
                ))}
              </Stack>
            )}
          </Paper>

          <Stack spacing={2}>
            <Paper elevation={0} sx={{ ...surfaceSx, p: 2.5 }}>
              <Typography variant="h6" sx={{ fontFamily: 'Orbitron' }}>
                Signal console
              </Typography>
              <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mt: 0.5 }}>
                Watch the services that shape identifier context and routing.
              </Typography>
              <Stack spacing={2} sx={{ mt: 2 }}>
                {signalStats.map((row) => (
                  <ButtonBase
                    key={row.label}
                    onClick={() =>
                      openComingSoon(row.label, 'Signal diagnostics are expanding soon.', [
                        ['Count', String(row.value)],
                        ['Share', `${row.pct}%`],
                      ])
                    }
                    sx={{ width: '100%', textAlign: 'left' }}
                  >
                    <Box sx={{ width: '100%' }}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2">{row.label}</Typography>
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {row.value}
                        </Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={row.pct}
                        sx={{
                          mt: 1,
                          height: 6,
                          borderRadius: '999px',
                          backgroundColor: alpha(theme.palette.background.default, 0.8),
                        }}
                      />
                    </Box>
                  </ButtonBase>
                ))}
              </Stack>
            </Paper>

            <Paper elevation={0} sx={{ ...surfaceSx, p: 2.5 }}>
              <Typography variant="h6" sx={{ fontFamily: 'Orbitron' }}>
                App attribution
              </Typography>
              <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mt: 0.5 }}>
                Identify which apps are shaping the current chain narrative.
              </Typography>
              <Stack spacing={2} sx={{ mt: 2 }}>
                {appAttribution.length === 0 && (
                  <Typography variant="body2" color="text.secondary">
                    No attribution data yet.
                  </Typography>
                )}
                {appAttribution.map((app) => (
                  <ButtonBase
                    key={app.name}
                    component={Link}
                    to={`/xqlore/apps/${encodeURIComponent(app.name)}`}
                    sx={{ width: '100%', textAlign: 'left' }}
                  >
                    <Box sx={{ width: '100%' }}>
                      <Stack direction="row" justifyContent="space-between">
                        <Typography variant="body2" sx={{ fontWeight: 600 }}>
                          {app.name}
                        </Typography>
                        <Typography variant="body2">{app.share}%</Typography>
                      </Stack>
                      <LinearProgress
                        variant="determinate"
                        value={app.share}
                        sx={{
                          mt: 1,
                          height: 6,
                          borderRadius: '999px',
                          backgroundColor: alpha(theme.palette.background.default, 0.8),
                        }}
                      />
                      <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                        {app.count} events
                      </Typography>
                    </Box>
                  </ButtonBase>
                ))}
              </Stack>
            </Paper>
          </Stack>
        </Box>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: '1.1fr 1fr' },
            gap: 2,
          }}
        >
          <Paper elevation={0} sx={{ ...surfaceSx, p: 2.5 }}>
            <Typography variant="h6" sx={{ fontFamily: 'Orbitron' }}>
              Tag matrix
            </Typography>
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mt: 0.5 }}>
              Surface emerging context across QDN, assets, and names.
            </Typography>
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: 'repeat(2, 1fr)', sm: 'repeat(4, 1fr)' },
                gap: 1,
                mt: 2,
              }}
            >
              {tagMatrix.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  Tags will appear once activity flows in.
                </Typography>
              )}
              {tagMatrix.map((tag) => (
                <ButtonBase
                  key={tag.label}
                  onClick={() =>
                    openComingSoon(`Tag: ${tag.label}`, 'Tag exploration is coming soon.', [
                      ['Matches', String(tag.count)],
                    ])
                  }
                  sx={{
                    textAlign: 'left',
                    borderRadius: '14px',
                    p: 1.5,
                    backgroundColor: alpha(theme.palette.background.default, 0.7),
                    border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                  }}
                >
                  <Box>
                    <Typography variant="body2" sx={{ fontWeight: 600 }}>
                      {tag.label}
                    </Typography>
                    <Typography variant="caption" sx={{ color: theme.palette.text.secondary }}>
                      {tag.count} matches
                    </Typography>
                  </Box>
                </ButtonBase>
              ))}
            </Box>
          </Paper>

          <Paper elevation={0} sx={{ ...surfaceSx, p: 2.5 }}>
            <Typography variant="h6" sx={{ fontFamily: 'Orbitron' }}>
              Identifier radar
            </Typography>
            <Typography variant="body2" sx={{ color: theme.palette.text.secondary, mt: 0.5 }}>
              Map identifiers to apps to keep the live feed contextual.
            </Typography>
            <Stack spacing={1.5} sx={{ mt: 2 }}>
              {identifierRadar.length === 0 && (
                <Typography variant="body2" color="text.secondary">
                  No identifiers detected yet.
                </Typography>
              )}
              {identifierRadar.map((item) => (
                <ButtonBase
                  key={item.id}
                  onClick={() =>
                    item.tx
                      ? openTxDetails(item.tx, `Identifier ${item.id}`)
                      : openComingSoon(item.id, 'Identifier details are coming soon.')
                  }
                  sx={{
                    textAlign: 'left',
                    borderRadius: '14px',
                    p: 1.5,
                    backgroundColor: alpha(theme.palette.background.default, 0.7),
                    border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 0.5,
                  }}
                >
                  <Typography variant="body2" sx={{ fontFamily: 'monospace' }}>
                    {item.id}
                  </Typography>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Typography variant="caption">{item.app}</Typography>
                    <Chip label={item.status} size="small" variant="outlined" />
                  </Stack>
                </ButtonBase>
              ))}
            </Stack>
          </Paper>
        </Box>

        {indexLoading && (
          <Paper elevation={0} sx={{ ...surfaceSx, p: 2, mt: 3 }}>
            <Typography variant="body2" color="text.secondary">
              Loading Xqlore index...
            </Typography>
          </Paper>
        )}
      </Box>

      <XqloreTxDetailsDialog
        open={Boolean(linkTarget && linkTarget.kind === 'tx')}
        tx={linkTarget && linkTarget.kind === 'tx' ? linkTarget.tx : null}
        onClose={closeDialog}
        title={linkTarget && linkTarget.kind === 'tx' ? linkTarget.title : 'Transaction Details'}
      />

      <Dialog open={Boolean(linkTarget && linkTarget.kind === 'comingSoon')} onClose={closeDialog}>
        <DialogTitle>
          {linkTarget && linkTarget.kind === 'comingSoon' ? linkTarget.title : 'Coming soon'}
        </DialogTitle>
        <DialogContent dividers>
          <Typography variant="body2" color="text.secondary">
            {linkTarget && linkTarget.kind === 'comingSoon'
              ? linkTarget.description || 'Coming soon.'
              : 'Coming soon.'}
          </Typography>
          {linkTarget && linkTarget.kind === 'comingSoon' && linkTarget.meta && (
            <Box
              sx={{
                mt: 2,
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr' },
                columnGap: 2,
                rowGap: 1,
                fontFamily: 'monospace',
                fontSize: 12,
              }}
            >
              {linkTarget.meta.map(([label, value]) => (
                <Box key={label} sx={{ display: 'contents' }}>
                  <Typography color="text.secondary">{label}</Typography>
                  <Typography>{value}</Typography>
                </Box>
              ))}
            </Box>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDialog}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
};

export default XqloreExplorer;
