import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../portfolio/PortfolioProvider';
import {
  Box,
  Button,
  Paper,
  TextField,
  Typography,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
} from '@mui/material';
import { Delete, Launch, Send as SendIcon, SwapHoriz, ReceiptLong } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import { formatAssetAmount } from '../utils/qortalAssetRequests';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { getPrimaryAccountName } from '../utils/qortalApi';
import pLimit from 'p-limit';

export default function PortfolioPage() {
  const {
    wallets,
    assetsIndex,
    holdings,
    loading,
    error,
    addWalletByNameOrAddress,
    removeWallet,
    refreshHoldings,
  } = usePortfolio();

  const { address: authAddress } = useAuth();

  const [newAddr, setNewAddr] = useState('');
  const [avatarMap, setAvatarMap] = useState<Record<number, string | null>>({});
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [authName, setAuthName] = useState<string | null>(null);
  const trackedSet = useMemo(() => new Set(wallets.map((w) => w.address)), [wallets]);

  const navigate = useNavigate();

  // Resolve primary name for authenticated account (for header prettiness)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authAddress) {
        setAuthName(null);
        return;
      }
      try {
        const n = await qortalRequest({ action: 'GET_PRIMARY_NAME', address: authAddress });
        if (!cancelled) setAuthName(typeof n === 'string' && n ? n : null);
      } catch {
        if (!cancelled) setAuthName(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [authAddress]);

  // Progressive avatar load for assets present in holdings
  useEffect(() => {
    let cancelled = false;
    const limit = pLimit(6);
    const nameCache = new Map<string, string | null>();

    const getIssuer = async (addr: string) => {
      if (nameCache.has(addr)) return nameCache.get(addr)!;
      const n = await getPrimaryAccountName(addr).catch(() => null);
      nameCache.set(addr, n);
      return n;
    };

    const loadAvatars = async () => {
      const entries = await Promise.all(
        Object.keys(holdings).map(async (k) => {
          const assetId = Number(k);
          const meta = assetsIndex[assetId];

          if (!meta) return [assetId, null] as const;
          try {
            if (assetId == 0) {
              const url = await fetchAssetAvatar('Q-Assets', 'QORT');
              return [assetId, url ?? null] as const;
            } else if (assetId == 1) {
              const url = await fetchAssetAvatar('Q-Assets', 'Legacy-QORA');
              return [assetId, url ?? null] as const;
            } else if (assetId == 2) {
              const url = await fetchAssetAvatar('Q-Assets', 'QORT-from-QORA');
              return [assetId, url ?? null] as const;
            }
            const issuerName = await getIssuer(meta.owner);

            if (!issuerName) return [assetId, null] as const;
            const url = await limit(() => fetchAssetAvatar(issuerName, meta.name));

            return [assetId, url ?? null] as const;
          } catch {
            return [assetId, null] as const;
          }
        })
      );

      if (!cancelled) setAvatarMap(Object.fromEntries(entries));
    };

    if (Object.keys(holdings).length) loadAvatars();
    return () => {
      cancelled = true;
    };
  }, [holdings, assetsIndex]);

  // Keep holdings fresh when wallets change
  useEffect(() => {
    refreshHoldings();
  }, [wallets, refreshHoldings]);

  // ===== Wallet (AUTH USER ONLY) rows =====
  const walletRows = useMemo(() => {
    if (!authAddress) return [];
    return Object.values(holdings).flatMap((h) => {
      const meta = assetsIndex[h.assetId];
      if (!meta) return [];
      const amt = h.perWallet[authAddress] || 0;
      if (amt <= 0) return [];
      return [{ assetId: h.assetId, name: meta.name, isDivisible: meta.isDivisible, amount: amt }];
    });
  }, [holdings, assetsIndex, authAddress]);

  // ===== All tracked (existing) rows =====
  const rowsAll = useMemo(() => {
    return Object.values(holdings)
      .map((h) => {
        const meta = assetsIndex[h.assetId];
        if (!meta) return null;

        // sum only tracked wallets
        const totalTracked = Object.entries(h.perWallet).reduce((sum, [addr, amt]) => {
          return trackedSet.has(addr) ? sum + (amt as number) : sum;
        }, 0);

        if (totalTracked <= 0) return null;

        return {
          assetId: h.assetId,
          name: meta.name,
          isDivisible: meta.isDivisible,
          total: totalTracked,
        };
      })
      .filter(Boolean) as Array<{
      assetId: number;
      name: string;
      isDivisible: boolean;
      total: number;
    }>;
  }, [holdings, assetsIndex, trackedSet]);

  function colorFromAssetId(aid: number) {
    const hue = (aid * 57) % 360; // cheap hash
    return {
      accent: `hsl(${hue} 80% 50%)`,
      tint: `hsl(${hue} 80% 20% / 0.15)`,
      tintHover: `hsl(${hue} 80% 20% / 0.25)`,
      border: `hsl(${hue} 80% 45% / 0.6)`,
    };
  }

  function walletRowSx(aid: number) {
    const c = colorFromAssetId(aid);
    return {
      display: 'grid',
      gridTemplateColumns: {
        xs: 'auto 1fr', // avatar | name (stack amount/actions under via auto rows)
        sm: 'auto 1fr auto', // add amount
        md: 'auto 1fr auto auto', // add actions on wide
      },
      gridAutoRows: 'min-content',
      alignItems: 'center',
      gap: { xs: 1, sm: 1.25, md: 1.5 },
      p: { xs: 1, sm: 1.25 },
      borderRadius: 1.5,
      borderLeft: `4px solid ${c.border}`,
      backgroundColor: c.tint,
      transition: 'background-color .15s ease, transform .12s ease',
      '&:hover': {
        backgroundColor: c.tintHover,
        transform: 'translateY(-1px)',
      },
      // Let actions fall to next line on xs
      '& > :nth-of-type(3)': { gridColumn: { xs: '1 / -1', sm: 'auto' } }, // amount
      '& > :nth-of-type(4)': {
        gridColumn: { xs: '1 / -1', md: 'auto' },
        justifySelf: { xs: 'start', md: 'end' },
      }, // actions
    } as const;
  }

  // Add tracked wallet (name or address)
  const onAdd = async () => {
    if (!newAddr) return;
    setAdding(true);
    setAddMsg(null);
    const ok = await addWalletByNameOrAddress(newAddr);
    setAdding(false);
    setAddMsg(ok ? 'Added' : 'Name/address not found');
    if (ok) setNewAddr('');
  };

  // Actions (Wallet section)
  const hasAuth = !!authAddress;

  const onShowTx = (assetId: number) => {
    if (!hasAuth) return;
    // route or drawer — adjust to your app
    navigate(`/assets/${assetId}?tab=tx&address=${authAddress}`);
  };

  const onSend = (assetId: number) => {
    if (!hasAuth) return;
    // open your send flow; example route:
    navigate(`/send?assetId=${assetId}&from=${authAddress}`);
  };

  const onTrade = (assetId: number) => {
    if (!hasAuth) return;
    navigate(`/trade?assetId=${assetId}&from=${authAddress}`);
  };

  const onViewDetails = (assetId: number) => {
    navigate(`/assets/${assetId}`);
  };

  return (
    <Box
      sx={{
        p: { xs: 2, md: 3 },
        display: 'grid',
        gridAutoRows: 'min-content',
        gap: { xs: 2, md: 3 },
      }}
    >
      {/* ===== TOP: Wallet (authenticated user only) ===== */}
      <Typography variant="h4" textAlign={'center'} sx={{ mb: { xs: 0.5, md: 1 } }}>
        Wallet
      </Typography>

      <Paper sx={{ p: { xs: 1.5, md: 2 }, mb: { xs: 2, md: 3 } }}>
        <Box
          display="flex"
          flexWrap="wrap"
          alignItems="center"
          justifyContent="space-between"
          rowGap={0.5}
          mb={{ xs: 1, md: 1.5 }}
        >
          <Typography variant="subtitle2" color="text.secondary">
            {authAddress ? 'Account:' : 'Not signed in'}
          </Typography>
          {authAddress && (
            <Typography
              variant="body2"
              color="text.secondary"
              sx={{
                fontFamily: authName ? undefined : 'monospace',
                maxWidth: '100%',
                overflow: 'hidden',
                textOverflow: 'ellipsis',
              }}
            >
              {authName ?? authAddress}
            </Typography>
          )}
        </Box>

        {!authAddress ? (
          <Typography variant="body2" color="text.secondary">
            Sign in to view balances and use wallet actions.
          </Typography>
        ) : walletRows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            This account holds no assets.
          </Typography>
        ) : (
          <Box display="grid" gap={{ xs: 1, md: 1.25 }}>
            {walletRows.map((row) => {
              const c = colorFromAssetId(row.assetId);
              return (
                <Box key={row.assetId} sx={walletRowSx(row.assetId)}>
                  {/* Avatar */}
                  <Box
                    sx={{
                      width: { xs: 40, sm: 44, md: 48 },
                      height: { xs: 40, sm: 44, md: 48 },
                      borderRadius: 1.5,
                      overflow: 'hidden',
                      bgcolor: 'background.default',
                      border: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {avatarMap[row.assetId] ? (
                      <img
                        src={avatarMap[row.assetId]!}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <img
                        src="/img/asset-placeholder.svg"
                        alt=""
                        style={{ width: '75%', height: '75%', opacity: 0.7 }}
                      />
                    )}
                  </Box>

                  {/* Name */}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="h6"
                      sx={{
                        lineHeight: 1.1,
                        fontSize: { xs: '1rem', sm: '1.1rem', md: '1.25rem' },
                        whiteSpace: 'nowrap',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                      }}
                      title={row.name}
                    >
                      {row.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Asset ID: {row.assetId}
                    </Typography>
                  </Box>

                  {/* Amount */}
                  <Box sx={{ textAlign: { xs: 'left', md: 'right' }, minWidth: { md: 160 } }}>
                    <Typography
                      sx={{
                        fontFamily: 'monospace',
                        color: c.accent,
                        lineHeight: 1.1,
                        fontSize: { xs: '.95rem', sm: '1.05rem', md: '1.15rem' },
                      }}
                      title="Balance"
                    >
                      {formatAssetAmount(row.amount, row.isDivisible)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      Balance
                    </Typography>
                  </Box>

                  {/* Actions */}
                  <Box
                    sx={{
                      display: 'grid',
                      gridAutoFlow: { xs: 'row', sm: 'column' },
                      gridAutoColumns: 'min-content',
                      gap: { xs: 0.5, sm: 1 },
                      justifyContent: { xs: 'stretch', sm: 'end' },
                    }}
                  >
                    <Tooltip title="Show transactions">
                      <span>
                        <IconButton
                          size="small"
                          color="inherit"
                          onClick={() => onShowTx(row.assetId)}
                          disabled={!hasAuth}
                        >
                          <ReceiptLong fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={`Send ${row.name}`}>
                      <span>
                        <IconButton
                          size="small"
                          sx={{ color: c.accent }}
                          onClick={() => onSend(row.assetId)}
                          disabled={!hasAuth}
                        >
                          <SendIcon fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title={`Trade ${row.name}`}>
                      <span>
                        <IconButton
                          size="small"
                          sx={{ color: c.accent }}
                          onClick={() => onTrade(row.assetId)}
                          disabled={!hasAuth}
                        >
                          <SwapHoriz fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                    <Tooltip title="View details">
                      <span>
                        <IconButton size="small" onClick={() => onViewDetails(row.assetId)}>
                          <Launch fontSize="small" />
                        </IconButton>
                      </span>
                    </Tooltip>
                  </Box>
                </Box>
              );
            })}
          </Box>
        )}
      </Paper>

      {/* ===== BELOW: Tracked wallets manager (left) + Holdings (right) ===== */}
      <Typography variant="h4" textAlign={'center'} sx={{ mb: { xs: 0.5, md: 1 } }}>
        Track Account Portfolios
      </Typography>
      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '1fr 2fr' },
          gap: { xs: 2, md: 3 },
        }}
      >
        {/* Tracked Wallets manager */}
        <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
          <Typography variant="h6" gutterBottom>
            Tracked Wallets
          </Typography>

          <Box display="grid" gridTemplateColumns={{ xs: '1fr', sm: '1fr auto' }} gap={1} mb={1.5}>
            <TextField
              size="small"
              fullWidth
              label="Qortal Address or Name"
              value={newAddr}
              onChange={(e) => setNewAddr(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') onAdd();
              }}
            />
            <Button
              variant="contained"
              onClick={onAdd}
              disabled={!newAddr || adding}
              sx={{ minWidth: { sm: 100 } }}
            >
              {adding ? 'Adding...' : 'Add'}
            </Button>
          </Box>

          {addMsg && (
            <Typography variant="caption" color="text.secondary" sx={{ mb: 1, display: 'block' }}>
              {addMsg}
            </Typography>
          )}

          {wallets.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No tracked wallets yet.
            </Typography>
          ) : (
            <Box display="grid" gap={0.5}>
              {wallets.map((w) => (
                <Box
                  key={w.address}
                  display="flex"
                  alignItems="center"
                  justifyContent="space-between"
                  py={0.5}
                >
                  <Typography
                    variant="body2"
                    noWrap
                    sx={{
                      minWidth: 0,
                      maxWidth: '75%',
                      fontFamily: w.name ? undefined : 'monospace',
                    }}
                    title={w.name ?? w.address}
                  >
                    {w.name ?? w.address}
                  </Typography>
                  <IconButton size="small" onClick={() => removeWallet(w.address)}>
                    <Delete fontSize="small" />
                  </IconButton>
                </Box>
              ))}
            </Box>
          )}

          <Box mt={2} display="flex" gap={1} flexWrap="wrap">
            <Button variant="outlined" onClick={() => refreshHoldings()} disabled={loading}>
              Refresh
            </Button>
            {error && (
              <Typography color="error" sx={{ alignSelf: 'center' }}>
                {error}
              </Typography>
            )}
          </Box>
        </Paper>

        {/* Holdings (All Tracked) */}
        <Paper sx={{ p: { xs: 1.5, md: 2 } }}>
          <Box
            display="flex"
            alignItems="center"
            justifyContent="space-between"
            mb={{ xs: 1.5, md: 2 }}
          >
            <Typography variant="h6">Holdings (All Tracked)</Typography>
            {loading && <CircularProgress size={20} />}
          </Box>

          {rowsAll.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              No holdings yet.
            </Typography>
          ) : (
            <Box
              display="grid"
              gridTemplateColumns={{
                xs: 'auto 1fr',
                sm: 'auto 1fr auto',
              }}
              rowGap={1}
              columnGap={1}
              alignItems="center"
            >
              {rowsAll.map((row) => (
                <React.Fragment key={row.assetId}>
                  <Box
                    sx={{
                      width: { xs: 32, sm: 36 },
                      height: { xs: 32, sm: 36 },
                      borderRadius: 1,
                      overflow: 'hidden',
                      bgcolor: 'background.default',
                      border: '1px solid',
                      borderColor: 'divider',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {avatarMap[row.assetId] ? (
                      <img
                        src={avatarMap[row.assetId]!}
                        alt=""
                        style={{ width: '100%', height: '100%', objectFit: 'contain' }}
                      />
                    ) : (
                      <img
                        src="/img/asset-placeholder.svg"
                        alt=""
                        style={{ width: '70%', height: '70%', opacity: 0.6 }}
                      />
                    )}
                  </Box>

                  <Typography
                    variant="body1"
                    sx={{
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      pr: 1,
                    }}
                    title={row.name}
                  >
                    {row.name}
                  </Typography>

                  <Typography
                    variant="body1"
                    sx={{ fontFamily: 'monospace', display: { xs: 'none', sm: 'block' } }}
                  >
                    {formatAssetAmount(row.total, row.isDivisible)}
                  </Typography>
                </React.Fragment>
              ))}
            </Box>
          )}
        </Paper>
      </Box>
    </Box>
  );
}
