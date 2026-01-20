import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  Divider,
  Paper,
  Stack,
  Typography,
  Link as MuiLink,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link, useParams } from 'react-router-dom';
import { getAccount, getAllAccountNames } from '../../utils/qortalApi';
import { getAssetBalances } from '../../utils/qortalAssetRequests';
import { useQortTransactions } from '../../portfolio/useQortTransactions';
import { useXqloreAppIndex } from '../../hooks/useXqloreAppIndex';
import { formatNumber, formatRelativeTime, normalizeTx } from '../../utils/xqloreTx';
import XqloreTxDetailsDialog from '../../components/xqlore/XqloreTxDetailsDialog';

const NULL_ACCOUNT_ADDRESS = 'QdSnUy6sUiEnaN87dWmE92g1uQjrvPgrWG';

const XqloreAccountPage = () => {
  const theme = useTheme();
  const { address = '' } = useParams();
  const [account, setAccount] = useState<any | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [qortBalance, setQortBalance] = useState<number | null>(null);
  const [loadingBalance, setLoadingBalance] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any | null>(null);
  const isNullAccount = address === NULL_ACCOUNT_ADDRESS;

  const { registry } = useXqloreAppIndex();
  const txState = useQortTransactions(address, 30);

  useEffect(() => {
    if (!address) return;
    let active = true;
    (async () => {
      setLoadingAccount(true);
      setError(null);
      try {
        const [acct, nameList] = await Promise.all([
          getAccount(address).catch(() => null),
          getAllAccountNames(address).catch(() => []),
        ]);
        if (!active) return;
        setAccount(acct);
        setNames(Array.isArray(nameList) ? nameList : []);
      } catch (err: any) {
        if (!active) return;
        setError(err?.message ?? 'Failed to load account.');
        setAccount(null);
        setNames([]);
      } finally {
        if (active) setLoadingAccount(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [address]);

  useEffect(() => {
    if (!address) return;
    let active = true;
    (async () => {
      setLoadingBalance(true);
      try {
        const rows = await getAssetBalances({ addresses: [address], assetIds: [0] });
        if (!active) return;
        const qortRow = Array.isArray(rows)
          ? rows.find((row: any) => Number(row?.assetId) === 0)
          : null;
        const amount = qortRow?.balance ?? qortRow?.amount ?? qortRow?.confirmedBalance;
        const parsed = Number(amount);
        setQortBalance(Number.isFinite(parsed) ? parsed : null);
      } catch {
        if (active) setQortBalance(null);
      } finally {
        if (active) setLoadingBalance(false);
      }
    })();
    return () => {
      active = false;
    };
  }, [address]);

  useEffect(() => {
    if (!address) return;
    if (!txState.loading && !txState.initialized) {
      void txState.loadMore();
    }
  }, [address, txState]);

  const normalizedTxs = useMemo(() => {
    return txState.items
      .map((tx) => normalizeTx(tx, registry))
      .filter(Boolean)
      .slice(0, 30);
  }, [txState.items, registry]);

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
        background: `radial-gradient(circle at 10% 10%, ${alpha(
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
                  Account
                </Typography>
                <MuiLink
                  component="button"
                  underline="hover"
                  onClick={() => setSelectedTx({ raw: { address } })}
                  sx={{ color: theme.palette.text.secondary, textAlign: 'left' }}
                >
                  {address}
                </MuiLink>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Button component={Link} to="/xqlore" variant="outlined">
                  Back to Xqlore
                </Button>
              </Stack>
            </Stack>
            {isNullAccount && (
              <Paper elevation={0} sx={{ p: 2, borderRadius: 2, backgroundColor: alpha(theme.palette.warning.light, 0.1), border: `1px solid ${alpha(theme.palette.warning.main, 0.4)}` }}>
                <Stack spacing={1}>
                  <Stack direction="row" spacing={1} alignItems="center">
                    <Chip label="Null Account" color="warning" variant="outlined" />
                    <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                      Qortal Null Account
                    </Typography>
                  </Stack>
                  <Typography variant="body2" color="text.secondary">
                    The Null Account is an account leveraged by ATs on Qortal and is a burn address
                    for any assets sent to it. The Null account is owned by no one and has no
                    private key. Null-owned groups are forced GROUP_APPROVAL controlled, such as
                    the MINTER group and Dev groups of Qortal.
                  </Typography>
                </Stack>
              </Paper>
            )}
            {error && (
              <Typography variant="body2" color="error">
                {error}
              </Typography>
            )}
            <Stack direction="row" spacing={1} flexWrap="wrap">
              {(names.length ? names : ['No names found']).map((name) => (
                <Chip
                  key={name}
                  label={name}
                  variant="outlined"
                  clickable
                  onClick={() => setSelectedTx({ raw: { name } })}
                />
              ))}
            </Stack>
          </Stack>
        </Paper>

        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
            gap: 2,
            mb: 3,
          }}
        >
          {[
            {
              label: 'Balance',
              value: loadingBalance
                ? 'Loading...'
                : formatNumber(
                    qortBalance ?? account?.balance ?? account?.confirmedBalance ?? '—',
                    8
                  ),
            },
            { label: 'Level', value: account?.level ?? '—' },
            { label: 'Blocks Minted', value: account?.blocksMinted ?? '—' },
          ].map((item) => (
            <Paper key={item.label} elevation={0} sx={{ ...surfaceSx, p: 0 }}>
              <Box
                role="button"
                tabIndex={0}
                onClick={() =>
                  setSelectedTx({
                    raw: { title: item.label, value: item.value },
                  })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    setSelectedTx({
                      raw: { title: item.label, value: item.value },
                    });
                  }
                }}
                sx={{
                  width: '100%',
                  textAlign: 'left',
                  p: 2.5,
                  display: 'flex',
                  flexDirection: 'column',
                  alignItems: 'flex-start',
                  cursor: 'pointer',
                }}
              >
                <Typography variant="overline" sx={{ letterSpacing: '0.16em' }}>
                  {item.label}
                </Typography>
                <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
                  {item.value}
                </Typography>
              </Box>
            </Paper>
          ))}
        </Box>

        <Paper elevation={0} sx={{ ...surfaceSx, p: { xs: 2.5, md: 3.5 } }}>
          <Stack direction="row" justifyContent="space-between" alignItems="center">
            <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
              Recent transactions
            </Typography>
            {txState.loading && (
              <Typography variant="caption" color="text.secondary">
                Loading...
              </Typography>
            )}
          </Stack>
          <Divider sx={{ my: 2 }} />
          {loadingAccount && normalizedTxs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              Loading account activity...
            </Typography>
          ) : normalizedTxs.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No transactions found for this account yet.
            </Typography>
          ) : (
            <Stack spacing={2}>
              {normalizedTxs.map((item) => (
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
                    <MuiLink
                      component={Link}
                      to={`/xqlore/apps/${encodeURIComponent(item.app)}`}
                      onClick={(event) => event.stopPropagation()}
                      underline="hover"
                    >
                      {item.app}
                    </MuiLink>
                    <Typography variant="caption" color="text.secondary">
                      {item.origin}
                    </Typography>
                  </Stack>
                </Box>
              ))}
              {txState.hasMore && (
                <Button variant="outlined" onClick={() => txState.loadMore()}>
                  Load more
                </Button>
              )}
            </Stack>
          )}
        </Paper>
      </Box>

      <XqloreTxDetailsDialog
        open={Boolean(selectedTx)}
        tx={selectedTx}
        onClose={() => setSelectedTx(null)}
        title="Account detail"
      />
    </Box>
  );
};

export default XqloreAccountPage;
