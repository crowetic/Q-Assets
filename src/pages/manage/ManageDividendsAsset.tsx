import * as React from 'react';
import { Box, Stack, Paper, Typography, Button, CircularProgress, Alert } from '@mui/material';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useFetchTracker } from '../../state/global/fetchTracker';
import { resolveAssetBasics } from '../../utils/resolveAssetBasics';
import { fetchAssetHolders, resolveNames, type HolderRow } from '../../utils/assetData';
import { formatQty } from '../../utils/marketUI';
import {
  ensureAssetsIndexLoaded,
  ensureAssetMini,
  readAssetsIndexSync,
} from '../../bootstrap/assetsBootstrap';

// Only the fields we actually read from "mini"
type MinimalMini = { name?: string; isDivisible?: boolean };

type Row = HolderRow & {
  name?: string | null;
  percent: number; // of circulating supply
};

export default function ManageDividendsAsset() {
  const { assetId } = useParams<{ assetId: string }>();
  const id = Number(assetId);
  const { track } = useFetchTracker();
  const busyWhile = React.useCallback(
    async <T,>(fn: () => Promise<T> | T, label: string) => track(Promise.resolve().then(fn), label),
    [track]
  );

  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  const [assetName, setAssetName] = React.useState<string>('');
  const [divisible, setDivisible] = React.useState(true);
  const [issuer, setIssuer] = React.useState<string | null>(null);
  const [rows, setRows] = React.useState<Row[]>([]);
  const [circulating, setCirculating] = React.useState(0);
  const [issuerBal, setIssuerBal] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        await busyWhile(async () => {
          // Mini info for name/divisibility
          const idx = (await ensureAssetsIndexLoaded()) ?? readAssetsIndexSync() ?? {};
          let mini: MinimalMini | undefined = (idx as Record<number, MinimalMini | undefined>)[id];
          if (!mini) {
            mini = (await ensureAssetMini(id).catch(() => undefined)) as MinimalMini | undefined;
          }
          const nm = mini?.name || `#${id}`;
          const div = Boolean(mini?.isDivisible ?? true);
          if (alive) {
            setAssetName(nm);
            setDivisible(div);
          }

          // basics for issuer address
          const basics = await resolveAssetBasics(id).catch(() => null);
          const ownerAddr = basics?.ownerAddress ?? null;
          if (alive) setIssuer(ownerAddr);

          // holders
          const raw = await fetchAssetHolders({
            assetId: id,
            limit: 5000,
            ordering: 'ASSET_BALANCE_ACCOUNT',
            excludeZero: true,
          });

          // enrich with names
          const nameMap = await resolveNames(raw.map((r) => r.address));
          const withNames = raw.map((r) => ({ ...r, name: nameMap.get(r.address) ?? null }));
          withNames.sort((a, b) => b.balance - a.balance);

          // compute totals
          const totalHeld = withNames.reduce((s, r) => s + (r.balance || 0), 0);
          const issuerBalance = ownerAddr
            ? withNames.find((r) => r.address === ownerAddr)?.balance || 0
            : 0;
          const circ = Math.max(0, totalHeld - issuerBalance);

          // exclude issuer and compute % of circulating
          const exIssuer = withNames
            .filter((r) => !ownerAddr || r.address !== ownerAddr)
            .map((r) => ({
              ...r,
              percent: circ > 0 ? (r.balance / circ) * 100 : 0,
            }));

          if (alive) {
            setIssuerBal(issuerBalance);
            setCirculating(circ);
            setRows(exIssuer);
          }
        }, 'blocking:manage:dividends:asset');
      } catch (e: any) {
        if (alive) setError(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, busyWhile]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: 1100 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h4" sx={{ lineHeight: 1.15 }}>
          Dividends — {assetName} (#{id})
        </Typography>
        <Button component={RouterLink} to="/manage/dividends" variant="text">
          ← Select Different Asset
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Paper variant="outlined" sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Paper>
      ) : (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 2 } }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Circulating (ex-issuer):
            </Typography>
            <Typography>
              Issuer balance: <b>{formatQty(issuerBal, divisible)}</b> {assetName}
            </Typography>
            <Typography>
              Circulating supply: <b>{formatQty(circulating, divisible)}</b> {assetName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Percentages below are each holder’s share of the current circulating amount.
            </Typography>
          </Paper>

          <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 2 } }}>
            {/* header */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr auto auto', sm: 'auto 1fr auto auto' },
                columnGap: 1,
                px: 1,
                fontSize: 12,
                color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums',
                mb: 0.5,
              }}
            >
              <Box sx={{ display: { xs: 'none', sm: 'block' } }}>#</Box>
              <Box>Account</Box>
              <Box sx={{ textAlign: 'right' }}>{assetName} Amount</Box>
              <Box sx={{ textAlign: 'right' }}>% Circulating</Box>
            </Box>

            <Box sx={{ display: 'grid', gap: 0.25 }}>
              {rows.map((r, idx) => {
                const rank = idx + 1;
                const label = r.name ? r.name : r.address.slice(0, 8) + '…' + r.address.slice(-6);

                return (
                  <Box
                    key={`${r.address}-${idx}`}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: { xs: '1fr auto auto', sm: 'auto 1fr auto auto' },
                      columnGap: 1,
                      alignItems: 'center',
                      px: 1,
                      py: 0.5,
                      borderRadius: 0.75,
                      fontVariantNumeric: 'tabular-nums',
                      border: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{rank}</Box>
                    <Box
                      sx={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </Box>
                    <Box sx={{ textAlign: 'right', fontWeight: 700 }}>
                      {formatQty(r.balance, divisible)}
                    </Box>
                    <Box sx={{ textAlign: 'right', fontWeight: 700 }}>{r.percent.toFixed(6)}%</Box>
                  </Box>
                );
              })}
            </Box>

            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button component={RouterLink} to={`/assetdata/${id}`} variant="outlined">
                View on Asset Data
              </Button>
              <Button variant="contained" disabled={circulating === 0}>
                Proceed to Payout
              </Button>
            </Box>
          </Paper>
        </Stack>
      )}
    </Box>
  );
}
