import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  TextField,
  Button,
  Chip,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import { fetchAssetHolders, resolveNames, type HolderRow } from '../../utils/assetData';
import { formatQty } from '../../utils/marketUI';
import { resolveAssetBasics } from '../../utils/resolveAssetBasics'; // <- gives ownerAddress
// import { formatAssetAmount } from '../../utils/qortalAssetRequests';

type Props = {
  assetId: number;
  assetName: string;
  divisible: boolean;
};

const PAGE = 100;

export default function AssetHolders({ assetId, assetName, divisible }: Props) {
  const [rows, setRows] = useState<HolderRow[]>([]);
  const [filter, setFilter] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ownerAddress, setOwnerAddress] = useState<string | null>(null);
  const [maxSupply, setMaxSupply] = useState<number>(0);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        setLoading(true);
        setError(null);
        const basics = await resolveAssetBasics(assetId).catch(() => null);
        if (!stop) setOwnerAddress(basics?.ownerAddress ?? null);
        if (basics?.maxSupply) {
          const supply = basics.maxSupply;
          setMaxSupply(supply);
        }

        const res = await fetchAssetHolders({
          assetId,
          limit: 2000,
          ordering: 'ASSET_BALANCE_ACCOUNT',
          excludeZero: true,
        });

        const nameMap = await resolveNames(res.map((r) => r.address));
        const withNames = res.map((r) => ({ ...r, name: nameMap.get(r.address) ?? null }));
        withNames.sort((a, b) => b.balance - a.balance);

        if (!stop) {
          setRows(withNames);
          setPage(0);
        }
      } catch (e: any) {
        if (!stop) setError(String(e?.message || e));
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [assetId]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) => {
      const nm = (r.name || '').toLowerCase();
      return r.address.toLowerCase().includes(q) || (nm && nm.includes(q));
    });
  }, [rows, filter]);

  const paged = useMemo(() => filtered.slice(page * PAGE, (page + 1) * PAGE), [filtered, page]);

  const totalHeld = useMemo(() => rows.reduce((s, r) => s + (r.balance || 0), 0), [rows]);

  const issuerBal = useMemo(
    () => (ownerAddress ? rows.find((r) => r.address === ownerAddress)?.balance || 0 : 0),
    [rows, ownerAddress]
  );

  const circulating = useMemo(() => Math.max(0, totalHeld - issuerBal), [totalHeld, issuerBal]);

  const IssuerTag = () => (
    <Chip
      size="small"
      label="Issuer"
      sx={{
        fontWeight: 700,
        height: 20,
        borderRadius: 1,
        bgcolor: 'warning.dark',
        color: 'warning.contrastText',
      }}
    />
  );

  return (
    <Paper sx={{ p: 2, display: 'grid', gap: 2, overflow: 'hidden' }}>
      <Box
        sx={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          flexWrap: 'wrap',
          gap: 1,
        }}
      >
        <Typography variant="h6">Holders</Typography>
        <TextField
          size="small"
          placeholder="Filter by address or name"
          value={filter}
          onChange={(e) => {
            setFilter(e.target.value);
            setPage(0);
          }}
        />
      </Box>

      <Typography variant="caption" color="text.secondary">
        {loading
          ? 'Loading…'
          : `${filtered.length.toLocaleString()} holder${filtered.length === 1 ? '' : 's'}`}
        {' • '}Total: {formatQty(maxSupply / 1e8, divisible)} {assetName}
        {' • '}Uncirculating: {formatQty(issuerBal, divisible)} {assetName}
        {' • '}Circulating: {formatQty(circulating, divisible)} {assetName}
      </Typography>

      {error && (
        <Typography variant="body2" color="error">
          {error}
        </Typography>
      )}

      {loading ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <>
          {/* header */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr auto', sm: 'auto 1fr auto' },
              columnGap: 1,
              px: 1,
              fontSize: 12,
              color: 'text.secondary',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>#</Box>
            <Box>Account</Box>
            <Box sx={{ textAlign: 'right' }}>{assetName} Amount</Box>
          </Box>

          <Box sx={{ display: 'grid', gap: 0.25 }}>
            {paged.map((r, idx) => {
              const rank = page * PAGE + idx + 1;
              const label = r.name ? r.name : r.address.slice(0, 8) + '…' + r.address.slice(-6);
              const byIssuer = ownerAddress && r.address === ownerAddress;

              return (
                <Box
                  key={`${r.address}-${idx}`}
                  sx={(theme) => ({
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr auto', sm: 'auto 1fr auto' },
                    columnGap: 1,
                    alignItems: 'center',
                    px: 1,
                    py: 0.5,
                    borderRadius: 0.75,
                    fontVariantNumeric: 'tabular-nums',
                    // ✅ highlight issuer row
                    bgcolor: byIssuer ? theme.palette.warning.main : 'background.paper',
                    color: byIssuer ? theme.palette.warning.contrastText : 'inherit',
                    border: 1,
                    borderColor: byIssuer ? theme.palette.warning.dark : 'divider',
                  })}
                >
                  <Box
                    sx={{ display: { xs: 'none', sm: 'block' }, fontWeight: byIssuer ? 700 : 400 }}
                  >
                    {rank}
                  </Box>

                  <Box
                    sx={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                      fontWeight: byIssuer ? 700 : 500,
                    }}
                  >
                    <Tooltip title={r.address} arrow>
                      <Chip
                        size="small"
                        label={label}
                        variant={byIssuer ? 'filled' : 'outlined'}
                        sx={
                          byIssuer ? { bgcolor: 'warning.dark', color: 'warning.contrastText' } : {}
                        }
                      />
                    </Tooltip>
                    {byIssuer && <IssuerTag />}
                  </Box>

                  <Box sx={{ textAlign: 'right', fontWeight: 700 }}>
                    {formatQty(r.balance, divisible)}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {filtered.length > PAGE && (
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}
            >
              <Typography variant="caption" color="text.secondary">
                Page {page + 1} of {Math.ceil(filtered.length / PAGE)}
              </Typography>
              <Box sx={{ display: 'flex', gap: 1 }}>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={page === 0}
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                >
                  Prev
                </Button>
                <Button
                  size="small"
                  variant="outlined"
                  disabled={(page + 1) * PAGE >= filtered.length}
                  onClick={() => setPage((p) => p + 1)}
                >
                  Next
                </Button>
              </Box>
            </Box>
          )}
        </>
      )}
    </Paper>
  );
}
