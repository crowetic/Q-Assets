import { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Paper,
  Typography,
  ToggleButtonGroup,
  ToggleButton,
  Button,
  Chip,
  Tooltip,
  CircularProgress,
} from '@mui/material';
import { fetchAssetTransactions, resolveNames, type AssetTx } from '../../utils/assetData';
import { formatPrice, formatQty } from '../../utils/marketUI';

type Props = {
  assetId: number;
  assetName: string;
  divisible: boolean;
};

const PAGE = 50;

export default function AssetTransactions({ assetId, assetName }: Props) {
  const [tab, setTab] = useState<'all' | 'orders' | 'issue'>('all');
  const [rows, setRows] = useState<AssetTx[]>([]);
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let stop = false;
    (async () => {
      try {
        setLoading(true);
        const txs = await fetchAssetTransactions({
          assetId,
          confirmationStatus: 'CONFIRMED',
          limit: 1000,
          reverse: true,
        });

        // resolve names for creator addresses
        const creators = txs.map((t) => t.creatorAddress).filter(Boolean) as string[];
        const nameMap = await resolveNames(creators);

        const withNames = txs.map((t) =>
          t.creatorAddress ? { ...t, creatorName: nameMap.get(t.creatorAddress) ?? null } : t
        );

        if (!stop) {
          // newest first (API already seems to be newest first)
          withNames.sort((a: any, b: any) => b.timestamp - a.timestamp);
          setRows(withNames);
          setPage(0);
        }
      } finally {
        if (!stop) setLoading(false);
      }
    })();
    return () => {
      stop = true;
    };
  }, [assetId]);

  const filtered = useMemo(() => {
    if (tab === 'all') return rows;
    if (tab === 'orders') return rows.filter((r) => r.type === 'CREATE_ASSET_ORDER');
    if (tab === 'issue') return rows.filter((r) => r.type === 'ISSUE_ASSET');
    return rows;
  }, [rows, tab]);

  const paged = useMemo(() => filtered.slice(page * PAGE, (page + 1) * PAGE), [filtered, page]);

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
        <Typography variant="h6">Asset Transactions</Typography>
        <ToggleButtonGroup
          exclusive
          size="small"
          value={tab}
          onChange={(_, v) => v && setTab(v)}
          sx={{ flexWrap: 'wrap', rowGap: 0.5 }}
        >
          <ToggleButton value="all">All</ToggleButton>
          <ToggleButton value="orders">Orders</ToggleButton>
          <ToggleButton value="issue">Issue</ToggleButton>
        </ToggleButtonGroup>
      </Box>

      {/* header */}
      {loading ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr auto', sm: 'auto 1fr auto auto' },
              columnGap: 1,
              px: 1,
              fontSize: 12,
              color: 'text.secondary',
              fontVariantNumeric: 'tabular-nums',
            }}
          >
            <Box sx={{ display: { xs: 'none', sm: 'block' } }}>Type</Box>
            <Box>Creator</Box>
            <Box sx={{ textAlign: 'right' }}>Details</Box>
            <Box sx={{ textAlign: 'right' }}>Time</Box>
          </Box>

          <Box sx={{ display: 'grid', gap: 0.25 }}>
            {paged.map((t, i) => {
              const when = new Date((t as any).timestamp).toLocaleString([], {
                month: '2-digit',
                day: '2-digit',
                hour: '2-digit',
                minute: '2-digit',
              });
              const creator = (t as any).creatorAddress || '—';
              const creatorName = (t as any).creatorName as string | null | undefined;

              return (
                <Box
                  key={`${(t as any).signature || i}`}
                  sx={{
                    display: 'grid',
                    gridTemplateColumns: { xs: '1fr auto', sm: 'auto 1fr auto auto' },
                    columnGap: 1,
                    alignItems: 'center',
                    px: 1,
                    py: 0.5,
                    borderRadius: 0.75,
                    bgcolor: 'background.paper',
                    border: 1,
                    borderColor: 'divider',
                    fontVariantNumeric: 'tabular-nums',
                  }}
                >
                  {/* Type */}
                  <Box
                    sx={{
                      display: { xs: 'none', sm: 'block' },
                      whiteSpace: 'nowrap',
                      fontWeight: 700,
                    }}
                  >
                    {String(t.type).replace(/_/g, ' ')}
                  </Box>

                  {/* Creator */}
                  <Box
                    sx={{
                      minWidth: 0,
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                      display: 'flex',
                      alignItems: 'center',
                      gap: 1,
                    }}
                  >
                    <Tooltip title={creator} arrow>
                      <Chip
                        size="small"
                        label={creatorName || creator.slice(0, 8) + '…' + creator.slice(-6)}
                      />
                    </Tooltip>
                  </Box>

                  {/* Details (right aligned) */}
                  <Box sx={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                    {t.type === 'ISSUE_ASSET' && (
                      <span>
                        Issued {formatQty((t as any).quantity, (t as any).isDivisible)} {assetName}
                      </span>
                    )}
                    {t.type === 'CREATE_ASSET_ORDER' && (
                      <span>
                        {(t as any).haveAssetName || 'Have'}: {formatQty((t as any).amount, true)} @{' '}
                        {formatPrice((t as any).price)} QORT/{assetName}
                      </span>
                    )}
                    {t.type !== 'ISSUE_ASSET' && t.type !== 'CREATE_ASSET_ORDER' && <span>—</span>}
                  </Box>

                  {/* Time */}
                  <Box sx={{ textAlign: 'right', color: 'text.secondary', whiteSpace: 'nowrap' }}>
                    {when}
                  </Box>
                </Box>
              );
            })}
          </Box>

          {(filtered.length > PAGE || loading) && (
            <Box
              sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mt: 1 }}
            >
              <Typography variant="caption" color="text.secondary">
                {loading ? 'Loading… ' : ''}Page {page + 1} of{' '}
                {Math.max(1, Math.ceil(filtered.length / PAGE))}
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
