import React, { useEffect, useMemo, useState } from 'react';
import { usePortfolio } from '../portfolio/PortfolioProvider';
import {
  Box,
  Button,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
  CircularProgress,
  IconButton,
  Tooltip,
} from '@mui/material';
import { Delete, Launch, Send as SendIcon, SwapHoriz, ReceiptLong } from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import { formatAssetAmount } from '../utils/qortalAssetRequests';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { getPrimaryAccountName } from '../utils/qortalApi';
import pLimit from 'p-limit';
import { transferAsset } from '../utils/qortalApi';
import { resolveRecipientStrict } from '../utils/address';
import SendAssetDialog from '../portfolio/SendAssetDialog';
import TransactionsPanel from '../portfolio/TransactionsPanel';
import TxDetailsDialog from '../portfolio/TxDetailsDialog';
import { useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import type { Wallet } from '../portfolio/portfolioTypes';
import { objectToBase64 } from '../utils/data';
import { useQdnBatchPublisher } from '../utils/useQdnBatchPublisher';
import { addPrivateMagic } from '../constants/qdeckIdentifiers';

const SAVED_SET_STORAGE_KEY = 'qa_portfolio_saved_wallet_sets';

type SavedWalletSet = {
  id: string;
  name: string;
  wallets: Wallet[];
  savedAt: number;
};

const normalizeStoredWallet = (raw: any): Wallet | null => {
  if (!raw || typeof raw !== 'object') return null;
  const address = typeof raw.address === 'string' ? raw.address.trim() : '';
  if (!address) return null;
  return {
    address,
    label: typeof raw.label === 'string' && raw.label ? raw.label : undefined,
    name: typeof raw.name === 'string' && raw.name ? raw.name : undefined,
  };
};

const normalizeStoredSet = (raw: any): SavedWalletSet | null => {
  if (!raw || typeof raw !== 'object') return null;
  const name = typeof raw.name === 'string' ? raw.name.trim() : '';
  if (!name) return null;

  const walletsRaw = Array.isArray(raw.wallets) ? raw.wallets : [];
  const wallets = walletsRaw
    .map((w: Wallet) => normalizeStoredWallet(w))
    .filter((w: Wallet): w is Wallet => Boolean(w));
  if (!wallets.length) return null;

  const savedAt =
    typeof raw.savedAt === 'number' && Number.isFinite(raw.savedAt) ? raw.savedAt : Date.now();
  const id =
    typeof raw.id === 'string' && raw.id.trim()
      ? raw.id.trim()
      : `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`;

  return { id, name, wallets, savedAt };
};

const QA_PORTFOLIO_QDN_PREFIX = 'qa_portfolio_saved_sets';

const buildSavedSetsIdentifier = (address: string) =>
  `${QA_PORTFOLIO_QDN_PREFIX}__${address.toLowerCase()}`;

const encryptForPublicKey = async (data64: string, publicKey: string) => {
  const encrypted: string | null = await qortalRequest({
    action: 'ENCRYPT_DATA',
    base64: data64,
    publicKeys: [publicKey],
  });
  if (!encrypted || typeof encrypted !== 'string') {
    throw new Error('Failed to encrypt saved tracked sets.');
  }
  return addPrivateMagic(encrypted);
};
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
    setWallets,
  } = usePortfolio();

  const [newAddr, setNewAddr] = useState('');
  const [avatarMap, setAvatarMap] = useState<Record<number, string | null>>({});
  const [addMsg, setAddMsg] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [authName, setAuthName] = useState<string | null>(null);
  const trackedSet = useMemo(() => new Set(wallets.map((w) => w.address)), [wallets]);
  // const [sending, setSending] = useState(false);
  const [sendDialog, setSendDialog] = useState<{ open: boolean; assetId: number }>({
    open: false,
    assetId: 0,
  });
  const [openTxAssetId, setOpenTxAssetId] = useState<number | null>(null);
  const [txDialog, setTxDialog] = useState<{ open: boolean; tx: any | null }>({
    open: false,
    tx: null,
  });
  const [savedSets, setSavedSets] = useState<SavedWalletSet[]>([]);
  const [saveSetName, setSaveSetName] = useState('');
  const [savingSet, setSavingSet] = useState(false);
  const [savedSetMsg, setSavedSetMsg] = useState<string | null>(null);
  const [publishingSets, setPublishingSets] = useState(false);
  const [publishStatus, setPublishStatus] = useState<string | null>(null);
  const [publishError, setPublishError] = useState<string | null>(null);
  const { publish } = useQdnBatchPublisher();
  useEffect(() => {
    try {
      const raw = localStorage.getItem(SAVED_SET_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) return;
      const normalized = parsed
        .map(normalizeStoredSet)
        .filter((set): set is SavedWalletSet => Boolean(set));
      if (normalized.length) setSavedSets(normalized);
    } catch {
      setSavedSets([]);
    }
  }, []);

  const persistSavedSets = (next: SavedWalletSet[]) => {
    try {
      localStorage.setItem(SAVED_SET_STORAGE_KEY, JSON.stringify(next));
    } catch {
      // ignore
    }
    setSavedSets(next);
  };

  const handleSaveCurrentSet = () => {
    setPublishStatus(null);
    setPublishError(null);
    const name = saveSetName.trim();
    if (!name) {
      setSavedSetMsg('Provide a name before saving.');
      return;
    }
    if (!wallets.length) {
      setSavedSetMsg('Add at least one tracked wallet first.');
      return;
    }
    setSavingSet(true);
    try {
      const newSet: SavedWalletSet = {
        id: `set-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
        name,
        wallets: wallets.map((w) => ({ ...w })),
        savedAt: Date.now(),
      };
      const nextSets = [newSet, ...savedSets.filter((set) => set.name !== name)];
      persistSavedSets(nextSets);
      setSaveSetName('');
      setSavedSetMsg(`Saved set "${name}".`);
    } finally {
      setSavingSet(false);
    }
  };

  const handleLoadSavedSet = (set: SavedWalletSet) => {
    setWallets(set.wallets.map((w) => ({ ...w })));
    setSavedSetMsg(`Loaded set "${set.name}".`);
    setPublishStatus(null);
    setPublishError(null);
  };

  const handleDeleteSavedSet = (id: string) => {
    const next = savedSets.filter((set) => set.id !== id);
    persistSavedSets(next);
    setSavedSetMsg('Saved set removed.');
    setPublishStatus(null);
    setPublishError(null);
  };

  const handleClearTracked = () => {
    setWallets([]);
    localStorage.setItem('qa_portfolio_skip_mine', '1');
    setSavedSetMsg('Tracked wallets cleared.');
    setPublishStatus(null);
    setPublishError(null);
  };

  const handlePublishSavedSets = async () => {
    setPublishStatus(null);
    setPublishError(null);
    if (!authAddress || !authPublicKey) {
      setPublishError('Sign in to publish saved sets.');
      return;
    }
    if (!savedSets.length) {
      setPublishError('No saved tracked sets to publish.');
      return;
    }
    setPublishingSets(true);
    try {
      const payload = {
        owner: authAddress,
        savedAt: Date.now(),
        sets: savedSets.map((set) => ({
          id: set.id,
          name: set.name,
          savedAt: set.savedAt,
          wallets: set.wallets.map((wallet) => ({
            address: wallet.address,
            label: wallet.label,
            name: wallet.name,
          })),
        })),
      };
      const base64 = await objectToBase64(payload);
      const encrypted = await encryptForPublicKey(base64, authPublicKey);
      await publish([
        {
          name: userName || authAddress,
          service: 'DOCUMENT_PRIVATE',
          identifier: buildSavedSetsIdentifier(authAddress),
          data64: encrypted,
        },
      ]);
      setPublishStatus('Saved sets published to QDN.');
    } catch (e: any) {
      setPublishError(e?.message || 'Failed to publish saved sets.');
    } finally {
      setPublishingSets(false);
    }
  };

  const navigate = useNavigate();

  const {
    address: authAddress,
    publicKey: authPublicKey,
    name: userName,
    authenticateUser,
  } = useAuth();

  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  // Resolve primary name for authenticated account (for header prettiness)
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!authAddress) {
        authenticateUser();
        setAuthName(userName || authAddress);
        return;
      }
      try {
        if (userName) setAuthName(userName);
        if (!userName) {
          const n = await qortalRequest({ action: 'GET_PRIMARY_NAME', address: authAddress });
          if (!cancelled) setAuthName(typeof n === 'string' && n ? n : null);
        }
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

  const toggleTx = (aid: number) => {
    setOpenTxAssetId((cur) => (cur === aid ? null : aid));
  };

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
      accentHover: `hsl(${hue} 64% 24%)`,
      tint: `hsl(${hue} 80% 20% / 0.15)`,
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
        backgroundColor: c.accentHover,
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

  const handleSendConfirm = async (recipient: string, amount: number) => {
    const meta = assetsIndex[sendDialog.assetId];
    if (!meta) throw new Error('Unknown asset metadata.');

    const resolvedRecipient = await resolveRecipientStrict(recipient);

    if (sendDialog.assetId === 0) {
      await qortalRequest({
        action: 'SEND_COIN',
        coin: 'QORT',
        recipient: resolvedRecipient,
        amount,
      });
    } else {
      if (!authPublicKey) throw new Error('Missing auth public key.');
      await transferAsset(
        authAddress as string,
        authPublicKey,
        resolvedRecipient,
        sendDialog.assetId,
        amount
      );
    }
  };

  const onTrade = (assetId: number) => {
    if (!hasAuth) return;
    navigate(`/trade/${assetId}`);
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
              const isOpen = openTxAssetId === row.assetId; // state: which asset's tx panel is open
              const isQort = row.assetId === 0;
              return (
                <React.Fragment key={row.assetId}>
                  <Box
                    key={row.assetId}
                    sx={{ ...walletRowSx(row.assetId), cursor: 'pointer' }}
                    role="button"
                    tabIndex={0}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleTx(row.assetId);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleTx(row.assetId);
                      }
                    }}
                  >
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
                          src="/src/core-assets/asset-placeholder.svg"
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
                        // span the full row on xs (belt & suspenders; matches the nth-of-type rule)
                        gridColumn: { xs: '1 / -1', md: 'auto' },
                        display: 'grid',
                        gap: { xs: 0.75, sm: 1 },

                        // Mobile: single column, full width; Desktop: inline icons
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, min-content)' },
                        alignItems: 'stretch',
                        justifyItems: { xs: 'stretch', sm: 'end' },
                      }}
                    >
                      {isXs ? (
                        // ===== Mobile: full-width labeled buttons =====
                        <>
                          <Button
                            fullWidth
                            size="small"
                            variant="outlined"
                            startIcon={<ReceiptLong fontSize="small" />}
                            onClick={() => toggleTx(row.assetId)}
                            disabled={!hasAuth}
                            sx={{
                              justifyContent: 'flex-start',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              minHeight: 36,
                            }}
                          >
                            Transactions
                          </Button>

                          <Button
                            fullWidth
                            size="small"
                            variant="contained"
                            startIcon={<SendIcon fontSize="small" />}
                            onClick={(e) => {
                              e.stopPropagation();
                              setSendDialog({ open: true, assetId: row.assetId });
                            }}
                            disabled={!hasAuth}
                            sx={{
                              justifyContent: 'flex-start',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              minHeight: 36,
                              bgcolor: c.accent,
                              '&:hover': { bgcolor: c.accentHover },
                            }}
                          >
                            {`Send ${row.name}`}
                          </Button>

                          {!isQort && (
                            <Button
                              fullWidth
                              size="small"
                              variant="contained"
                              startIcon={<SwapHoriz fontSize="small" />}
                              onClick={(e) => {
                                e.stopPropagation();
                                onTrade(row.assetId);
                              }}
                              disabled={!hasAuth}
                              sx={{
                                justifyContent: 'flex-start',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                minHeight: 36,
                                bgcolor: c.accent,
                                '&:hover': { bgcolor: c.accentHover },
                              }}
                            >
                              {`Trade ${row.name}`}
                            </Button>
                          )}

                          <Button
                            fullWidth
                            size="small"
                            variant="outlined"
                            startIcon={<Launch fontSize="small" />}
                            onClick={(e) => {
                              e.stopPropagation();
                              onViewDetails(row.assetId);
                            }}
                            sx={{
                              justifyContent: 'flex-start',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              minHeight: 36,
                            }}
                          >
                            View details
                          </Button>
                        </>
                      ) : (
                        // ===== Desktop/Tablet: compact icon buttons inline =====
                        <>
                          <Tooltip title="Show transactions">
                            <span>
                              <IconButton
                                size="small"
                                color="inherit"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  toggleTx(row.assetId);
                                }}
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
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setSendDialog({ open: true, assetId: row.assetId });
                                }}
                                disabled={!hasAuth}
                              >
                                <SendIcon fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>

                          {!isQort && (
                            <Tooltip title={`Trade ${row.name}`}>
                              <span>
                                <IconButton
                                  size="small"
                                  sx={{ color: c.accent }}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onTrade(row.assetId);
                                  }}
                                  disabled={!hasAuth}
                                >
                                  <SwapHoriz fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          )}

                          <Tooltip title="View details">
                            <span>
                              <IconButton
                                size="small"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onViewDetails(row.assetId);
                                }}
                              >
                                <Launch fontSize="small" />
                              </IconButton>
                            </span>
                          </Tooltip>
                        </>
                      )}
                    </Box>

                    {/* Dialog (shared for both mobile & desktop branches) */}
                    <SendAssetDialog
                      open={sendDialog.open}
                      onClose={() => setSendDialog({ ...sendDialog, open: false })}
                      assetId={sendDialog.assetId}
                      assetName={assetsIndex[sendDialog.assetId]?.name || ''}
                      isDivisible={assetsIndex[sendDialog.assetId]?.isDivisible ?? true}
                      isUnspendable={assetsIndex[sendDialog.assetId]?.isUnspendable ?? false}
                      balance={holdings[sendDialog.assetId]?.perWallet?.[authAddress] ?? 0}
                      avatarUrl={avatarMap[sendDialog.assetId] ?? null}
                      accent={sendDialog.assetId ? colorFromAssetId(sendDialog.assetId) : undefined}
                      onConfirm={handleSendConfirm}
                    />
                  </Box>
                  {/* Inline transactions panel as its own grid item, full width */}
                  <Box
                    sx={{
                      gridColumn: '1 / -1',
                      // Optional: indent panel to align under the avatar block
                      ml: { xs: '52px', sm: '60px', md: '68px' }, // ≈ avatar width + gap
                    }}
                  >
                    <TransactionsPanel
                      open={isOpen}
                      address={authAddress!}
                      assetId={row.assetId}
                      assetName={row.name}
                      isDivisible={row.isDivisible}
                      accent={c}
                      formatAmount={formatAssetAmount}
                      onTxClick={(tx: any) => setTxDialog({ open: true, tx })}
                    />
                  </Box>
                </React.Fragment>
              );
            })}
            <TxDetailsDialog
              open={txDialog.open}
              tx={txDialog.tx}
              onClose={() => setTxDialog({ open: false, tx: null })}
            />
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
            <Button
              variant="outlined"
              color="secondary"
              onClick={handleClearTracked}
              disabled={loading}
            >
              New set
            </Button>
            {error && (
              <Typography color="error" sx={{ alignSelf: 'center' }}>
                {error}
              </Typography>
            )}
          </Box>
          <Divider sx={{ my: 2 }} />
          <Box display="grid" gap={1}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1}>
              <TextField
                size="small"
                fullWidth
                label="Save tracked set as"
                value={saveSetName}
                onChange={(e) => setSaveSetName(e.target.value)}
              />
              <Button variant="contained" onClick={handleSaveCurrentSet} disabled={savingSet}>
                {savingSet ? 'Saving…' : 'Save Set'}
              </Button>
            </Stack>
            {savedSetMsg && (
              <Typography variant="caption" color="text.secondary">
                {savedSetMsg}
              </Typography>
            )}
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              <Button
                variant="outlined"
                size="small"
                onClick={handlePublishSavedSets}
                disabled={publishingSets || !savedSets.length}
              >
                {publishingSets ? 'Publishing…' : 'Publish saved sets'}
              </Button>
              {publishError ? (
                <Typography variant="caption" color="error.main">
                  {publishError}
                </Typography>
              ) : publishStatus ? (
                <Typography variant="caption" color="success.main">
                  {publishStatus}
                </Typography>
              ) : null}
            </Stack>
            <Typography variant="subtitle2" sx={{ mt: 0.5 }}>
              Saved Tracked Sets
            </Typography>
            {savedSets.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No saved tracked account sets yet.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {savedSets.map((set) => (
                  <Paper key={set.id} variant="outlined" sx={{ p: 1.25 }}>
                    <Stack direction="row" alignItems="flex-start" spacing={1}>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography variant="subtitle2">{set.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                          {set.wallets.length} wallet{set.wallets.length === 1 ? '' : 's'} · saved{' '}
                          {new Date(set.savedAt).toLocaleDateString()}
                        </Typography>
                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{
                            display: 'block',
                            mt: 0.5,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={set.wallets.map((w) => w.name ?? w.address).join(', ')}
                        >
                          {set.wallets.map((w) => w.name ?? w.address).join(', ')}
                        </Typography>
                      </Box>
                      <Stack direction="row" spacing={0.5}>
                        <Button size="small" onClick={() => handleLoadSavedSet(set)}>
                          Load
                        </Button>
                        <Button
                          size="small"
                          color="error"
                          onClick={() => handleDeleteSavedSet(set.id)}
                        >
                          Delete
                        </Button>
                      </Stack>
                    </Stack>
                  </Paper>
                ))}
              </Stack>
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
                xs: 'auto 1fr auto', // 👈 amount column exists on mobile too
                sm: 'auto 1fr auto',
              }}
              rowGap={1}
              columnGap={1}
              alignItems="center"
            >
              {rowsAll.map((row) => (
                <React.Fragment key={row.assetId}>
                  {/* Avatar */}
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
                        src="/src/core-assets/asset-placeholder.svg"
                        alt=""
                        style={{ width: '70%', height: '70%', opacity: 0.6 }}
                      />
                    )}
                  </Box>

                  {/* Name */}
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

                  {/* Amount — now visible on xs, right-aligned */}
                  <Typography
                    variant="body1"
                    sx={{
                      fontFamily: 'monospace',
                      textAlign: 'right',
                      fontSize: { xs: '0.92rem', sm: '1rem' }, // optional; tighter on phones
                    }}
                    title="Total tracked balance"
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
