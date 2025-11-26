import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Button,
  Chip,
  CircularProgress,
  IconButton,
  MenuItem,
  InputLabel,
  Select,
  FormControl,
  FormControlLabel,
  Checkbox,
  Divider,
  Paper,
  Stack,
  TextField,
  Typography,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import { useAuth } from 'qapp-core';
import { getAccountGroups, type GroupSummary } from '../../utils/qortalApi';
import AddRoundedIcon from '@mui/icons-material/AddRounded';
import DeleteRoundedIcon from '@mui/icons-material/DeleteRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import {
  loadManagementManifest,
  publishManagementManifest,
  type ManagementManifest,
  type ManifestRole,
  type ManifestScope,
  type DiscountTier,
  type CurrencyCode,
} from '../../utils/managementManifest';

type Props = {
  disabled?: boolean;
  onChange?: (manifest: ManagementManifest) => void;
};

const emptyRole = (): ManifestRole => ({
  id: `role-${Date.now().toString(36)}`,
  label: 'New Role',
  groupId: 0,
  permissions: [],
  membership: 'member',
});

const emptyScope = (): ManifestScope => ({
  type: 'custom',
  identifier: `scope-${Date.now().toString(36)}`,
  requiredPermissions: [],
});

const feeKeys = [
  { key: 'notifications.global', label: 'Global Notifications' },
  { key: 'qdeck.upvote', label: 'Q-Deck Upvotes' },
  { key: 'qdeck.bounty', label: 'Q-Deck Bounties' },
];

export function ManagementManifestEditor({ disabled, onChange }: Props) {
  const [manifest, setManifest] = useState<ManagementManifest | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [publishing, setPublishing] = useState(false);
  const { address } = useAuth();
  const [groupOptions, setGroupOptions] = useState<GroupSummary[]>([]);

  useEffect(() => {
    if (!address) {
      setGroupOptions([]);
      return;
    }
    let alive = true;
    (async () => {
      try {
        const groups = await getAccountGroups(address);
        if (alive) setGroupOptions(groups);
      } catch {
        if (alive) setGroupOptions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [address]);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await loadManagementManifest();
      setManifest(data);
      onChange?.(data);
    } catch (e: any) {
      setError(e?.message || 'Unable to load management manifest.');
    } finally {
      setLoading(false);
    }
  }, [onChange]);

  useEffect(() => {
    load();
  }, [load]);

  const updateManifest = useCallback(
    (updater: (prev: ManagementManifest) => ManagementManifest) => {
      setManifest((prev) => {
        if (!prev) return prev;
        const next = updater(prev);
        onChange?.(next);
        return next;
      });
    },
    [onChange]
  );

  const handleRoleField = (index: number, field: keyof ManifestRole, value: string) => {
    updateManifest((prev) => {
      const roles = prev.roles.slice();
      let parsed: any = value;
      if (field === 'groupId') parsed = Number(value);
      if (field === 'membership') parsed = value === 'admin' ? 'admin' : 'member';
      const role = { ...roles[index], [field]: parsed };
      roles[index] = role;
      return { ...prev, roles, updatedAt: Date.now() };
    });
  };

  const handleRolePermissions = (index: number, value: string) => {
    const permissions = value
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    updateManifest((prev) => {
      const roles = prev.roles.slice();
      roles[index] = { ...roles[index], permissions };
      return { ...prev, roles, updatedAt: Date.now() };
    });
  };

  const handleScopeField = (index: number, field: keyof ManifestScope, value: string) => {
    updateManifest((prev) => {
      const scopes = prev.scopes.slice();
      scopes[index] = {
        ...scopes[index],
        [field]: field === 'requiredPermissions' ? scopes[index][field] : value,
      };
      return { ...prev, scopes, updatedAt: Date.now() };
    });
  };

  const handleScopePermissions = (index: number, value: string) => {
    const requiredPermissions = value
      .split(/[,\n]/)
      .map((p) => p.trim())
      .filter(Boolean);
    updateManifest((prev) => {
      const scopes = prev.scopes.slice();
      scopes[index] = { ...scopes[index], requiredPermissions };
      return { ...prev, scopes, updatedAt: Date.now() };
    });
  };

  const addRole = () => {
    updateManifest((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      roles: [...prev.roles, emptyRole()],
    }));
  };

  const removeRole = (index: number) => {
    updateManifest((prev) => {
      const roles = prev.roles.slice();
      roles.splice(index, 1);
      return { ...prev, roles, updatedAt: Date.now() };
    });
  };

  const addScope = () => {
    updateManifest((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      scopes: [...prev.scopes, emptyScope()],
    }));
  };

  const removeScope = (index: number) => {
    updateManifest((prev) => {
      const scopes = prev.scopes.slice();
      scopes.splice(index, 1);
      return { ...prev, scopes, updatedAt: Date.now() };
    });
  };

  const handleFeeChange = (
    key: string,
    field: 'baseAmount' | 'currencies' | 'allow1to1',
    value: any
  ) => {
    updateManifest((prev) => {
      const fees = { ...(prev.fees || {}) };
      const current = fees[key] || { baseAmount: 0, currencies: ['QORT'] };
      if (field === 'currencies') {
        fees[key] = { ...current, currencies: value as CurrencyCode[] };
      } else if (field === 'allow1to1') {
        fees[key] = { ...current, allow1to1: Boolean(value) };
      } else {
        fees[key] = { ...current, baseAmount: Number(value) || 0 };
      }
      return { ...prev, fees, updatedAt: Date.now() };
    });
  };

  const addDiscountTier = () => {
    updateManifest((prev) => ({
      ...prev,
      updatedAt: Date.now(),
      discounts: [...(prev.discounts || []), { assetId: 6, min: 0, max: undefined, percent: 0 }],
    }));
  };

  const updateDiscountTier = (index: number, field: keyof DiscountTier, value: string) => {
    updateManifest((prev) => {
      const discounts = [...(prev.discounts || [])];
      const current = discounts[index] || { assetId: 6, min: 0, percent: 0 };
      const parsed: DiscountTier = { ...current };
      if (field === 'assetId' || field === 'min') {
        parsed[field] = Number(value) || 0;
      } else if (field === 'max') {
        parsed.max = value === '' ? undefined : Number(value);
      } else if (field === 'percent') {
        parsed.percent = Number(value) || 0;
      }
      discounts[index] = parsed;
      return { ...prev, discounts, updatedAt: Date.now() };
    });
  };

  const removeDiscountTier = (index: number) => {
    updateManifest((prev) => {
      const discounts = [...(prev.discounts || [])];
      discounts.splice(index, 1);
      return { ...prev, discounts, updatedAt: Date.now() };
    });
  };

  const permissionsSummary = useMemo(() => {
    if (!manifest) return null;
    const all = new Set<string>();
    manifest.roles.forEach((role) => role.permissions.forEach((perm) => all.add(perm)));
    return Array.from(all).sort();
  }, [manifest]);

  const handlePublish = async () => {
    if (!manifest) return;
    setPublishing(true);
    try {
      await publishManagementManifest(manifest);
      await load();
    } catch (e: any) {
      setError(e?.message || 'Failed to publish manifest.');
    } finally {
      setPublishing(false);
    }
  };

  return (
    <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, mt: 3 }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        justifyContent="space-between"
        alignItems={{ xs: 'flex-start', sm: 'center' }}
      >
        <Box>
          <Typography variant="h6">Management permissions</Typography>
          <Typography variant="body2" color="text.secondary">
            Configure which Qortal groups hold admin/editor roles for core features.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
            Roles map Qortal groups to permission strings; scopes describe where those permissions
            apply. Fees control what users pay for specific actions. Discount tiers set Q-Asset
            holding thresholds for fee reductions. Publishing writes the manifest to QDN so the app
            enforces the new rules.
          </Typography>
        </Box>
        <Stack direction="row" spacing={1} alignItems="center">
          {error && (
            <Typography variant="body2" color="error.main">
              {error}
            </Typography>
          )}
          <Button size="small" startIcon={<RefreshRoundedIcon />} onClick={load} disabled={loading}>
            Reload
          </Button>
          <Button
            variant="contained"
            size="small"
            onClick={handlePublish}
            disabled={disabled || loading || !manifest || publishing}
          >
            {publishing ? 'Publishing…' : 'Publish'}
          </Button>
        </Stack>
      </Stack>

      {loading || !manifest ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
          <CircularProgress size={28} />
        </Box>
      ) : (
        <>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 2, flexWrap: 'wrap' }}>
            <Chip label={`Version ${manifest.version}`} size="small" />
            <Chip
              label={`Updated ${new Date(manifest.updatedAt).toLocaleString()}`}
              size="small"
              color="info"
            />
            {permissionsSummary && permissionsSummary.length > 0 && (
              <Chip label={`${permissionsSummary.length} permissions`} size="small" />
            )}
          </Stack>

          <Box sx={{ mt: 2, maxWidth: 300 }}>
            <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
              Content expiry (days)
            </Typography>
            <TextField
              fullWidth
              type="number"
              size="small"
              inputProps={{ min: 0 }}
              value={manifest.defaultNewsPromoExpiryDays ?? ''}
              onChange={(e) =>
                updateManifest((prev) => ({
                  ...prev,
                  updatedAt: Date.now(),
                  defaultNewsPromoExpiryDays: Number(e.target.value) || 0,
                }))
              }
              helperText="Announcements and asset news older than this move to Archived. Use 0 to keep everything active."
              disabled={disabled}
            />
          </Box>

          <Box sx={{ mt: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1">Roles</Typography>
              <IconButton size="small" onClick={addRole} disabled={disabled}>
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
            {manifest.roles.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No roles defined. Add at least one role mapping to a Qortal group.
              </Typography>
            ) : (
              <Grid container spacing={2}>
                {manifest.roles.map((role, idx) => (
                  <Grid key={role.id} size={{ xs: 12, md: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Set which group (and membership level) controls these permissions. Avoid
                        changing Role ID unless you are migrating to a new identifier.
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {role.label}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => removeRole(idx)}
                          disabled={disabled}
                        >
                          <DeleteRoundedIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                      <TextField
                        label="Role Label"
                        fullWidth
                        sx={{ mb: 1 }}
                        value={role.label}
                        onChange={(e) => handleRoleField(idx, 'label', e.target.value)}
                        disabled={disabled}
                      />
                      <TextField
                        label="Role ID"
                        fullWidth
                        sx={{ mb: 1 }}
                        value={role.id}
                        onChange={(e) => handleRoleField(idx, 'id', e.target.value)}
                        disabled={disabled}
                      />
                      <FormControl size="small" fullWidth sx={{ mb: 1 }}>
                        <InputLabel id={`group-${role.id}`}>Group</InputLabel>
                        <Select
                          labelId={`group-${role.id}`}
                          label="Group"
                          value={role.groupId || ''}
                          onChange={(e) => handleRoleField(idx, 'groupId', String(e.target.value))}
                          disabled={disabled}
                        >
                          <MenuItem value="">
                            <em>Select group…</em>
                          </MenuItem>
                          {groupOptions.map((group) => (
                            <MenuItem key={group.groupId} value={group.groupId}>
                              {group.groupName} (#{group.groupId})
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                      <TextField
                        label="Membership requirement"
                        select
                        fullWidth
                        sx={{ mb: 1 }}
                        value={role.membership || 'member'}
                        onChange={(e) => handleRoleField(idx, 'membership', e.target.value)}
                        disabled={disabled}
                      >
                        <MenuItem value="member">Member</MenuItem>
                        <MenuItem value="admin">Admin</MenuItem>
                      </TextField>
                      <TextField
                        label="Permissions (comma separated)"
                        fullWidth
                        multiline
                        minRows={2}
                        value={role.permissions.join(', ')}
                        onChange={(e) => handleRolePermissions(idx, e.target.value)}
                        disabled={disabled}
                      />
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            )}
          </Box>

          <Box sx={{ mt: 3 }}>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1">Scopes</Typography>
              <IconButton size="small" onClick={addScope} disabled={disabled}>
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
            {manifest.scopes.length === 0 ? (
              <Typography variant="body2" color="text.secondary">
                No scopes defined. Add scopes to describe which permissions are needed per feature.
              </Typography>
            ) : (
              <Grid container spacing={2}>
                {manifest.scopes.map((scope, idx) => (
                  <Grid key={`${scope.type}-${scope.identifier}-${idx}`} size={{ xs: 12, md: 6 }}>
                    <Paper variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                      <Typography variant="body2" color="text.secondary" sx={{ mb: 1 }}>
                        Scopes describe where permissions are required (e.g., notifications:global).
                        Do not remove requiredPermissions unless the feature no longer needs them.
                      </Typography>
                      <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {scope.type}:{scope.identifier}
                        </Typography>
                        <IconButton
                          size="small"
                          onClick={() => removeScope(idx)}
                          disabled={disabled}
                        >
                          <DeleteRoundedIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                      <TextField
                        label="Scope Type"
                        fullWidth
                        sx={{ mb: 1 }}
                        value={scope.type}
                        onChange={(e) => handleScopeField(idx, 'type', e.target.value)}
                        disabled={disabled}
                      />
                      <TextField
                        label="Scope Identifier"
                        fullWidth
                        sx={{ mb: 1 }}
                        value={scope.identifier}
                        onChange={(e) => handleScopeField(idx, 'identifier', e.target.value)}
                        disabled={disabled}
                      />
                      <TextField
                        label="Required permissions"
                        fullWidth
                        multiline
                        minRows={2}
                        value={scope.requiredPermissions.join(', ')}
                        onChange={(e) => handleScopePermissions(idx, e.target.value)}
                        disabled={disabled}
                      />
                    </Paper>
                  </Grid>
                ))}
              </Grid>
            )}
          </Box>

          <Divider sx={{ my: 3 }} />

          <Box>
            <Typography variant="subtitle1" sx={{ mb: 1 }}>
              Fees
            </Typography>
            <Stack spacing={1.5}>
              {feeKeys.map(({ key, label }) => {
                const fee = manifest.fees?.[key] || { baseAmount: 0, currencies: ['QORT'] };
                return (
                  <Paper key={key} variant="outlined" sx={{ p: 2, borderRadius: 2 }}>
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      Base amount is charged per action. Allowed currencies restrict what users can
                      pay with. 1:1 treats Q-Asset equal to QORT for this fee.
                    </Typography>
                    <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 1 }}>
                      {label}
                    </Typography>
                    <TextField
                      label="Base amount"
                      type="number"
                      size="small"
                      sx={{ mb: 1 }}
                      value={fee.baseAmount}
                      onChange={(e) => handleFeeChange(key, 'baseAmount', e.target.value)}
                      disabled={disabled}
                    />
                    <FormControl fullWidth size="small" sx={{ mb: 1 }}>
                      <InputLabel id={`fee-curr-${key}`}>Allowed currencies</InputLabel>
                      <Select
                        labelId={`fee-curr-${key}`}
                        label="Allowed currencies"
                        multiple
                        value={fee.currencies || []}
                        onChange={(e) =>
                          handleFeeChange(
                            key,
                            'currencies',
                            (e.target.value as string[]).filter(Boolean) as CurrencyCode[]
                          )
                        }
                        disabled={disabled}
                      >
                        <MenuItem value="QORT">QORT</MenuItem>
                        <MenuItem value="QASSET">Q-Asset</MenuItem>
                      </Select>
                    </FormControl>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={fee.allow1to1 ?? true}
                          onChange={(e) => handleFeeChange(key, 'allow1to1', e.target.checked)}
                          disabled={disabled}
                        />
                      }
                      label="Treat Q-Asset/QORT 1:1"
                    />
                  </Paper>
                );
              })}
            </Stack>
          </Box>

          <Divider sx={{ my: 3 }} />

          <Box>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
              <Typography variant="subtitle1">Discount tiers (Q-Asset holdings)</Typography>
              <IconButton size="small" onClick={addDiscountTier} disabled={disabled}>
                <AddRoundedIcon fontSize="small" />
              </IconButton>
            </Stack>
            {manifest.discounts?.length ? (
              <Stack spacing={1.5}>
                {manifest.discounts.map((tier, idx) => (
                  <Paper
                    key={`${tier.assetId}-${tier.min}-${idx}`}
                    variant="outlined"
                    sx={{ p: 2 }}
                  >
                    <Typography variant="body2" color="text.secondary" sx={{ mb: 0.5 }}>
                      Discounts apply when holdings meet the min (and optional max) for this asset.
                      Leave max empty to cover all balances above min.
                    </Typography>
                    <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1 }}>
                      <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                        Tier {idx + 1}
                      </Typography>
                      <IconButton
                        size="small"
                        onClick={() => removeDiscountTier(idx)}
                        disabled={disabled}
                      >
                        <DeleteRoundedIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    <Grid container spacing={2}>
                      <Grid size={{ xs: 12, sm: 3 }}>
                        <TextField
                          label="Asset ID"
                          type="number"
                          fullWidth
                          size="small"
                          value={tier.assetId}
                          onChange={(e) => updateDiscountTier(idx, 'assetId', e.target.value)}
                          disabled={disabled}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 3 }}>
                        <TextField
                          label="Min holdings"
                          type="number"
                          fullWidth
                          size="small"
                          value={tier.min}
                          onChange={(e) => updateDiscountTier(idx, 'min', e.target.value)}
                          disabled={disabled}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 3 }}>
                        <TextField
                          label="Max holdings"
                          type="number"
                          fullWidth
                          size="small"
                          value={tier.max ?? ''}
                          onChange={(e) => updateDiscountTier(idx, 'max', e.target.value)}
                          disabled={disabled}
                        />
                      </Grid>
                      <Grid size={{ xs: 12, sm: 3 }}>
                        <TextField
                          label="Discount %"
                          type="number"
                          fullWidth
                          size="small"
                          value={tier.percent}
                          onChange={(e) => updateDiscountTier(idx, 'percent', e.target.value)}
                          disabled={disabled}
                        />
                      </Grid>
                    </Grid>
                  </Paper>
                ))}
              </Stack>
            ) : (
              <Typography variant="body2" color="text.secondary">
                No discount tiers defined.
              </Typography>
            )}
          </Box>
        </>
      )}
    </Paper>
  );
}
