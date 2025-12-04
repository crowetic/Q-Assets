import { useEffect, useState, useMemo, useCallback } from 'react';
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
import { useMemberGroupIds } from '../hooks/useMemberGroupIds';
import { canViewAsset, getAssetPrivacy, type AssetPrivacy } from '../utils/assetPrivacy';

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
    <Stack direction="row" flexWrap="wrap" sx={{ mt: 1 }} overflow={'none'}>
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
const PAGE_SIZE = 60;
const SCROLL_THRESHOLD_PX = 600;

const AssetExplorer = () => {
  type SortKey = 'name' | 'assetId' | 'circulating' | 'volume';
  type SortDir = 'asc' | 'desc';
  const [assets, setAssets] = useState<EnrichedAsset[]>([]);
  const [balances, setBalances] = useState<Record<number, number>>({});
  const [loading, setLoading] = useState(true);
  const [avatarMap, setAvatarMap] = useState<Record<number, string | null>>({});
  const [sortKey, setSortKey] = useState<SortKey>('volume');
  const [sortDir, setSortDir] = useState<SortDir>('desc');
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const [privacyMap, setPrivacyMap] = useState<Record<number, AssetPrivacy>>({});

  const theme = useTheme();
  const { memberGroupIds, loading: groupsLoading } = useMemberGroupIds();
  const { address: userAddress } = useAuth();

  const [tick, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((t) => (t < 10 ? t + 1 : t)), 1000);
    return () => clearInterval(id);
  }, []);

  const viewableAssets = useMemo(() => {
    return assets.filter((a) => {
      if (a.assetId <= 2) return true;
      const privacy = privacyMap[a.assetId];
      if (!privacy) return false; // hide until privacy resolved
      return canViewAsset(privacy, memberGroupIds);
    });
  }, [assets, privacyMap, memberGroupIds]);

  const publicAssets = useMemo(
    () => viewableAssets.filter((a) => !privacyMap[a.assetId]?.isPrivate),
    [viewableAssets, privacyMap]
  );

  const privateAssets = useMemo(
    () => viewableAssets.filter((a) => privacyMap[a.assetId]?.isPrivate),
    [viewableAssets, privacyMap]
  );

  const sortAssets = useCallback(
    (list: EnrichedAsset[]) => {
      const copy = [...list];

      const getVolume = (assetId: number) => {
        const s = loadStats(assetId);
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
    },
    [sortDir, sortKey, tick]
  );

  const sortedPublicAssets = useMemo(() => sortAssets(publicAssets), [publicAssets, sortAssets]);
  const sortedPrivateAssets = useMemo(() => sortAssets(privateAssets), [privateAssets, sortAssets]);

  const displayAssets = useMemo(
    () => sortedPublicAssets.slice(0, Math.min(visibleCount, sortedPublicAssets.length)),
    [sortedPublicAssets, visibleCount]
  );

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [sortedPublicAssets.length, sortKey, sortDir]);

  useEffect(() => {
    const missing = assets.filter((a) => a.assetId > 2 && !privacyMap[a.assetId]);
    if (!missing.length) return;
    let cancelled = false;
    const limit = pLimit(6);
    (async () => {
      const results = await Promise.all(
        missing.map((a) =>
          limit(async () => {
            const priv = await getAssetPrivacy(a.assetId);
            return [a.assetId, priv] as const;
          })
        )
      );
      if (cancelled) return;
      setPrivacyMap((prev) => {
        const next = { ...prev };
        for (const [id, priv] of results) {
          next[id] = priv;
        }
        return next;
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [assets, privacyMap]);

  useEffect(() => {
    const handleScroll = () => {
      const nearBottom =
        window.innerHeight + window.scrollY >= document.body.offsetHeight - SCROLL_THRESHOLD_PX;
      if (nearBottom) {
        setVisibleCount((prev) =>
          prev >= sortedPublicAssets.length
            ? prev
            : Math.min(prev + PAGE_SIZE, sortedPublicAssets.length)
        );
      }
    };
    window.addEventListener('scroll', handleScroll, { passive: true });
    return () => window.removeEventListener('scroll', handleScroll);
  }, [sortedPublicAssets.length]);

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
    if (displayAssets.length === 0) return;

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

    displayAssets.forEach((a) =>
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
  }, [displayAssets]);

  // inside your component render
  const overallLoading = loading || groupsLoading;
  return (
    <Box sx={{ p: { xs: 1.25, sm: 2 } }}>
      {overallLoading ? (
        <Box display="flex" justifyContent="center" py={8}>
          <CircularProgress />
        </Box>
      ) : (
        <>
          {/* Controls */}
          <Box sx={{ mb: 2, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
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

          {/* SIMPLE responsive grid: packs 1..N columns depending on space */}
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: {
                xs: '1fr',
                sm: 'repeat(auto-fit, minmax(30rem, 1fr))',
              },
              gap: 2,
            }}
          >
            {displayAssets.map((asset) => {
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
                      overflow: 'hidden',
                      p: { xs: 1.25, sm: 1.5 },
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

                      display: 'flex',
                      flexDirection: { xs: 'column', sm: 'row' }, // vertical on phones, horizontal otherwise
                      alignItems: 'stretch',
                      gap: { xs: 1, sm: 1.25 },
                      flexWrap: 'noWrap',
                      // keep “card” feel, but don’t jiggle on touch
                      transition: 'transform .18s ease, border-color .18s ease',
                      '@media (hover: hover) and (pointer: fine)': {
                        '&:hover': {
                          transform: 'scale(0.999) translateY(-1px) gap(1.0)',
                          borderColor: theme.palette.info.light,
                          borderWidth: '1',
                          borderStyle: 'solid',
                          cursor: 'pointer',
                        },
                      },
                    }}
                  >
                    {/* TEXT */}
                    <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
                      <Typography variant="h4" fontWeight={800} color="secondary.light">
                        {asset.name}
                      </Typography>

                      <Typography
                        variant="body2"
                        sx={{
                          mb: 1.25,
                          display: '-webkit-box',
                          WebkitBoxOrient: 'vertical',
                          WebkitLineClamp: { xs: 3, sm: 3, md: 3 },
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          wordBreak: 'break-word',
                        }}
                      >
                        {asset.description || 'No description'}
                      </Typography>

                      <Box
                        component="div"
                        sx={{
                          p: 0.75,
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
                            fontWeight={700}
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
                            fontWeight={600}
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
                            >
                              You Hold:{' '}
                            </Typography>
                            <Typography component="span" color="success.contrastText">
                              {formatAssetAmount(balance, asset.isDivisible)}
                            </Typography>
                          </Box>
                        )}
                      </Box>

                      {asset.assetId > 2 && <AssetCardStats assetId={asset.assetId} />}

                      {isOwned && (
                        <Typography
                          variant="h5"
                          color="success.light"
                          fontWeight={800}
                          sx={{ mt: 0.5 }}
                        >
                          ASSET ISSUER
                        </Typography>
                      )}
                    </Box>

                    {/* AVATAR — always centered, always a square, size = clamp(min, fluid, max) */}
                    <Box
                      sx={{
                        flex: { xs: '0 0 auto', sm: '0 0 auto' },
                        alignSelf: 'center',
                        // Row layout: cap width; Column layout (xs): larger but still bounded
                        width: { xs: 'min(70%, 220px)', sm: 'clamp(140px, 18vw, 180px)' },
                        aspectRatio: '1 / 1',
                        borderRadius: '999px',
                        overflow: 'hidden',
                        display: 'grid',
                        placeItems: 'center',
                        mx: { sm: 1 }, // tiny breathing room from text
                      }}
                    >
                      {avatarMap[asset.assetId] ? (
                        <img
                          loading="lazy"
                          src={avatarMap[asset.assetId]!}
                          alt={`${asset.name} Avatar`}
                          style={{
                            width: '100%',
                            height: '100%',
                            objectFit: 'cover', // fills the circle; switch to 'contain' if you prefer letterbox
                            display: 'block',
                          }}
                          onError={(e) => (e.currentTarget.style.display = 'none')}
                        />
                      ) : (
                        <div style={{ width: '100%', height: '100%', opacity: 0.5 }} />
                      )}
                    </Box>
                  </Paper>
                </Link>
              );
            })}
          </Box>
          {sortedPrivateAssets.length > 0 && (
            <Box sx={{ mt: 4 }}>
              <Typography variant="h6" sx={{ mb: 1 }}>
                Private Assets (accessible via your groups)
              </Typography>
              <Box
                sx={{
                  display: 'grid',
                  gridTemplateColumns: {
                    xs: '1fr',
                    sm: 'repeat(auto-fit, minmax(30rem, 1fr))',
                  },
                  gap: 2,
                }}
              >
                {sortedPrivateAssets.map((asset) => {
                  const balance = balances[asset.assetId] || 0;
                  const isOwned = !!userAddress && asset.owner === userAddress;
                  const bgColor = isOwned
                    ? theme.palette.secondary.dark
                    : balance > 0
                      ? theme.palette.primary.dark
                      : theme.palette.grey[900];
                  const textColor = theme.palette.getContrastText(bgColor);
                  const borderColor = isOwned ? 'limegreen' : balance > 0 ? '#1e90ff' : 'orange';

                  return (
                    <Link
                      key={asset.assetId}
                      to={`/assets/${asset.assetId}`}
                      style={{ textDecoration: 'none' }}
                    >
                      <Paper
                        elevation={5}
                        sx={{
                          overflow: 'hidden',
                          p: { xs: 1.25, sm: 1.5 },
                          height: '100%',
                          backgroundColor: bgColor,
                          color: textColor,
                          borderLeft: `4px solid ${borderColor}`,
                          display: 'flex',
                          flexDirection: { xs: 'column', sm: 'row' },
                          alignItems: 'stretch',
                          gap: { xs: 1, sm: 1.25 },
                          flexWrap: 'noWrap',
                        }}
                      >
                        <Box sx={{ flex: '1 1 0', minWidth: 0 }}>
                          <Typography variant="h4" fontWeight={800} color="warning.light">
                            {asset.name}
                          </Typography>
                          <Typography
                            variant="body2"
                            sx={{
                              mb: 1.25,
                              display: '-webkit-box',
                              WebkitBoxOrient: 'vertical',
                              WebkitLineClamp: { xs: 3, sm: 3, md: 3 },
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              wordBreak: 'break-word',
                            }}
                          >
                            {asset.description || 'No description'}
                          </Typography>
                          <Typography variant="caption" color="warning.main">
                            Private asset — visible because you belong to its group
                          </Typography>
                          {balance > 0 && (
                            <Box sx={{ mt: 0.5 }}>
                              <Typography
                                variant="subtitle1"
                                color="secondary.light"
                                component="span"
                                fontWeight={700}
                              >
                                You Hold:{' '}
                              </Typography>
                              <Typography component="span" color="success.contrastText">
                                {formatAssetAmount(balance, asset.isDivisible)}
                              </Typography>
                            </Box>
                          )}
                        </Box>
                        <Box
                          sx={{
                            flex: { xs: '0 0 auto', sm: '0 0 auto' },
                            alignSelf: 'center',
                            width: { xs: 'min(70%, 220px)', sm: 'clamp(140px, 18vw, 180px)' },
                            aspectRatio: '1 / 1',
                            borderRadius: '999px',
                            overflow: 'hidden',
                            display: 'grid',
                            placeItems: 'center',
                            mx: { sm: 1 },
                          }}
                        >
                          {avatarMap[asset.assetId] ? (
                            <img
                              loading="lazy"
                              src={avatarMap[asset.assetId]!}
                              alt={`${asset.name} Avatar`}
                              style={{
                                width: '100%',
                                height: '100%',
                                objectFit: 'cover',
                                display: 'block',
                              }}
                              onError={(e) => (e.currentTarget.style.display = 'none')}
                            />
                          ) : (
                            <div style={{ width: '100%', height: '100%', opacity: 0.5 }} />
                          )}
                        </Box>
                      </Paper>
                    </Link>
                  );
                })}
              </Box>
            </Box>
          )}
          {visibleCount < sortedPublicAssets.length && (
            <Box display="flex" justifyContent="center" mt={2}>
              <button
                onClick={() =>
                  setVisibleCount((prev) => Math.min(prev + PAGE_SIZE, sortedPublicAssets.length))
                }
                style={{
                  padding: '10px 16px',
                  borderRadius: 8,
                  border: `1px solid ${theme.palette.divider}`,
                  background: theme.palette.background.paper,
                  color: theme.palette.text.primary,
                  cursor: 'pointer',
                }}
              >
                Load more assets
              </button>
            </Box>
          )}
        </>
      )}
    </Box>
  );
};

export default AssetExplorer;
