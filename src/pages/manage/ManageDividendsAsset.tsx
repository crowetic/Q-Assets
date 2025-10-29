import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  CircularProgress,
  Alert,
  useTheme,
  Divider,
  Select,
  SelectChangeEvent,
} from '@mui/material';
import { Link as RouterLink, useParams } from 'react-router-dom';
import { useFetchTracker } from '../../state/global/fetchTracker';
import { resolveAssetBasics } from '../../utils/resolveAssetBasics';
import { fetchAssetHolders, resolveNames, type HolderRow } from '../../utils/assetData';
import { formatQty } from '../../utils/marketUI';
import {
  ensureAssetsIndexLoaded,
  ensureAssetMini,
  readAssetsIndexSync,
} from '../../bootstrap/assetsBootstrap';
import { getAssetBalances } from '../../utils/qortalAssetRequests';
import { TextField, MenuItem } from '@mui/material';
import { transferAsset } from '../../utils/qortalApi';
import { resolveRecipientStrict } from '../../utils/address';
import { useAuth } from 'qapp-core';
import {
  getPrimaryName,
  getNextDividendCounter,
  publishDividendEntry,
  publishDividendHead,
} from '../../utils/qdnDividends';
import { Q_ASSET_APP_PUBLISHER, Q_ASSETS_VERSION } from '../../constants/qdnConstants';
import { useAlert } from '../../components/alerts';
import { DividendEntry } from '../../types/dividendsObject';

// Only the fields we actually read from "mini"
type MinimalMini = { name?: string; isDivisible?: boolean };

type Row = HolderRow & {
  name?: string | null;
  percent: number; // of circulating supply
};

type PayoutRow = Row & {
  payoutAtomic: number; // integer, 8 dp
  payout: number; // float, for UI
};

const DECIMALS = 8;
const UNIT = 10 ** DECIMALS;
const toAtomic = (x: number) => Math.max(0, Math.floor(x * UNIT + 1e-9));
const fromAtomic = (a: number) => a / UNIT;

const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));
const isTooManyUnconfirmed = (e: any) => {
  const msg = (e?.message || String(e) || '').toUpperCase();
  return msg.includes('TOO_MANY_UNCONFIRMED');
};

export default function ManageDividendsAsset() {
  const { assetId } = useParams<{ assetId: string }>();
  const id = Number(assetId);
  const { track } = useFetchTracker();
  const busyWhile = useCallback(
    async <T,>(fn: () => Promise<T> | T, label: string) => track(Promise.resolve().then(fn), label),
    [track]
  );

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [assetName, setAssetName] = useState<string>('');
  const [divisible, setDivisible] = useState(true);
  const [issuer, setIssuer] = useState<string | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [circulating, setCirculating] = useState(0);
  const [issuerBal, setIssuerBal] = useState(0);
  const [balances, setBalances] = useState<{ assetId: number; name: string; balance: number }[]>(
    []
  );
  const [selectedAsset, setSelectedAsset] = useState<number>(0); // 0 = QORT
  const [payoutAmount, setPayoutAmount] = useState<number>(0);
  const [balanceError, setBalanceError] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sentOk, setSentOk] = useState(0);
  const [sentFail, setSentFail] = useState(0);
  const [lastError, setLastError] = useState<string | null>(null);
  const [currentIdx, setCurrentIdx] = useState<number>(-1);
  const abortRef = useRef(false);

  const theme = useTheme();
  const payoutColor = theme.palette.success.main;

  const issuerAssetBalance = useMemo(() => {
    return balances.find((b) => b.assetId === selectedAsset)?.balance ?? 0;
  }, [balances, selectedAsset]);

  const {
    address: userAddress,
    name: userName,
    publicKey: userPublicKey,
    authenticateUser,
  } = useAuth();

  const { alert, confirm } = useAlert();

  useEffect(() => {
    if (payoutAmount > issuerAssetBalance) {
      setBalanceError(`Insufficient balance. You have ${issuerAssetBalance} available.`);
    } else {
      setBalanceError(null);
    }
  }, [payoutAmount, issuerAssetBalance]);

  const sendPayment = async (recipient: string, amount: number) => {
    if (selectedAsset === undefined || selectedAsset === null) {
      await alert('No asset selected for payouts.', 'error', { severity: 'error' });
      return;
    }
    if (!userName) {
      await authenticateUser();
      if (!userName) {
        await alert('authentication failure, username not found, required.', 'error', {
          severity: 'error',
        });
      }
    }

    const resolvedRecipient = await resolveRecipientStrict(recipient);

    const amountFixed = Number(amount.toFixed(8));

    if (selectedAsset === 0) {
      const res = await qortalRequest({
        action: 'SEND_COIN',
        coin: 'QORT',
        recipient: resolvedRecipient,
        amount: amountFixed,
      });
      return { txId: res?.signature ?? res?.txId ?? null };
    } else {
      if (!userPublicKey) throw new Error('Missing auth public key.');
      const res = await transferAsset(
        userAddress as string,
        userPublicKey,
        resolvedRecipient,
        selectedAsset,
        amountFixed
      );
      return { txId: res };
    }
  };

  const INTER_TX_DELAY_MS = 1500; // delay between successful sends
  const RETRY_BACKOFF_MS = 20000; // wait on TOO_MANY_UNCONFIRMED before retry
  const MAX_RETRIES_PER_TX = 6; // ~2 minutes of retries per stuck tx

  async function issueDividends() {
    if (!issuer) {
      await alert('Missing issuer address.', 'error', { severity: 'error' });
      return;
    }
    if (!payoutAmount || payouts.length === 0) {
      alert('Enter a payout amount first.');
      return;
    }
    if (payoutAmount > issuerAssetBalance) {
      alert('Insufficient balance for this payout.');
      return;
    }

    // Build sequential plan (skip zeros)
    const plan = payouts
      .filter((p) => p.payoutAtomic > 0)
      .map((p) => ({
        to: p.address,
        // Send decimal amount to your sendPayment
        amount: fromAtomic(p.payoutAtomic),
        name: p.name ?? null,
      }));

    if (!plan.length) {
      alert('Nothing to pay (all computed payouts are zero).');
      return;
    }

    const prettyAsset = selectedAsset === 0 ? 'QORT' : `Asset #${selectedAsset}`;
    const ok = await confirm(
      `Confirm dividends:\n\n` +
        `Recipients: ${plan.length}\n` +
        `Asset: ${prettyAsset}\n` +
        `Total: ${formatQty(
          plan.reduce((s, p) => s + p.amount, 0),
          true
        )}\n\nProceed?`
    );
    if (!ok) return;

    // init state
    abortRef.current = false;
    setSending(true);
    setSentOk(0);
    setSentFail(0);
    setLastError(null);
    setCurrentIdx(-1);
    const receipts: Array<{ index: number; address: string; txId: string | null }> = [];

    try {
      for (let i = 0; i < plan.length; i++) {
        if (abortRef.current) break;

        const item = plan[i];
        setCurrentIdx(i);

        let attempt = 0;
        while (true) {
          if (abortRef.current) break;
          try {
            const receipt = await sendPayment(item.to, Number(item.amount.toFixed(8)));
            const txId = receipt?.txId ?? null; // <- safe
            setSentOk((prev) => prev + 1);
            receipts.push({ index: i, address: item.to, txId });

            break; // success → move to next recipient
          } catch (e: any) {
            // Handle specific node throttling
            if (isTooManyUnconfirmed(e) && attempt < MAX_RETRIES_PER_TX) {
              setLastError('Node says TOO_MANY_UNCONFIRMED — backing off before retry…');
              attempt++;
              await sleep(RETRY_BACKOFF_MS);
              continue; // retry same recipient
            }

            // Other error → count as failed and continue
            setSentFail((prev) => prev + 1);
            setLastError(e?.message ?? String(e));
            break;
          }
        }

        // Small pacing delay after a successful (or failed) attempt before next address
        if (!abortRef.current && i < plan.length - 1) {
          await sleep(INTER_TX_DELAY_MS);
        }
      }

      if (abortRef.current) {
        alert('Dividend run canceled.');
      } else {
        // Build dividends JSON payload from what we just sent //TODO IMPORTANT, FIGURE OUT WHY THE PAYOUTS WENT THROUGH BEFORE THE CONFIRMATION WAS ACCEPTED, AND THE PUBLISH FOR THE DIVIDENT ENTRY DIDN'T WORK.
        const publishName = userName;
        if (!publishName) {
          await authenticateUser();
          if (!publishName) {
            await alert('authentication failure, required to publish payout json!', 'error', {
              severity: 'error',
            });
            return;
          }
        }

        const entry: DividendEntry = {
          app: Q_ASSET_APP_PUBLISHER,
          appVersion: Q_ASSETS_VERSION,
          type: 'dividends',
          assetId: id,
          assetName, // optional
          payoutAssetId: selectedAsset,
          payoutAssetName: selectedAsset === 0 ? 'QORT' : `Asset #${selectedAsset}`,
          totalInput: Number(payoutAmount.toFixed(8)),
          totalPlanned: Number(totalPlanned.toFixed(8)),
          issuerAddress: issuer!,
          issuerPrimaryName: await getPrimaryName(issuer!),
          timestamp: Date.now(),
          recipients: payouts
            .filter((p) => p.payoutAtomic > 0)
            .map((p) => {
              const rec = receipts.find((r) => r.address === p.address);
              return {
                address: p.address,
                name: p.name ?? null,
                amount: Number(p.payout.toFixed(8)),
                txId: rec?.txId ?? null, //TODO - fill out the txid from the qortalRequest. Not necessary as it can be pulled again, but good to have?
              };
            }),
          notes: '',
          meta: {
            holdersCount: rows.length,
            ok: sentOk,
            fail: sentFail,
          },
        };

        try {
          const counter = await getNextDividendCounter(publishName, id);
          const identifier = await publishDividendEntry(publishName, id, entry, counter);
          await publishDividendHead(publishName, id, counter, identifier);
          alert('Dividend run finished. Check your node for confirmations.');
        } catch (e: any) {
          setLastError(e?.message ?? String(e));
          await alert(
            `Dividends sent, but failed to publish the dividends JSON:\n${e?.message ?? e}`,
            'error',
            { severity: 'error' }
          );
        }
      }
    } finally {
      setSending(false);
      setCurrentIdx(-1);
    }
  }

  // const payouts = useMemo(() => {
  //   if (!payoutAmount || circulating === 0) return [];
  //   return rows.map((r) => ({
  //     ...r,
  //     payout: (payoutAmount * r.percent) / 100,
  //   }));
  // }, [payoutAmount, rows, circulating]);

  const payouts = useMemo<PayoutRow[]>(() => {
    if (!payoutAmount || circulating === 0 || rows.length === 0) return [];

    const totalAtomic = toAtomic(payoutAmount);

    // precompute exact shares at atomic precision
    const base = rows.map((r) => {
      const exact = (payoutAmount * r.percent) / 100; // float
      const exactAtomic = exact * UNIT; // float
      const floorAtomic = Math.floor(exactAtomic); // int
      const remainder = exactAtomic - floorAtomic; // 0..1
      return { row: r, exactAtomic, floorAtomic, remainder };
    });

    // allocate the floors
    let allocated = base.reduce((s, x) => s + x.floorAtomic, 0);
    let remaining = Math.max(0, totalAtomic - allocated);

    // give leftover atoms to largest remainders
    const byRem = [...base].sort((a, b) => b.remainder - a.remainder);
    for (let i = 0; i < remaining && i < byRem.length; i++) {
      byRem[i].floorAtomic += 1;
    }

    // final rows
    return base.map((x) => ({
      ...x.row,
      payoutAtomic: x.floorAtomic,
      payout: fromAtomic(x.floorAtomic),
    }));
  }, [payoutAmount, rows, circulating]);

  const totalPlanned = useMemo(() => {
    return payouts.reduce((s, p) => s + (p.payout ?? 0), 0);
  }, [payouts]);

  const totalDelta = useMemo(() => {
    // how far off we are from the user-entered total due to floating math
    return totalPlanned - (payoutAmount || 0);
  }, [totalPlanned, payoutAmount]);

  const prettyAsset = selectedAsset === 0 ? 'QORT' : `Asset #${selectedAsset}`;

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoading(true);
        setError(null);

        await busyWhile(async () => {
          // Mini info for name/divisibility
          const idx = (await ensureAssetsIndexLoaded()) ?? readAssetsIndexSync() ?? {};
          let mini: MinimalMini | undefined = (idx as Record<number, MinimalMini | undefined>)[id];
          if (!mini) {
            mini = (await ensureAssetMini(id).catch(() => undefined)) as MinimalMini | undefined;
          }
          const nm = mini?.name || `#${id}`;
          const div = Boolean(mini?.isDivisible ?? true);
          if (alive) {
            setAssetName(nm);
            setDivisible(div);
          }

          // basics for issuer address
          const basics = await resolveAssetBasics(id).catch(() => null);
          const ownerAddr = basics?.ownerAddress ?? null;
          if (alive) setIssuer(ownerAddr);
          if (ownerAddr) {
            const assetBalances = await getAssetBalances({
              addresses: [ownerAddr],
              excludeZero: true,
            });
            setBalances(
              assetBalances.map((b: any) => ({
                assetId: b.assetId, // QORT is assetId 0
                name: b.assetName ?? (b.assetId === 0 ? 'QORT' : `Asset #${b.assetId}`),
                balance: Number(b.balance), // normalize later per divisibility
              }))
            );
          }

          // holders
          const raw = await fetchAssetHolders({
            assetId: id,
            limit: 5000,
            ordering: 'ASSET_BALANCE_ACCOUNT',
            excludeZero: true,
          });

          // enrich with names
          const nameMap = await resolveNames(raw.map((r) => r.address));
          const withNames = raw.map((r) => ({ ...r, name: nameMap.get(r.address) ?? null }));
          withNames.sort((a, b) => b.balance - a.balance);

          // compute totals
          const totalHeld = withNames.reduce((s, r) => s + (r.balance || 0), 0);
          const issuerBalance = ownerAddr
            ? withNames.find((r) => r.address === ownerAddr)?.balance || 0
            : 0;
          const circ = Math.max(0, totalHeld - issuerBalance);

          // exclude issuer and compute % of circulating
          const exIssuer = withNames
            .filter((r) => !ownerAddr || r.address !== ownerAddr)
            .map((r) => ({
              ...r,
              percent: circ > 0 ? (r.balance / circ) * 100 : 0,
            }));

          if (alive) {
            setIssuerBal(issuerBalance);
            setCirculating(circ);
            setRows(exIssuer);
          }
        }, 'blocking:manage:dividends:asset');
      } catch (e: any) {
        if (alive) setError(String(e?.message || e));
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, busyWhile]);

  useEffect(() => {
    if (!balances.length) return;

    // If current selectedAsset is not present in the list, pick the first available
    const exists = balances.some((b) => b.assetId === selectedAsset);
    if (!exists) {
      setSelectedAsset(balances[0].assetId);
    }
  }, [balances, selectedAsset]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: 1100 }}>
      <Stack direction="row" alignItems="center" justifyContent="space-between" sx={{ mb: 2 }}>
        <Typography variant="h4" sx={{ lineHeight: 1.15 }}>
          Dividends — {assetName} (#{id}) By - {userName}
        </Typography>
        <Button component={RouterLink} to="/manage/dividends" variant="text">
          ← Select Different Asset
        </Button>
      </Stack>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loading ? (
        <Paper variant="outlined" sx={{ p: 4, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Paper>
      ) : (
        <Stack spacing={2}>
          <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 2 } }}>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Circulating (not including issuer - only held in user accounts):
            </Typography>
            <Typography>
              Issuer balance: <b>{formatQty(issuerBal, divisible)}</b> {assetName}
            </Typography>
            <Typography>
              Circulating supply: <b>{formatQty(circulating, divisible)}</b> {assetName}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              Percentages below are each holder’s share of the current circulating amount.
            </Typography>
          </Paper>

          <Box
            sx={{
              mb: 2,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 2,
              alignItems: 'center',
              border: 1,
              borderColor: 'divider',
              borderRadius: 1.5,
              p: 2,
              bgcolor: 'background.paper',
            }}
          >
            <Typography variant="body2" sx={{ flexBasis: '100%', opacity: 0.8, mb: 0.5 }}>
              💡 Enter a payout amount to automatically calculate dividend amounts for each holder.
            </Typography>

            <TextField
              type="number"
              label="Payout Amount"
              value={payoutAmount || ''}
              onChange={(e) => setPayoutAmount(Number(e.target.value) || 0)}
              size="small"
              sx={{
                input: { color: payoutColor, fontWeight: 600 },
                width: 200,
              }}
            />

            {/* <TextField
              select
              label="Asset"
              value={selectedAsset}
              onChange={(e) => setSelectedAsset(Number(e.target.value))}
              size="small"
              sx={{ minWidth: 200 }}
            >
              {balances.map((b) => (
                <MenuItem key={b.assetId} value={b.assetId}>
                  {b.name} — {formatQty(b.balance, true)}
                </MenuItem>
              ))}
            </TextField> */}
            <Select<number>
              labelId="asset-select-label"
              id="asset-select"
              value={selectedAsset}
              onChange={(e: SelectChangeEvent<number>) => setSelectedAsset(Number(e.target.value))}
              size="small"
              sx={{ minWidth: 200 }}
            >
              {balances.map((b) => (
                <MenuItem key={b.assetId} value={b.assetId}>
                  {b.name} — {formatQty(b.balance, true)}
                </MenuItem>
              ))}
            </Select>

            {balanceError && (
              <Typography color="error" variant="body2">
                {balanceError}
              </Typography>
            )}
          </Box>

          <Paper
            variant="outlined"
            sx={{
              p: { xs: 1.25, sm: 2 },
              boxShadow: payoutAmount > 0 ? 4 : 1,
              borderColor: payoutAmount > 0 ? payoutColor : 'divider',
              transition: 'all 0.25s ease',
            }}
          >
            {/* header */}
            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr auto auto auto', sm: 'auto 1fr auto auto auto' },
                columnGap: 1,
                px: 1,
                fontSize: 12,
                color: 'text.secondary',
                fontVariantNumeric: 'tabular-nums',
                mb: 0.5,
              }}
            >
              <Box sx={{ display: { xs: 'none', sm: 'block' } }}>#</Box>
              <Box>Account</Box>
              <Box sx={{ textAlign: 'right' }}>{assetName} Amount</Box>
              <Box sx={{ textAlign: 'right' }}>% Circulating</Box>
              <Box sx={{ textAlign: 'right' }}>Payout</Box>
            </Box>

            <Box sx={{ display: 'grid', gap: 0.25 }}>
              {payouts.map((r, idx) => {
                const rank = idx + 1;
                const label = r.name ? r.name : r.address.slice(0, 8) + '…' + r.address.slice(-6);

                return (
                  <Box
                    key={`${r.address}-${idx}`}
                    sx={{
                      display: 'grid',
                      gridTemplateColumns: {
                        xs: '1fr auto auto auto',
                        sm: 'auto 1fr auto auto auto',
                      },
                      columnGap: 1,
                      alignItems: 'center',
                      px: 1,
                      py: 0.5,
                      borderRadius: 0.75,
                      fontVariantNumeric: 'tabular-nums',
                      border: 1,
                      borderColor: 'divider',
                    }}
                  >
                    <Box sx={{ display: { xs: 'none', sm: 'block' } }}>{rank}</Box>
                    <Box
                      sx={{
                        minWidth: 0,
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {label}
                    </Box>
                    <Box sx={{ textAlign: 'right', fontWeight: 700 }}>
                      {formatQty(r.balance, divisible)}
                    </Box>
                    <Box sx={{ textAlign: 'right', fontWeight: 700 }}>{r.percent.toFixed(6)}%</Box>
                    <Box
                      sx={{
                        textAlign: 'right',
                        fontWeight: 700,
                        color: payoutAmount > 0 ? payoutColor : 'text.secondary',
                        transition: 'color 0.2s ease',
                      }}
                    >
                      {payoutAmount > 0 ? formatQty(r.payout, divisible) : '—'}
                    </Box>
                  </Box>
                );
              })}
            </Box>

            <Divider sx={{ my: 1.5 }} />

            <Box
              sx={{
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: '1fr auto auto' },
                gap: 1,
                alignItems: 'center',
              }}
            >
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                Totals shown in <b>{prettyAsset}</b>.
              </Typography>

              <Typography variant="body2" sx={{ textAlign: { xs: 'left', sm: 'right' } }}>
                Available: <b>{formatQty(issuerAssetBalance, true)}</b>
              </Typography>

              <Typography
                variant="body2"
                sx={{
                  textAlign: { xs: 'left', sm: 'right' },
                  fontWeight: 700,
                  color: payoutAmount > 0 ? payoutColor : 'text.secondary',
                }}
              >
                Total planned: <b>{formatQty(totalPlanned, true)}</b>
              </Typography>
            </Box>

            {payoutAmount > 0 && Math.abs(totalDelta) > 1e-8 && (
              <Typography variant="caption" sx={{ color: 'warning.main' }}>
                Note: planned total differs from input by {formatQty(totalDelta, true)} due to
                floating math. We’ll resolve this with atomic (8-dp) rounding in the send step.
              </Typography>
            )}
            {sending && (
              <Box sx={{ mt: 1, display: 'flex', gap: 2, alignItems: 'center', flexWrap: 'wrap' }}>
                <Typography variant="body2">
                  Progress: <b>{sentOk + sentFail}</b> /{' '}
                  <b>{payouts.filter((p) => p.payoutAtomic > 0).length}</b>
                  {currentIdx >= 0 ? ` (sending ${currentIdx + 1})` : ''}
                </Typography>
                <Typography variant="body2">
                  OK: <b>{sentOk}</b>
                </Typography>
                <Typography variant="body2">
                  Failed: <b>{sentFail}</b>
                </Typography>
                {lastError && (
                  <Typography variant="body2" color="warning.main">
                    {lastError}
                  </Typography>
                )}
                <Button
                  size="small"
                  variant="outlined"
                  color="warning"
                  onClick={() => {
                    abortRef.current = true;
                  }}
                >
                  Cancel
                </Button>
              </Box>
            )}

            <Box sx={{ mt: 1, display: 'flex', justifyContent: 'flex-end', gap: 1 }}>
              <Button component={RouterLink} to={`/assetdata/${id}`} variant="outlined">
                View on Asset Data
              </Button>
              <Button
                variant="contained"
                disabled={
                  sending ||
                  !payoutAmount ||
                  !!balanceError ||
                  circulating === 0 ||
                  totalPlanned <= 0 ||
                  totalPlanned > issuerAssetBalance
                }
                onClick={issueDividends}
              >
                {sending ? 'Sending…' : 'Issue Payouts'}
              </Button>
            </Box>
          </Paper>
        </Stack>
      )}
    </Box>
  );
}
