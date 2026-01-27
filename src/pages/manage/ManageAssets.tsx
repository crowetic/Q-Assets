import { useEffect, useMemo, useState, useCallback } from 'react';
import {
  Box,
  Paper,
  Typography,
  Select,
  MenuItem,
  FormControl,
  InputLabel,
  TextField,
  Checkbox,
  FormControlLabel,
  Button,
  CircularProgress,
  Divider,
} from '@mui/material';
import { useSearchParams } from 'react-router-dom';
import { useAuth } from 'qapp-core';
import { ensureAssetsIndexLoaded, ensureAssetMini } from '../../bootstrap/assetsBootstrap';
import type { Asset } from '../AssetExplorer';
import TiptapEditor from '../../components/TipTapEditor';
import { prepareHtmlForPublish } from '../../utils/publicationPublisher';
import { getAssetIdentifiers, assetPrivacyId } from '../../constants/qdnConstants';
import { objectToBase64, fileToBase64 } from '../../utils/data';
// import { publishAssetPublication } from '../../utils/publishAssetPublication';
import { useActiveAccountName } from '../../hooks/useActiveAccountName';
import { useAlert } from '../../components/alerts';
import { enqueueQdnPublishJob } from '../../state/publishQueue';
import { getAccountGroups, type GroupSummary } from '../../utils/qortalApi';
import { resolveAssetPublicationById } from '../../utils/resolveAssetPublication';
import type { BatchPublishResource } from '../../utils/useQdnBatchPublisher';

type ManageAsset = Asset & { issuerAddress: string };

export default function ManageAssets() {
  const { address: userAddress, publicKey } = useAuth();
  const { alert } = useAlert();
  const [assets, setAssets] = useState<ManageAsset[]>([]);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [loadingAssets, setLoadingAssets] = useState(false);
  const [saving, setSaving] = useState(false);
  const [html, setHtml] = useState('');
  const [description, setDescription] = useState('');
  const [privateAsset, setPrivateAsset] = useState(false);
  const [privateGroupId, setPrivateGroupId] = useState<number | ''>('');
  const { activeName, setActiveName, availableNames, namesLoading } = useActiveAccountName();
  const [groupOptions, setGroupOptions] = useState<GroupSummary[]>([]);
  const [groupsLoading, setGroupsLoading] = useState(false);
  const [primaryGroupId, setPrimaryGroupId] = useState<string>('');
  const [primaryGroupName, setPrimaryGroupName] = useState<string>('');
  const [primaryGroupJoinLink, setPrimaryGroupJoinLink] = useState<string>('');
  const [primaryGroupIsPrivate, setPrimaryGroupIsPrivate] = useState<boolean>(false);
  const [initialPrivate, setInitialPrivate] = useState(false);
  const [avatarBase64, setAvatarBase64] = useState<string | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [searchParams] = useSearchParams();

  const selectedAsset = useMemo(
    () => (selectedId != null ? (assets.find((a) => a.assetId === selectedId) ?? null) : null),
    [assets, selectedId]
  );

  useEffect(() => {
    if (!userAddress) return;
    let cancelled = false;
    (async () => {
      try {
        setLoadingAssets(true);
        const idx = await ensureAssetsIndexLoaded();
        const mine = Object.values(idx).filter((a) => a.owner === userAddress) as Asset[];

        // Fallback: also include any ISSUE_ASSET txs for this address
        let issuedIds: number[] = [];
        try {
          const txs = await qortalRequest({
            action: 'SEARCH_TRANSACTIONS',
            address: userAddress,
            txType: ['ISSUE_ASSET'],
            confirmationStatus: 'CONFIRMED',
            limit: 1000,
            reverse: true,
          });
          if (Array.isArray(txs)) {
            issuedIds = Array.from(
              new Set(
                txs
                  .map((t: any) => Number(t.assetId ?? t.assetIdCreated ?? t.assetIdIssued))
                  .filter((n) => Number.isFinite(n))
              )
            );
          }
        } catch {
          /* ignore */
        }

        const allIds = Array.from(
          new Set([...mine.map((a) => a.assetId), ...issuedIds].filter((n) => Number.isFinite(n)))
        );

        const enriched: ManageAsset[] = [];
        for (const id of allIds) {
          const mini = await ensureAssetMini(id);
          if (mini) {
            enriched.push({ ...mini, issuerAddress: mini.owner });
          }
        }
        if (!cancelled) {
          setAssets(enriched);
          if (!selectedId && enriched.length) {
            const queryId = Number(searchParams.get('assetId'));
            const match = Number.isFinite(queryId)
              ? enriched.find((a) => a.assetId === queryId)
              : null;
            setSelectedId(match ? match.assetId : enriched[0].assetId);
          }
        }
      } finally {
        if (!cancelled) setLoadingAssets(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userAddress, selectedId, searchParams]);

  // Load account groups
  useEffect(() => {
    if (!userAddress) return;
    let cancelled = false;
    (async () => {
      try {
        setGroupsLoading(true);
        const groups = await getAccountGroups(userAddress);
        if (!cancelled) setGroupOptions(groups);
      } catch {
        if (!cancelled) setGroupOptions([]);
      } finally {
        if (!cancelled) setGroupsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [userAddress]);

  // Load publication for selected asset
  useEffect(() => {
    if (selectedId == null || !selectedAsset) return;
    let cancelled = false;
    (async () => {
      try {
        const resolved = await resolveAssetPublicationById(selectedAsset.assetId);
        const publication = resolved.publication;
        if (publication && !cancelled) {
          setDescription(publication.description ?? '');
          setHtml(publication.html ?? '');
          const priv = Boolean(publication.privateAsset);
          setPrivateAsset(priv);
          setInitialPrivate(priv);
          const gidRaw =
            resolved.privateGroupId ?? publication.privateGroupId ?? publication.primaryGroup?.id;
          const gid = gidRaw != null ? Number(gidRaw) : NaN;
          setPrivateGroupId(Number.isFinite(gid) ? gid : '');
          setPrimaryGroupId(
            publication.primaryGroup?.id ? String(publication.primaryGroup.id) : ''
          );
          setPrimaryGroupName(publication.primaryGroup?.name ?? '');
          setPrimaryGroupJoinLink(publication.primaryGroup?.joinLink ?? '');
          setPrimaryGroupIsPrivate(Boolean(publication.primaryGroup?.isPrivate));
        }
        if (!cancelled) {
          setAvatarBase64(null);
          setAvatarPreview(null);
        }
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedId, selectedAsset]);

  const handleSave = useCallback(async () => {
    if (!selectedAsset || !userAddress || !publicKey) return;
    const issuerName = activeName;
    if (!issuerName) {
      alert('Select a publishing name first.', 'Name required', { severity: 'warning' });
      return;
    }
    const groupIdNum = privateAsset && privateGroupId !== '' ? Number(privateGroupId) : undefined;
    if (privateAsset && !groupIdNum) {
      alert('Private assets require a group ID.', 'Group required', { severity: 'warning' });
      return;
    }

    const normalizedPrimary =
      primaryGroupId && primaryGroupName
        ? {
            id: primaryGroupId,
            name: primaryGroupName,
            joinLink:
              primaryGroupJoinLink ||
              (primaryGroupId ? `qortal://use-group/action-join/groupid-${primaryGroupId}` : ''),
            isPrivate: primaryGroupIsPrivate,
          }
        : undefined;

    const pub = {
      description,
      html: prepareHtmlForPublish(html, undefined as any), // theme not needed for simple sanitize
      privateAsset,
      privateGroupId: groupIdNum ?? (normalizedPrimary ? Number(normalizedPrimary.id) : undefined),
      primaryGroup: normalizedPrimary,
    };

    try {
      setSaving(true);
      const publishInfo = await getAssetIdentifiers(selectedAsset.name, selectedAsset.assetId);
      const resources: BatchPublishResource[] = [];

      // publication (encrypt if private)
      const pub64 = await objectToBase64(pub);
      let pubData64 = pub64;
      if (privateAsset && groupIdNum != null) {
        const enc = await qortalRequest({
          action: 'ENCRYPT_QORTAL_GROUP_DATA',
          base64: pub64,
          groupId: groupIdNum,
          isAdmins: false,
        });
        const enc64 = typeof enc === 'string' ? enc : (enc?.data64 ?? enc?.base64);
        if (!enc64 || typeof enc64 !== 'string') {
          throw new Error('ENCRYPT_QORTAL_GROUP_DATA failed for publication.');
        }
        pubData64 = enc64;
      }
      resources.push({
        name: issuerName,
        service: publishInfo.services.genesisPost,
        identifier: publishInfo.identifiers.genesisPost,
        base64: pubData64,
      });

      // privacy hint doc
      if (privateAsset && groupIdNum != null) {
        const privacyId = assetPrivacyId(selectedAsset.assetId, groupIdNum);
        const payload = {
          assetId: selectedAsset.assetId,
          assetName: selectedAsset.name,
          private: true,
          groupId: groupIdNum,
          updatedAt: Date.now(),
        };
        resources.push({
          name: issuerName,
          service: 'DOCUMENT',
          identifier: privacyId,
          base64: await objectToBase64(payload),
        });
      }

      // avatar (encrypt if private)
      if (avatarBase64) {
        let avatarData64 = avatarBase64;
        if (privateAsset && groupIdNum != null) {
          const enc = await qortalRequest({
            action: 'ENCRYPT_QORTAL_GROUP_DATA',
            base64: avatarBase64,
            groupId: groupIdNum,
            isAdmins: false,
          });
          const enc64 = typeof enc === 'string' ? enc : (enc?.data64 ?? enc?.base64);
          if (!enc64 || typeof enc64 !== 'string') {
            throw new Error('ENCRYPT_QORTAL_GROUP_DATA failed for avatar.');
          }
          avatarData64 = enc64;
        }
        resources.push({
          name: issuerName,
          service: publishInfo.services.avatar,
          identifier: publishInfo.identifiers.avatar,
          base64: avatarData64,
        });
      }

      const queued = enqueueQdnPublishJob({
        label: `Update asset ${selectedAsset.name}`,
        resources,
      });
      if (!queued) throw new Error('Unable to queue publish.');
      await queued.completion;
      alert('Asset publication updated.', 'Success', { severity: 'success' });
    } catch (e: any) {
      alert(e?.message || 'Failed to publish updates.', 'Error', { severity: 'error' });
    } finally {
      setSaving(false);
    }
  }, [
    activeName,
    alert,
    description,
    html,
    avatarBase64,
    privateAsset,
    privateGroupId,
    primaryGroupId,
    primaryGroupName,
    primaryGroupJoinLink,
    primaryGroupIsPrivate,
    publicKey,
    selectedAsset,
    userAddress,
  ]);

  return (
    <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: '85%', mx: 'auto', width: '100%' }}>
      <Typography variant="h4" sx={{ mb: 1 }}>
        Asset Management
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 3 }}>
        Edit publications and privacy for assets you issued. Uses your selected publishing name and
        publishes changes in one batch.
      </Typography>

      {loadingAssets ? (
        <Box display="flex" justifyContent="center" py={4}>
          <CircularProgress />
        </Box>
      ) : assets.length === 0 ? (
        <Paper sx={{ p: 3 }}>
          <Typography>No issued assets found for your account.</Typography>
        </Paper>
      ) : (
        <Paper sx={{ p: 3, display: 'grid', gap: 2 }}>
          <FormControl fullWidth size="small">
            <InputLabel id="manage-asset-select">Select asset</InputLabel>
            <Select
              labelId="manage-asset-select"
              label="Select asset"
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(Number(e.target.value))}
            >
              {assets.map((a) => (
                <MenuItem key={a.assetId} value={a.assetId}>
                  {a.name} (#{a.assetId})
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <FormControl fullWidth size="small">
            <InputLabel id="manage-asset-name">Publish as name</InputLabel>
            <Select
              labelId="manage-asset-name"
              label="Publish as name"
              value={activeName || ''}
              onChange={(e) => setActiveName(e.target.value || null)}
              disabled={namesLoading}
            >
              {availableNames.map((nm) => (
                <MenuItem key={nm} value={nm}>
                  {nm}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <TextField
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            multiline
            minRows={2}
          />

          <FormControl fullWidth size="small">
            <InputLabel id="manage-asset-primary-group">Primary group</InputLabel>
            <Select
              labelId="manage-asset-primary-group"
              label="Primary group"
              value={primaryGroupId}
              onChange={(e) => {
                const val = String(e.target.value || '');
                setPrimaryGroupId(val);
                const match = groupOptions.find((g) => String(g.groupId) === val);
                if (match) {
                  setPrimaryGroupName(match.groupName || '');
                  setPrimaryGroupJoinLink(
                    `qortal://use-group/action-join/groupid-${match.groupId}`
                  );
                  setPrimaryGroupIsPrivate(!match.isOpen);
                  if (privateAsset) setPrivateGroupId(match.groupId);
                } else {
                  setPrimaryGroupName('');
                  setPrimaryGroupJoinLink('');
                  setPrimaryGroupIsPrivate(false);
                }
              }}
              disabled={groupsLoading || groupOptions.length === 0}
            >
              {groupOptions.map((g) => (
                <MenuItem key={g.groupId} value={g.groupId}>
                  {g.groupName} (#{g.groupId}) {g.isOpen ? '(Public)' : '(Private)'}
                </MenuItem>
              ))}
            </Select>
          </FormControl>

          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Publication HTML
            </Typography>
            <TiptapEditor value={html} onChange={setHtml} />
          </Box>

          <FormControlLabel
            control={
              <Checkbox
                checked={privateAsset}
                onChange={(e) => {
                  const next = e.target.checked;
                  if (next && !initialPrivate) {
                    const ok = window.confirm(
                      'You are converting this asset to private. It will only be accessible to members of the selected private group. Continue?'
                    );
                    if (!ok) return;
                  }
                  setPrivateAsset(next);
                }}
              />
            }
            label="Private asset"
          />
          {privateAsset && (
            <TextField
              label="Private group ID"
              value={privateGroupId}
              onChange={(e) => setPrivateGroupId(Number(e.target.value))}
              type="number"
              helperText="Must match the group used to encrypt the publication."
            />
          )}

          <Divider />
          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Asset Avatar
            </Typography>
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
              <Button component="label" variant="outlined" size="small" disabled={saving}>
                {avatarPreview ? 'Change avatar' : 'Upload avatar'}
                <input
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (!file) return;
                    const base64 = await fileToBase64(file);
                    setAvatarBase64(base64);
                    const mime = file.type || 'image/png';
                    setAvatarPreview(`data:${mime};base64,${base64}`);
                  }}
                />
              </Button>
              {avatarPreview && (
                <Box
                  component="img"
                  src={avatarPreview}
                  alt="Avatar preview"
                  sx={{ width: 72, height: 72, borderRadius: '50%', objectFit: 'cover' }}
                />
              )}
            </Box>
            {privateAsset && (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ display: 'block', mt: 0.5 }}
              >
                Avatar will be encrypted with the selected private group.
              </Typography>
            )}
          </Box>

          <Divider />
          <Box display="flex" justifyContent="flex-end" gap={1}>
            <Button variant="contained" onClick={handleSave} disabled={saving || !selectedAsset}>
              {saving ? 'Publishing…' : 'Publish updates'}
            </Button>
          </Box>
        </Paper>
      )}
    </Box>
  );
}
