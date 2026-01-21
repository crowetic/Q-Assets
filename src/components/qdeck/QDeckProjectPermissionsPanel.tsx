import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Box,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Divider,
  IconButton,
  Stack,
  Switch,
  TextField,
  Tooltip,
  Typography,
  Button,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
} from '@mui/material';
import RefreshIcon from '@mui/icons-material/Refresh';
import SaveIcon from '@mui/icons-material/Save';
import AddIcon from '@mui/icons-material/Add';
import { QDeckProject } from '../../types/qdeck';
import { loadProjectsIndexMerged } from '../../utils/qdeckProjectIndexCache';
import { resolveProjectForRead, saveProjectDoc } from '../../utils/qdeckApi';
import { useAuth } from 'qapp-core';
// import pLimit from 'p-limit';
import { getAccountGroups, type GroupSummary } from '../../utils/qortalApi';
import { fetchGroupMembers } from '../../utils/access';
import { isQAddressFormat } from '../../utils/address';

declare function qortalRequest<T = any>(request: any): Promise<T>;

type EditableProject = QDeckProject & {
  isDirty?: boolean;
  newOwner?: string;
  newEditor?: string;
  newOwnerGroup?: string;
  newEditorGroup?: string;
  encryption?: string;
};

export default function QDeckProjectPermissionsPanel() {
  const { name: myName, address: myAddress } = useAuth() as any;
  const [projects, setProjects] = useState<EditableProject[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // const limit = useMemo(() => pLimit(2), []);
  const [myGroups, setMyGroups] = useState<GroupSummary[]>([]);
  const groupMemberCacheRef = useRef(new Map<number, Set<string>>());
  const nameAddressCacheRef = useRef(new Map<string, string>());
  const publicKeyCacheRef = useRef(new Map<string, string>());

  const resolveNameToAddress = useCallback(async (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return null;
    const cached = nameAddressCacheRef.current.get(trimmed);
    if (cached) return cached;
    if (isQAddressFormat(trimmed)) {
      nameAddressCacheRef.current.set(trimmed, trimmed);
      return trimmed;
    }
    try {
      const data = await qortalRequest({ action: 'GET_NAME_DATA', name: trimmed });
      const owner = data?.owner;
      if (typeof owner === 'string' && owner.trim()) {
        const addr = owner.trim();
        nameAddressCacheRef.current.set(trimmed, addr);
        return addr;
      }
    } catch {
      /* empty */
    }
    return null;
  }, []);

  const resolvePublicKey = useCallback(async (address: string) => {
    const trimmed = address.trim();
    if (!trimmed) return null;
    const cached = publicKeyCacheRef.current.get(trimmed);
    if (cached) return cached;
    try {
      const data = await qortalRequest({ action: 'GET_ACCOUNT_DATA', address: trimmed });
      const publicKey = data?.publicKey;
      if (typeof publicKey === 'string' && publicKey.trim()) {
        const pk = publicKey.trim();
        publicKeyCacheRef.current.set(trimmed, pk);
        return pk;
      }
    } catch {
      /* empty */
    }
    return null;
  }, []);

  const loadGroupMemberSet = useCallback(async (groupId: number) => {
    const cached = groupMemberCacheRef.current.get(groupId);
    if (cached) return cached;
    const rows = await fetchGroupMembers(false, groupId).catch(() => []);
    const set = new Set(
      rows.map((row) => String(row?.address || row?.member || '').trim()).filter(Boolean)
    );
    groupMemberCacheRef.current.set(groupId, set);
    return set;
  }, []);

  const canAddPrivateMember = useCallback(
    async (project: EditableProject, nameOrAddress: string) => {
      if (project.visibility !== 'private') return { ok: true };
      const mode =
        project.privateMeta?.mode ?? (project.privateMeta?.groupId != null ? 'group' : 'direct');

      if (mode === 'group') {
        const groupId = project.privateMeta?.groupId;
        if (!groupId) {
          return { ok: false, reason: 'Private project missing encryption group.' };
        }
        const address = await resolveNameToAddress(nameOrAddress);
        if (!address) {
          return { ok: false, reason: `Unable to resolve "${nameOrAddress}".` };
        }
        const members = await loadGroupMemberSet(groupId);
        if (!members.has(address)) {
          return {
            ok: false,
            reason: `Only members of group #${groupId} can be added to private projects.`,
          };
        }
        return { ok: true };
      }

      if (mode === 'direct') {
        const recipients = project.privateMeta?.recipients;
        if (!recipients?.length) {
          return {
            ok: false,
            reason: 'Direct encrypted projects can only add existing recipients.',
          };
        }
        const address = await resolveNameToAddress(nameOrAddress);
        if (!address) {
          return { ok: false, reason: `Unable to resolve "${nameOrAddress}".` };
        }
        const publicKey = await resolvePublicKey(address);
        if (!publicKey) {
          return { ok: false, reason: 'Unable to resolve account public key.' };
        }
        if (!recipients.includes(publicKey)) {
          return {
            ok: false,
            reason: 'Only existing encryption recipients can be added to private projects.',
          };
        }
      }

      return { ok: true };
    },
    [loadGroupMemberSet, resolveNameToAddress, resolvePublicKey]
  );

  const canAddPrivateGroup = useCallback((project: EditableProject, groupId: number) => {
    if (project.visibility !== 'private') return { ok: true };
    const mode =
      project.privateMeta?.mode ?? (project.privateMeta?.groupId != null ? 'group' : 'direct');
    if (mode !== 'group') {
      return {
        ok: false,
        reason: 'Direct encrypted projects do not allow group-based permissions.',
      };
    }
    const privateGroupId = project.privateMeta?.groupId;
    if (!privateGroupId) {
      return { ok: false, reason: 'Private project missing encryption group.' };
    }
    if (groupId !== privateGroupId) {
      return {
        ok: false,
        reason: `Only group #${privateGroupId} can be added to this private project.`,
      };
    }
    return { ok: true };
  }, []);

  const load = async () => {
    setLoading(true);
    setError(null);
    try {
      if (!myName) throw new Error('Authenticate to load your projects');
      const idx = await loadProjectsIndexMerged(myName);
      const entries = idx?.projects ?? [];
      const mapped: EditableProject[] = [];

      for (const entry of entries) {
        const issuer = idx?.issuerName || myName;
        const resolved = await resolveProjectForRead(
          issuer,
          entry.projectId,
          entry.visibility
        ).catch(() => null);
        const base = resolved || (entry as any);
        const ownerGroups = base.ownerGroups || [];
        const editorGroups = Array.from(
          new Set([...(base.editorGroups || base.groupsAllowed || []), ...ownerGroups])
        );
        const privMode =
          base.privateMeta?.mode ?? (base.privateMeta?.groupId != null ? 'group' : entry.mode);

        mapped.push({
          ...(base as any),
          visibility: base.visibility ?? entry.visibility,
          owners: base.owners || [base.createdBy || issuer || myName],
          ownerGroups,
          editors: base.editors || base.usersAllowed || [],
          editorGroups,
          createdBy: base.createdBy || issuer || myName,
          encryption:
            entry.visibility === 'private'
              ? privMode === 'direct'
                ? 'Direct'
                : privMode === 'group'
                  ? 'Group'
                  : 'Private'
              : undefined,
        });
      }
      setProjects(mapped);
    } catch (e: any) {
      setError(e?.message || 'Failed to load projects index');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, [myName]);

  useEffect(() => {
    if (!myAddress) {
      setMyGroups([]);
      return;
    }
    getAccountGroups(myAddress)
      .then((gs) => setMyGroups(gs))
      .catch(() => setMyGroups([]));
  }, [myAddress]);

  const addName = async (project: EditableProject, field: 'owners' | 'editors', value?: string) => {
    const v = (value || '').trim();
    if (!v) return false;
    const allowed = await canAddPrivateMember(project, v);
    if (!allowed.ok) {
      setError(allowed.reason || 'Unable to add member.');
      return false;
    }
    setProjects((prev) =>
      prev.map((p) =>
        p.projectId === project.projectId
          ? { ...p, [field]: Array.from(new Set([...(p[field] || []), v])), isDirty: true }
          : p
      )
    );
    return true;
  };

  const removeName = (projectId: string, field: 'owners' | 'editors', value: string) => {
    setProjects((prev) =>
      prev.map((p) =>
        p.projectId === projectId
          ? { ...p, [field]: (p[field] || []).filter((x) => x !== value), isDirty: true }
          : p
      )
    );
  };

  const addOwnerGroup = async (project: EditableProject, groupId: number) => {
    const allowed = canAddPrivateGroup(project, groupId);
    if (!allowed.ok) {
      setError(allowed.reason || 'Unable to add group.');
      return false;
    }
    setProjects((prev) =>
      prev.map((p) => {
        if (p.projectId !== project.projectId) return p;
        const ownerGroups = Array.from(new Set([...(p.ownerGroups || []), groupId]));
        const editorGroups = Array.from(new Set([...(p.editorGroups || []), groupId]));
        return { ...p, ownerGroups, editorGroups, isDirty: true };
      })
    );
    return true;
  };

  const addEditorGroup = async (project: EditableProject, groupId: number) => {
    const allowed = canAddPrivateGroup(project, groupId);
    if (!allowed.ok) {
      setError(allowed.reason || 'Unable to add group.');
      return false;
    }
    setProjects((prev) =>
      prev.map((p) => {
        if (p.projectId !== project.projectId) return p;
        const editorGroups = Array.from(new Set([...(p.editorGroups || []), groupId]));
        return { ...p, editorGroups, isDirty: true };
      })
    );
    return true;
  };

  const dirtyCount = useMemo(() => projects.filter((p) => p.isDirty).length, [projects]);

  const saveAll = async () => {
    if (!myName) return setError('Authenticate first.');
    const dirtyProjects = projects.filter((p) => p.isDirty);
    if (!dirtyProjects.length) return;
    setLoading(true);
    setError(null);

    try {
      for (const p of dirtyProjects) {
        const resolved = await resolveProjectForRead(
          myName,
          p.projectId,
          p.visibility as any
        ).catch(() => null);
        if (!resolved) {
          setError(`Failed to load project ${p.title} for save`);
          continue;
        }

        const next: QDeckProject = { ...resolved };
        next.updatedAt = Date.now();
        next.owners = p.owners && p.owners.length ? p.owners : [next.createdBy];
        next.ownerGroups = p.ownerGroups ?? [];
        next.editors = p.editors ?? [];
        next.editorGroups = p.editorGroups ?? [];
        next.adminOverride = !!p.adminOverride;

        next.usersAllowed = next.editors;
        next.groupsAllowed = next.editorGroups?.length ? next.editorGroups : next.groupsAllowed;

        await saveProjectDoc(myName, next);
      }

      await load();
      setProjects((prev) => prev.map((p) => ({ ...p, isDirty: false })));
    } catch (e: any) {
      setError(e?.message || 'Failed to save changes');
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card variant="outlined" sx={{ p: 1.5 }}>
      <CardHeader
        title="Q-Deck Project Permissions"
        subheader="Manage project admins/editors and adjust override permissions."
        action={
          <Stack direction="row" spacing={1} alignItems="center">
            <Tooltip title="Reload projects">
              <IconButton size="small" onClick={load} disabled={loading}>
                <RefreshIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <Button
              size="small"
              variant="contained"
              startIcon={<SaveIcon />}
              disabled={dirtyCount === 0 || loading}
              onClick={saveAll}
            >
              Save changes
            </Button>
          </Stack>
        }
      />
      <Divider />
      {error && (
        <Typography color="error" variant="body2" sx={{ mt: 1, mb: 1 }}>
          {error}
        </Typography>
      )}
      {projects.length === 0 && !loading ? (
        <Typography variant="body2" color="text.secondary" sx={{ p: 2 }}>
          No projects found for your account.
        </Typography>
      ) : (
        <Stack spacing={1.5} sx={{ mt: 1 }}>
          {projects.map((p) => {
            const isPriv = p.visibility === 'private';
            const privateMode =
              p.privateMeta?.mode ?? (p.privateMeta?.groupId != null ? 'group' : 'direct');
            const privateGroupId = p.privateMeta?.groupId;
            const groupSelectDisabled =
              isPriv && (privateMode !== 'group' || privateGroupId == null);
            const filteredGroups =
              isPriv && privateMode === 'group' && privateGroupId != null
                ? myGroups.filter((g) => g.groupId === privateGroupId)
                : myGroups;
            const groupOptions =
              filteredGroups.length === 0 && isPriv && privateMode === 'group' && privateGroupId
                ? [{ groupId: privateGroupId, groupName: undefined, isOpen: false }]
                : filteredGroups;
            const privateNote = isPriv
              ? privateMode === 'group'
                ? `Private project: only members of group #${
                    privateGroupId ?? 'unknown'
                  } can be added, and encryption settings stay fixed.`
                : 'Private project uses direct encryption; only existing recipients can be added.'
              : null;
            return (
              <Card key={p.projectId} variant="outlined">
                {privateNote && (
                  <Box sx={{ p: 1, pb: 0 }}>
                    <Typography variant="caption" color="text.secondary">
                      {privateNote}
                    </Typography>
                  </Box>
                )}
                <CardContent>
                  <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                    <Box>
                      <Typography variant="subtitle1">{p.title}</Typography>
                      <Typography variant="caption" color="text.secondary">
                        {p.projectId} · {p.visibility}
                        {p.encryption ? ` (${p.encryption})` : ''} · {p.createdBy}
                      </Typography>
                    </Box>
                    {p.isDirty && (
                      <Chip size="small" color="warning" label="Unsaved" sx={{ fontWeight: 600 }} />
                    )}
                  </Box>

                  <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ mt: 1 }}>
                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={700}>
                        Admins
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(p.owners || []).map((o) => (
                          <Chip
                            key={o}
                            label={o}
                            onDelete={() => removeName(p.projectId, 'owners', o)}
                            size="small"
                          />
                        ))}
                      </Stack>
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <TextField
                          size="small"
                          label="Add admin (name)"
                          value={(p as any).newOwner || ''}
                          onChange={(e) =>
                            setProjects((prev) =>
                              prev.map((x) =>
                                x.projectId === p.projectId ? { ...x, newOwner: e.target.value } : x
                              )
                            )
                          }
                          fullWidth
                        />
                        <IconButton
                          color="primary"
                          onClick={async () => {
                            const ok = await addName(p, 'owners', (p as any).newOwner);
                            if (!ok) return;
                            setProjects((prev) =>
                              prev.map((x) =>
                                x.projectId === p.projectId ? { ...x, newOwner: '' } : x
                              )
                            );
                          }}
                        >
                          <AddIcon />
                        </IconButton>
                      </Stack>

                      <Typography variant="body2" fontWeight={700} sx={{ mt: 1 }}>
                        Admin Groups (admins of these groups)
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(p.ownerGroups || []).map((g) => {
                          const group = myGroups.find((mg) => mg.groupId === g);
                          const label = group ? `${group.groupName} (#${g})` : `Group ${g}`;
                          return (
                            <Chip
                              key={g}
                              label={label}
                              onDelete={() =>
                                setProjects((prev) =>
                                  prev.map((x) =>
                                    x.projectId === p.projectId
                                      ? {
                                          ...x,
                                          ownerGroups: (x.ownerGroups || []).filter(
                                            (id) => id !== g
                                          ),
                                          isDirty: true,
                                        }
                                      : x
                                  )
                                )
                              }
                              size="small"
                            />
                          );
                        })}
                      </Stack>
                      <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                        <InputLabel>Add admin group</InputLabel>
                        <Select
                          label="Add admin group"
                          value=""
                          onChange={async (e) => {
                            const val = Number(e.target.value);
                            if (!Number.isFinite(val)) return;
                            await addOwnerGroup(p, val);
                          }}
                          disabled={groupSelectDisabled}
                        >
                          <MenuItem value="">
                            <em>Select group…</em>
                          </MenuItem>
                          {groupOptions.map((g) => (
                            <MenuItem key={g.groupId} value={g.groupId}>
                              {g.groupName
                                ? `${g.groupName} (#${g.groupId})`
                                : `Group #${g.groupId}`}{' '}
                              {g.isOpen ? '(public)' : '(private)'}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>

                    <Box sx={{ flex: 1 }}>
                      <Typography variant="body2" fontWeight={700}>
                        Editors
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(p.editors || []).map((o) => (
                          <Chip
                            key={o}
                            label={o}
                            onDelete={() => removeName(p.projectId, 'editors', o)}
                            size="small"
                          />
                        ))}
                      </Stack>
                      <Stack direction="row" spacing={1} sx={{ mt: 1 }}>
                        <TextField
                          size="small"
                          label="Add editor (name)"
                          value={(p as any).newEditor || ''}
                          onChange={(e) =>
                            setProjects((prev) =>
                              prev.map((x) =>
                                x.projectId === p.projectId
                                  ? { ...x, newEditor: e.target.value }
                                  : x
                              )
                            )
                          }
                          fullWidth
                        />
                        <IconButton
                          color="primary"
                          onClick={async () => {
                            const ok = await addName(p, 'editors', (p as any).newEditor);
                            if (!ok) return;
                            setProjects((prev) =>
                              prev.map((x) =>
                                x.projectId === p.projectId ? { ...x, newEditor: '' } : x
                              )
                            );
                          }}
                        >
                          <AddIcon />
                        </IconButton>
                      </Stack>

                      <Typography variant="body2" fontWeight={700} sx={{ mt: 1 }}>
                        Editor Groups
                      </Typography>
                      <Stack direction="row" spacing={0.5} flexWrap="wrap">
                        {(p.editorGroups || []).map((g) => {
                          const group = myGroups.find((mg) => mg.groupId === g);
                          const label = group ? `${group.groupName} (#${g})` : `Group ${g}`;
                          return (
                            <Chip
                              key={g}
                              label={label}
                              onDelete={() =>
                                setProjects((prev) =>
                                  prev.map((x) =>
                                    x.projectId === p.projectId
                                      ? {
                                          ...x,
                                          editorGroups: (x.editorGroups || []).filter(
                                            (id) => id !== g
                                          ),
                                          isDirty: true,
                                        }
                                      : x
                                  )
                                )
                              }
                              size="small"
                            />
                          );
                        })}
                      </Stack>
                      <FormControl fullWidth size="small" sx={{ mt: 1 }}>
                        <InputLabel>Add editor group</InputLabel>
                        <Select
                          label="Add editor group"
                          value=""
                          onChange={async (e) => {
                            const val = Number(e.target.value);
                            if (!Number.isFinite(val)) return;
                            await addEditorGroup(p, val);
                          }}
                          disabled={groupSelectDisabled}
                        >
                          <MenuItem value="">
                            <em>Select group…</em>
                          </MenuItem>
                          {groupOptions.map((g) => (
                            <MenuItem key={g.groupId} value={g.groupId}>
                              {g.groupName
                                ? `${g.groupName} (#${g.groupId})`
                                : `Group #${g.groupId}`}{' '}
                              {g.isOpen ? '(public)' : '(private)'}
                            </MenuItem>
                          ))}
                        </Select>
                      </FormControl>
                    </Box>
                  </Stack>

                  <Divider sx={{ my: 1 }} />

                  <Tooltip title="Allow admins of editor groups to override project publishes.">
                    <Box>
                      <Typography variant="body2">Admin override</Typography>
                      <Switch
                        checked={!!p.adminOverride}
                        onChange={() =>
                          setProjects((prev) =>
                            prev.map((x) =>
                              x.projectId === p.projectId
                                ? { ...x, adminOverride: !x.adminOverride, isDirty: true }
                                : x
                            )
                          )
                        }
                      />
                    </Box>
                  </Tooltip>
                </CardContent>
              </Card>
            );
          })}
        </Stack>
      )}
    </Card>
  );
}
