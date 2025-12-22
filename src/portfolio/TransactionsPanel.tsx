import React, { useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  Collapse,
  Typography,
  Tooltip,
  ToggleButtonGroup,
  ToggleButton,
} from '@mui/material';
import PaymentIcon from '@mui/icons-material/Payment';
import SyncAltIcon from '@mui/icons-material/SyncAlt';
import CloudUploadIcon from '@mui/icons-material/CloudUpload';
import ChatBubbleIcon from '@mui/icons-material/ChatBubbleOutline';
import GroupIcon from '@mui/icons-material/Groups';
import AddBoxIcon from '@mui/icons-material/AddBox';
import EditNoteIcon from '@mui/icons-material/EditNote';
import SwapHorizIcon from '@mui/icons-material/SwapHoriz';
import CancelIcon from '@mui/icons-material/Cancel';
import MemoryIcon from '@mui/icons-material/Memory';
import HelpOutlineIcon from '@mui/icons-material/HelpOutline';
import { useAssetTx } from './useAssetTx';
import { useQortTransactions } from './useQortTransactions';

const relativeTimeFormat = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });
const RELATIVE_TIME_UNITS: { unit: Intl.RelativeTimeFormatUnit; seconds: number }[] = [
  { unit: 'year', seconds: 60 * 60 * 24 * 365 },
  { unit: 'month', seconds: 60 * 60 * 24 * 30 },
  { unit: 'week', seconds: 60 * 60 * 24 * 7 },
  { unit: 'day', seconds: 60 * 60 * 24 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
  { unit: 'second', seconds: 1 },
];

function formatRelativeTime(tsMs: number) {
  const diffSeconds = Math.round((tsMs - Date.now()) / 1000);
  const absSeconds = Math.abs(diffSeconds);

  for (const { unit, seconds } of RELATIVE_TIME_UNITS) {
    if (absSeconds >= seconds || unit === 'second') {
      const value = Math.round(diffSeconds / seconds);
      return relativeTimeFormat.format(value, unit);
    }
  }
  return '';
}

interface Props {
  open: boolean;
  onClose?: () => void;
  address: string; // auth user
  assetId: number;
  assetName: string;
  isDivisible: boolean;
  accent: { accent: string; tint: string; border: string };
  formatAmount: (n: number, divisible: boolean) => string;
  onTxClick?: (tx: any) => void;
}

export default function TransactionsPanel({
  open,
  address,
  assetId,
  assetName,
  isDivisible,
  accent,
  formatAmount,
  onTxClick,
}: Props) {
  const qortTxState = useQortTransactions(address, 50);
  const assetTxState = useAssetTx(address, assetId, 20);
  const isQort = assetId === 0;
  const { items, loading, error, hasMore, loadMore, initialized } = isQort
    ? qortTxState
    : assetTxState;
  const detailsById = isQort ? null : assetTxState.detailsById;
  const [statusFilter, setStatusFilter] = useState<'all' | 'confirmed' | 'unconfirmed'>('all');

  // Auto-load first page on open
  useEffect(() => {
    if (open && !initialized && !loading) void loadMore();
  }, [open, initialized, loading, loadMore]);

  const normTsMs = (ts: number) => (ts < 1e12 ? ts * 1000 : ts);

  const keyOf = (tx: any, idx: number) =>
    tx?.signature ||
    tx?.reference ||
    tx?.txId ||
    `${tx?.type ?? 'TX'}-${tx?.timestamp ?? 0}-${idx}`;
  const normalizeAddress = (value?: string | null) => (value || '').trim();
  const formatOrderSide = (assetIdValue?: number, assetName?: string) => {
    if (assetName) return assetName;
    if (Number.isFinite(assetIdValue)) return `#${assetIdValue}`;
    return 'Unknown';
  };

  const filteredItems = useMemo(() => {
    return items.filter((tx) => {
      const isConfirmed = (tx.confirmations ?? 0) > 0 || (tx.blockHeight ?? 0) > 0;
      if (statusFilter === 'confirmed') return isConfirmed;
      if (statusFilter === 'unconfirmed') return !isConfirmed;
      return true;
    });
  }, [items, statusFilter]);

  const iconForType = (type: string) => {
    switch (type) {
      case 'PAYMENT':
      case 'MULTI_PAYMENT':
        return <PaymentIcon fontSize="small" />;
      case 'TRANSFER_ASSET':
        return <SyncAltIcon fontSize="small" />;
      case 'ISSUE_ASSET':
        return <AddBoxIcon fontSize="small" />;
      case 'UPDATE_ASSET':
        return <EditNoteIcon fontSize="small" />;
      case 'CREATE_ASSET_ORDER':
        return <SwapHorizIcon fontSize="small" />;
      case 'CANCEL_ASSET_ORDER':
        return <CancelIcon fontSize="small" />;
      case 'ARBITRARY':
        return <CloudUploadIcon fontSize="small" />;
      case 'MESSAGE':
        return <ChatBubbleIcon fontSize="small" />;
      case 'JOIN_GROUP':
      case 'LEAVE_GROUP':
      case 'CREATE_GROUP':
      case 'UPDATE_GROUP':
      case 'GROUP_INVITE':
      case 'GROUP_APPROVAL':
        return <GroupIcon fontSize="small" />;
      case 'AT':
        return <MemoryIcon fontSize="small" />;
      default:
        return <HelpOutlineIcon fontSize="small" />;
    }
  };

  const typeLabel = (type: string) => {
    switch (type) {
      case 'PAYMENT':
        return 'Payment';
      case 'MULTI_PAYMENT':
        return 'Multi-payment';
      case 'TRANSFER_ASSET':
        return 'Asset transfer';
      case 'ISSUE_ASSET':
        return 'Issue asset';
      case 'UPDATE_ASSET':
        return 'Update asset';
      case 'CREATE_ASSET_ORDER':
        return 'Create asset order';
      case 'CANCEL_ASSET_ORDER':
        return 'Cancel asset order';
      case 'ARBITRARY':
        return 'Published data';
      case 'MESSAGE':
        return 'Message';
      case 'JOIN_GROUP':
        return 'Join group';
      case 'LEAVE_GROUP':
        return 'Leave group';
      case 'CREATE_GROUP':
        return 'Create group';
      case 'UPDATE_GROUP':
        return 'Update group';
      case 'AT':
        return 'Automated transaction';
      default:
        return type || 'Transaction';
    }
  };

  const panelTitle = isQort
    ? 'Recent QORT Transactions (account history)'
    : `Recent ${assetName} Transactions`;
  const panelHint = isQort ? 'Fetched via SEARCH_TRANSACTIONS for the signed-in account.' : null;

  return (
    <Collapse in={open} timeout="auto" unmountOnExit>
      <Box
        sx={{
          mt: 1,
          px: { xs: 1.25, md: 1.5 },
          py: 1.25,
          borderRadius: 1.5,
          backgroundColor: accent.tint,
          borderLeft: `4px solid ${accent.border}`,
        }}
      >
        <Box display="flex" alignItems="baseline" justifyContent="space-between" mb={1}>
          <Box>
            <Typography variant="subtitle1">{panelTitle}</Typography>
            {panelHint && (
              <Typography variant="caption" color="text.secondary">
                {panelHint}
              </Typography>
            )}
          </Box>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={statusFilter}
            onChange={(_e, val) => val && setStatusFilter(val)}
          >
            <ToggleButton value="all">All</ToggleButton>
            <ToggleButton value="confirmed">Confirmed</ToggleButton>
            <ToggleButton value="unconfirmed">Unconfirmed</ToggleButton>
          </ToggleButtonGroup>
          {loading && <CircularProgress size={16} />}
        </Box>

        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 1 }}>
            {error}
          </Typography>
        )}

        {filteredItems.length === 0 && !loading ? (
          <Typography variant="body2" color="text.secondary">
            No transactions found.
          </Typography>
        ) : (
          <Box
            sx={{
              display: 'grid',
              gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr auto' },
              rowGap: 1,
              columnGap: 1,
              alignItems: 'center',
            }}
          >
            {filteredItems.map((tx, idx) => {
              const txAny = tx as Record<string, any>;
              const txId = String(txAny.txId ?? txAny.signature ?? txAny.txSignature ?? '');
              const detail = !isQort && txId ? detailsById?.[txId] : null;
              const senderAddress =
                normalizeAddress(
                  txAny.sender ??
                    txAny.senderAddress ??
                    txAny.from ??
                    txAny.creatorAddress ??
                    txAny.creator ??
                    detail?.sender
                ) || '';
              const recipientAddress =
                normalizeAddress(
                  txAny.recipient ??
                    txAny.recipientAddress ??
                    txAny.to ??
                    txAny.destination ??
                    txAny.address ??
                    detail?.recipient
                ) || '';
              const isOut = senderAddress === normalizeAddress(address);
              const sign = isOut ? '-' : '+';
              const color = isOut ? 'text.secondary' : undefined;
              const tsMs = normTsMs(Number(tx?.timestamp ?? 0));
              const when = Number.isFinite(tsMs) && tsMs > 0 ? formatRelativeTime(tsMs) : '';

              const otherParty = isOut
                ? recipientAddress || String(tx?.recipient ?? '')
                : senderAddress || String(tx?.sender ?? '');
              const otherPartyShort =
                typeof otherParty === 'string' && otherParty.length > 10
                  ? `${otherParty.slice(0, 10)}...`
                  : otherParty;

              let amount = Number(txAny.amount ?? txAny.amountQort ?? txAny.amountAsset ?? 0);
              if (detail?.type === 'TRANSFER_ASSET') {
                amount = Number(detail.amountAsset ?? amount);
              } else if (detail?.type === 'ISSUE_ASSET') {
                amount = Number(detail.quantity ?? amount);
              } else if (detail?.type === 'CREATE_ASSET_ORDER' && detail.haveAssetId === assetId) {
                amount = Number(detail.amountHave ?? amount);
              }
              if (!amount && Array.isArray(txAny.payments)) {
                amount = txAny.payments.reduce(
                  (sum: number, payment: any) =>
                    sum + Number(payment?.amount ?? payment?.amountQort ?? 0),
                  0
                );
              }
              const displayType = String(txAny.type ?? 'TX');
              const detailAssetId =
                detail && 'assetId' in detail
                  ? (detail as { assetId?: number }).assetId
                  : undefined;
              const rawAssetId = Number(
                txAny.assetId ?? txAny.haveAssetId ?? txAny.amountAssetId ?? detailAssetId ?? 0
              );
              const showRawAmount = isQort && Number.isFinite(rawAssetId) && rawAssetId !== 0;
              const blockHeight =
                txAny?.blockHeight ??
                (Number.isFinite(txAny.blockHeight) ? txAny.blockHeight : undefined);
              const isConfirmed = Number.isFinite(blockHeight) && (blockHeight as number) > 0;
              const statusLabel = isConfirmed ? 'Confirmed' : 'Unconfirmed';
              const detailParts: string[] = [];
              if (detail?.type === 'ISSUE_ASSET') {
                detailParts.push(`Issued ${detail.name || `#${detail.assetId}`}`);
              } else if (detail?.type === 'TRANSFER_ASSET') {
                detailParts.push(
                  `Asset ${detail.assetName || (detail.assetId != null ? `#${detail.assetId}` : 'Transfer')}`
                );
              } else if (detail?.type === 'CREATE_ASSET_ORDER') {
                detailParts.push(
                  `Order ${formatOrderSide(detail.haveAssetId, detail.haveAssetName)} -> ${formatOrderSide(
                    detail.wantAssetId,
                    detail.wantAssetName
                  )}`
                );
                if (detail.pricePair) detailParts.push(detail.pricePair);
              } else if (detail?.type === 'CANCEL_ASSET_ORDER') {
                if (detail.orderId) detailParts.push(`Cancel ${detail.orderId.slice(0, 10)}...`);
              }
              if (!detailParts.length) {
                if (txAny.assetId && Number(txAny.assetId) !== 0) {
                  const assetLabel = txAny.assetName
                    ? `${txAny.assetName} (#${txAny.assetId})`
                    : `Asset #${txAny.assetId}`;
                  detailParts.push(assetLabel);
                }
                if (txAny.txGroupId) detailParts.push(`Group ${txAny.txGroupId}`);
                if (Array.isArray(txAny.payments)) {
                  detailParts.push(
                    `${txAny.payments.length} payment${txAny.payments.length === 1 ? '' : 's'}`
                  );
                }
              }
              const detailLine = detailParts.filter(Boolean).join(' | ');

              return (
                <React.Fragment key={keyOf(tx, idx)}>
                  {/* Dot / direction (click targets the whole row wrapper below) */}
                  <Box
                    sx={{
                      display: { xs: 'none', sm: 'block' },
                      width: 10,
                      height: 10,
                      borderRadius: '50%',
                      backgroundColor: isOut ? 'warning.main' : 'success.main',
                      justifySelf: 'center',
                    }}
                    title={isOut ? 'Sent' : 'Received'}
                  />

                  {/* Clickable row content */}
                  <Box
                    role="button"
                    tabIndex={0}
                    onClick={() => onTxClick?.(detail ?? tx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onTxClick?.(detail ?? tx);
                      }
                    }}
                    sx={{
                      minWidth: 0,
                      cursor: 'pointer',
                      p: { xs: 0.5, sm: 0.75 },
                      borderRadius: 1,
                      '&:hover': { bgcolor: 'action.hover' },
                      outline: 'none',
                      '&:focus-visible': {
                        boxShadow: (t) => `0 0 0 2px ${t.palette.primary.main}66`,
                      },
                    }}
                    title="Click for full details"
                  >
                    <Typography
                      component="div"
                      variant="body2"
                      sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={displayType}
                    >
                      <Box
                        component="span"
                        sx={{ display: 'inline-flex', alignItems: 'center', gap: 0.5 }}
                      >
                        {iconForType(displayType)}
                        {typeLabel(displayType)}
                      </Box>{' '}
                      <Box component="span" sx={{ ml: 0.5, display: 'inline-flex' }}>
                        <Chip
                          size="small"
                          label={statusLabel}
                          color={isConfirmed ? 'success' : 'warning'}
                        />
                      </Box>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {isOut ? 'To' : 'From'}{' '}
                      <Tooltip title={String(otherParty ?? '')}>
                        <span style={{ fontFamily: 'monospace' }}>{otherPartyShort}</span>
                      </Tooltip>{' '}
                      {when ? ` - ${when}` : ''}
                      {detailLine && (
                        <Box component="span" display="block" sx={{ fontSize: '0.65rem', mt: 0.5 }}>
                          {detailLine}
                        </Box>
                      )}
                    </Typography>
                  </Box>

                  {/* Amount */}
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', justifySelf: { sm: 'end' }, userSelect: 'text' }}
                    color={color as any}
                    title={String(amount)}
                  >
                    {sign}
                    {showRawAmount ? String(amount) : formatAmount(amount, isDivisible)}
                  </Typography>
                </React.Fragment>
              );
            })}
          </Box>
        )}

        <Box mt={1.25} display="flex" justifyContent="flex-end" gap={1}>
          {hasMore && (
            <Button
              onClick={loadMore}
              size="small"
              variant="outlined"
              sx={{ borderColor: accent.border, color: accent.accent }}
              disabled={loading}
            >
              Load more
            </Button>
          )}
        </Box>
      </Box>
    </Collapse>
  );
}
