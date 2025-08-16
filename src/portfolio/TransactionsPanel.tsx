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
  formatAmount: (n: number, divisible: boolean) => string; // your formatter
}

export default function TransactionsPanel({
  open,
  address,
  assetId,
  assetName,
  isDivisible,
  accent,
  formatAmount,
}: Props) {
  const { items, loading, error, hasMore, loadMore, initialized } = useAssetTx(
    address,
    assetId,
    20
  );

  // Auto-load first page on open
  useEffect(() => {
    if (open && !initialized && !loading) {
      void loadMore();
    }
  }, [open, initialized, loading, loadMore]);

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
            {items.map((tx) => {
              const isOut = tx.sender === address;
              const sign = isOut ? '-' : '+';
              const color = isOut ? 'text.secondary' : undefined;
              const when = formatDistanceToNow(new Date(tx.timestamp), { addSuffix: true });

              return (
                <React.Fragment key={tx.txId}>
                  {/* Dot / direction */}
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
                  {/* Summary */}
                  <Box sx={{ minWidth: 0 }}>
                    <Typography
                      variant="body2"
                      sx={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}
                      title={tx.type}
                    >
                      {isOut ? 'Sent' : 'Received'} {assetName}{' '}
                      <Chip size="small" label={tx.type} sx={{ ml: 0.5 }} />
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {isOut ? 'To' : 'From'}{' '}
                      <Tooltip title={isOut ? tx.recipient : tx.sender}>
                        <span style={{ fontFamily: 'monospace' }}>
                          {(isOut ? tx.recipient : tx.sender).slice(0, 10)}…
                        </span>
                      </Tooltip>{' '}
                      • {when}
                    </Typography>
                  </Box>
                  {/* Amount */}
                  <Typography
                    variant="body2"
                    sx={{ fontFamily: 'monospace', justifySelf: { sm: 'end' } }}
                    color={color as any}
                  >
                    {sign}
                    {formatAmount(tx.amount, isDivisible)}
                  </Typography>
                </React.Fragment>
              );
            })}
          </Box>
        )}

        <Box mt={1.25} display="flex" justifyContent="flex-end" gap={1}>
          {hasMore && (
            <Button
              onClick={() => loadMore()}
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
