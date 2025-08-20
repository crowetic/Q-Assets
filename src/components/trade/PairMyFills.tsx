import { Box, Typography } from '@mui/material';
import { formatPrice, formatQty } from '../../utils/marketUI';

export type FillEvent = {
  orderId: string;
  side: 'buy' | 'sell';
  price: number;
  qtyAsset: number;
  qort: number;
  ts: number;
};

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
      {fills.map((f) => (
        <Box
          key={`${f.orderId}:${f.ts}`}
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr auto',
            gap: 1,
            fontSize: 14,
          }}
          title={new Date(f.ts).toLocaleString()}
        >
          <Box sx={{ color: f.side === 'buy' ? 'success.main' : 'error.main', fontWeight: 600 }}>
            {f.side.toUpperCase()}
          </Box>
          <Box>
            {formatQty(f.qtyAsset, divisible)} {assetName}
          </Box>
          <Box sx={{ textAlign: 'right' }}>{formatPrice(f.price)} QORT</Box>
        </Box>
      ))}
    </Box>
  );
}
