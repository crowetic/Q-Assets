// src/components/AssetExplorer.tsx
import { useEffect, useState, useMemo } from 'react';
import { getAssetBalances } from '../utils/qortalAssetRequests';
import {
  Typography,
  Paper,
  CircularProgress,
  useTheme,
  Box,
  Chip,
  Tooltip,
  Stack,
} from '@mui/material';
import { Link } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import { formatAssetAmount } from '../utils/qortalAssetRequests';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { getPrimaryAccountName } from '../utils/qortalApi';
import pLimit from 'p-limit';
import { ensureAssetsIndexLoaded } from '../bootstrap/assetsBootstrap';

// NEW: stats hook/types
import { useExplorerStats } from '../explorerStats/useExplorerStats';
import { TRADE_FETCH_N } from '../explorerStats/types';
import { usePrimaryGroupId } from '../utils/usePrimaryGroupId';
import { loadStats } from '../explorerStats/storage';

export interface Asset {
  assetId: number;
  name: string;
  description?: string;
  owner: string;
  quantity: number;
  isDivisible: boolean;
  isUnspendable: boolean;
  // OPTIONAL: if your index already carries primary group id, uncomment:
  // primaryGroupId?: number;
}

export interface BalanceEntry {
  assetId: number;
  address: string;
  balance: string; // normalized already
  assetName: string;
}

export interface EnrichedAsset extends Asset {
  totalSupply: number | string;
  circulating: number | string;
}

type StatsProps = { assetId: number };

// interface StatsTagProps {
//   label: string;
//   value: string | number;
//   tooltip?: string;
//   color?: 'default' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error';
// }
function StatsTag({
  label,
  value,
  tooltip,
  color = 'default',
}: {
  label: string;
  value: string | number;
  tooltip?: string;
  color?: 'default' | 'primary' | 'secondary' | 'success' | 'info' | 'warning' | 'error';
}) {
  return (
    <Tooltip title={tooltip ?? ''}>
      <Chip label={`${label}: ${value}`} color={color} variant="outlined" sx={{ mr: 1, mb: 1 }} />
    </Tooltip>
  );
}

// ------- Stats subcomponent per card ----------------------------------------

export function AssetCardStats({ assetId }: StatsProps) {
  // Always call hooks; internal logic decides whether to fetch
  const isBase = assetId === 0 || assetId === 1 || assetId === 2;
  const primaryGroupId = usePrimaryGroupId(assetId); // returns number | null

  // Hook meta: no commentsIdPrefix needed anymore
  const meta = useMemo(
    () => ({
      assetId,
      primaryGroupId: isBase ? undefined : (primaryGroupId ?? undefined),
    }),
    [assetId, isBase, primaryGroupId]
  );

  const { stats, busy } = useExplorerStats(meta);

  // const tradesVal = busy && stats?.trades == null ? 'refreshing…' : (stats?.trades ?? '—');

  // const lastTradeVal =
  //   busy && stats?.lastTradeTs == null
  //     ? 'refreshing…'
  //     : stats?.lastTradeTs
  //       ? timeAgo(stats.lastTradeTs)
  //       : '—';

  // const commentsVal = busy && stats?.comments == null ? 'refreshing…' : (stats?.comments ?? '—');

  // const membersVal =
  //   busy && stats?.groupMembers == null ? 'refreshing…' : (stats?.groupMembers ?? '—');

  const volVal =
    busy && stats?.qortVolLastN == null
      ? 'refreshing…'
      : (stats?.qortVolLastN ?? 0).toLocaleString(undefined, { maximumFractionDigits: 8 });

  // ---- display strings (never “refreshing…” forever)
  const tradesCountDisplay =
    busy && stats?.trades == null ? 'refreshing…' : String(stats?.trades ?? 0);

  const lastTradeDisplay = (() => {
    if (stats?.lastTradeTs) return new Date(stats.lastTradeTs).toLocaleString();
    // if no last trade, only show “refreshing…” while the *first* fetch is happening
    return busy && stats?.trades == null ? 'refreshing…' : 'no trades';
  })();

  const commentsDisplay =
    stats?.comments == null ? (busy ? 'refreshing…' : '0') : String(stats.comments);

  const groupDisplay = (() => {
    if (isBase) return null;
    if (meta.primaryGroupId == null) return 'NO PRIMARY GROUP';
    return busy && stats?.groupMembers == null ? 'refreshing…' : String(stats?.groupMembers ?? 0);
  })();

  return (
    <Stack direction="row" flexWrap="wrap" sx={{ mt: 1 }}>
      {/* volume first so users see “QORT value” quickly */}
      {!isBase && (
        <StatsTag
          label={`Recent QORT Volume`}
          value={volVal}
          tooltip={`Total QORT matched in the last ${TRADE_FETCH_N} trades`}
          color="success"
        />
      )}
      {!isBase && (
        <StatsTag
          label={`Trades`}
          value={tradesCountDisplay}
          tooltip={`Count of the last 1000 or less QORT/asset trades`}
          color="info"
        />
      )}
      {!isBase && (
        <StatsTag
          label="Last Trade"
          value={lastTradeDisplay}
          tooltip="Most recent trade time (local)"
          color="warning"
        />
      )}
      {!isBase && stats?.comments != null && (
        <StatsTag
          label="Comments"
          value={commentsDisplay}
          tooltip="Total QDN comments"
          color="default"
        />
      )}
      {!isBase && (
        <StatsTag
          label={meta.primaryGroupId == null ? '' : 'Group Member Count'}
          value={groupDisplay!} // safe: we return null only when isBase
          tooltip={
            meta.primaryGroupId == null
              ? 'This asset has no declared primary group'
              : 'Size of the primary group'
          }
          color={meta.primaryGroupId == null ? 'error' : 'info'}
        />
      )}
    </Stack>
  );
}

// ------- Main Explorer -------------------------------------------------------
const AssetExplorer = () => {
  type SortKey = 'name' | 'assetId' | 'circulating' | 'volume';
  type SortDir = 'asc' | 'desc';
  const [assets, setAssets] = useState<EnrichedAsset[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [avatarMap, setAvatarMap] = useState<Record<number, string | null>>({});
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDir, setSortDir] = useState<SortDir>('desc');

  const theme = useTheme();
  const { address: userAddress } = useAuth();

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t < 10 ? t + 1 : t)), 1000);
    return () => clearInterval(id);
  }, []);

  const sortedAssets = useMemo(() => {
    const copy = [...assets];

    const getVolume = (assetId: number) => {
      // Read from local cache written by useExplorerStats
      const s = loadStats(assetId);
      // push unknown volumes to the end: use -1 sentinel
      return s?.qortVolLastN ?? -1;
    };

    const getCirculating = (a: EnrichedAsset) =>
      typeof a.circulating === 'number' ? a.circulating : Number.NEGATIVE_INFINITY;

    copy.sort((a, b) => {
      let av: number | string;
      let bv: number | string;

      switch (sortKey) {
        case 'name':
          av = a.name.toLowerCase();
          bv = b.name.toLowerCase();
          break;
        case 'assetId':
          av = a.assetId;
          bv = b.assetId;
          break;
        case 'circulating':
          av = getCirculating(a);
          bv = getCirculating(b);
          break;
        case 'volume':
        default:
          av = getVolume(a.assetId);
          bv = getVolume(b.assetId);
          break;
      }

      let cmp: number;
      if (typeof av === 'string' && typeof bv === 'string') {
        cmp = av.localeCompare(bv);
      } else {
        cmp = (Number(av) || 0) - (Number(bv) || 0);
      }

      return sortDir === 'asc' ? cmp : -cmp;
    });

    return copy;
    // include tick so list can update as stats land
  }, [assets, sortKey, sortDir, tick]);

  useEffect(() => {
    async function loadAssets() {
      try {
        setLoading(true);
        const assetIndex = await ensureAssetsIndexLoaded();
        const rawAssets: Asset[] = Object.values(assetIndex) as Asset[];

        const qortCirculating = await fetch('/stats/supply/circulating').then((res) => res.json());
        const assetIds: number[] = rawAssets.map((a) => a.assetId);
        const issuerAddresses: string[] = [...new Set(rawAssets.map((a) => a.owner))];

        localStorage.setItem('allAssets', JSON.stringify(rawAssets));

        const [userBalancesRaw, issuerBalancesRaw]: [BalanceEntry[], BalanceEntry[]] =
          await Promise.all([
            userAddress
              ? getAssetBalances({ addresses: [userAddress], assetIds, excludeZero: true })
              : Promise.resolve([]),
            getAssetBalances({ addresses: issuerAddresses, assetIds }),
          ]);

        const balanceMap: Record<number, number> = {};
        userBalancesRaw.forEach((b) => {
          balanceMap[b.assetId] = parseFloat(b.balance);
        });

        const issuerMap: Record<number, number> = {};
        issuerBalancesRaw.forEach((b: BalanceEntry) => {
          issuerMap[b.assetId] = (issuerMap[b.assetId] || 0) + parseFloat(b.balance);
        });

        const enriched: EnrichedAsset[] = rawAssets.map((asset) => {
          const isQort = asset.assetId === 0;
          const isUnspendable = asset.isUnspendable || asset.quantity === 0;

          if (isQort) {
            return {
              ...asset,
              totalSupply: qortCirculating,
              circulating: qortCirculating,
            };
          }

          if (isUnspendable) {
            return {
              ...asset,
              totalSupply: 'special base asset',
              circulating: 'coming soon',
            };
          }

          const totalSupply = asset.quantity / 1e8;
          const issuerBalance = issuerMap[asset.assetId] ?? 0;
          const circulating = Math.max(0, totalSupply - issuerBalance);

          return {
            ...asset,
            totalSupply,
            circulating,
          };
        });

        setAssets(enriched);
        localStorage.setItem('allAssets', JSON.stringify(enriched));
        setBalances(balanceMap);
      } catch (err) {
        console.error('Asset load error:', err);
      } finally {
        setLoading(false);
      }
    }

    loadAssets();
  }, [userAddress]);

  useEffect(() => {
    if (assets.length === 0) return;

    const ctrl = new AbortController();
    const limit = pLimit(6);
    let aborted = false;

    const withTimeout = <T,>(p: Promise<T>, ms = 8000) =>
      new Promise<T>((resolve, reject) => {
        const t = setTimeout(() => reject(new Error('timeout')), ms);
        p.then(
          (v) => {
            clearTimeout(t);
            resolve(v);
          },
          (e) => {
            clearTimeout(t);
            reject(e);
          }
        );
      });

    const setOne = (id: number, url: string | null) =>
      setAvatarMap((prev) => (prev[id] ? prev : { ...prev, [id]: url }));

    assets.forEach((a) =>
      limit(async () => {
        if (aborted || ctrl.signal.aborted) return;

        try {
          if (avatarMap[a.assetId] != null) return;

          let url: string | null = null;
          if (a.name === 'QORT' || a.name === 'QORT-from-QORA' || a.name === 'Legacy-QORA') {
            url = await withTimeout(fetchAssetAvatar('Q-Assets', a.name)).catch(() => null);
          } else {
            const issuerName = await withTimeout(getPrimaryAccountName(a.owner)).catch(() => null);
            if (issuerName) {
              url = await withTimeout(fetchAssetAvatar(issuerName, a.name)).catch(() => null);
            }
          }

          if (!aborted && !ctrl.signal.aborted) setOne(a.assetId, url);
        } catch {
          if (!aborted && !ctrl.signal.aborted) setOne(a.assetId, null);
        }
      })
    );

    return () => {
      aborted = true;
      ctrl.abort();
    };
  }, [assets]);

  return (
    <Box sx={{ padding: '2rem' }}>
      {loading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center' }}>
            <Typography variant="h6" sx={{ mr: 1 }}>
              Sort by
            </Typography>

            <select
              value={sortKey}
              onChange={(e) => setSortKey(e.target.value as SortKey)}
              style={{
                padding: '8px 10px',
                borderRadius: 8,
                border: `1px solid ${theme.palette.divider}`,
                background: theme.palette.background.paper,
                color: theme.palette.text.primary,
              }}
            >
              <option value="volume">QORT Volume</option>
              <option value="name">Name</option>
              <option value="assetId">Asset ID</option>
              <option value="circulating">Circulating</option>
            </select>

            <button
              onClick={() => setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'))}
              style={{
                padding: '8px 12px',
                borderRadius: 8,
                border: `1px solid ${theme.palette.divider}`,
                background: theme.palette.background.paper,
                color: theme.palette.text.primary,
                cursor: 'pointer',
              }}
              title={`Sort ${sortDir === 'asc' ? 'ascending' : 'descending'}`}
            >
              {sortDir === 'asc' ? 'Asc ↑' : 'Desc ↓'}
            </button>
          </Box>
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(38rem, 1fr))', // stable, chunky cards
              gap: 3,
              overflowX: 'hidden',
            }}
          >
            {sortedAssets.map((asset) => {
              const balance = balances[asset.assetId] || 0;
              const isOwned = !!userAddress && asset.owner === userAddress;

              return (
                <Link
                  key={asset.assetId}
                  to={`/assets/${asset.assetId}`}
                  style={{ textDecoration: 'none' }}
                >
                  <Paper
                    elevation={5}
                    sx={{
                      minWidth: '10rem',
                      minHeight: '10rem',
                      overflow: 'hidden',
                      padding: '1.5rem',
                      height: '100%',
                      backgroundColor: isOwned
                        ? theme.palette.secondary.dark
                        : balance > 0
                          ? theme.palette.primary.dark
                          : theme.palette.background.paper,
                      color:
                        isOwned || balance > 0
                          ? theme.palette.getContrastText(
                              isOwned ? theme.palette.secondary.dark : theme.palette.primary.dark
                            )
                          : theme.palette.text.primary,
                      borderLeft: isOwned
                        ? '4px solid limegreen'
                        : balance > 0
                          ? '4px solid #1e90ff'
                          : '4px solid transparent',
                      transition: 'transform 0.2s ease',
                      '&:hover': {
                        transform: 'scale(0.995)',
                        borderWidth: '1',
                        borderStyle: 'solid',
                        cursor: 'pointer',
                        borderColor: theme.palette.info.light,
                      },
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                  >
                    <Box
                      sx={{
                        display: 'flex',
                        flexDirection: { xs: 'column', lg: 'row' },
                        // flexWrap: 'wrap', // allow wrap at lg to avoid forcing width
                        gap: 1,
                        minWidth: 0, // allow shrink
                        alignItems: 'stretch',
                      }}
                    >
                      {/* TEXT BLOCK */}
                      <Box flex={1}>
                        <Typography variant="h4" fontWeight="bold" color="secondary.light">
                          {asset.name}
                        </Typography>

                        <Typography variant="body2" sx={{ mb: 2 }}>
                          {asset.description || 'No description'}
                        </Typography>

                        <Box
                          component="div"
                          sx={{
                            p: 0.5,
                            fontFamily: 'monospace',
                            bgcolor: theme.palette.secondary.main,
                            border: `1px solid ${theme.palette.divider}`,
                            borderRadius: 1,
                            fontSize: '0.875rem',
                            whiteSpace: 'pre-wrap',
                            wordBreak: 'break-word',
                            mb: 1,
                          }}
                        >
                          <Box>
                            <Typography
                              variant="subtitle2"
                              fontWeight="700"
                              color="text.secondary"
                              component="span"
                            >
                              Asset ID:{' '}
                            </Typography>
                            <Typography component="span">{asset.assetId}</Typography>
                          </Box>

                          <Box>
                            <Typography
                              variant="subtitle2"
                              fontWeight="600"
                              color="text.secondary"
                              component="span"
                            >
                              Total Supply:{' '}
                            </Typography>
                            <Typography component="span">
                              {typeof asset.totalSupply === 'number'
                                ? formatAssetAmount(asset.totalSupply, asset.isDivisible)
                                : asset.totalSupply}
                            </Typography>
                          </Box>

                          <Box>
                            <Typography
                              variant="subtitle2"
                              color="text.secondary"
                              fontWeight={600}
                              component="span"
                            >
                              Circulating:{' '}
                            </Typography>
                            <Typography component="span">
                              {typeof asset.circulating === 'number'
                                ? formatAssetAmount(asset.circulating, asset.isDivisible)
                                : asset.circulating}
                            </Typography>
                          </Box>

                          {balance > 0 && (
                            <Box>
                              <Typography
                                variant="subtitle1"
                                color="secondary.light"
                                component="span"
                                fontWeight={700}
                                bgcolor={'background.paper'}
                              >
                                You Hold:{' '}
                              </Typography>
                              <Typography
                                component="span"
                                color="success.contrastText"
                                bgcolor={'background.paper'}
                              >
                                {balance}
                              </Typography>
                            </Box>
                          )}
                        </Box>

                        {/* NEW: Stats box */}
                        {asset.assetId > 2 && <AssetCardStats assetId={asset.assetId} />}

                        {isOwned && (
                          <Typography
                            variant="h5"
                            color="success.light"
                            fontWeight={800}
                            bgcolor={'background.paper'}
                            sx={{ mt: 1 }}
                          >
                            ASSET ISSUER
                          </Typography>
                        )}
                      </Box>

                      {/* ASSET AVATAR */}
                      <Box
                        sx={{
                          // fixed basis at lg, full width on small; never exceed container
                          flex: { xs: '0 0 auto', lg: '0 0 16rem' }, // wider at desktop
                          width: { xs: '100%', lg: '16rem' },
                          height: { xs: '15rem', sm: '18rem', md: '20rem', lg: 'auto' }, // tall on mobile; on desktop, fill row height
                          alignSelf: { xs: 'center', lg: 'center' }, // fill height when in row layout
                          justifySelf: 'center',
                          alignContent: 'center',
                          justifycontent: 'center',
                          display: 'block',
                          minWidth: 0,
                          maxWidth: '100%',
                        }}
                      >
                        {avatarMap[asset.assetId] ? (
                          <img
                            loading="lazy"
                            src={avatarMap[asset.assetId]!}
                            alt={`${asset.name} Avatar`}
                            style={{
                              display: 'block',
                              width: '100%',
                              height: '100%',
                              objectFit: 'contain',
                              borderRadius: '500rem',
                            }}
                            onError={(e) => (e.currentTarget.style.display = 'none')}
                          />
                        ) : (
                          <div
                            style={{
                              width: '100%',
                              height: '100%',
                              opacity: 0.5,
                            }}
                          />
                        )}
                      </Box>
                    </Box>
                  </Paper>
                </Link>
              );
            })}
          </Box>
        </>
      )}
    </Box>
  );
};

export default AssetExplorer;
