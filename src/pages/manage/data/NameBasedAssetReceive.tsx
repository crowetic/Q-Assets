import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link as RouterLink, useSearchParams } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Paper,
  Stack,
  Typography,
} from '@mui/material';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import WarningAmberRoundedIcon from '@mui/icons-material/WarningAmberRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import type { QdnResource } from '../../../hooks/useQdnResources';
import { useAlert } from '../../../components/alerts';
import BusyButton from '../../../components/common/BusyButton';
import {
  createBuyNameTransactionWithRetry,
  fetchNbaTransferPackage,
  findTransferTransaction,
  hasUnconfirmedBuyNameTransaction,
  hasUnconfirmedSellNameTransaction,
  processSignedTransaction,
  resolveTransferOwnershipState,
  searchTransferPackagesForRecipient,
  signTransaction,
  type NbaTransferOwnershipState,
  type NbaTransferPackage,
} from '../../../utils/nbaTransfers';

type LoadedTransferPackage = {
  resource: QdnResource;
  package: NbaTransferPackage;
  ownership: NbaTransferOwnershipState;
};

type CompletionSubmission = {
  entry: LoadedTransferPackage;
  submittedAt: number;
  status: 'submitted' | 'unconfirmed' | 'confirmed';
  confirmedAt?: number;
};

const getPackageLabel = (entry: LoadedTransferPackage) =>
  `${entry.package.transferName} • ${entry.package.amount} QORT`;

const BUY_RETRY_TIMEOUT_MS = 300_000;
const sleep = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms));

export default function NameBasedAssetReceive() {
  const { alert, confirm } = useAlert();
  const [searchParams] = useSearchParams();
  const {
    address: userAddress,
    publicKey: userPublicKey,
    authenticateUser,
  } = useAuth() as {
    address?: string | null;
    publicKey?: string | null;
    authenticateUser?: () => Promise<void>;
  };

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [packages, setPackages] = useState<LoadedTransferPackage[]>([]);
  const [completionSubmissions, setCompletionSubmissions] = useState<CompletionSubmission[]>([]);
  const [selectedIdentifier, setSelectedIdentifier] = useState<string | null>(
    searchParams.get('identifier')
  );
  const [completing, setCompleting] = useState(false);

  useEffect(() => {
    if (!userAddress && typeof authenticateUser === 'function') {
      authenticateUser().catch(() => undefined);
    }
  }, [authenticateUser, userAddress]);

  const loadPackages = useCallback(async () => {
    if (!userAddress) {
      setPackages([]);
      return;
    }
    setLoading(true);
    setStatus(null);
    try {
      const hits = await searchTransferPackagesForRecipient(userAddress);
      const loaded = await Promise.all(
        hits.map(async (hit) => {
          const resource: QdnResource = {
            name: hit.name,
            service: hit.service,
            identifier: hit.identifier,
            created: hit.created,
            updated: hit.updated,
          };
          try {
            const pkg = await fetchNbaTransferPackage(resource);
            if (pkg?.transferee?.address !== userAddress) return null;
            const ownership = await resolveTransferOwnershipState(pkg);
            return { resource, package: pkg, ownership } as LoadedTransferPackage;
          } catch {
            return null;
          }
        })
      );
      const valid = loaded.filter(Boolean) as LoadedTransferPackage[];
      setPackages(valid);
      const firstPending =
        valid.find(
          (entry) => entry.ownership.state !== 'transferee' && entry.ownership.state !== 'other'
        )?.package.packageIdentifier || null;
      setSelectedIdentifier(
        (prev) => prev || firstPending || valid[0]?.package.packageIdentifier || null
      );
    } catch (err: any) {
      setStatus(err?.message || 'Unable to load NBA transfer packages.');
    } finally {
      setLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    void loadPackages();
  }, [loadPackages]);

  const submissionIds = useMemo(
    () => new Set(completionSubmissions.map((entry) => entry.entry.package.packageIdentifier)),
    [completionSubmissions]
  );

  const allEntries = useMemo(() => {
    const byIdentifier = new Map<string, LoadedTransferPackage>();
    packages.forEach((entry) => {
      byIdentifier.set(entry.package.packageIdentifier, entry);
    });
    completionSubmissions.forEach((entry) => {
      byIdentifier.set(entry.entry.package.packageIdentifier, entry.entry);
    });
    return Array.from(byIdentifier.values());
  }, [completionSubmissions, packages]);

  const selectedPackage = useMemo(
    () =>
      allEntries.find((entry) => entry.package.packageIdentifier === selectedIdentifier) ||
      allEntries[0] ||
      null,
    [allEntries, selectedIdentifier]
  );

  const selectedSubmission = useMemo(
    () =>
      completionSubmissions.find(
        (entry) => entry.entry.package.packageIdentifier === selectedIdentifier
      ) || null,
    [completionSubmissions, selectedIdentifier]
  );

  const pendingPackages = useMemo(
    () =>
      packages.filter(
        (entry) =>
          !submissionIds.has(entry.package.packageIdentifier) &&
          entry.ownership.state !== 'transferee' &&
          entry.ownership.state !== 'other'
      ),
    [packages, submissionIds]
  );

  const resolvedPackages = useMemo(
    () =>
      packages.filter(
        (entry) =>
          !submissionIds.has(entry.package.packageIdentifier) &&
          (entry.ownership.state === 'transferee' || entry.ownership.state === 'other')
      ),
    [packages, submissionIds]
  );

  useEffect(() => {
    const active = completionSubmissions.filter((entry) => entry.status !== 'confirmed');
    if (!active.length || !userPublicKey) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      const next = await Promise.all(
        active.map(async (submission) => {
          const [confirmedBuy, ownership, unconfirmedBuy] = await Promise.all([
            findTransferTransaction({
              transfer: submission.entry.package,
              type: 'BUY_NAME',
              confirmationStatus: 'CONFIRMED',
              maxPages: 1,
              pageSize: 20,
            }),
            resolveTransferOwnershipState(submission.entry.package),
            hasUnconfirmedBuyNameTransaction({
              transfer: submission.entry.package,
              creatorPublicKey: userPublicKey,
              limit: 20,
            }).catch(() => false),
          ]);

          if (ownership.state === 'transferee' || confirmedBuy) {
            return {
              ...submission,
              entry: { ...submission.entry, ownership },
              status: 'confirmed' as const,
              confirmedAt: submission.confirmedAt || Date.now(),
            };
          }

          return {
            ...submission,
            entry: { ...submission.entry, ownership },
            status: unconfirmedBuy ? ('unconfirmed' as const) : ('submitted' as const),
          };
        })
      );

      if (cancelled) return;

      setCompletionSubmissions((prev) =>
        prev.map((entry) => {
          const updated = next.find(
            (candidate) =>
              candidate.entry.package.packageIdentifier === entry.entry.package.packageIdentifier
          );
          return updated || entry;
        })
      );
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [completionSubmissions, userPublicKey]);

  const handleCompleteTransfer = useCallback(async () => {
    if (!selectedPackage) {
      setStatus('Select a transfer package first.');
      return;
    }
    if (!userAddress) {
      setStatus('Authenticate the transferee account before completing the transfer.');
      return;
    }
    if (!selectedPackage.package.transferor.publicKey) {
      setStatus(
        'The transfer package is missing the transferor public key required for sell monitoring.'
      );
      return;
    }
    const buyerPublicKey =
      typeof userPublicKey === 'string' && userPublicKey
        ? userPublicKey
        : (await qortalRequest({ action: 'GET_USER_ACCOUNT' }))?.publicKey;
    if (!buyerPublicKey) {
      setStatus('Unable to resolve the transferee public key.');
      return;
    }

    const acknowledged = await confirm(
      [
        'Completing this transfer will process the seller signed transaction first.',
        '',
        'Q-Assets will then keep watching the seller unconfirmed transactions.',
        'Every time the sell transaction is no longer shown as unconfirmed, Q-Assets will try to create your buy-name transaction and ask you to sign it immediately.',
        '',
        'If a re-org causes the sell to return to unconfirmed, Q-Assets will keep waiting and then try the buyer flow again the next time it disappears.',
        '',
        'WARNING:',
        'THE PROCESS WILL KEEP ATTEMPTING TO PLACE THE FINAL BUY ORDER UNTIL IT SUCCEEDS.',
        'THIS MEANS YOU MAY HAVE TO APPROVE MORE THAN ONCE.',
        'DO NOT WALK AWAY OR STOP PAYING ATTENTION UNTIL IT SAYS IT WAS COMPLETED.',
        '',
        'This cannot be undone.',
      ].join('\n'),
      'Complete NBA transfer?',
      { severity: 'warning', confirmText: 'Complete transfer' }
    );
    if (!acknowledged) return;

    setCompleting(true);
    setStatus('Processing seller signed transaction...');

    try {
      try {
        await processSignedTransaction(selectedPackage.package.sellerSignedTransaction);
      } catch {
        setStatus(
          'Seller transaction may already be submitted. Continuing to watch seller unconfirmed state...'
        );
      }

      const buyDeadline = Date.now() + BUY_RETRY_TIMEOUT_MS;
      let attempt = 0;
      let completed = false;

      while (Date.now() < buyDeadline && !completed) {
        const alreadyBought = await findTransferTransaction({
          transfer: selectedPackage.package,
          type: 'BUY_NAME',
          confirmationStatus: 'CONFIRMED',
          maxPages: 1,
          pageSize: 20,
        });
        if (alreadyBought) {
          completed = true;
          break;
        }

        const sellStillUnconfirmed = await hasUnconfirmedSellNameTransaction({
          transfer: selectedPackage.package,
          creatorPublicKey: selectedPackage.package.transferor.publicKey,
          limit: 20,
        });
        if (sellStillUnconfirmed) {
          setStatus(
            'Seller transaction is currently unconfirmed. Waiting for it to disappear from unconfirmed before trying the buyer transaction...'
          );
          await sleep(1_000);
          continue;
        }

        attempt += 1;
        setStatus(
          `Sell is not shown as unconfirmed. Attempting buyer transaction ${attempt} now...`
        );
        let unsignedBuyTx: string;

        try {
          unsignedBuyTx = await createBuyNameTransactionWithRetry(
            {
              buyerAddress: userAddress,
              buyerPublicKey,
              sellerAddress: selectedPackage.package.transferor.address,
              name: selectedPackage.package.transferName,
              amount: selectedPackage.package.amount,
            },
            {
              timeoutMs: 4_000,
              retryIntervalMs: 400,
              onRetry: () =>
                setStatus(
                  `Buyer transaction attempt ${attempt} is not creatable yet. Continuing to watch seller state...`
                ),
            }
          );
        } catch {
          setStatus(
            `Buyer transaction attempt ${attempt} could not be created yet. Continuing to watch seller state...`
          );
          await sleep(1_000);
          continue;
        }

        setStatus(
          `Buyer transaction attempt ${attempt} created. Approve the signature prompt immediately...`
        );
        const signedBuyTx = await signTransaction(unsignedBuyTx);

        try {
          setStatus(`Processing buyer transaction attempt ${attempt} now...`);
          await processSignedTransaction(signedBuyTx);
          completed = true;
          break;
        } catch {
          const confirmedBuy = await findTransferTransaction({
            transfer: selectedPackage.package,
            type: 'BUY_NAME',
            confirmationStatus: 'CONFIRMED',
            maxPages: 1,
            pageSize: 20,
          });
          if (confirmedBuy) {
            completed = true;
            break;
          }

          setStatus(
            `Buyer transaction attempt ${attempt} did not complete. Continuing to watch seller state and retry...`
          );
          await sleep(1_000);
        }
      }

      if (!completed) {
        throw new Error(
          'WARNING: seller transaction is on-chain, but the buyer transaction did not complete inside the retry window. Stay on this page and try again immediately.'
        );
      }

      const submittedAt = Date.now();
      setStatus('Buyer transaction submitted successfully. Waiting for blockchain confirmation...');
      setCompletionSubmissions((prev) => [
        {
          entry: selectedPackage,
          submittedAt,
          status: 'submitted',
        },
        ...prev.filter(
          (entry) =>
            entry.entry.package.packageIdentifier !== selectedPackage.package.packageIdentifier
        ),
      ]);
      setPackages((prev) =>
        prev.filter(
          (entry) => entry.package.packageIdentifier !== selectedPackage.package.packageIdentifier
        )
      );
      await alert(
        `The buyer transaction for ${selectedPackage.package.transferName} was submitted. Q-Assets will keep checking until it confirms.`,
        'NBA buy submitted',
        { severity: 'success' }
      );
    } catch (err: any) {
      setStatus(err?.message || 'Unable to complete the transfer.');
    } finally {
      setCompleting(false);
    }
  }, [alert, confirm, selectedPackage, userAddress, userPublicKey]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: '1100px' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" sx={{ lineHeight: 1.1 }}>
            Receive NBA
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Review transfer packages addressed to you and complete the final name handoff.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1}>
          <Button
            component={RouterLink}
            to="/manage/data/name-assets/transfer"
            variant="contained"
            color="secondary"
            size="large"
            startIcon={<SendRoundedIcon />}
            sx={{
              minHeight: 52,
              px: 2.25,
              fontWeight: 700,
              boxShadow: 4,
              whiteSpace: 'nowrap',
            }}
          >
            Send NBA
          </Button>
          <Button component={RouterLink} to="/manage/data" variant="text">
            ← Back to Data Management
          </Button>
        </Stack>
      </Stack>

      <Stack spacing={2}>
        <Alert severity="warning" icon={<WarningAmberRoundedIcon fontSize="inherit" />}>
          {
            'Review each transfer package carefully. Completing a transfer processes the seller signed sell-name transaction first and then keeps retrying the buyer flow until it sticks or the retry window expires. THE PROCESS WILL KEEP ATTEMPTING TO PLACE THE FINAL BUY ORDER UNTIL IT SUCCEEDS. THIS MEANS YOU MAY HAVE TO APPROVE MORE THAN ONCE. DO NOT WALK AWAY OR STOP PAYING ATTENTION UNTIL IT SAYS IT WAS COMPLETED.'
          }
        </Alert>

        <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
          <Stack
            direction={{ xs: 'column', md: 'row' }}
            spacing={1.5}
            alignItems={{ xs: 'flex-start', md: 'center' }}
            justifyContent="space-between"
          >
            <Box>
              <Typography variant="h6">Transfer Inbox</Typography>
              <Typography variant="body2" color="text.secondary">
                Packages are discovered by searching recipient-targeted NBA transfer identifiers and
                decrypting only the ones addressed to your account.
              </Typography>
            </Box>
            <Button
              startIcon={<RefreshRoundedIcon />}
              onClick={() => void loadPackages()}
              disabled={loading}
            >
              Refresh inbox
            </Button>
          </Stack>

          {status && (
            <Alert
              severity={status.toLowerCase().includes('warning') ? 'warning' : 'info'}
              sx={{ mt: 2 }}
            >
              {status}
            </Alert>
          )}

          {loading ? (
            <Stack direction="row" spacing={1.25} alignItems="center" sx={{ mt: 2 }}>
              <CircularProgress size={20} />
              <Typography variant="body2" color="text.secondary">
                Loading transfer packages…
              </Typography>
            </Stack>
          ) : pendingPackages.length === 0 ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
              No actionable NBA transfer packages were found for the active account.
            </Typography>
          ) : (
            <Stack spacing={1.25} sx={{ mt: 2 }}>
              {pendingPackages.map((entry) => (
                <Paper
                  key={entry.package.packageIdentifier}
                  variant="outlined"
                  onClick={() => setSelectedIdentifier(entry.package.packageIdentifier)}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    cursor: 'pointer',
                    borderColor:
                      selectedPackage?.package.packageIdentifier === entry.package.packageIdentifier
                        ? 'primary.main'
                        : 'divider',
                    bgcolor:
                      selectedPackage?.package.packageIdentifier === entry.package.packageIdentifier
                        ? 'action.selected'
                        : 'background.paper',
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                  >
                    <Box>
                      <Typography variant="body1">{getPackageLabel(entry)}</Typography>
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}
                        color="text.secondary"
                      >
                        {entry.package.packageIdentifier}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip size="small" label={`${entry.package.amount} QORT`} color="warning" />
                      <Chip
                        size="small"
                        label={entry.package.transferor.name || entry.package.transferor.address}
                      />
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          )}
        </Paper>

        {completionSubmissions.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Stack spacing={1.25}>
              <Typography variant="h6">Received NBA History</Typography>
              <Typography variant="body2" color="text.secondary">
                Recent receive submissions are displayed here after they are submitted. Confirmation
                status updates automatically.
              </Typography>

              {completionSubmissions.map((entry) => (
                <Paper
                  key={`${entry.entry.package.packageIdentifier}-completion`}
                  variant="outlined"
                  onClick={() => setSelectedIdentifier(entry.entry.package.packageIdentifier)}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    cursor: 'pointer',
                    borderColor:
                      entry.status === 'confirmed'
                        ? 'success.main'
                        : entry.status === 'unconfirmed'
                          ? 'warning.main'
                          : 'info.main',
                    bgcolor:
                      selectedPackage?.package.packageIdentifier ===
                      entry.entry.package.packageIdentifier
                        ? 'action.selected'
                        : 'background.paper',
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                  >
                    <Box>
                      <Typography variant="body1">{getPackageLabel(entry.entry)}</Typography>
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}
                        color="text.secondary"
                      >
                        {entry.entry.package.packageIdentifier}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        color={
                          entry.status === 'confirmed'
                            ? 'success'
                            : entry.status === 'unconfirmed'
                              ? 'warning'
                              : 'info'
                        }
                        label={
                          entry.status === 'confirmed'
                            ? 'Confirmed'
                            : entry.status === 'unconfirmed'
                              ? 'Unconfirmed'
                              : 'Submitted'
                        }
                      />
                      <Chip
                        size="small"
                        variant="outlined"
                        label={`Submitted ${new Date(entry.submittedAt).toLocaleTimeString()}`}
                      />
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Paper>
        )}

        {resolvedPackages.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Stack spacing={1.25}>
              <Typography variant="h6">Resolved Transfers</Typography>
              <Typography variant="body2" color="text.secondary">
                These transfer packages are no longer actionable because the name is already owned
                by the intended transferee or by another account.
              </Typography>

              {resolvedPackages.map((entry) => (
                <Paper
                  key={`${entry.package.packageIdentifier}-resolved`}
                  variant="outlined"
                  onClick={() => setSelectedIdentifier(entry.package.packageIdentifier)}
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    cursor: 'pointer',
                    borderColor:
                      entry.ownership.state === 'other'
                        ? 'error.main'
                        : selectedPackage?.package.packageIdentifier ===
                            entry.package.packageIdentifier
                          ? 'primary.main'
                          : 'divider',
                    bgcolor:
                      selectedPackage?.package.packageIdentifier === entry.package.packageIdentifier
                        ? 'action.selected'
                        : 'background.paper',
                  }}
                >
                  <Stack
                    direction={{ xs: 'column', md: 'row' }}
                    spacing={1}
                    justifyContent="space-between"
                  >
                    <Box>
                      <Typography variant="body1">{getPackageLabel(entry)}</Typography>
                      <Typography
                        variant="caption"
                        sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}
                        color="text.secondary"
                      >
                        {entry.package.packageIdentifier}
                      </Typography>
                    </Box>
                    <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                      <Chip
                        size="small"
                        color={entry.ownership.state === 'other' ? 'error' : 'success'}
                        label={entry.ownership.state === 'other' ? 'Intercepted?' : 'Completed'}
                      />
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Paper>
        )}

        {selectedPackage && (
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Stack spacing={1.5}>
              <Stack direction="row" spacing={1} alignItems="center">
                <DownloadRoundedIcon color="primary" />
                <Typography variant="h6">Selected Transfer Package</Typography>
              </Stack>

              <Typography variant="body2">
                Name: <strong>{selectedPackage.package.transferName}</strong>
              </Typography>
              <Typography variant="body2">
                Transferor:{' '}
                <strong>
                  {selectedPackage.package.transferor.name ||
                    selectedPackage.package.transferor.address}
                </strong>
              </Typography>
              <Typography variant="body2">
                Required sell price: <strong>{selectedPackage.package.amount} QORT</strong>
              </Typography>
              {selectedPackage.package.note && (
                <Alert severity="info">{selectedPackage.package.note}</Alert>
              )}
              {selectedPackage.package.reencryptedResources?.length ? (
                <Alert severity="success">
                  This transfer package includes{' '}
                  {selectedPackage.package.reencryptedResources.length} re-encrypted resource
                  {selectedPackage.package.reencryptedResources.length === 1 ? '' : 's'} prepared
                  for the new owner.
                </Alert>
              ) : (
                <Alert severity="info">
                  No private resources were re-encrypted as part of this transfer package.
                </Alert>
              )}

              {selectedPackage.ownership.state === 'transferee' && (
                <Alert severity="success">
                  This transfer is already completed. The name is currently owned by your account.
                </Alert>
              )}

              {selectedSubmission && selectedSubmission.status !== 'confirmed' && (
                <Alert severity={selectedSubmission.status === 'unconfirmed' ? 'warning' : 'info'}>
                  {selectedSubmission.status === 'unconfirmed'
                    ? 'The buyer transaction has been submitted and is currently visible as unconfirmed. Q-Assets will keep checking every few seconds until it confirms.'
                    : 'The buyer transaction was submitted successfully. Q-Assets is checking every few seconds until confirmation appears.'}
                </Alert>
              )}

              {selectedSubmission && selectedSubmission.status === 'confirmed' && (
                <Alert severity="success">
                  The buyer transaction has confirmed.
                  {selectedSubmission.confirmedAt
                    ? ` Confirmed at ${new Date(selectedSubmission.confirmedAt).toLocaleTimeString()}.`
                    : ''}
                </Alert>
              )}

              {selectedPackage.ownership.state === 'other' &&
                selectedPackage.ownership.currentOwnerAddress && (
                  <Alert severity="error">
                    This transfer may have been intercepted. The current owner is{' '}
                    {selectedPackage.ownership.currentOwnerPrimaryName
                      ? `${selectedPackage.ownership.currentOwnerPrimaryName} `
                      : ''}
                    {selectedPackage.ownership.currentOwnerAddress}, which is neither the transferor
                    nor the planned transferee.
                  </Alert>
                )}

              <Alert severity="warning">
                {
                  'The buyer transaction cannot be created until the seller transaction already exists on-chain. Q-Assets will process the seller transaction first, then keep watching the transferor unconfirmed transactions. Every time the sell transaction disappears from unconfirmed, Q-Assets will try the buyer flow again until it succeeds or the retry window expires. THE PROCESS WILL KEEP ATTEMPTING TO PLACE THE FINAL BUY ORDER UNTIL IT SUCCEEDS. THIS MEANS YOU MAY HAVE TO APPROVE MORE THAN ONCE. DO NOT WALK AWAY OR STOP PAYING ATTENTION UNTIL IT SAYS IT WAS COMPLETED.'
                }
              </Alert>

              {!selectedSubmission &&
                selectedPackage.ownership.state !== 'transferee' &&
                selectedPackage.ownership.state !== 'other' && (
                  <BusyButton
                    variant="contained"
                    onClick={() => void handleCompleteTransfer()}
                    loading={completing}
                  >
                    Complete transfer
                  </BusyButton>
                )}
            </Stack>
          </Paper>
        )}
      </Stack>
    </Box>
  );
}
