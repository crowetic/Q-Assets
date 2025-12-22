import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
  Divider,
  Chip,
} from '@mui/material';

function copy(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {}
}

export default function TxDetailsDialog({
  open,
  tx,
  onClose,
  title = 'Transaction Details',
}: {
  open: boolean;
  tx: any | null;
  onClose: () => void;
  title?: string;
}) {
  if (!tx) return null;
  const rawPayload = tx.raw ?? tx;
  const json = JSON.stringify(rawPayload, null, 2);
  const type = String(tx.type ?? tx.txType ?? 'TRANSACTION');
  const tsRaw = tx.timestamp ?? tx.time ?? tx.created ?? tx.createdAt;
  const ts = Number(tsRaw);
  const tsMs = Number.isFinite(ts) ? (ts < 1e12 ? ts * 1000 : ts) : null;
  const timestampLabel = tsMs ? new Date(tsMs).toLocaleString() : '-';
  const blockHeight = tx.blockHeight ?? tx.height;
  const confirmations = tx.confirmations ?? (Number.isFinite(blockHeight) ? blockHeight : undefined);
  const fee = tx.feeQort ?? tx.fee ?? tx.feeAmount;

  const entry = (label: string, value?: any) =>
    value == null || value === ''
      ? null
      : { label, value: typeof value === 'object' ? JSON.stringify(value) : String(value) };

  const baseRows = [
    entry('Type', type),
    entry('Timestamp', timestampLabel),
    entry('Status', tx.approvalStatus ?? tx.status),
    entry('Block', blockHeight),
    entry('Confirmations', confirmations),
    entry('Fee', fee),
    entry('Group', tx.txGroupId),
    entry('Sender', tx.sender ?? tx.creatorAddress ?? tx.creator),
    entry('Recipient', tx.recipient ?? tx.recipientAddress),
    entry('Reference', tx.reference),
    entry('Signature', tx.signature ?? tx.txId ?? tx.txSignature),
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  if (type === 'PAYMENT') {
    const paymentRow = entry('Amount', tx.amountQort ?? tx.amount);
    if (paymentRow) baseRows.push(paymentRow);
  }
  if (type === 'MULTI_PAYMENT') {
    const totalRow = entry('Total', tx.totalQort ?? tx.total);
    if (totalRow) baseRows.push(totalRow);
  }

  const assetRows: Array<{ label: string; value: string }> = [];
  if (type === 'ISSUE_ASSET') {
    assetRows.push(
      ...( [
        entry('Asset ID', tx.assetId),
        entry('Asset Name', tx.name ?? tx.assetName),
        entry('Quantity', tx.quantity),
        entry('Divisible', tx.isDivisible),
        entry('Unspendable', tx.isUnspendable),
        entry('Description', tx.description),
        entry('Issuer Public Key', tx.issuerPublicKey ?? tx.creatorPublicKey),
        entry('Data', tx.data),
      ].filter(Boolean) as Array<{ label: string; value: string }>)
    );
  }
  if (type === 'TRANSFER_ASSET') {
    assetRows.push(
      ...( [
        entry('Asset ID', tx.assetId),
        entry('Asset Name', tx.assetName),
        entry('Amount', tx.amountAsset ?? tx.amount),
        entry('Sender Public Key', tx.senderPublicKey),
        entry('Recipient Public Key', tx.recipientPublicKey),
      ].filter(Boolean) as Array<{ label: string; value: string }>)
    );
  }
  if (type === 'CREATE_ASSET_ORDER') {
    assetRows.push(
      ...( [
        entry('Have Asset ID', tx.haveAssetId),
        entry('Have Asset', tx.haveAssetName),
        entry('Want Asset ID', tx.wantAssetId),
        entry('Want Asset', tx.wantAssetName),
        entry('Amount', tx.amountHave ?? tx.amount),
        entry('Price', tx.price),
        entry('Pair', tx.pricePair),
        entry('Amount Asset ID', tx.amountAssetId),
        entry('Amount Asset', tx.amountAssetName),
        entry('Creator Public Key', tx.creatorPublicKey),
      ].filter(Boolean) as Array<{ label: string; value: string }>)
    );
  }
  if (type === 'CANCEL_ASSET_ORDER') {
    assetRows.push(
      ...( [
        entry('Order ID', tx.orderId),
        entry('Creator Public Key', tx.creatorPublicKey),
      ].filter(Boolean) as Array<{ label: string; value: string }>)
    );
  }
  if (type === 'MULTI_PAYMENT' && Array.isArray(tx.payments)) {
    const paymentRow = entry('Payments', `${tx.payments.length}`);
    if (paymentRow) assetRows.push(paymentRow);
  }

  const renderRows = (rows: Array<{ label: string; value: string }>) => (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr' },
        columnGap: 2,
        rowGap: 0.75,
        fontFamily: 'monospace',
        fontSize: 12,
        wordBreak: 'break-word',
      }}
    >
      {rows.map((row) => (
        <React.Fragment key={row.label}>
          <Typography color="text.secondary">{row.label}</Typography>
          <Box>{row.value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>
        {title}{' '}
        <Chip size="small" label={type} sx={{ ml: 1 }} variant="outlined" color="primary" />
      </DialogTitle>
      <DialogContent dividers>
        {renderRows(baseRows)}
        {assetRows.length > 0 && (
          <>
            <Divider sx={{ my: 2 }} />
            {renderRows(assetRows)}
          </>
        )}

        {/* Raw JSON (collapsible could be added later) */}
        <Box
          component="pre"
          sx={{
            mt: 2,
            p: 1,
            bgcolor: 'background.default',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          {json}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => copy(json)}>Copy JSON</Button>
        <Button variant="contained" onClick={onClose} autoFocus>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
