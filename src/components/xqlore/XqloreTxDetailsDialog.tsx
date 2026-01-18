import React from 'react';
import {
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Divider,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import { Link } from 'react-router-dom';

function copyText(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {
    /* empty */
  }
}

const toMs = (value: unknown) => {
  const num = Number(value);
  if (!Number.isFinite(num)) return null;
  return num < 1e12 ? num * 1000 : num;
};

const formatRowValue = (value?: unknown) => {
  if (value == null || value === '') return null;
  if (typeof value === 'object') {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
};

const buildRow = (label: string, value?: unknown) => {
  const rendered = formatRowValue(value);
  if (!rendered) return null;
  return { label, value: rendered };
};

export default function XqloreTxDetailsDialog({
  open,
  tx,
  onClose,
  title,
}: {
  open: boolean;
  tx: any | null;
  onClose: () => void;
  title?: string;
}) {
  const theme = useTheme();

  if (!tx) return null;
  const rawPayload = tx.raw ?? tx;
  const json = JSON.stringify(rawPayload, null, 2);
  const type = String(rawPayload.type ?? rawPayload.txType ?? tx.type ?? 'TRANSACTION');
  const tsRaw =
    rawPayload.timestamp ?? rawPayload.time ?? rawPayload.created ?? rawPayload.createdAt;
  const tsMs = toMs(tsRaw);
  const timestampLabel = tsMs ? new Date(tsMs).toLocaleString() : '—';
  const blockHeight = rawPayload.blockHeight ?? rawPayload.height;
  const confirmations =
    rawPayload.confirmations ?? (Number.isFinite(blockHeight) ? blockHeight : undefined);
  const fee = rawPayload.feeQort ?? rawPayload.fee ?? rawPayload.feeAmount;
  const sender = rawPayload.sender ?? rawPayload.creatorAddress ?? rawPayload.creator;
  const recipient = rawPayload.recipient ?? rawPayload.recipientAddress;
  const identifier = rawPayload.identifier ?? rawPayload.data?.identifier;
  const service = rawPayload.service ?? rawPayload.data?.service;

  const rows = [
    buildRow('Type', type),
    buildRow('Timestamp', timestampLabel),
    buildRow('Status', rawPayload.approvalStatus ?? rawPayload.status),
    buildRow('Block', blockHeight),
    buildRow('Confirmations', confirmations),
    buildRow('Fee', fee),
    buildRow('Group', rawPayload.txGroupId),
    buildRow('Sender', sender),
    buildRow('Recipient', recipient),
    buildRow('Signature', rawPayload.signature ?? rawPayload.txId ?? rawPayload.txSignature),
  ].filter(Boolean) as Array<{ label: string; value: string }>;

  const assetRows: Array<{ label: string; value: string }> = [];
  if (type === 'ISSUE_ASSET') {
    assetRows.push(
      ...([
        buildRow(
          'Asset ID',
          rawPayload.assetId ?? rawPayload.assetIdIssued ?? rawPayload.assetIdCreated
        ),
        buildRow('Asset Name', rawPayload.name ?? rawPayload.assetName),
        buildRow('Quantity', rawPayload.quantity),
        buildRow('Divisible', rawPayload.isDivisible),
        buildRow('Unspendable', rawPayload.isUnspendable),
        buildRow('Description', rawPayload.description),
        buildRow('Issuer Public Key', rawPayload.issuerPublicKey ?? rawPayload.creatorPublicKey),
      ].filter(Boolean) as Array<{ label: string; value: string }>)
    );
  }
  if (type === 'TRANSFER_ASSET') {
    assetRows.push(
      ...([
        buildRow('Asset ID', rawPayload.assetId),
        buildRow('Asset Name', rawPayload.assetName),
        buildRow('Amount', rawPayload.amountAsset ?? rawPayload.amount),
        buildRow('Sender Public Key', rawPayload.senderPublicKey),
        buildRow('Recipient Public Key', rawPayload.recipientPublicKey),
      ].filter(Boolean) as Array<{ label: string; value: string }>)
    );
  }
  if (type === 'CREATE_ASSET_ORDER') {
    assetRows.push(
      ...([
        buildRow('Have Asset ID', rawPayload.haveAssetId),
        buildRow('Have Asset', rawPayload.haveAssetName),
        buildRow('Want Asset ID', rawPayload.wantAssetId),
        buildRow('Want Asset', rawPayload.wantAssetName),
        buildRow('Amount', rawPayload.amountHave ?? rawPayload.amount),
        buildRow('Price', rawPayload.price),
        buildRow('Pair', rawPayload.pricePair),
        buildRow('Creator Public Key', rawPayload.creatorPublicKey),
      ].filter(Boolean) as Array<{ label: string; value: string }>)
    );
  }
  if (type === 'ARBITRARY') {
    assetRows.push(
      ...([
        buildRow('Service', service),
        buildRow('Identifier', identifier),
        buildRow('Size', rawPayload.dataSize ?? rawPayload.size ?? rawPayload.payloadSize),
      ].filter(Boolean) as Array<{ label: string; value: string }>)
    );
  }

  const renderRows = (items: Array<{ label: string; value: string }>) => (
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
      {items.map((row) => (
        <React.Fragment key={row.label}>
          <Typography color="text.secondary">{row.label}</Typography>
          <Box>{row.value}</Box>
        </React.Fragment>
      ))}
    </Box>
  );

  return (
    <Dialog
      open={open}
      onClose={onClose}
      maxWidth="md"
      fullWidth
      PaperProps={{
        sx: {
          borderRadius: 3,
          backgroundImage: `linear-gradient(135deg, ${alpha(
            theme.palette.background.paper,
            0.98
          )}, ${alpha(theme.palette.background.default, 0.95)})`,
          border: `1px solid ${alpha(theme.palette.divider, 0.6)}`,
        },
      }}
    >
      <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
        <Stack spacing={0.5} sx={{ flex: 1 }}>
          <Typography variant="h6" sx={{ fontFamily: 'Orbitron' }}>
            {title || 'Transaction Details'}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {identifier ? `Identifier: ${identifier}` : 'Signature-ready transaction view'}
          </Typography>
        </Stack>
        <Chip size="small" label={type} variant="outlined" color="primary" />
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Box>
            {renderRows(rows)}
            <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
              {sender && (
                <MuiLink
                  component={Link}
                  to={`/xqlore/accounts/${sender}`}
                  onClick={(event) => event.stopPropagation()}
                  underline="hover"
                >
                  View sender account
                </MuiLink>
              )}
              {recipient && (
                <MuiLink
                  component={Link}
                  to={`/xqlore/accounts/${recipient}`}
                  onClick={(event) => event.stopPropagation()}
                  underline="hover"
                >
                  View recipient account
                </MuiLink>
              )}
            </Stack>
          </Box>

          {assetRows.length > 0 && (
            <>
              <Divider />
              {renderRows(assetRows)}
            </>
          )}

          <Box
            component="pre"
            sx={{
              p: 1,
              bgcolor: alpha(theme.palette.background.default, 0.6),
              border: `1px solid ${alpha(theme.palette.divider, 0.5)}`,
              borderRadius: 1.5,
              maxHeight: 280,
              overflow: 'auto',
              fontSize: 12,
              fontFamily: 'monospace',
            }}
          >
            {json}
          </Box>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => copyText(json)}>Copy JSON</Button>
        {rawPayload.signature && (
          <Button onClick={() => copyText(String(rawPayload.signature))}>Copy Signature</Button>
        )}
        <Button variant="contained" onClick={onClose} autoFocus>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
