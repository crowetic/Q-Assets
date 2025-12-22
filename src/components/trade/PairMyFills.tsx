import { Box, Typography } from '@mui/material';
import { formatPrice, formatQty } from '../../utils/marketUI';
import type { FillEvent } from '../../utils/markets';

export default function PairMyFills(props: {
  fills: FillEvent[];
  assetName: string;
  divisible: boolean;
}) {
  const { fills, assetName, divisible } = props;

  if (!fills.length) {
    return (
      <Typography variant="caption" color="text.secondary">
        No fills yet for this pair.
      </Typography>
    );
  }

  return (
    <Box sx={{ display: 'grid', gap: 0.25 }}>
      {fills.map((f, i) => {
        const dateStr = new Date(f.ts).toLocaleString(undefined, {
          year: 'numeric',
          month: 'short',
          day: '2-digit',
          hour: '2-digit',
          minute: '2-digit',
        });
        const totalQort = Number.isFinite(f.qort) ? f.qort : f.qtyAsset * f.price;

        return (
          <Box
            key={f.tradeSignature ?? `${f.orderId}:${f.ts}:${i}`}
            sx={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr auto',
              gap: 1,
              fontSize: 14,
              alignItems: 'center',
            }}
            title={`${dateStr} • Total ${formatPrice(totalQort)} QORT @ ${formatPrice(
              f.price
            )} QORT / ${assetName}`}
          >
            {/* Side + Date */}
            <Box sx={{ display: 'flex', flexDirection: 'column' }}>
              <Typography
                sx={{
                  color: f.side === 'buy' ? 'success.main' : 'error.main',
                  fontWeight: 600,
                  lineHeight: 1.1,
                }}
              >
                {f.side.toUpperCase()}
              </Typography>
              <Typography variant="caption" sx={{ color: 'text.secondary', lineHeight: 1.1 }}>
                {dateStr}
              </Typography>
            </Box>

            {/* Qty + Asset */}
            <Box>
              {formatQty(f.qtyAsset, divisible)} {assetName}
            </Box>

            {/* QORT + Price */}
            <Box sx={{ textAlign: 'right' }}>
              {formatPrice(totalQort)} QORT
              <Typography
                variant="caption"
                sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.1 }}
              >
                Total QORT
              </Typography>
              <Typography
                variant="caption"
                sx={{ display: 'block', color: 'text.secondary', lineHeight: 1.1 }}
              >
                @ {formatPrice(f.price)} QORT / {assetName}
              </Typography>
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
