// SendAssetDialog.tsx
import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  TextField,
  Typography,
  Box,
  Avatar,
} from '@mui/material';

interface SendAssetDialogProps {
  open: boolean;
  onClose: () => void;
  assetId: number;
  assetName: string;
  isDivisible: boolean;
  isUnspendable: boolean;
  balance?: number;
  avatarUrl?: string | null; // optional: show avatar in header
  accent?: { accent: string; accentHover: string; tint: string; border: string }; // derived color
  onConfirm: (recipient: string, amount: number) => Promise<void>;
}

export default function SendAssetDialog({
  open,
  onClose,
  assetId,
  assetName,
  isDivisible,
  isUnspendable,
  balance = 0,
  avatarUrl,
  accent,
  onConfirm,
}: SendAssetDialogProps) {
  const [recipient, setRecipient] = useState('');
  const [amount, setAmount] = useState('');
  const [error, setError] = useState('');
  const [sending, setSending] = useState(false);

  const colors = useMemo(
    () =>
      accent ?? {
        accent: '#7c3aed', // fallback purple
        accentHover: '#6d28d9',
        tint: 'rgba(124,58,237,0.12)',
        border: 'rgba(124,58,237,0.5)',
      },
    [accent]
  );

  const validate = (): boolean => {
    if (isUnspendable) {
      setError(`Unable to send. "${assetName}" is marked unspendable by issuer.`);
      return false;
    }
    if (!recipient.trim()) {
      setError('Recipient is required.');
      return false;
    }
    // disallow exponentials/commas
    if (!/^\d+(\.\d+)?$/.test(amount)) {
      setError('Invalid amount format.');
      return false;
    }
    const num = Number(amount);
    if (!Number.isFinite(num) || num <= 0) {
      setError('Invalid amount.');
      return false;
    }
    if (!isDivisible && !Number.isInteger(num)) {
      setError(`"${assetName}" can only be sent in whole numbers.`);
      return false;
    }
    if (balance > 0 && num > balance) {
      setError(`Insufficient balance. You have ${balance} ${assetName}.`);
      return false;
    }
    setError('');
    return true;
  };

  const handleSend = async () => {
    if (!validate()) return;
    try {
      setSending(true);
      await onConfirm(recipient.trim(), Number(amount));
      onClose();
    } catch (e: any) {
      setError(e?.message || 'Send failed.');
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle sx={{ p: 0 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1.25,
            px: { xs: 2, sm: 2.5 },
            py: { xs: 1.25, sm: 1.5 },
            background: `linear-gradient(180deg, ${colors.tint}, transparent)`,
            borderBottom: `2px solid ${colors.border}`,
          }}
        >
          <Avatar
            sx={{
              width: 36,
              height: 36,
              bgcolor: '#fff',
              border: '1px solid',
              borderColor: 'divider',
            }}
            src={avatarUrl || undefined}
            alt=""
          />
          <Box sx={{ minWidth: 0 }}>
            <Typography variant="h6" sx={{ lineHeight: 1.1 }}>
              Send {assetName}
            </Typography>
            <Typography variant="caption" sx={{ color: colors.accent }}>
              Asset ID: {assetId}
            </Typography>
          </Box>
        </Box>
      </DialogTitle>

      <DialogContent
        sx={{
          pt: 2,
          borderTop: `1px solid ${colors.tint}`,
        }}
      >
        {error && (
          <Typography color="error" variant="body2" sx={{ mb: 1 }}>
            {error}
          </Typography>
        )}

        <TextField
          autoFocus
          margin="dense"
          label="Recipient (Qortal Name or Address)"
          fullWidth
          value={recipient}
          onChange={(e) => setRecipient(e.target.value)}
        />

        <TextField
          margin="dense"
          label={`Amount (${isDivisible ? 'decimals allowed' : 'whole numbers only'})`}
          fullWidth
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />

        <Box sx={{ mt: 0.5 }}>
          <Typography variant="caption" color="text.secondary">
            Balance:&nbsp;
          </Typography>
          <Typography variant="caption" sx={{ fontFamily: 'monospace' }}>
            {balance} {assetName}
          </Typography>
        </Box>
      </DialogContent>

      <DialogActions sx={{ px: { xs: 2, sm: 2.5 }, pb: { xs: 1.5, sm: 2 } }}>
        <Button onClick={onClose} disabled={sending}>
          Cancel
        </Button>
        <Button
          onClick={handleSend}
          variant="contained"
          disabled={sending}
          sx={{
            bgcolor: colors.accent,
            '&:hover': { bgcolor: colors.accentHover },
          }}
        >
          Send
        </Button>
      </DialogActions>
    </Dialog>
  );
}
