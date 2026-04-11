import { useCallback, useEffect, useMemo, useState } from 'react';
import { objectToBase64, useAuth, type Service } from 'qapp-core';
import { Link as RouterLink } from 'react-router-dom';
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Divider,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Paper,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material';
import VpnKeyRoundedIcon from '@mui/icons-material/VpnKeyRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
import SendRoundedIcon from '@mui/icons-material/SendRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import AutorenewRoundedIcon from '@mui/icons-material/AutorenewRounded';
import InfoOutlinedIcon from '@mui/icons-material/InfoOutlined';
import DownloadRoundedIcon from '@mui/icons-material/DownloadRounded';
import CancelScheduleSendRoundedIcon from '@mui/icons-material/CancelScheduleSendRounded';
import type { QdnResource } from '../../../hooks/useQdnResources';
import { useQdnResources } from '../../../hooks/useQdnResources';
import { useActiveAccountName } from '../../../hooks/useActiveAccountName';
import { useResolveResourceBase64 } from './hooks/useResolveResourceBase64';
import { useQdnBatchPublisher } from '../../../utils/useQdnBatchPublisher';
import { useAlert } from '../../../components/alerts';
import {
  getAccountGroups,
  getNameDataCached,
  getPrimaryNameCached,
} from '../../../utils/qortalApi';
import type { GroupSummary } from '../../../utils/qortalApi';
import { collectRecipientPublicKeys } from '../../../utils/qdeckAccess';
import { resolvePublisherAddress, looksLikeAddress } from '../../../utils/newsHelpers';
import {
  buildEncryptionTagSet,
  getEncryptionInfo,
  resourceIsPrivate,
} from '../../../utils/qdnEncryption';
import { inferStructuredMeta, isShareResource } from '../../../utils/qdnResourceUtils';
import { filterUserTags } from '../../../utils/qdnTags';
import type { NotificationRecipient } from '../../../utils/notificationRecipients';
import { sendQmailNotifications } from '../../../utils/qmailNotifications';
import {
  NBA_TRANSFER_PACKAGE_SERVICE,
  NBA_TRANSFER_TOMBSTONE_BASE64,
  buildNbaTransferIdentifier,
  buildNbaTransferQmailMessage,
  createSellNameTransaction,
  findConfirmedTransferPackagePublish,
  hasUnconfirmedTransferPackagePublish,
  loadNbaTransferHistory,
  signTransaction,
  type NbaTransferHistoryItem,
  type NbaTransferPackage,
} from '../../../utils/nbaTransfers';
import BusyButton from '../../../components/common/BusyButton';

declare function qortalRequest<T = any>(request: any): Promise<T>;

type ResolvedTransferTarget = {
  input: string;
  address: string;
  name?: string;
};

type CreatedTransferState = {
  packageIdentifier: string;
  packagePublisherName: string;
  publisherPublicKey: string;
  transferName: string;
  amount: number;
  transferee: ResolvedTransferTarget;
  reencryptedResources: Array<{
    service: string;
    identifier: string;
    path?: string | null;
  }>;
};

type ReEncryptionMode = 'new-owner-rights' | 'full-ownership-transfer';

type TransferPackageSubmission = {
  transfer: CreatedTransferState;
  submittedAt: number;
  status: 'submitted' | 'unconfirmed' | 'confirmed';
  confirmedAt?: number;
};

const getResourceKey = (resource: QdnResource) =>
  `${resource.service || '—'}::${resource.identifier}`;

const formatBytes = (n?: number) => {
  if (!n && n !== 0) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = n;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[unit]}`;
};

const formatTs = (ts?: number) => {
  if (!ts) return '—';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return String(ts);
  }
};

const getResourcePath = (resource: QdnResource) => {
  const structured = inferStructuredMeta(resource);
  return structured?.folderSegments?.join('/') || '';
};

const getResourceFileName = (resource: QdnResource) => {
  const structured = inferStructuredMeta(resource);
  return structured?.fileName || '';
};

const getResourceDescription = (resource: QdnResource) =>
  typeof resource.metadata?.description === 'string' ? resource.metadata.description : undefined;

const getResourceTitle = (resource: QdnResource) =>
  typeof resource.metadata?.title === 'string' ? resource.metadata.title : resource.identifier;

const parseAmount = (value: string) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
};

const MISSING_TRANSFEREE_PUBLIC_KEY_MESSAGE =
  'The receiving account does not appear to have an on-chain public key yet. A Qortal account must have at least one outbound transaction before its public key can be used for NBA transfer encryption.';

const getHistoryStatusLabel = (status: NbaTransferHistoryItem['status']) => {
  switch (status) {
    case 'intercepted':
      return 'Intercepted?';
    case 'completed':
      return 'Completed';
    case 'sell-only':
      return 'Sell Processed Only';
    case 'buy-only':
      return 'Buy Detected';
    default:
      return 'Pending';
  }
};

const getHistoryStatusColor = (
  status: NbaTransferHistoryItem['status']
): 'default' | 'success' | 'warning' | 'info' | 'error' => {
  switch (status) {
    case 'intercepted':
      return 'error';
    case 'completed':
      return 'success';
    case 'sell-only':
      return 'warning';
    case 'buy-only':
      return 'info';
    default:
      return 'default';
  }
};

const getHistoryStatusText = (item: NbaTransferHistoryItem) => {
  switch (item.status) {
    case 'intercepted':
      return `This transfer may have been intercepted. The current owner is ${
        item.ownership.currentOwnerPrimaryName ? `${item.ownership.currentOwnerPrimaryName} ` : ''
      }${item.ownership.currentOwnerAddress || 'unknown'}, which is neither the planned transferee nor the transferor.`;
    case 'completed':
      return item.ownership.state === 'transferee'
        ? 'The name is currently owned by the planned transferee, so this transfer is treated as completed.'
        : 'Matching sell and buy transactions were both found for this transfer.';
    case 'sell-only':
      return 'The sell transaction appears to have been processed, but the matching buy transaction has not been detected yet.';
    case 'buy-only':
      return 'A matching buy transaction was detected, but the related sell transaction could not be matched from history.';
    default:
      return 'The transfer package exists, but no matching on-chain sell or buy transactions have been detected yet.';
  }
};

function ResourceSummaryCard({
  resource,
  selected,
  onSelect,
}: {
  resource: QdnResource;
  selected: boolean;
  onSelect: (resource: QdnResource) => void;
}) {
  const info = getEncryptionInfo(resource);
  const path = getResourcePath(resource);
  const fileName = getResourceFileName(resource);

  return (
    <Paper
      variant="outlined"
      onClick={() => onSelect(resource)}
      sx={{
        p: 1.5,
        borderRadius: 2,
        cursor: 'pointer',
        borderColor: selected ? 'primary.main' : 'divider',
        bgcolor: selected ? 'action.selected' : 'background.paper',
      }}
    >
      <Stack spacing={1}>
        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap alignItems="center">
          <Chip size="small" label={resource.service || '—'} />
          <Chip
            size="small"
            color={
              info.mode === 'group' ? 'warning' : info.mode === 'direct' ? 'secondary' : 'default'
            }
            label={
              info.mode === 'group'
                ? `Group${info.groupId ? ` ${info.groupId}` : ''}`
                : info.mode === 'direct'
                  ? 'Direct encrypted'
                  : 'Private'
            }
          />
        </Stack>

        <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
          {resource.identifier}
        </Typography>

        {(path || fileName) && (
          <Typography variant="caption" color="text.secondary">
            {path ? `Path: ${path}` : 'No folder path'} {fileName ? `• File: ${fileName}` : ''}
          </Typography>
        )}

        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
          <Typography variant="caption" color="text.secondary">
            {formatBytes(resource.size)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            Updated {formatTs(resource.updated || resource.created)}
          </Typography>
        </Stack>
      </Stack>
    </Paper>
  );
}

export default function NameBasedAssetData() {
  const { alert, confirm } = useAlert();
  const {
    address: userAddress,
    publicKey: userPublicKey,
    authenticateUser,
  } = useAuth() as {
    address?: string | null;
    publicKey?: string | null;
    authenticateUser?: () => Promise<void>;
  };
  const { activeName, availableNames, namesLoading, namesError } = useActiveAccountName();
  const [transferName, setTransferName] = useState<string | null>(null);
  const { rows, loading, error, reload, hasMore, loadMore, loadAll } =
    useQdnResources(transferName);
  const { publish } = useQdnBatchPublisher();

  const [groups, setGroups] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [groupsError, setGroupsError] = useState<string | null>(null);
  const resolveResourceBase64 = useResolveResourceBase64(groups);

  const [recipientInput, setRecipientInput] = useState('');
  const [resolvedTarget, setResolvedTarget] = useState<ResolvedTransferTarget | null>(null);
  const [resolvingTarget, setResolvingTarget] = useState(false);
  const [amountInput, setAmountInput] = useState('0.01');
  const [transferNote, setTransferNote] = useState('');
  const [publishWithActiveName, setPublishWithActiveName] = useState(false);
  const [reEncryptPrivateData, setReEncryptPrivateData] = useState(false);
  const [reEncryptionMode, setReEncryptionMode] = useState<ReEncryptionMode>('new-owner-rights');
  const [serviceFilter, setServiceFilter] = useState('ALL');
  const [manualQuery, setManualQuery] = useState('');
  const [selectedResourceKey, setSelectedResourceKey] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [creatingTransfer, setCreatingTransfer] = useState(false);
  const [createdTransfer, setCreatedTransfer] = useState<CreatedTransferState | null>(null);
  const [packageSubmissions, setPackageSubmissions] = useState<TransferPackageSubmission[]>([]);
  const [historyItems, setHistoryItems] = useState<NbaTransferHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [cancelledIdentifiers, setCancelledIdentifiers] = useState<string[]>([]);
  const [cancelingIdentifier, setCancelingIdentifier] = useState<string | null>(null);
  const [infoOpen, setInfoOpen] = useState(false);

  useEffect(() => {
    if (!userAddress && typeof authenticateUser === 'function') {
      authenticateUser().catch(() => undefined);
    }
  }, [authenticateUser, userAddress]);

  useEffect(() => {
    if (!availableNames.length) {
      setTransferName(null);
      return;
    }
    if (transferName && availableNames.includes(transferName)) return;
    setTransferName(
      activeName && availableNames.includes(activeName) ? activeName : availableNames[0]
    );
  }, [activeName, availableNames, transferName]);

  useEffect(() => {
    let cancelled = false;
    if (!userAddress) {
      setGroups([]);
      setGroupsError(null);
      return;
    }
    setGroupsLoading(true);
    setGroupsError(null);
    getAccountGroups(userAddress)
      .then((next) => {
        if (!cancelled) setGroups(next);
      })
      .catch((err: any) => {
        if (!cancelled) setGroupsError(err?.message || 'Unable to load account groups.');
      })
      .finally(() => {
        if (!cancelled) setGroupsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [userAddress]);

  const privateResources = useMemo(
    () => rows.filter((resource) => resourceIsPrivate(resource) && !isShareResource(resource)),
    [rows]
  );

  const serviceOptions = useMemo(() => {
    const set = new Set<string>();
    privateResources.forEach((resource) => {
      if (resource.service) set.add(resource.service);
    });
    return ['ALL', ...Array.from(set).sort()];
  }, [privateResources]);

  const filteredResources = useMemo(() => {
    const query = manualQuery.trim().toLowerCase();
    return privateResources.filter((resource) => {
      if (serviceFilter !== 'ALL' && resource.service !== serviceFilter) return false;
      if (!query) return true;
      const path = getResourcePath(resource).toLowerCase();
      const fileName = getResourceFileName(resource).toLowerCase();
      const identifier = (resource.identifier || '').toLowerCase();
      const description = (getResourceDescription(resource) || '').toLowerCase();
      return (
        identifier.includes(query) ||
        path.includes(query) ||
        fileName.includes(query) ||
        description.includes(query)
      );
    });
  }, [manualQuery, privateResources, serviceFilter]);

  useEffect(() => {
    if (!filteredResources.length) {
      setSelectedResourceKey(null);
      return;
    }
    if (
      selectedResourceKey &&
      filteredResources.some((resource) => getResourceKey(resource) === selectedResourceKey)
    ) {
      return;
    }
    setSelectedResourceKey(getResourceKey(filteredResources[0]));
  }, [filteredResources, selectedResourceKey]);

  const selectedResource = useMemo(
    () =>
      filteredResources.find((resource) => getResourceKey(resource) === selectedResourceKey) ||
      null,
    [filteredResources, selectedResourceKey]
  );

  const handleResolveTarget = useCallback(async () => {
    const trimmed = recipientInput.trim();
    if (!trimmed) {
      setResolvedTarget(null);
      setStatus('Enter the future owner name or address first.');
      return;
    }
    setResolvingTarget(true);
    setStatus(null);
    try {
      if (looksLikeAddress(trimmed)) {
        const primaryName = await getPrimaryNameCached(trimmed).catch(() => '');
        setResolvedTarget({
          input: trimmed,
          address: trimmed,
          name: primaryName || undefined,
        });
        return;
      }

      const nameData = await getNameDataCached(trimmed);
      const address = nameData?.owner ? String(nameData.owner) : '';
      if (!address) throw new Error('Unable to resolve the owner address for that name.');
      setResolvedTarget({
        input: trimmed,
        address,
        name: typeof nameData?.name === 'string' ? nameData.name : trimmed,
      });
    } catch (err: any) {
      setResolvedTarget(null);
      setStatus(err?.message || 'Unable to resolve the transfer target.');
    } finally {
      setResolvingTarget(false);
    }
  }, [recipientInput]);

  const handleRefreshTransferHistory = useCallback(async () => {
    if (!userAddress) {
      setHistoryItems([]);
      setHistoryError(null);
      return;
    }

    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const next = await loadNbaTransferHistory({
        ownerAddress: userAddress,
        maxPackages: 20,
        maxPublishPages: 4,
        maxTxPages: 4,
        txPageSize: 50,
      });
      setHistoryItems(next);
    } catch (err: any) {
      setHistoryError(err?.message || 'Unable to load previous NBA transfers.');
    } finally {
      setHistoryLoading(false);
    }
  }, [userAddress]);

  useEffect(() => {
    void handleRefreshTransferHistory();
  }, [handleRefreshTransferHistory]);

  useEffect(() => {
    const active = packageSubmissions.filter((entry) => entry.status !== 'confirmed');
    if (!active.length) return;

    let cancelled = false;
    const timeoutId = window.setTimeout(async () => {
      const next = await Promise.all(
        active.map(async (submission) => {
          const [confirmedPublish, unconfirmedPublish] = await Promise.all([
            findConfirmedTransferPackagePublish({
              creatorPublicKey: submission.transfer.publisherPublicKey,
              packageIdentifier: submission.transfer.packageIdentifier,
              packagePublisherName: submission.transfer.packagePublisherName,
              limit: 50,
            }).catch(() => null),
            hasUnconfirmedTransferPackagePublish({
              creatorPublicKey: submission.transfer.publisherPublicKey,
              packageIdentifier: submission.transfer.packageIdentifier,
              packagePublisherName: submission.transfer.packagePublisherName,
              limit: 20,
            }).catch(() => false),
          ]);

          if (confirmedPublish) {
            return {
              ...submission,
              status: 'confirmed' as const,
              confirmedAt: submission.confirmedAt || confirmedPublish.timestamp || Date.now(),
            };
          }

          return {
            ...submission,
            status: unconfirmedPublish ? ('unconfirmed' as const) : ('submitted' as const),
          };
        })
      );

      if (cancelled) return;

      let shouldRefreshHistory = false;
      setPackageSubmissions((prev) =>
        prev.map((entry) => {
          const updated = next.find(
            (candidate) => candidate.transfer.packageIdentifier === entry.transfer.packageIdentifier
          );
          if (!updated) return entry;
          if (entry.status !== 'confirmed' && updated.status === 'confirmed') {
            shouldRefreshHistory = true;
          }
          return updated;
        })
      );
      if (shouldRefreshHistory) {
        void handleRefreshTransferHistory();
      }
    }, 5_000);

    return () => {
      cancelled = true;
      window.clearTimeout(timeoutId);
    };
  }, [handleRefreshTransferHistory, packageSubmissions]);

  const packageSubmissionIds = useMemo(
    () => new Set(packageSubmissions.map((entry) => entry.transfer.packageIdentifier)),
    [packageSubmissions]
  );

  const visibleHistoryItems = useMemo(
    () =>
      historyItems.filter(
        (item) =>
          !cancelledIdentifiers.includes(item.transfer.packageIdentifier) &&
          !packageSubmissionIds.has(item.transfer.packageIdentifier)
      ),
    [cancelledIdentifiers, historyItems, packageSubmissionIds]
  );

  const historySummary = useMemo(() => {
    return visibleHistoryItems.reduce(
      (acc, item) => {
        acc.total += 1;
        if (item.status === 'completed') acc.completed += 1;
        if (item.status === 'pending') acc.pending += 1;
        if (item.status === 'sell-only') acc.sellOnly += 1;
        if (item.status === 'buy-only') acc.buyOnly += 1;
        if (item.status === 'intercepted') acc.intercepted += 1;
        return acc;
      },
      { total: 0, completed: 0, pending: 0, sellOnly: 0, buyOnly: 0, intercepted: 0 }
    );
  }, [visibleHistoryItems]);

  const handleCancelTransferPackage = useCallback(
    async (item: {
      packageIdentifier: string;
      transferName: string;
      packagePublisherName: string;
    }) => {
      const acknowledged = await confirm(
        [
          'WARNING - cancelling a transfer package will make it so that the data is removed from QDN and the transfer package will not display in Q-Assets, however, there is no way to guarantee that the receiver did not decrypt the data and keep the signed transaction, allowing them to publish the name sale in the future without your consent.',
          '',
          'If you are concerned about this possibility, it is recommended to transfer the name to another account as soon as possible.',
          '',
          'Select the name in the transfers section and prepare a transfer package for another account you control (that has at least one outbound tx), then use that account to receive the package as soon as possible!',
        ].join('\n'),
        'Cancel NBA transfer package?',
        {
          severity: 'warning',
          confirmText: 'Cancel package',
          cancelText: 'Keep package',
        }
      );
      if (!acknowledged) return;

      setCancelingIdentifier(item.packageIdentifier);
      setStatus(`Cancelling transfer package ${item.packageIdentifier}...`);

      try {
        await publish([
          {
            name: item.packagePublisherName,
            service: NBA_TRANSFER_PACKAGE_SERVICE,
            identifier: item.packageIdentifier,
            base64: NBA_TRANSFER_TOMBSTONE_BASE64,
            title: `Cancelled NBA transfer package for ${item.transferName}`,
            description: 'Q-Assets tombstone publish for a cancelled NBA transfer package.',
          },
        ]);

        setCancelledIdentifiers((prev) =>
          prev.includes(item.packageIdentifier) ? prev : [...prev, item.packageIdentifier]
        );
        setCreatedTransfer((prev) =>
          prev?.packageIdentifier === item.packageIdentifier ? null : prev
        );
        setPackageSubmissions((prev) =>
          prev.filter((entry) => entry.transfer.packageIdentifier !== item.packageIdentifier)
        );
        setStatus(
          'NBA transfer package cancelled. It may take a moment for all indexes to reflect the tombstone publish.'
        );
        await alert(
          'The NBA transfer package was overwritten with a tombstone payload. Q-Assets will stop showing it, although a transferee who already decrypted the package could still retain the signed sale transaction.',
          'Transfer package cancelled',
          { severity: 'success' }
        );
        await handleRefreshTransferHistory();
      } catch (err: any) {
        const message = err?.message || 'Unable to cancel the transfer package.';
        setStatus(message);
        await alert(message, 'Cancel transfer failed', { severity: 'error' });
      } finally {
        setCancelingIdentifier(null);
      }
    },
    [alert, confirm, handleRefreshTransferHistory, publish]
  );

  const handleCreateTransfer = useCallback(async () => {
    if (!transferName) {
      setStatus('Select a Qortal name before creating a transfer.');
      return;
    }
    if (!userAddress) {
      setStatus('Authenticate the active account before creating a transfer.');
      return;
    }
    if (!resolvedTarget) {
      setStatus('Resolve the future owner before creating the transfer.');
      return;
    }
    const amount = parseAmount(amountInput);
    if (!amount) {
      setStatus('Enter a valid positive sell price.');
      return;
    }
    if (resolvedTarget.address === userAddress) {
      setStatus('The transferee must be a different account.');
      return;
    }
    if (reEncryptPrivateData && !selectedResource) {
      setStatus('Choose a private resource to re-encrypt, or disable the re-encrypt option.');
      return;
    }

    setCreatingTransfer(true);
    setStatus(
      reEncryptPrivateData
        ? 'Re-encrypting selected private data and preparing the signed sell transaction...'
        : 'Preparing the signed sell transaction...'
    );
    setCreatedTransfer(null);

    try {
      const ownerAddress = userAddress || (await resolvePublisherAddress(transferName));
      const ownerPublicKey =
        typeof userPublicKey === 'string' && userPublicKey
          ? userPublicKey
          : (await qortalRequest({ action: 'GET_USER_ACCOUNT' }))?.publicKey;
      if (!ownerAddress || !ownerPublicKey) {
        throw new Error('Unable to resolve the active account address/public key.');
      }

      const recipientResolution = await collectRecipientPublicKeys({
        usersAllowed: [resolvedTarget.name || resolvedTarget.address],
        includeSelf: true,
        me: { name: activeName || transferName, address: ownerAddress },
      });
      if (!recipientResolution.publicKeys.length) {
        throw new Error('Unable to resolve encryption keys for the transferee.');
      }

      const transfereeRecipient = recipientResolution.included.find(
        (entry) => entry.address === resolvedTarget.address && entry.publicKey
      );
      if (!transfereeRecipient?.publicKey) {
        throw new Error(MISSING_TRANSFEREE_PUBLIC_KEY_MESSAGE);
      }

      const reencryptedResources: CreatedTransferState['reencryptedResources'] = [];
      if (reEncryptPrivateData && selectedResource) {
        const clearBase64 = await resolveResourceBase64(selectedResource);
        const keepOriginalOwnerAccess = reEncryptionMode === 'new-owner-rights';
        const encryptedData = await qortalRequest<string>({
          action: 'ENCRYPT_DATA',
          base64: clearBase64,
          publicKeys: keepOriginalOwnerAccess
            ? recipientResolution.publicKeys
            : [transfereeRecipient.publicKey],
        });

        const tags = buildEncryptionTagSet({
          mode: 'direct',
          publisher: ownerAddress,
          userCount: keepOriginalOwnerAccess ? recipientResolution.publicKeys.length : 1,
        }).concat(
          filterUserTags(
            Array.isArray(selectedResource.metadata?.tags) ? selectedResource.metadata.tags : []
          )
        );

        const metadata = {
          ...(selectedResource.metadata || {}),
          qassetsNbaTransfer: {
            version: 1,
            preparedAt: Date.now(),
            preparedByName: transferName,
            preparedByAddress: ownerAddress,
            futureOwnerAddress: resolvedTarget.address,
            futureOwnerName: resolvedTarget.name || null,
            originalMode: getEncryptionInfo(selectedResource).mode || null,
            reEncryptionMode,
            note: transferNote.trim() || null,
          },
        };

        await publish([
          {
            name: transferName,
            service: selectedResource.service as Service,
            identifier: selectedResource.identifier,
            base64: encryptedData,
            title: getResourceTitle(selectedResource),
            description: getResourceDescription(selectedResource),
            tags,
            metadata,
            privateMode: 'direct',
          },
        ]);

        reencryptedResources.push({
          service: selectedResource.service,
          identifier: selectedResource.identifier,
          path: getResourcePath(selectedResource) || null,
        });
      }

      const unsignedSellTx = await createSellNameTransaction({
        ownerAddress,
        ownerPublicKey,
        recipientAddress: resolvedTarget.address,
        name: transferName,
        amount,
      });
      const sellerSignedTransaction = await signTransaction(unsignedSellTx);
      const packageIdentifier = buildNbaTransferIdentifier(ownerAddress, resolvedTarget.address);
      const primaryPublisherName =
        (await getPrimaryNameCached(ownerAddress).catch(() => '')) || transferName;
      const packagePublisherName =
        publishWithActiveName && activeName ? activeName : primaryPublisherName;

      const transferPackage: NbaTransferPackage = {
        version: 1,
        type: 'qassets-nba-transfer',
        createdAt: Date.now(),
        packageIdentifier,
        transferName,
        amount,
        note: transferNote.trim() || null,
        transferor: {
          address: ownerAddress,
          name: transferName,
          publicKey: ownerPublicKey,
        },
        transferee: {
          address: resolvedTarget.address,
          name: resolvedTarget.name || null,
          publicKey: transfereeRecipient.publicKey,
        },
        sellerSignedTransaction,
        reencryptedResources: reencryptedResources.map((resource) => ({
          name: transferName,
          service: resource.service,
          identifier: resource.identifier,
          path: resource.path || null,
          previousMode: selectedResource ? getEncryptionInfo(selectedResource).mode || null : null,
          republishedAt: Date.now(),
        })),
      };

      const encryptedPackage = await qortalRequest<string>({
        action: 'ENCRYPT_DATA',
        base64: await objectToBase64(transferPackage),
        publicKeys: recipientResolution.publicKeys,
      });

      await publish([
        {
          name: packagePublisherName,
          service: NBA_TRANSFER_PACKAGE_SERVICE,
          identifier: packageIdentifier,
          base64: encryptedPackage,
          title: `NBA transfer package for ${transferName}`,
          description:
            'Signed name-transfer package prepared by Q-Assets for the intended transferee.',
          tags: buildEncryptionTagSet({
            mode: 'direct',
            publisher: ownerAddress,
            userCount: recipientResolution.publicKeys.length,
          }).concat(['qassets-nba', 'qassets-nba-transfer']),
          privateMode: 'direct',
        },
      ]);

      const qmailRecipient: NotificationRecipient | null =
        resolvedTarget.name && transfereeRecipient.publicKey
          ? {
              name: resolvedTarget.name,
              address: resolvedTarget.address,
              publicKey: transfereeRecipient.publicKey,
            }
          : null;

      if (qmailRecipient) {
        const qmailMessage = await buildNbaTransferQmailMessage({
          transferName,
          transferorName: transferName,
          transferorAddress: ownerAddress,
          transfereeAddress: resolvedTarget.address,
          packageIdentifier,
          amount,
        });
        await sendQmailNotifications({
          senderName: packagePublisherName,
          recipients: [qmailRecipient],
          subject: `Q-Assets NBA transfer for ${transferName}`,
          message: qmailMessage,
          batchSize: 1,
        });
      }

      await reload();
      await handleRefreshTransferHistory();

      setCreatedTransfer({
        packageIdentifier,
        packagePublisherName,
        publisherPublicKey: ownerPublicKey,
        transferName,
        amount,
        transferee: resolvedTarget,
        reencryptedResources,
      });
      setPackageSubmissions((prev) => [
        {
          transfer: {
            packageIdentifier,
            packagePublisherName,
            publisherPublicKey: ownerPublicKey,
            transferName,
            amount,
            transferee: resolvedTarget,
            reencryptedResources,
          },
          submittedAt: Date.now(),
          status: 'submitted',
        },
        ...prev.filter((entry) => entry.transfer.packageIdentifier !== packageIdentifier),
      ]);
      setStatus('NBA transfer package created successfully.');
      await alert(
        `The signed sell transaction was created, signed, and published privately to ${
          resolvedTarget.name || resolvedTarget.address
        }. The transfer has not been processed yet.`,
        'Transfer package created',
        { severity: 'success' }
      );
    } catch (err: any) {
      const message = err?.message || 'Unable to create the transfer package.';
      setStatus(message);
      if (message === MISSING_TRANSFEREE_PUBLIC_KEY_MESSAGE) {
        await alert(message, 'Transferee public key unavailable', { severity: 'warning' });
      }
    } finally {
      setCreatingTransfer(false);
    }
  }, [
    alert,
    amountInput,
    activeName,
    publish,
    publishWithActiveName,
    reEncryptionMode,
    reEncryptPrivateData,
    reload,
    handleRefreshTransferHistory,
    resolveResourceBase64,
    resolvedTarget,
    selectedResource,
    transferName,
    transferNote,
    userAddress,
    userPublicKey,
  ]);

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: '1200px' }}>
      <Stack
        direction={{ xs: 'column', md: 'row' }}
        spacing={1.5}
        alignItems={{ xs: 'flex-start', md: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" sx={{ lineHeight: 1.1 }}>
            NBA Transfer
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
            Create a signed sell package for a future owner, optionally re-encrypting private data
            first.
          </Typography>
        </Box>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          spacing={1}
          alignItems={{ xs: 'stretch', sm: 'center' }}
        >
          <Button
            component={RouterLink}
            to="/manage/data/name-assets/receive"
            variant="contained"
            color="secondary"
            size="large"
            startIcon={<DownloadRoundedIcon />}
            sx={{
              minHeight: 52,
              px: 2.25,
              fontWeight: 700,
              boxShadow: 4,
              whiteSpace: 'nowrap',
            }}
          >
            Receive NBA
          </Button>
          <Button
            variant="outlined"
            startIcon={<InfoOutlinedIcon />}
            onClick={() => setInfoOpen(true)}
          >
            NBA Info
          </Button>
          <Button component={RouterLink} to="/manage/data" variant="text">
            ← Back to Data Management
          </Button>
        </Stack>
      </Stack>

      <Stack spacing={2}>
        <Alert severity="info">
          This step prepares the transfer only. Q-Assets creates and signs the sell transaction,
          publishes it privately to the transferee, and notifies them. The actual name transfer is
          completed later from the receive flow.
        </Alert>

        <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <VpnKeyRoundedIcon color="primary" />
              <Typography variant="h6">Transfer Setup</Typography>
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                select
                fullWidth
                label="Name to transfer"
                value={transferName || ''}
                onChange={(event) => setTransferName(event.target.value || null)}
                disabled={namesLoading || availableNames.length === 0}
                helperText={
                  namesError ||
                  `This is the name that will be transferred. Current active publishing name: ${
                    activeName || 'none selected'
                  }.`
                }
              >
                {availableNames.length === 0 ? (
                  <MenuItem value="" disabled>
                    {namesLoading ? 'Loading names…' : 'No names available'}
                  </MenuItem>
                ) : (
                  availableNames.map((name) => (
                    <MenuItem key={name} value={name}>
                      {name}
                    </MenuItem>
                  ))
                )}
              </TextField>

              <TextField
                fullWidth
                label="Transferee name or address"
                value={recipientInput}
                onChange={(event) => {
                  setRecipientInput(event.target.value);
                  setResolvedTarget(null);
                }}
                placeholder="Qortal name or Q-address"
              />

              <Button
                variant="contained"
                onClick={handleResolveTarget}
                disabled={resolvingTarget || !recipientInput.trim()}
                sx={{ minWidth: { xs: '100%', md: 160 } }}
              >
                {resolvingTarget ? 'Resolving…' : 'Resolve transferee'}
              </Button>
            </Stack>

            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
              <TextField
                fullWidth
                label="Sell price (QORT)"
                value={amountInput}
                onChange={(event) => setAmountInput(event.target.value)}
                helperText="A higher sell price adds protection if the buyer-side completion stalls."
              />
              <TextField
                fullWidth
                multiline
                minRows={2}
                label="Transfer note"
                value={transferNote}
                onChange={(event) => setTransferNote(event.target.value)}
                helperText="Optional note stored inside the transfer package for the transferee."
              />
            </Stack>

            <Stack spacing={1}>
              <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
                <Switch
                  checked={publishWithActiveName}
                  onChange={(event) => setPublishWithActiveName(event.target.checked)}
                />
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  publish with selected 'Active Name' (in Q-Assets header)
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                By default, Q-Assets publishes the transfer package and transfer-notification Q-Mail
                with your primary name. This helps avoid adding an extra publish under the name
                being sold, which can matter for names intended to behave like single-publish
                assets.
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Enable this option only if you specifically want the current active publishing name
                to publish the transfer package instead of your primary name. Choosing a name to
                transfer here does not change your active publishing name.
              </Typography>
            </Stack>

            <Stack spacing={1}>
              <Stack direction="row" spacing={1.25} alignItems="center" flexWrap="wrap" useFlexGap>
                <Switch
                  checked={reEncryptPrivateData}
                  onChange={(event) => setReEncryptPrivateData(event.target.checked)}
                />
                <Typography variant="body1" sx={{ fontWeight: 600 }}>
                  Re-encrypt private data for the transferee
                </Typography>
              </Stack>
              <Typography variant="body2" color="text.secondary">
                Re-Encryption allows data published privately by the transferor (original owner) to
                be accessed or edited in the future by the transferee. Without re-encrypting the
                data, the new owner would not be able to access the private data.
              </Typography>
            </Stack>

            {reEncryptPrivateData && (
              <>
                <Alert severity="warning">
                  Choose how the re-published private data should behave after the transfer. The
                  first mode preserves the current owner's recovery access. The second mode removes
                  the current owner's access entirely after re-publishing.
                </Alert>
                <TextField
                  select
                  fullWidth
                  label="Re-encryption mode"
                  value={reEncryptionMode}
                  onChange={(event) => setReEncryptionMode(event.target.value as ReEncryptionMode)}
                  helperText={
                    reEncryptionMode === 'new-owner-rights'
                      ? 'New Owner Rights Mode keeps the transferor key in the encryption so the original owner can still recover the data if needed.'
                      : 'Full Ownership Transfer Mode encrypts with the transferee key only, so the transferor cannot read the re-published private data afterward.'
                  }
                >
                  <MenuItem value="new-owner-rights">New Owner Rights Mode</MenuItem>
                  <MenuItem value="full-ownership-transfer">Full Ownership Transfer Mode</MenuItem>
                </TextField>
              </>
            )}

            {!reEncryptPrivateData && (
              <Alert severity="info">
                Re-encryption is optional. You can transfer the name even if it has no private data
                or you do not want to republish any private resources first.
              </Alert>
            )}

            {resolvedTarget && (
              <Alert severity="success">
                Transferee resolved to {resolvedTarget.name ? `${resolvedTarget.name} ` : ''}
                <strong>{resolvedTarget.address}</strong>
              </Alert>
            )}

            <Alert severity="info">
              The receiving account must already have an on-chain public key. In practice, that
              means it needs at least one outbound transaction before it can receive an NBA transfer
              package.
            </Alert>
          </Stack>
        </Paper>

        {reEncryptPrivateData && (
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Stack spacing={1.5}>
              <Stack
                direction={{ xs: 'column', md: 'row' }}
                spacing={1.5}
                alignItems={{ xs: 'flex-start', md: 'center' }}
                justifyContent="space-between"
              >
                <Stack direction="row" spacing={1} alignItems="center">
                  <TravelExploreRoundedIcon color="primary" />
                  <Typography variant="h6">Private Data To Re-Encrypt</Typography>
                </Stack>
                <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                  <Button
                    startIcon={<RefreshRoundedIcon />}
                    onClick={() => void reload()}
                    disabled={!transferName || loading}
                  >
                    Refresh
                  </Button>
                  <Button
                    startIcon={<AutorenewRoundedIcon />}
                    onClick={() => void loadAll()}
                    disabled={!hasMore || loading}
                  >
                    Load all
                  </Button>
                </Stack>
              </Stack>

              <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                <Chip label={`${rows.length} total resources`} variant="outlined" />
                <Chip
                  label={`${privateResources.length} private candidates`}
                  color="secondary"
                  variant="outlined"
                />
                {groupsLoading && <Chip label="Loading groups…" variant="outlined" />}
              </Stack>

              {(error || groupsError) && (
                <Alert severity="warning">
                  {error || groupsError || 'Unable to load transfer data.'}
                </Alert>
              )}

              <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                <TextField
                  select
                  fullWidth
                  label="Service filter"
                  value={serviceFilter}
                  onChange={(event) => setServiceFilter(event.target.value)}
                >
                  {serviceOptions.map((service) => (
                    <MenuItem key={service} value={service}>
                      {service}
                    </MenuItem>
                  ))}
                </TextField>
                <TextField
                  fullWidth
                  label="Find by identifier, path, or file name"
                  value={manualQuery}
                  onChange={(event) => setManualQuery(event.target.value)}
                  placeholder="DOCUMENT / my-folder / contract.pdf"
                />
              </Stack>

              <Divider />

              {!transferName ? (
                <Typography variant="body2" color="text.secondary">
                  Select one of your Qortal names to review private resources.
                </Typography>
              ) : loading && !rows.length ? (
                <Stack direction="row" spacing={1.25} alignItems="center">
                  <CircularProgress size={20} />
                  <Typography variant="body2" color="text.secondary">
                    Loading private resources for {transferName}…
                  </Typography>
                </Stack>
              ) : filteredResources.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  No private resources matched the current filters.
                </Typography>
              ) : (
                <Box
                  sx={{
                    display: 'grid',
                    gap: 1.25,
                    gridTemplateColumns: {
                      xs: 'repeat(1, minmax(0, 1fr))',
                      lg: 'repeat(2, minmax(0, 1fr))',
                    },
                  }}
                >
                  {filteredResources.map((resource) => (
                    <ResourceSummaryCard
                      key={getResourceKey(resource)}
                      resource={resource}
                      selected={getResourceKey(resource) === selectedResourceKey}
                      onSelect={(next) => setSelectedResourceKey(getResourceKey(next))}
                    />
                  ))}
                </Box>
              )}

              {hasMore && (
                <Button onClick={() => void loadMore()} disabled={loading}>
                  Load next page
                </Button>
              )}
            </Stack>
          </Paper>
        )}

        <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
          <Stack spacing={1.5}>
            <Stack direction="row" spacing={1} alignItems="center">
              <SendRoundedIcon color="primary" />
              <Typography variant="h6">Create Transfer Package</Typography>
            </Stack>

            <Alert severity="warning">
              The transfer package contains the signed sell transaction and is published privately
              to the transferee and current owner. The name is not transferred until the transferee
              completes the receive flow.
            </Alert>

            {status && (
              <Alert severity={status.toLowerCase().includes('success') ? 'success' : 'info'}>
                {status}
              </Alert>
            )}

            <BusyButton
              variant="contained"
              onClick={() => void handleCreateTransfer()}
              loading={creatingTransfer}
              disabled={!transferName || !resolvedTarget}
            >
              Create NBA transfer package
            </BusyButton>
          </Stack>
        </Paper>

        {createdTransfer && (
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Stack spacing={1}>
              <Typography variant="h6">Latest Transfer Package</Typography>
              <Typography variant="body2" color="text.secondary">
                Transferee: {createdTransfer.transferee.name || createdTransfer.transferee.address}
              </Typography>
              <Typography variant="body2" sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}>
                Package: {NBA_TRANSFER_PACKAGE_SERVICE}/{createdTransfer.packagePublisherName}/
                {createdTransfer.packageIdentifier}
              </Typography>
              <Typography variant="body2">Sell price: {createdTransfer.amount} QORT</Typography>
              {createdTransfer.packagePublisherName !== createdTransfer.transferName ? (
                <Typography variant="body2" color="text.secondary">
                  Package published via primary name: {createdTransfer.packagePublisherName}
                </Typography>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  Package published via active name: {createdTransfer.packagePublisherName}
                </Typography>
              )}
              {createdTransfer.reencryptedResources.length > 0 && (
                <Typography variant="body2" color="text.secondary">
                  Re-encrypted resources: {createdTransfer.reencryptedResources.length}
                </Typography>
              )}
            </Stack>
          </Paper>
        )}

        {packageSubmissions.length > 0 && (
          <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
            <Stack spacing={1.25}>
              <Typography variant="h6">Package Publish Submissions</Typography>
              <Typography variant="body2" color="text.secondary">
                Fresh NBA transfer-package publishes are tracked here until confirmation, so you can
                see when the QDN package is still only submitted or unconfirmed.
              </Typography>

              {packageSubmissions.map((entry) => (
                <Paper
                  key={`${entry.transfer.packageIdentifier}-publish`}
                  variant="outlined"
                  sx={{
                    p: 1.5,
                    borderRadius: 2,
                    borderColor:
                      entry.status === 'confirmed'
                        ? 'success.main'
                        : entry.status === 'unconfirmed'
                          ? 'warning.main'
                          : 'info.main',
                  }}
                >
                  <Stack spacing={1}>
                    <Stack
                      direction={{ xs: 'column', md: 'row' }}
                      spacing={1}
                      justifyContent="space-between"
                    >
                      <Box>
                        <Typography variant="body1" sx={{ fontWeight: 700 }}>
                          {entry.transfer.transferName}
                        </Typography>
                        <Typography
                          variant="caption"
                          sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}
                          color="text.secondary"
                        >
                          {entry.transfer.packageIdentifier}
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
                          label={`Sell price: ${entry.transfer.amount} QORT`}
                        />
                        <Chip
                          size="small"
                          variant="outlined"
                          label={`Submitted ${new Date(entry.submittedAt).toLocaleTimeString()}`}
                        />
                      </Stack>
                    </Stack>

                    <Typography variant="body2" color="text.secondary">
                      New owner:{' '}
                      {entry.transfer.transferee.name || entry.transfer.transferee.address}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                      Package publisher: {entry.transfer.packagePublisherName}
                    </Typography>

                    <Alert severity={entry.status === 'confirmed' ? 'success' : 'info'}>
                      {entry.status === 'confirmed'
                        ? `The transfer package publish has confirmed on-chain.${
                            entry.confirmedAt
                              ? ` Confirmed at ${new Date(entry.confirmedAt).toLocaleTimeString()}.`
                              : ''
                          }`
                        : entry.status === 'unconfirmed'
                          ? 'The transfer package publish is currently visible as unconfirmed. It will remain here until confirmation.'
                          : 'The transfer package was submitted. Q-Assets is checking every few seconds until it appears as unconfirmed or confirmed.'}
                    </Alert>

                    <Stack direction="row" justifyContent="flex-end">
                      <BusyButton
                        loading={cancelingIdentifier === entry.transfer.packageIdentifier}
                        variant="outlined"
                        color="warning"
                        startIcon={<CancelScheduleSendRoundedIcon />}
                        onClick={() =>
                          void handleCancelTransferPackage({
                            packageIdentifier: entry.transfer.packageIdentifier,
                            transferName: entry.transfer.transferName,
                            packagePublisherName: entry.transfer.packagePublisherName,
                          })
                        }
                      >
                        Cancel transfer package
                      </BusyButton>
                    </Stack>
                  </Stack>
                </Paper>
              ))}
            </Stack>
          </Paper>
        )}

        <Paper variant="outlined" sx={{ p: 2.25, borderRadius: 3 }}>
          <Stack spacing={1.5}>
            <Stack
              direction={{ xs: 'column', md: 'row' }}
              spacing={1.5}
              alignItems={{ xs: 'flex-start', md: 'center' }}
              justifyContent="space-between"
            >
              <Box>
                <Typography variant="h6">Outbound Transfer History</Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                  Review NBA transfer packages created by this account and see whether matching sell
                  and buy transactions have been found on-chain.
                </Typography>
              </Box>
              <Button
                startIcon={<RefreshRoundedIcon />}
                onClick={() => void handleRefreshTransferHistory()}
                disabled={historyLoading || !userAddress}
              >
                Refresh history
              </Button>
            </Stack>

            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              <Chip label={`${historySummary.total} packages`} variant="outlined" />
              <Chip
                label={`${historySummary.completed} completed`}
                color="success"
                variant="outlined"
              />
              <Chip
                label={`${historySummary.pending} pending`}
                color="default"
                variant="outlined"
              />
              <Chip
                label={`${historySummary.sellOnly} sell-only`}
                color="warning"
                variant="outlined"
              />
              {historySummary.buyOnly > 0 && (
                <Chip
                  label={`${historySummary.buyOnly} buy-only`}
                  color="info"
                  variant="outlined"
                />
              )}
              {historySummary.intercepted > 0 && (
                <Chip
                  label={`${historySummary.intercepted} intercepted`}
                  color="error"
                  variant="outlined"
                />
              )}
            </Stack>

            {historyError && <Alert severity="warning">{historyError}</Alert>}

            {!userAddress ? (
              <Typography variant="body2" color="text.secondary">
                Authenticate the active account to load prior NBA transfer packages.
              </Typography>
            ) : historyLoading && historyItems.length === 0 ? (
              <Stack direction="row" spacing={1.25} alignItems="center">
                <CircularProgress size={20} />
                <Typography variant="body2" color="text.secondary">
                  Loading previous transfers for this account…
                </Typography>
              </Stack>
            ) : visibleHistoryItems.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No previous NBA transfer packages were found for this account yet.
              </Typography>
            ) : (
              <Stack spacing={1.25}>
                {visibleHistoryItems.map((item) => {
                  const transfereeLabel =
                    item.transfer.transferee.name || item.transfer.transferee.address;

                  return (
                    <Paper
                      key={item.transfer.packageIdentifier}
                      variant="outlined"
                      sx={{
                        p: 1.75,
                        borderRadius: 2.5,
                        width: '100%',
                        borderColor:
                          item.status === 'intercepted'
                            ? 'error.main'
                            : item.status === 'completed'
                              ? 'success.main'
                              : item.status === 'sell-only'
                                ? 'warning.main'
                                : 'divider',
                      }}
                    >
                      <Stack spacing={1}>
                        <Stack
                          direction="row"
                          spacing={1}
                          alignItems="center"
                          justifyContent="space-between"
                          flexWrap="wrap"
                          useFlexGap
                        >
                          <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {item.transfer.transferName}
                          </Typography>
                          <Chip
                            size="small"
                            color={getHistoryStatusColor(item.status)}
                            label={getHistoryStatusLabel(item.status)}
                          />
                        </Stack>

                        <Typography variant="body2" color="text.secondary">
                          New owner: {transfereeLabel}
                        </Typography>
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}
                        >
                          {item.transfer.transferee.address}
                        </Typography>

                        <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
                          <Chip
                            size="small"
                            label={`Sell price: ${item.transfer.amount} QORT`}
                            variant="outlined"
                          />
                          <Chip
                            size="small"
                            label={`Initiated: ${formatTs(item.transfer.createdAt)}`}
                            variant="outlined"
                          />
                        </Stack>

                        <Typography variant="body2" color="text.secondary">
                          {getHistoryStatusText(item)}
                        </Typography>

                        {(item.status === 'completed' || item.status === 'intercepted') &&
                          item.ownership.currentOwnerAddress && (
                            <Typography variant="caption" color="text.secondary">
                              Current owner:{' '}
                              {item.ownership.currentOwnerPrimaryName
                                ? `${item.ownership.currentOwnerPrimaryName} `
                                : ''}
                              {item.ownership.currentOwnerAddress}
                            </Typography>
                          )}

                        <Typography
                          variant="caption"
                          color="text.secondary"
                          sx={{ fontFamily: 'monospace', wordBreak: 'break-word' }}
                        >
                          Package: {item.transfer.packageIdentifier}
                        </Typography>

                        {item.sellTransaction && (
                          <Typography variant="caption" color="text.secondary">
                            Sell tx detected: {formatTs(item.sellTransaction.timestamp)}
                          </Typography>
                        )}

                        {item.buyTransaction && (
                          <Typography variant="caption" color="text.secondary">
                            Buy tx detected: {formatTs(item.buyTransaction.timestamp)}
                          </Typography>
                        )}

                        {item.status === 'pending' && (
                          <Stack direction="row" justifyContent="flex-end">
                            <BusyButton
                              loading={cancelingIdentifier === item.transfer.packageIdentifier}
                              variant="outlined"
                              color="warning"
                              startIcon={<CancelScheduleSendRoundedIcon />}
                              onClick={() =>
                                void handleCancelTransferPackage({
                                  packageIdentifier: item.transfer.packageIdentifier,
                                  transferName: item.transfer.transferName,
                                  packagePublisherName: item.resource.name,
                                })
                              }
                            >
                              Cancel transfer package
                            </BusyButton>
                          </Stack>
                        )}
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </Stack>
        </Paper>
      </Stack>

      <Dialog open={infoOpen} onClose={() => setInfoOpen(false)} maxWidth="md" fullWidth>
        <DialogTitle>Name-Based Asset Info</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <Typography variant="body2">
              Name-Based Assets are transferable names paired with data, identity, applications, or
              entire organizations. The transfer flow lets Q-Assets prepare ownership handoff safely
              before the actual on-chain sell and buy transactions are processed.
            </Typography>

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Package Publisher
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                By default, NBA transfer packages are published with your account's primary name so
                the name being sold does not need to create an extra publish. If you want the
                selected active name to publish the package instead, enable `Publish with active
                name` on the transfer form.
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                Pending outbound packages can also be cancelled, which republishes a tombstone over
                the package identifier so Q-Assets stops showing it. This does not guarantee that a
                recipient did not already decrypt and retain the signed sell transaction.
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Re-Encryption Modes
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                `New Owner Rights Mode` re-encrypts private data for the transferee while keeping
                the transferor key included as a recovery path.
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                `Full Ownership Transfer Mode` re-encrypts the currently published private data with
                the transferee key only, removing the original owner's access after re-publishing.
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Coming Soon: TrueNBA Mode
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                `Small Private Data` or `TrueNBA Mode` will allow a private file to remain
                unpublished until the sale is initialized. Q-Assets will then publish the original
                private data under the identifier `NBA` with a selected private service type,
                encrypted only for the new owner.
              </Typography>
            </Box>

            <Box>
              <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                Planned NBA Marketplace
              </Typography>
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                A broader NBA Marketplace is planned so multiple Name-Based Assets can be listed and
                purchased. Planned categories range from full organizations and completed
                apps/websites to compact single-asset NBAs.
              </Typography>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setInfoOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
