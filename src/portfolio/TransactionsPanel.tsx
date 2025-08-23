import React, { useEffect } from 'react';
import { Box, Button, Chip, CircularProgress, Collapse, Typography, Tooltip } from '@mui/material';
import { useAssetTx } from './useAssetTx';
import { formatDistanceToNow } from 'date-fns';

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
  const { items, loading, error, hasMore, loadMore, initialized } = useAssetTx(
    address,
    assetId,
    20
  );

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
          <Typography variant="subtitle1">Recent {assetName} Transactions</Typography>
          {loading && <CircularProgress size={16} />}
        </Box>

        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 1 }}>
            {error}
          </Typography>
        )}

        {items.length === 0 && !loading ? (
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
            {items.map((tx, idx) => {
              const isOut = (tx?.sender ?? '') === address;
              const sign = isOut ? '-' : '+';
              const color = isOut ? 'text.secondary' : undefined;
              const tsMs = normTsMs(Number(tx?.timestamp ?? 0));
              const when =
                Number.isFinite(tsMs) && tsMs > 0
                  ? formatDistanceToNow(new Date(tsMs), { addSuffix: true })
                  : '';

              const otherParty = isOut ? tx?.recipient : tx?.sender;
              const otherPartyShort =
                typeof otherParty === 'string' && otherParty.length > 10
                  ? `${otherParty.slice(0, 10)}…`
                  : (otherParty ?? '');

              const amount = Number(tx?.amount ?? 0);

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
                    onClick={() => onTxClick?.(tx)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        onTxClick?.(tx);
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
                      variant="body2"
                      sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={tx?.type}
                    >
                      {isOut ? 'OUTBOUND' : 'INCOMING'} {assetName}{' '}
                      <Box component="span" sx={{ ml: 0.5, display: 'inline-flex' }}>
                        <Chip size="small" label={tx?.type ?? 'TX'} />
                      </Box>
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {isOut ? 'To' : 'From'}{' '}
                      <Tooltip title={String(otherParty ?? '')}>
                        <span style={{ fontFamily: 'monospace' }}>{otherPartyShort}</span>
                      </Tooltip>{' '}
                      • {when}
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
                    {formatAmount(amount, isDivisible)}
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
