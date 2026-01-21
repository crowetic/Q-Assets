import * as React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Checkbox,
  Chip,
  Alert,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';
import LockIcon from '@mui/icons-material/Lock';
import { useAuth } from 'qapp-core';

import {
  canEncryptToGroup,
  createProjectAndIndex,
  isGroupKeyMissing,
  qdeckFetch,
} from '../utils/qdeckApi';
import { loadProjectsIndexMerged } from '../utils/qdeckProjectIndexCache';
import { searchSimpleByIdPrefixOnly } from '../utils/searchSimple';
import { parsePrivateProjectIdentV2, QDeckId } from '../constants/qdeckIdentifiers';
import type { ProjectsIndexDoc, AnyProject, QDeckProject } from '../types/qdeck';
import { coerceService, coerceVisibility } from '../types/qdeck';
import { getAccountGroups, GroupSummary } from '../utils/qortalApi';
import { useAlert } from '../components/alerts';
import { pastelBgFromId, pastelBorderFromId } from '../utils/qdeckColors';

type ProjectLoadStatus = 'queued' | 'loading' | 'decrypting' | 'loaded' | 'error';
type OwnedProjectDetail = {
  status: ProjectLoadStatus;
  statusMessage?: string;
  updatedAt?: number;
  createdAt?: number;
  identifier?: string;
  service?: AnyProject['service'];
  visibility?: AnyProject['visibility'];
  owners?: string[];
  ownerGroups?: number[];
  editors?: string[];
  editorGroups?: number[];
  groupsAllowed?: number[];
  usersAllowed?: string[];
};

const formatRelativeTime = (timestamp?: number) => {
  if (!timestamp) return 'Unknown';
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return 'Just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

export default function QDeckProjects() {
  const [doc, setDoc] = React.useState<ProjectsIndexDoc | null>(null);
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [projectDetails, setProjectDetails] = React.useState<Record<string, OwnedProjectDetail>>(
    {}
  );

  const [groupOptions, setGroupOptions] = React.useState<GroupSummary[]>([]);
  const [groupsAllowedIds, setGroupsAllowedIds] = React.useState<number[]>([]);
  const [usersAllowedText, setUsersAllowedText] = React.useState<string>('');
  const [visibility, setVisibility] = React.useState<'public' | 'private'>('public');
  const [privateGroupId, setPrivateGroupId] = React.useState<number | null>(null);
  const [isAdminsOnly, setIsAdminsOnly] = React.useState(false);

  const theme = useTheme();
  const { alert } = useAlert();
  const { name: userName, address: myAddress, authenticateUser } = useAuth();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

  let issuer = userName;
  if (!issuer) authenticateUser();
  issuer = userName as string;

  const selectedGroups = React.useMemo(
    () => groupOptions.filter((g) => groupsAllowedIds.includes(g.groupId)),
    [groupOptions, groupsAllowedIds]
  );
  const selectedPrivateGroups = selectedGroups.filter((g) => !g.isOpen);
  const selectedPublicGroups = selectedGroups.filter((g) => g.isOpen);
  const canUseGroupEncryption =
    visibility === 'private' &&
    selectedPrivateGroups.length === 1 &&
    selectedPublicGroups.length === 0;
  const needsDirectEncryptionWarning = visibility === 'private' && !canUseGroupEncryption;

  React.useEffect(() => {
    if (visibility !== 'private') {
      setPrivateGroupId(null);
      return;
    }
    if (canUseGroupEncryption) {
      const only = selectedPrivateGroups[0];
      if (only && privateGroupId !== only.groupId) setPrivateGroupId(only.groupId);
    } else if (privateGroupId !== null) {
      setPrivateGroupId(null);
    }
  }, [visibility, canUseGroupEncryption, selectedPrivateGroups, privateGroupId]);

  const hydrateOwnedProject = React.useCallback(
    async (head: { identifier: string; name: string; created?: number; updated?: number }) => {
      const isPrivate = head.identifier.startsWith(QDeckId.prefixPrivateProjects);
      const parsed = isPrivate ? parsePrivateProjectIdentV2(head.identifier) : undefined;
      const shortId = isPrivate
        ? (parsed?.projectId ?? head.identifier)
        : head.identifier.replace(QDeckId.prefixPublicProjects, '');
      if (!shortId) return;

      setProjectDetails((prev) => ({
        ...prev,
        [shortId]: {
          ...(prev[shortId] ?? {}),
          identifier: head.identifier,
          status: isPrivate ? 'decrypting' : 'loading',
          statusMessage: isPrivate ? 'Decrypting private project…' : 'Fetching project metadata…',
        },
      }));

      try {
        const doc = await qdeckFetch<QDeckProject>(
          head.name,
          head.identifier,
          isPrivate,
          parsed?.mode === 'group' ? parsed.groupId : undefined,
          parsed?.mode === 'group' ? !!parsed.isAdmins : undefined,
          parsed?.mode ?? 'group'
        );
        if (!doc || (doc as any)?._type === 'QDECK_TOMBSTONE') {
          setProjectDetails((prev) => ({
            ...prev,
            [shortId]: {
              ...(prev[shortId] ?? {}),
              status: 'error',
              statusMessage: 'Project not found or deleted.',
            },
          }));
          return;
        }
        setProjectDetails((prev) => ({
          ...prev,
          [shortId]: {
            status: 'loaded',
            statusMessage: 'Project ready.',
            identifier: head.identifier,
            updatedAt: doc.updatedAt,
            createdAt: doc.createdAt,
            service: coerceService(doc.service ?? prev[shortId]?.service ?? 'DOCUMENT'),
            visibility: coerceVisibility(doc.visibility ?? prev[shortId]?.visibility ?? 'public'),
            owners: doc.owners ?? prev[shortId]?.owners ?? [],
            ownerGroups: doc.ownerGroups ?? prev[shortId]?.ownerGroups ?? [],
            editors: doc.editors ?? prev[shortId]?.editors ?? [],
            editorGroups: doc.editorGroups ?? prev[shortId]?.editorGroups ?? [],
            groupsAllowed: doc.groupsAllowed ?? prev[shortId]?.groupsAllowed ?? [],
            usersAllowed: doc.usersAllowed ?? prev[shortId]?.usersAllowed ?? [],
          },
        }));
      } catch (error: any) {
        setProjectDetails((prev) => ({
          ...prev,
          [shortId]: {
            ...(prev[shortId] ?? {}),
            status: 'error',
            identifier: head.identifier,
            statusMessage:
              typeof error?.message === 'string'
                ? error.message
                : 'Unable to load project metadata.',
          },
        }));
      }
    },
    []
  );

  const load = React.useCallback(async () => {
    if (!issuer) return;

    const merged = await loadProjectsIndexMerged(issuer).catch(() => null);
    if (merged) {
      setDoc(merged);
      return;
    }

    const pubHeads = await searchSimpleByIdPrefixOnly(QDeckId.prefixPublicProjects, false);
    const myPub = pubHeads.filter((h) => h.name === issuer);
    const privHeads = await searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateProjects, true);
    const myPriv = privHeads.filter((h) => h.name === issuer);

    const compact: ProjectsIndexDoc['projects'] = [];

    await Promise.all(
      [...myPub, ...myPriv].map(async (h) => {
        const isPrivate = h.identifier.startsWith(QDeckId.prefixPrivateProjects);
        const parsed = isPrivate ? parsePrivateProjectIdentV2(h.identifier) : null;
        const shortId = isPrivate
          ? (parsed?.projectId ?? h.identifier)
          : h.identifier.replace(QDeckId.prefixPublicProjects, '');
        if (!shortId) return;
        try {
          const doc = await qdeckFetch<QDeckProject>(
            h.name,
            h.identifier,
            isPrivate,
            parsed?.mode === 'group' ? parsed.groupId : undefined,
            parsed?.mode === 'group' ? !!parsed.isAdmins : undefined,
            parsed?.mode ?? 'group'
          );
          if (!doc || (doc as any)?._type === 'QDECK_TOMBSTONE') return;
          compact.push({
            projectId: doc.projectId,
            title: doc.title,
            createdAt: doc.createdAt,
            updatedAt: doc.updatedAt,
            visibility: coerceVisibility(doc.visibility ?? 'public'),
            service: coerceService(doc.service ?? 'DOCUMENT'),
            mode: doc.privateMeta?.mode ?? 'group',
          });
        } catch {
          compact.push({
            projectId: shortId,
            title: '(Private project)',
            createdAt: Number(h.created) || 0,
            updatedAt: Number(h.updated) || 0,
            visibility: 'private',
            service: 'DOCUMENT_PRIVATE',
            mode: parsed?.mode ?? 'group',
          });
        }
      })
    );

    setDoc({
      _type: 'QDECK_PROJECTS_INDEX',
      version: 1,
      issuerName: issuer,
      projects: compact,
      updatedAt: Date.now(),
      seq: 0,
    });
  }, [issuer]);

  React.useEffect(() => {
    load().catch(console.error);
  }, [load]);

  React.useEffect(() => {
    if (!doc?.issuerName) {
      setProjectDetails({});
      return;
    }
    (async () => {
      try {
        const [pubHeads, privHeads] = await Promise.all([
          searchSimpleByIdPrefixOnly(QDeckId.prefixPublicProjects, false),
          searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateProjects, true),
        ]);
        const targets = [...pubHeads, ...privHeads].filter((h) => h.name === doc.issuerName);
        const seen = new Set<string>();
        targets.forEach((head) => {
          if (!head?.identifier || seen.has(head.identifier)) return;
          seen.add(head.identifier);
          hydrateOwnedProject(head);
        });
      } catch {
        /* ignore */
      }
    })();
  }, [doc?.issuerName, hydrateOwnedProject]);

  React.useEffect(() => {
    if (!open || !myAddress) return;
    let alive = true;
    (async () => {
      try {
        const gs = await getAccountGroups(myAddress);
        if (alive) setGroupOptions(gs);
      } catch {
        if (alive) setGroupOptions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [open, myAddress]);

  const createProject = async () => {
    const users = usersAllowedText
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    try {
      const needsDirect = visibility === 'private' && (!privateGroupId || !canUseGroupEncryption);

      if (visibility === 'private' && privateGroupId != null) {
        const ok = await canEncryptToGroup(privateGroupId, isAdminsOnly);
        if (!ok) {
          alert(
            `This project is set to use group encryption, but the required group key ${
              isAdminsOnly ? '(admins key)' : ''
            } is missing.\n\n` +
              `Fix options:\n1) Qortal UI → Groups → ${
                isAdminsOnly ? 'Create Admin Group Key' : 'Create Group Key'
              }.\n` +
              `2) Switch to direct encryption.`
          );
          return;
        }
      }

      await createProjectAndIndex({
        issuerName: issuer,
        title: title.trim(),
        description: description.trim() || undefined,
        groupsAllowed: groupsAllowedIds,
        usersAllowed: users.length ? users : undefined,
        visibility,
        privateOpts:
          visibility === 'private'
            ? {
                groupId: privateGroupId ?? undefined,
                isAdmins: isAdminsOnly,
                mode: needsDirect ? 'direct' : 'group',
              }
            : undefined,
      });
    } catch (e) {
      if (isGroupKeyMissing(e)) {
        alert(`Group encryption failed: no ${isAdminsOnly ? 'admin ' : ''}group key found.`);
        return;
      }
      alert(`Failed to create project: ${String((e as any)?.message || e)}`);
    }

    setOpen(false);
    setTitle('');
    setDescription('');
    setGroupsAllowedIds([]);
    setUsersAllowedText('');
    setPrivateGroupId(null);
    setVisibility('public');
    await load();
  };

  const publisher = doc?.issuerName?.trim() ? doc.issuerName : issuer;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={{ xs: 1, sm: 2 }}
        sx={{ mb: { xs: 1.25, sm: 2 } }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
          <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
            My Projects
          </Typography>
          <Stack direction="row" spacing={1} sx={{ ml: { sm: 1 } }}>
            <Chip label="My projects" color="primary" />
            <Chip
              label="All projects"
              component={RouterLink}
              to="/qdeck/projects/all"
              variant="outlined"
              clickable
              color="primary"
            />
          </Stack>
        </Stack>
        <Stack direction="row" spacing={1}>
          <Button variant="outlined" component={RouterLink} to="/manage/qdeck-project-permissions">
            Manage Permissions
          </Button>
          <Button variant="contained" onClick={() => setOpen(true)}>
            New project
          </Button>
        </Stack>
      </Stack>

      {!doc?.projects?.length ? (
        <Alert severity="info">No projects yet. Create your first project.</Alert>
      ) : (
        <Stack spacing={1.25}>
          {doc.projects.map((p) => {
            const detail = projectDetails[p.projectId];
            const targetId = detail?.identifier ?? p.projectId;
            const to = `/qdeck/projects/${encodeURIComponent(publisher)}/${encodeURIComponent(
              targetId
            )}`;
            const visibility = detail?.visibility ?? p.visibility ?? 'public';
            const isPrivate = visibility === 'private';
            const statusColor =
              detail?.status === 'error'
                ? 'error.main'
                : detail?.status === 'loaded'
                  ? 'success.main'
                  : 'info.main';
            const statusMessage =
              detail?.statusMessage ?? (!detail ? 'Queued for hydration…' : undefined);

            return (
              <Paper
                key={p.projectId}
                component={RouterLink}
                to={to}
                elevation={0}
                role="link"
                tabIndex={0}
                sx={{
                  p: { xs: 1.25, sm: 2 },
                  display: 'grid',
                  gridTemplateColumns: { xs: '1fr', sm: '1fr auto' },
                  rowGap: { xs: 0.75, sm: 0 },
                  alignItems: { xs: 'stretch', sm: 'center' },
                  textDecoration: 'none',
                  bgcolor: pastelBgFromId(p.projectId, theme.palette.mode),
                  border: `1px solid ${pastelBorderFromId(p.projectId, theme.palette.mode)}`,
                  borderRadius: 1.5,
                  transition: 'transform 120ms ease, box-shadow 120ms ease',
                  cursor: 'pointer',
                  ...(isTouch
                    ? {}
                    : { '&:hover': { transform: 'translateY(-1px)', boxShadow: 2 } }),
                  '&:focus-visible': { outlineOffset: 2 },
                }}
              >
                <Box sx={{ minWidth: 0 }}>
                  <Stack
                    direction="row"
                    spacing={1}
                    alignItems="center"
                    sx={{ mb: 0.25, minWidth: 0, flexWrap: 'wrap', rowGap: 0.5 }}
                  >
                    <Typography
                      variant="subtitle1"
                      sx={{
                        lineHeight: 1.2,
                        maxWidth: { xs: '100%', sm: '40vw' },
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {p.title}
                    </Typography>

                    {isPrivate ? (
                      <Chip
                        size="small"
                        icon={<LockIcon fontSize="small" />}
                        label="Private"
                        variant="outlined"
                        color="warning"
                      />
                    ) : (
                      <Chip
                        size="small"
                        icon={<PublicIcon fontSize="small" />}
                        label="Public"
                        variant="outlined"
                        color="success"
                      />
                    )}
                  </Stack>

                  <Typography
                    variant="caption"
                    sx={{
                      opacity: 0.7,
                      display: 'block',
                      wordBreak: 'break-all',
                    }}
                  >
                    Project ID: {p.projectId}
                  </Typography>
                  <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>
                    Updated {formatRelativeTime(detail?.updatedAt ?? p.updatedAt)} • Created{' '}
                    {formatRelativeTime(detail?.createdAt ?? p.createdAt)}
                  </Typography>
                  {statusMessage && (
                    <Typography variant="caption" color={statusColor} sx={{ display: 'block' }}>
                      {statusMessage}
                    </Typography>
                  )}
                </Box>

                <Stack
                  direction="row"
                  alignItems="center"
                  spacing={1}
                  justifyContent={{ xs: 'flex-start', sm: 'flex-end' }}
                >
                  <Typography
                    variant="button"
                    sx={{ opacity: 0.7, pr: 0.5, display: { xs: 'none', sm: 'inline' } }}
                  >
                    Open →
                  </Typography>
                </Stack>
              </Paper>
            );
          })}
        </Stack>
      )}

      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth fullScreen={isXs}>
        <DialogTitle>Create Project</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Project title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              size="small"
            />
            <TextField
              label="Description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              fullWidth
              size="small"
              multiline
              minRows={2}
            />

            <FormControl size="small" fullWidth>
              <InputLabel id="edit-groups">Editor groups</InputLabel>
              <Select
                labelId="edit-groups"
                label="Editor groups"
                multiple
                value={groupsAllowedIds}
                onChange={(e) =>
                  setGroupsAllowedIds((e.target.value as (number | string)[]).map(Number))
                }
                renderValue={(selected) => {
                  const ids = new Set(selected as number[]);
                  const names = groupOptions
                    .filter((g) => ids.has(g.groupId))
                    .map((g) => `${g.groupName} (#${g.groupId})`);
                  return names.length ? names.join(', ') : 'None (open project)';
                }}
                MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
              >
                {groupOptions.map((g) => (
                  <MenuItem key={g.groupId} value={g.groupId}>
                    <Checkbox checked={groupsAllowedIds.includes(g.groupId)} />
                    <Box sx={{ whiteSpace: 'normal', lineHeight: 1.2 }}>
                      {g.groupName} (#{g.groupId}){g.isOpen ? '' : ' — PRIVATE'}
                    </Box>
                  </MenuItem>
                ))}
              </Select>
            </FormControl>

            {groupsAllowedIds.length > 0 && (
              <Box display="flex" alignItems="center" gap={1}>
                <Checkbox
                  checked={visibility === 'private'}
                  onChange={(e) => setVisibility(e.target.checked ? 'private' : 'public')}
                />
                <Typography variant="body2">Make this a private project</Typography>
              </Box>
            )}

            {visibility === 'private' && groupsAllowedIds.length > 0 && (
              <>
                <FormControl size="small" fullWidth disabled={!canUseGroupEncryption}>
                  <InputLabel id="priv-project-group">Private project group</InputLabel>
                  <Select
                    labelId="priv-project-group"
                    label="Private project group"
                    value={privateGroupId ?? ''}
                    displayEmpty
                    onChange={(e) =>
                      setPrivateGroupId(e.target.value ? Number(e.target.value) : null)
                    }
                    MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
                  >
                    <MenuItem value="">
                      <em>
                        {canUseGroupEncryption ? 'Select one private group' : 'Not applicable'}
                      </em>
                    </MenuItem>
                    {groupOptions
                      .filter((g) => groupsAllowedIds.includes(g.groupId) && !g.isOpen)
                      .map((g) => (
                        <MenuItem key={g.groupId} value={g.groupId}>
                          {g.groupName} (#{g.groupId}) — PRIVATE
                        </MenuItem>
                      ))}
                  </Select>
                </FormControl>

                {privateGroupId != null && (
                  <Box display="flex" alignItems="center" gap={1}>
                    <Checkbox
                      checked={isAdminsOnly}
                      onChange={(e) => setIsAdminsOnly(e.target.checked)}
                    />
                    <Typography variant="body2">
                      Admins-only access (group key for admins)
                    </Typography>
                  </Box>
                )}
              </>
            )}

            {needsDirectEncryptionWarning && (
              <Alert severity="warning" sx={{ mt: -1 }}>
                Private project requires <b>direct encryption</b> (more than one private group
                and/or any public groups).
              </Alert>
            )}

            <TextField
              label="Users allowed (names/addresses, comma-separated)"
              placeholder="alice, bob, Qabcd..."
              value={usersAllowedText}
              onChange={(e) => setUsersAllowedText(e.target.value)}
              size="small"
              fullWidth
              helperText="Optional: limit project editing to specific names/addresses."
              multiline
              minRows={2}
            />
          </Stack>
        </DialogContent>
        <DialogActions sx={{ p: { xs: 1, sm: 2 } }}>
          <Button onClick={() => setOpen(false)} fullWidth={isXs}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={createProject}
            disabled={!title.trim()}
            fullWidth={isXs}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
