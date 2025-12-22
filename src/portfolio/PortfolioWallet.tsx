import React, { useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  IconButton,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import useMediaQuery from '@mui/material/useMediaQuery';
import {
  AccountBalanceWalletRounded,
  ContentCopyRounded,
  Launch,
  ReceiptLong,
  Send as SendIcon,
  SwapHoriz,
} from '@mui/icons-material';
import { useNavigate } from 'react-router-dom';
import type { AssetMini, HoldingAggregate } from './portfolioTypes';
import { formatAssetAmount } from '../utils/qortalAssetRequests';
import { transferAsset } from '../utils/qortalApi';
import { resolveRecipientStrict } from '../utils/address';
import SendAssetDialog from './SendAssetDialog';
import TransactionsPanel from './TransactionsPanel';
import TxDetailsDialog from './TxDetailsDialog';

type WalletRow = {
  assetId: number;
  name: string;
  isDivisible: boolean;
  isUnspendable: boolean;
  amount: number;
  description?: string;
  owner?: string;
};

type PortfolioWalletProps = {
  authAddress?: string | null;
  authPublicKey?: string | null;
  authName?: string | null;
  assetsIndex: Record<number, AssetMini>;
  holdings: Record<number, HoldingAggregate>;
  avatarMap: Record<number, string | null>;
  loading?: boolean;
};

function copyToClipboard(text: string) {
  if (!text) return;
  try {
    navigator.clipboard.writeText(text);
  } catch {
    // ignore
  }
}

function colorFromAssetId(aid: number) {
  const hue = (aid * 57) % 360; // cheap hash
  return {
    accent: `hsl(${hue} 80% 50%)`,
    accentHover: `hsl(${hue} 64% 24%)`,
    tint: `hsl(${hue} 80% 20% / 0.18)`,
    border: `hsl(${hue} 80% 45% / 0.55)`,
  };
}

export default function PortfolioWallet({
  authAddress,
  authPublicKey,
  authName,
  assetsIndex,
  holdings,
  avatarMap,
  loading,
}: PortfolioWalletProps) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const navigate = useNavigate();

  const [openTxAssetId, setOpenTxAssetId] = useState<number | null>(null);
  const [sendDialog, setSendDialog] = useState<{ open: boolean; assetId: number }>({
    open: false,
    assetId: 0,
  });
  const [txDialog, setTxDialog] = useState<{ open: boolean; tx: any | null }>({
    open: false,
    tx: null,
  });
  const resolvedAddress = authAddress ?? '';

  const walletRows = useMemo<WalletRow[]>(() => {
    if (!authAddress) return [];
    return Object.values(holdings).flatMap((holding) => {
      const meta = assetsIndex[holding.assetId];
      if (!meta) return [];
      const amt = holding.perWallet[authAddress] || 0;
      if (amt <= 0) return [];
      return [
        {
          assetId: holding.assetId,
          name: meta.name,
          isDivisible: meta.isDivisible,
          isUnspendable: meta.isUnspendable,
          amount: amt,
          description: meta.description,
          owner: meta.owner,
        },
      ];
    });
  }, [holdings, assetsIndex, authAddress]);

  const qortRow = walletRows.find((row) => row.assetId === 0);
  const assetsHeldLabel = walletRows.length === 1 ? '1 asset' : `${walletRows.length} assets`;
  const isLoading = Boolean(loading);

  const handleSendConfirm = async (recipient: string, amount: number) => {
    const resolvedRecipient = await resolveRecipientStrict(recipient);
    if (sendDialog.assetId === 0) {
      await qortalRequest({
        action: 'SEND_COIN',
        coin: 'QORT',
        recipient: resolvedRecipient,
        amount,
      });
    } else {
      if (!authAddress || !authPublicKey) {
        throw new Error('Missing auth credentials.');
      }
      await transferAsset(
        authAddress,
        authPublicKey,
        resolvedRecipient,
        sendDialog.assetId,
        amount
      );
    }
  };

  const toggleTx = (assetId: number) => {
    setOpenTxAssetId((cur) => (cur === assetId ? null : assetId));
  };

  return (
    <Paper
      variant="outlined"
      sx={{
        p: { xs: 1.5, md: 2.5 },
        borderRadius: 3,
        borderColor: alpha(theme.palette.primary.main, 0.35),
        background: `linear-gradient(135deg, ${alpha(
          theme.palette.primary.main,
          0.12
        )}, ${alpha(theme.palette.background.paper, 0.92)})`,
      }}
    >
      <Stack spacing={{ xs: 2, md: 2.5 }}>
        <Box
          display="flex"
          alignItems={{ xs: 'flex-start', sm: 'center' }}
          justifyContent="space-between"
          flexWrap="wrap"
          gap={1.5}
        >
          <Stack direction="row" spacing={1.5} alignItems="center">
            <Box
              sx={{
                width: 44,
                height: 44,
                borderRadius: 2,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                bgcolor: alpha(theme.palette.primary.main, 0.2),
                color: theme.palette.primary.main,
              }}
            >
              <AccountBalanceWalletRounded />
            </Box>
            <Box>
              <Typography variant="h4" sx={{ lineHeight: 1.1 }}>
                Wallet
              </Typography>
              <Typography variant="body2" color="text.secondary">
                {authAddress ? 'Account overview and activity' : 'Sign in to view balances'}
              </Typography>
            </Box>
          </Stack>
          {authAddress ? (
            <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
              {isLoading && <CircularProgress size={16} />}
              <Chip label={assetsHeldLabel} color="primary" variant="outlined" size="small" />
              {qortRow && (
                <Chip
                  label={`${formatAssetAmount(qortRow.amount, true)} QORT`}
                  color="success"
                  variant="outlined"
                  size="small"
                />
              )}
            </Stack>
          ) : (
            <Chip label="Not signed in" variant="outlined" size="small" />
          )}
        </Box>

        <Paper
          variant="outlined"
          sx={{
            p: 1.5,
            borderRadius: 2,
            bgcolor: alpha(theme.palette.background.default, 0.6),
          }}
        >
          {authAddress ? (
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} alignItems="center">
              <Box flex={1} minWidth={0}>
                <Typography variant="subtitle2" color="text.secondary">
                  Signed in as
                </Typography>
                <Typography
                  variant="body1"
                  sx={{
                    fontFamily: authName ? undefined : 'monospace',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={authName ?? authAddress ?? ''}
                >
                  {authName ?? authAddress}
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                <Tooltip title="Copy address">
                  <span>
                    <IconButton
                      size="small"
                      onClick={() => copyToClipboard(authAddress)}
                      disabled={!authAddress}
                    >
                      <ContentCopyRounded fontSize="small" />
                    </IconButton>
                  </span>
                </Tooltip>
                <Chip
                  size="small"
                  label="Main account"
                  variant="outlined"
                  sx={{ borderColor: alpha(theme.palette.primary.main, 0.5) }}
                />
              </Stack>
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Sign in to view balances and use wallet actions.
            </Typography>
          )}
        </Paper>

        {!authAddress ? null : isLoading ? (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
              Loading balances…
            </Typography>
          </Stack>
        ) : walletRows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            This account holds no assets.
          </Typography>
        ) : (
          <Stack spacing={2}>
            {walletRows.map((row) => {
              const accent = colorFromAssetId(row.assetId);
              const isOpen = openTxAssetId === row.assetId;
              const isQort = row.assetId === 0;
              const canSendAsset = Boolean(authAddress && (authPublicKey || isQort));
              return (
                <React.Fragment key={row.assetId}>
                  <Paper
                    variant="outlined"
                    sx={{
                      p: { xs: 1.25, sm: 1.5 },
                      borderRadius: 2.5,
                      borderColor: accent.border,
                      background: `linear-gradient(130deg, ${accent.tint}, ${alpha(
                        theme.palette.background.paper,
                        0.95
                      )})`,
                    }}
                  >
                    <Box
                      role="button"
                      tabIndex={0}
                      onClick={() => toggleTx(row.assetId)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          e.preventDefault();
                          toggleTx(row.assetId);
                        }
                      }}
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: {
                          xs: 'auto 1fr',
                          sm: 'auto 1fr auto',
                          md: 'auto 1fr auto auto',
                        },
                        gridAutoRows: 'min-content',
                        alignItems: 'center',
                        gap: { xs: 1, sm: 1.5 },
                        cursor: 'pointer',
                        borderRadius: 1.5,
                        '&:hover': { bgcolor: alpha(theme.palette.action.hover, 0.35) },
                        '&:focus-visible': {
                          outline: `2px solid ${alpha(theme.palette.primary.main, 0.6)}`,
                          outlineOffset: 2,
                        },
                      }}
                      title="Click to toggle transactions"
                    >
                      <Box
                        sx={{
                          width: { xs: 42, sm: 46 },
                          height: { xs: 42, sm: 46 },
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
                            style={{ width: '72%', height: '72%', opacity: 0.7 }}
                          />
                        )}
                      </Box>

                      <Box sx={{ minWidth: 0 }}>
                        <Typography
                          variant="h6"
                          sx={{
                            lineHeight: 1.1,
                            whiteSpace: 'nowrap',
                            overflow: 'hidden',
                            textOverflow: 'ellipsis',
                          }}
                          title={row.description ? `${row.name} - ${row.description}` : row.name}
                        >
                          {row.name}
                        </Typography>
                        {row.description && (
                          <Typography
                            variant="caption"
                            color="text.secondary"
                            sx={{
                              display: 'block',
                              whiteSpace: 'nowrap',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                            }}
                            title={row.description}
                          >
                            {row.description}
                          </Typography>
                        )}
                        <Stack direction="row" spacing={0.75} mt={0.5} flexWrap="wrap">
                          <Chip size="small" label={`ID #${row.assetId}`} variant="outlined" />
                          {row.isUnspendable && (
                            <Chip size="small" label="Unspendable" color="warning" />
                          )}
                          <Chip
                            size="small"
                            label={row.isDivisible ? 'Divisible' : 'Indivisible'}
                            variant="outlined"
                          />
                        </Stack>
                      </Box>

                      <Box sx={{ textAlign: { xs: 'left', md: 'right' } }}>
                        <Typography
                          sx={{
                            fontFamily: 'monospace',
                            color: accent.accent,
                            lineHeight: 1.1,
                            fontSize: { xs: '1rem', sm: '1.1rem', md: '1.2rem' },
                          }}
                        >
                          {formatAssetAmount(row.amount, row.isDivisible)}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Balance
                        </Typography>
                      </Box>

                      <Box
                        sx={{
                          display: 'grid',
                          gap: { xs: 0.75, sm: 1 },
                          gridColumn: { xs: '1 / -1', md: 'auto' },
                          gridTemplateColumns: { xs: '1fr', sm: 'repeat(4, min-content)' },
                          justifyItems: { xs: 'stretch', sm: 'end' },
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => e.stopPropagation()}
                      >
                        {isXs ? (
                          <>
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<ReceiptLong fontSize="small" />}
                              onClick={() => toggleTx(row.assetId)}
                            >
                              {isOpen ? 'Hide activity' : 'Transactions'}
                            </Button>
                            <Button
                              size="small"
                              variant="contained"
                              startIcon={<SendIcon fontSize="small" />}
                              onClick={() => setSendDialog({ open: true, assetId: row.assetId })}
                              disabled={!canSendAsset}
                              sx={{
                                bgcolor: accent.accent,
                                '&:hover': { bgcolor: accent.accentHover },
                              }}
                            >
                              {`Send ${row.name}`}
                            </Button>
                            {!isQort && (
                              <Button
                                size="small"
                                variant="contained"
                                startIcon={<SwapHoriz fontSize="small" />}
                                onClick={() => navigate(`/trade/${row.assetId}`)}
                                sx={{
                                  bgcolor: accent.accent,
                                  '&:hover': { bgcolor: accent.accentHover },
                                }}
                              >
                                {`Trade ${row.name}`}
                              </Button>
                            )}
                            <Button
                              size="small"
                              variant="outlined"
                              startIcon={<Launch fontSize="small" />}
                              onClick={() => navigate(`/assets/${row.assetId}`)}
                            >
                              View details
                            </Button>
                          </>
                        ) : (
                          <>
                            <Tooltip title={isOpen ? 'Hide activity' : 'Show transactions'}>
                              <span>
                                <IconButton size="small" onClick={() => toggleTx(row.assetId)}>
                                  <ReceiptLong fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                            <Tooltip title={`Send ${row.name}`}>
                              <span>
                                <IconButton
                                  size="small"
                                  sx={{ color: accent.accent }}
                                  onClick={() =>
                                    setSendDialog({ open: true, assetId: row.assetId })
                                  }
                                  disabled={!canSendAsset}
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
                                    sx={{ color: accent.accent }}
                                    onClick={() => navigate(`/trade/${row.assetId}`)}
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
                                  onClick={() => navigate(`/assets/${row.assetId}`)}
                                >
                                  <Launch fontSize="small" />
                                </IconButton>
                              </span>
                            </Tooltip>
                          </>
                        )}
                      </Box>
                    </Box>
                    {isOpen && <Divider sx={{ my: 1.5 }} />}
                    <TransactionsPanel
                      open={isOpen}
                      address={resolvedAddress}
                      assetId={row.assetId}
                      assetName={row.name}
                      isDivisible={row.isDivisible}
                      accent={accent}
                      formatAmount={formatAssetAmount}
                      onTxClick={(tx: any) => setTxDialog({ open: true, tx })}
                    />
                  </Paper>
                </React.Fragment>
              );
            })}
          </Stack>
        )}

        <SendAssetDialog
          open={sendDialog.open}
          onClose={() => setSendDialog({ ...sendDialog, open: false })}
          assetId={sendDialog.assetId}
          assetName={assetsIndex[sendDialog.assetId]?.name || ''}
          isDivisible={assetsIndex[sendDialog.assetId]?.isDivisible ?? true}
          isUnspendable={assetsIndex[sendDialog.assetId]?.isUnspendable ?? false}
          balance={holdings[sendDialog.assetId]?.perWallet?.[resolvedAddress] ?? 0}
          avatarUrl={avatarMap[sendDialog.assetId] ?? null}
          accent={colorFromAssetId(sendDialog.assetId)}
          onConfirm={handleSendConfirm}
        />
        <TxDetailsDialog
          open={txDialog.open}
          tx={txDialog.tx}
          onClose={() => setTxDialog({ open: false, tx: null })}
        />
      </Stack>
    </Paper>
  );
}
