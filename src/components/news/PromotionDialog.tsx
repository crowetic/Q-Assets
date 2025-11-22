import { useMemo, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Button,
  Box,
  FormControlLabel,
  Checkbox,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Typography,
} from '@mui/material';
import { DateTimePicker, LocalizationProvider } from '@mui/x-date-pickers';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import dayjs, { Dayjs } from 'dayjs';
import { objectToBase64 } from '../../utils/data';
import {
  Q_ASSET_ID_FOR_PROMOS,
  Q_ASSET_PROMO_DISCOUNT,
  qaPromoRequestPrefix,
} from '../../constants/qdnConstants';
import { PROMO_PAYMENT_OPTIONS, getDiscountedAmount } from '../../utils/promotions';
import { useAuth } from 'qapp-core';
import { uniqueId6 } from '../../utils/ids';
import { transferAsset } from '../../utils/qortalApi';

type Props = {
  open: boolean;
  onClose: () => void;
  treasuryAddress: string; // Q-Assets treasury address
  defaultAmountQort?: number; // pricing you set (e.g. 5 QORT)
};

export default function PromotionDialog({
  open,
  onClose,
  treasuryAddress,
  defaultAmountQort = 5,
}: Props) {
  const { name: userName, address, publicKey, authenticateUser } = useAuth();
  const [title, setTitle] = useState('');
  const [assetName, setAssetName] = useState('');
  const [assetIdInput, setAssetIdInput] = useState('');
  const [targetDescription, setTargetDescription] = useState('');
  const [scope, setScope] = useState<'asset' | 'general'>('asset');
  const [paymentCurrency, setPaymentCurrency] = useState<'QORT' | 'QASSET'>('QORT');
  const [amountQort, setAmountQort] = useState<number>(defaultAmountQort);
  const [startsAt, setStartsAt] = useState<Dayjs | null>(dayjs());
  const [endsAt, setEndsAt] = useState<Dayjs | null>(dayjs().add(7, 'day'));
  const [contentHtml, setContentHtml] = useState('');
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const payableAmount = useMemo(() => {
    const base = Number.isFinite(amountQort) ? amountQort : defaultAmountQort;
    return paymentCurrency === 'QASSET' ? getDiscountedAmount(base) : base;
  }, [amountQort, paymentCurrency, defaultAmountQort]);

  const resetState = () => {
    setTitle('');
    setAssetName('');
    setAssetIdInput('');
    setTargetDescription('');
    setScope('asset');
    setPaymentCurrency('QORT');
    setAmountQort(defaultAmountQort);
    setStartsAt(dayjs());
    setEndsAt(dayjs().add(7, 'day'));
    setContentHtml('');
    setAgree(false);
    setErr(null);
  };

  async function handleSubmit() {
    setErr(null);
    if (!agree) {
      setErr('Please accept the terms.');
      return;
    }
    if (!title || !contentHtml) {
      setErr('Title and content are required.');
      return;
    }
    if (scope === 'asset' && !assetName && !assetIdInput.trim()) {
      setErr('Provide an asset name or ID for asset promotions.');
      return;
    }
    if (scope === 'general' && !targetDescription.trim()) {
      setErr('Describe what you are promoting.');
      return;
    }
    if (!userName) {
      authenticateUser();
      setErr('You must be logged in with a Qortal name to submit promotions.');
      return;
    }
    if (!startsAt || !endsAt) {
      setErr('Start/end times required.');
      return;
    }
    if (paymentCurrency === 'QASSET' && (!address || !publicKey)) {
      authenticateUser();
      setErr('You must be logged in to pay via Q-Assets.');
      return;
    }
    try {
      setBusy(true);

      const payment =
        paymentCurrency === 'QASSET'
          ? await (async () => {
              const transferResponse = (await transferAsset(
                address as string,
                publicKey as string,
                treasuryAddress,
                Q_ASSET_ID_FOR_PROMOS,
                payableAmount
              )) as Response | any;
              let signature: string | null = null;
              if (typeof transferResponse === 'string') {
                signature = transferResponse;
              } else if (transferResponse && typeof transferResponse === 'object') {
                signature = transferResponse.signature ?? transferResponse.txId ?? null;
                if (!signature && typeof transferResponse.text === 'function') {
                  try {
                    const txt = await transferResponse.text();
                    signature = txt || null;
                  } catch {
                    signature = null;
                  }
                }
              }
              return { signature };
            })()
          : await qortalRequest({
              action: 'SEND_COIN',
              coin: 'QORT',
              recipient: treasuryAddress,
              amount: payableAmount,
            });

      const identifier = `${qaPromoRequestPrefix}${uniqueId6()}`;
      const assetId = assetIdInput.trim() ? Number(assetIdInput.trim()) : undefined;
      const payload = {
        kind: 'QASSETS_PROMO_REQUEST',
        title,
        contentHtml,
        scope,
        assetName: scope === 'asset' ? assetName || null : null,
        assetId: scope === 'asset' ? assetId : undefined,
        targetDescription: scope === 'general' ? targetDescription.trim() : null,
        basePriceQort: amountQort,
        startsAt: startsAt.valueOf(),
        endsAt: endsAt.valueOf(),
        createdAt: Date.now(),
        createdBy: userName,
        createdByAddress: address,
        payment: {
          currency: paymentCurrency,
          assetId: paymentCurrency === 'QASSET' ? Q_ASSET_ID_FOR_PROMOS : undefined,
          basePrice: amountQort,
          amountPaid: payableAmount,
          discountApplied: paymentCurrency === 'QASSET' ? Q_ASSET_PROMO_DISCOUNT : undefined,
          txSignature: payment?.signature || payment?.txId || null,
        },
        status: 'pending',
        isActive: false,
      };

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        name: userName,
        service: 'JSON',
        identifier,
        data64: await objectToBase64(payload),
      });

      resetState();
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Failed submitting promotion.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} maxWidth="md" fullWidth>
      <DialogTitle>Submit a Promotion</DialogTitle>
      <DialogContent dividers>
        <LocalizationProvider dateAdapter={AdapterDayjs}>
          <Box sx={{ display: 'grid', gap: 2, mt: 0.5 }}>
            <TextField label="Title" value={title} onChange={(e) => setTitle(e.target.value)} />
            <FormControl size="small">
              <InputLabel id="promo-scope-label">Promotion Focus</InputLabel>
              <Select
                labelId="promo-scope-label"
                value={scope}
                label="Promotion Focus"
                onChange={(e) => setScope(e.target.value as 'asset' | 'general')}
              >
                <MenuItem value="asset">Asset Promotion</MenuItem>
                <MenuItem value="general">General Qortal Promotion</MenuItem>
              </Select>
            </FormControl>
            <TextField
              label="Base price (QORT equivalent)"
              type="number"
              value={amountQort}
              onChange={(e) => {
                const val = Number(e.target.value);
                setAmountQort(Number.isFinite(val) ? val : defaultAmountQort);
              }}
              helperText="Charged immediately. Non-refundable even if pending."
            />
            <FormControl size="small">
              <InputLabel id="promo-payment-label">Payment Asset</InputLabel>
              <Select
                labelId="promo-payment-label"
                value={paymentCurrency}
                label="Payment Asset"
                onChange={(e) => setPaymentCurrency(e.target.value as 'QORT' | 'QASSET')}
              >
                {PROMO_PAYMENT_OPTIONS.map((opt) => (
                  <MenuItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
            <Typography variant="caption" color="text.secondary">
              Payable now:{' '}
              <Box component="span" sx={{ fontWeight: 600 }}>
                {payableAmount} {paymentCurrency === 'QASSET' ? 'Q-Asset' : 'QORT'}
              </Box>{' '}
              {paymentCurrency === 'QASSET'
                ? `(includes ${(Q_ASSET_PROMO_DISCOUNT * 100).toFixed(0)}% discount)`
                : '(full price)'}
            </Typography>
            {scope === 'asset' ? (
              <>
                <TextField
                  label="Asset ID (optional)"
                  value={assetIdInput}
                  onChange={(e) => setAssetIdInput(e.target.value)}
                />
                <TextField
                  label="Asset name"
                  value={assetName}
                  onChange={(e) => setAssetName(e.target.value)}
                />
              </>
            ) : (
              <TextField
                label="What are you promoting?"
                value={targetDescription}
                onChange={(e) => setTargetDescription(e.target.value)}
                helperText="Q-App, QDN site, website, or community project."
              />
            )}
            <DateTimePicker label="Starts" value={startsAt} onChange={setStartsAt} />
            <DateTimePicker label="Ends" value={endsAt} onChange={setEndsAt} />
            <TextField
              label="Content (HTML)"
              value={contentHtml}
              minRows={6}
              onChange={(e) => setContentHtml(e.target.value)}
              multiline
            />
            <FormControlLabel
              control={<Checkbox checked={agree} onChange={(e) => setAgree(e.target.checked)} />}
              label="I understand this is a paid submission subject to moderator approval."
            />
            {err && <Box sx={{ color: 'error.main', fontSize: 13 }}>{err}</Box>}
          </Box>
        </LocalizationProvider>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={handleSubmit} disabled={busy || !agree} variant="contained">
          {busy ? 'Submitting…' : 'Pay & Submit'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
