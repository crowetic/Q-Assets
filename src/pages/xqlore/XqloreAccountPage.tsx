import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  ButtonBase,
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
import { useQortTransactions } from '../../portfolio/useQortTransactions';
import { useXqloreAppIndex } from '../../hooks/useXqloreAppIndex';
import { formatRelativeTime, normalizeTx } from '../../utils/xqloreTx';
import XqloreTxDetailsDialog from '../../components/xqlore/XqloreTxDetailsDialog';

const XqloreAccountPage = () => {
  const theme = useTheme();
  const { address = '' } = useParams();
  const [account, setAccount] = useState<any | null>(null);
  const [names, setNames] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingAccount, setLoadingAccount] = useState(false);
  const [selectedTx, setSelectedTx] = useState<any | null>(null);

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
      <Box sx={{ maxWidth: 1200, mx: 'auto' }}>
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
            { label: 'Balance', value: account?.balance ?? account?.confirmedBalance ?? '—' },
            { label: 'Level', value: account?.level ?? '—' },
            { label: 'Blocks Minted', value: account?.blocksMinted ?? '—' },
          ].map((item) => (
            <Paper key={item.label} elevation={0} sx={{ ...surfaceSx, p: 0 }}>
              <ButtonBase
                onClick={() =>
                  setSelectedTx({
                    raw: { title: item.label, value: item.value },
                  })
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
                  {item.label}
                </Typography>
                <Typography variant="h5" sx={{ fontFamily: 'Orbitron' }}>
                  {item.value}
                </Typography>
              </ButtonBase>
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
                <ButtonBase
                  key={item.id}
                  onClick={() => setSelectedTx(item.raw)}
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
                </ButtonBase>
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
