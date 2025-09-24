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
  useTheme,
  Chip,
  Alert,
  useMediaQuery,
} from '@mui/material';
import PublicIcon from '@mui/icons-material/Public';
import LockIcon from '@mui/icons-material/Lock';
import { useAuth } from 'qapp-core';

import {
  canEncryptToGroup,
  createBoardAndIndex,
  deleteBoardById,
  isGroupKeyMissing,
  qdeckFetch,
  repairOwnerIndex,
} from '../utils/qdeckApi';
import { loadBoardsIndexMerged } from '../utils/qdeckIndexCache';
import { searchSimpleByIdPrefixOnly } from '../utils/searchSimple';
import { parsePrivateBoardIdentV2, QDeckId } from '../constants/qdeckIdentifiers';
import type { QDeckBoard, BoardsIndexDoc } from '../types/qdeck';
import { coerceService, coerceVisibility } from '../types/qdeck';
import { getAccountGroups, GroupSummary } from '../utils/qortalApi';
import { useAlert } from '../components/alerts';
import { collectRecipientPublicKeys } from '../utils/qdeckAccess';
import { RowActions, RowLinkGuard } from './QDeckPage';
import { pastelBgFromId, pastelBorderFromId } from '../utils/qdeckColors';

// // small helpers
// function hueFromId(id: string): number {
//   let h = 0;
//   for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
//   return h;
// }
// function bgFromId(id: string, mode: 'light' | 'dark') {
//   const h = hueFromId(id);
//   const s = mode === 'dark' ? 45 : 55;
//   const l = mode === 'dark' ? 16 : 92;
//   return `hsl(${h} ${s}% ${l}%)`;
// }

export default function MyBoards() {
  const [doc, setDoc] = React.useState<BoardsIndexDoc | null>(null);
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');

  // creator form state
  const [groupOptions, setGroupOptions] = React.useState<GroupSummary[]>([]);
  const [groupsAllowedIds, setGroupsAllowedIds] = React.useState<number[]>([]);
  const [usersAllowedText, setUsersAllowedText] = React.useState<string>('');
  const [visibility, setVisibility] = React.useState<'public' | 'private'>();
  const [privateGroupId, setPrivateGroupId] = React.useState<number | null>(null);
  const [allowOverride, setAllowOverride] = React.useState(false);
  const [isAdminsOnly, setIsAdminsOnly] = React.useState(false);

  // deletion
  const [confirmDel, setConfirmDel] = React.useState<null | { boardId: string; title: string }>(
    null
  );
  const [cascadeCards, setCascadeCards] = React.useState(false);
  const [cascadeComments, setCascadeComments] = React.useState(false);
  const [busyDel, setBusyDel] = React.useState(false);

  const theme = useTheme();
  const { alert } = useAlert();
  const { name: userName, address: myAddress, authenticateUser } = useAuth();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

  let issuer = userName;
  if (!issuer) authenticateUser();
  issuer = userName as string;

  // classify selected groups
  const selectedGroups = React.useMemo(
    () => groupOptions.filter((g) => groupsAllowedIds.includes(g.groupId)),
    [groupOptions, groupsAllowedIds]
  );
  const selectedPrivateGroups = selectedGroups.filter((g) => !g.isOpen);
  const selectedPublicGroups = selectedGroups.filter((g) => g.isOpen);

  // group-mode only when exactly one private group AND no public groups
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

  // debounced repair
  const repairTimer = React.useRef<number | null>(null);
  const runRepair = async () => {
    if (repairTimer.current) window.clearTimeout(repairTimer.current);
    repairTimer.current = window.setTimeout(async () => {
      try {
        await repairOwnerIndex(issuer);
        await load();
        alert('Index repair finished.', 'success', { severity: 'success' });
      } catch (e: any) {
        alert(`Index repair failed: ${e?.message || e}`, 'error', { severity: 'error' });
      }
      repairTimer.current = null;
    }, 600);
  };

  const load = React.useCallback(async () => {
    if (!issuer) return;

    // 1) Fast path: merged owner index (already visibility-aware)
    const merged = await loadBoardsIndexMerged(issuer).catch(() => null);
    if (merged) {
      setDoc(merged);
      return;
    }

    // 2) Fallback: discover by heads

    // Public heads under this issuer
    const pubHeads = await searchSimpleByIdPrefixOnly(QDeckId.prefixPublicBoards, false);
    const myPub = pubHeads.filter((h) => h.name === issuer);

    // Private heads under this issuer (v2 identifiers)
    const privHeads = await searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateBoards, true);
    const myPriv = privHeads.filter((h) => h.name === issuer);

    // --- Hydrate PUBLIC
    const pubBoards = await Promise.all(
      myPub.map(async (h) => {
        const shortId = h.identifier.replace(QDeckId.prefixPublicBoards, '');
        const bd = await qdeckFetch<QDeckBoard>(h.name, h.identifier, false).catch(() => null);
        if (!bd || (bd as any)?._type === 'QDECK_TOMBSTONE') return null;
        return {
          boardId: shortId,
          title: bd.title,
          createdAt: bd.createdAt,
          updatedAt: bd.updatedAt,
          visibility: coerceVisibility(bd.visibility ?? 'public'),
          service: coerceService(bd.service ?? 'DOCUMENT'),
        };
      })
    );

    // --- Hydrate PRIVATE using v2 ident (mode & admins are in the ident)
    const privBoards = await Promise.all(
      myPriv.map(async (h) => {
        const parsed = parsePrivateBoardIdentV2(h.identifier);
        if (!parsed) return null; // non-v2; you said first release -> v2 only

        const shortId = parsed.boardId;

        const bd = await qdeckFetch<QDeckBoard>(
          h.name,
          h.identifier,
          /* isPrivate */ true,
          parsed.mode === 'group' ? parsed.groupId : undefined,
          parsed.mode === 'group' ? !!parsed.isAdmins : undefined,
          parsed.mode
        ).catch(() => null);

        // If decrypt fails, still list it as a private board with placeholder
        if (!bd || (bd as any)?._type === 'QDECK_TOMBSTONE') {
          return {
            boardId: shortId,
            title: '(Private board)',
            createdAt: undefined,
            updatedAt: undefined,
            visibility: 'private' as const,
            service: 'DOCUMENT_PRIVATE' as const,
          };
        }

        return {
          boardId: shortId,
          title: bd.title,
          createdAt: bd.createdAt,
          updatedAt: bd.updatedAt,
          visibility: coerceVisibility(bd.visibility ?? 'private'),
          service: coerceService(bd.service ?? 'DOCUMENT_PRIVATE'),
        };
      })
    );

    const compact = [...pubBoards, ...privBoards].filter(Boolean) as NonNullable<
      (typeof pubBoards)[number]
    >[];

    setDoc({
      _type: 'QDECK_BOARDS_INDEX',
      version: 1,
      issuerName: issuer,
      boards: compact,
      updatedAt: Date.now(),
      seq: 0,
    });
  }, [issuer]);

  React.useEffect(() => {
    load().catch(console.error);
  }, [load]);

  // load groups when dialog opens
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

  // helpers
  function parseUsersCsv(csv: string): string[] {
    const uniq = new Set(
      csv
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
    );
    return Array.from(uniq);
  }
  async function verifyQortalName(name: string): Promise<boolean> {
    const nm = name.trim();
    if (!nm) return false;
    try {
      const data = await qortalRequest?.({ action: 'GET_NAME_DATA', name: nm });
      if (data && (data.name === nm || data?.owner)) return true;
    } catch {
      /* ignore */
    }
    try {
      const res = await fetch(`/names/${encodeURIComponent(nm)}`, {
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return false;
      const j = await res.json().catch(() => null);
      return !!j && (j.name === nm || j?.owner);
    } catch {
      return false;
    }
  }
  async function verifyUsersAllowed(list: string[]) {
    const valid: string[] = [],
      invalid: string[] = [];
    for (const n of list) ((await verifyQortalName(n)) ? valid : invalid).push(n);
    return { valid, invalid };
  }

  const createBoard = async () => {
    const users = parseUsersCsv(usersAllowedText);
    const { valid, invalid } = await verifyUsersAllowed(users);
    if (invalid.length) {
      alert(
        `These names could not be verified and will be ignored:\n\n- ${invalid.join('\n- ')}\n\nContinuing with: ${valid.length ? valid.join(', ') : 'no users'}`
      );
    }

    try {
      const needsDirect = visibility === 'private' && (!privateGroupId || !canUseGroupEncryption);

      let recipients: string[] | undefined;
      if (visibility === 'private' && needsDirect) {
        const { publicKeys } = await collectRecipientPublicKeys({
          groupIds: groupsAllowedIds,
          usersAllowed: valid,
          includeSelf: false,
          me: { address: myAddress!, name: userName! },
        });
        if (!publicKeys.length) {
          alert('Direct encryption needs at least one recipient public key.');
          return;
        }
        recipients = publicKeys;
      }

      if (visibility === 'private' && privateGroupId != null) {
        const ok = await canEncryptToGroup(privateGroupId, isAdminsOnly);
        if (!ok) {
          alert(
            `This board is set to use group encryption, but the required group key ${isAdminsOnly ? '(admins key)' : ''} is missing.\n\n` +
              `Fix options:\n1) Qortal UI → Groups → ${isAdminsOnly ? 'Create Admin Group Key' : 'Create Group Key'}.\n` +
              `2) Uncheck "Make private".\n3) Use "direct encryption".`
          );
          return;
        }
      }

      await createBoardAndIndex({
        issuerName: issuer,
        title: title.trim(),
        groupsAllowed: groupsAllowedIds,
        usersAllowed: valid.length ? valid : undefined,
        visibility,
        privateOpts:
          visibility === 'private'
            ? {
                groupId: privateGroupId ?? undefined,
                isAdmins: isAdminsOnly,
                mode: needsDirect ? 'direct' : 'group',
                recipients,
              }
            : undefined,
        adminOverride: allowOverride,
      });
    } catch (e) {
      if (isGroupKeyMissing(e)) {
        alert(`Group encryption failed: no ${isAdminsOnly ? 'admin ' : ''}group key found.`);
        return;
      }
      alert(`Failed to create board: ${String((e as any)?.message || e)}`);
    }

    setOpen(false);
    setTitle('');
    setGroupsAllowedIds([]);
    setUsersAllowedText('');
    setPrivateGroupId(null);
    setAllowOverride(false);
    setVisibility('public');
    await load();
  };

  const publisher = doc?.issuerName?.trim() ? doc.issuerName : issuer;

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto' }}>
      {/* Responsive header: column on mobile, wraps actions, full-width buttons on xs */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={{ xs: 1, sm: 2 }}
        sx={{ mb: { xs: 1.25, sm: 2 } }}
      >
        <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
          Q-Deck Boards
        </Typography>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          useFlexGap
          flexWrap="wrap"
          sx={{
            '& > *': {
              // make buttons full-width on phones, auto on larger screens
              width: { xs: '100%', sm: 'auto' },
            },
          }}
        >
          <Typography
            variant="subtitle1"
            sx={{ opacity: 0.8, order: { xs: 3, sm: 0 }, width: { xs: '100%', sm: 'auto' } }}
          >
            {issuer}
          </Typography>

          <Button
            variant="contained"
            onClick={() => setOpen(true)}
            sx={{ order: { xs: 1, sm: 0 } }}
          >
            Create Board
          </Button>

          <Button onClick={() => runRepair()} sx={{ order: { xs: 2, sm: 0 } }}>
            Run Index Repair
          </Button>
        </Stack>
      </Stack>

      <Stack spacing={{ xs: 1.25, sm: 2 }}>
        {(doc?.boards ?? []).length === 0 && (
          <Typography sx={{ opacity: 0.7 }}>
            No boards yet for <b>{publisher}</b>.
          </Typography>
        )}

        {(doc?.boards ?? []).map((b) => {
          const to = `/qdeck/${encodeURIComponent(publisher)}/${b.boardId}`;
          const isPrivate = (b.visibility ?? 'public') === 'private';

          return (
            <Paper
              key={b.boardId}
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
                bgcolor: pastelBgFromId(b.boardId, theme.palette.mode),
                border: `1px solid ${pastelBorderFromId(b.boardId, theme.palette.mode)}`,
                borderRadius: 1.5,
                transition: 'transform 120ms ease, box-shadow 120ms ease',
                cursor: 'pointer',
                // On touch, skip hover lift to avoid “sticky hover” feel
                ...(isTouch ? {} : { '&:hover': { transform: 'translateY(-1px)', boxShadow: 2 } }),
                '&:focus-visible': {
                  // outline: (t) => `2px solid ${t.palette.primary.main}`,
                  outlineOffset: 2,
                },
              }}
            >
              {/* Left block */}
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
                      // truncate very long titles on small screens
                      maxWidth: { xs: '100%', sm: '40vw' },
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {b.title}
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
                    // allow wrap to avoid overflow
                    wordBreak: 'break-all',
                  }}
                >
                  Board ID: {b.boardId}
                </Typography>
              </Box>

              {/* Right block (actions) */}
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
                <RowLinkGuard>
                  <RowActions
                    onOpen={() => {}}
                    onDelete={() => {
                      setCascadeCards(false);
                      setCascadeComments(false);
                      setConfirmDel({ boardId: b.boardId, title: b.title });
                    }}
                    canDelete={true}
                  />
                </RowLinkGuard>
              </Stack>
            </Paper>
          );
        })}
      </Stack>

      {/* Create dialog: full-screen on phones */}
      <Dialog open={open} onClose={() => setOpen(false)} maxWidth="sm" fullWidth fullScreen={isXs}>
        <DialogTitle>Create Board</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ pt: 1 }}>
            <TextField
              label="Board Title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              fullWidth
              size="small"
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
                  return names.length ? names.join(', ') : 'None (open board)';
                }}
                MenuProps={{
                  PaperProps: { sx: { maxHeight: 320 } },
                }}
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

            {/* Private mode controls – unchanged logic, just smaller spacing */}
            <FormControl size="small" fullWidth disabled={!canUseGroupEncryption}>
              <InputLabel id="priv-board-group">Private board group</InputLabel>
              <Select
                labelId="priv-board-group"
                label="Private board group"
                value={privateGroupId ?? ''}
                displayEmpty
                onChange={(e) => setPrivateGroupId(e.target.value ? Number(e.target.value) : null)}
                MenuProps={{ PaperProps: { sx: { maxHeight: 320 } } }}
              >
                <MenuItem value="">
                  <em>{canUseGroupEncryption ? 'Select one private group' : 'Not applicable'}</em>
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

            {/* Checkboxes – make them tap-friendly */}
            {privateGroupId != null && (
              <Box display="flex" alignItems="center" gap={1}>
                <Checkbox
                  checked={visibility === 'private'}
                  onChange={(e) => setVisibility(e.target.checked ? 'private' : 'public')}
                />
                <Typography variant="body2">Make this a private board</Typography>
              </Box>
            )}

            {groupsAllowedIds.length > 0 && (
              <Box display="flex" alignItems="center" gap={1}>
                <Checkbox
                  checked={allowOverride}
                  onChange={(e) => setAllowOverride(e.target.checked)}
                />
                <Typography variant="body2">
                  Allow admins of selected editor group(s) to override cards
                </Typography>
              </Box>
            )}

            {groupsAllowedIds.length > 0 && privateGroupId != null && (
              <Box display="flex" alignItems="center" gap={1}>
                <Checkbox
                  checked={isAdminsOnly}
                  onChange={(e) => setIsAdminsOnly(e.target.checked)}
                />
                <Typography variant="body2">Admins-only access (group key for admins)</Typography>
              </Box>
            )}

            {groupsAllowedIds.length > 0 && (
              <Box display="flex" alignItems="center" gap={1}>
                <Checkbox
                  checked={visibility === 'private'}
                  onChange={(e) => setVisibility(e.target.checked ? 'private' : 'public')}
                />
                <Typography variant="body2">Make this a private board</Typography>
              </Box>
            )}

            {needsDirectEncryptionWarning && (
              <Alert severity="warning" sx={{ mt: -1 }}>
                Private board requires <b>direct encryption</b> (more than one private group and/or
                any public groups).
              </Alert>
            )}

            <TextField
              label="Users allowed (names/addresses, comma-separated)"
              placeholder="alice, bob, Qabcd..."
              value={usersAllowedText}
              onChange={(e) => setUsersAllowedText(e.target.value)}
              size="small"
              fullWidth
              helperText="Names will be verified now; invalid entries are ignored."
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
            onClick={createBoard}
            disabled={!title.trim()}
            fullWidth={isXs}
          >
            Create
          </Button>
        </DialogActions>
      </Dialog>

      {/* Delete dialog */}
      <Dialog open={!!confirmDel} onClose={() => setConfirmDel(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete board?</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <Typography>
              You're about to delete <b>{confirmDel?.title}</b>. This publishes a tombstone over the
              board.
            </Typography>
            <Box display="flex" alignItems="center" gap={1}>
              <Checkbox
                checked={cascadeCards}
                onChange={(e) => setCascadeCards(e.target.checked)}
              />
              <Typography variant="body2">Also delete all cards</Typography>
            </Box>
            <Box display="flex" alignItems="center" gap={1}>
              <Checkbox
                checked={cascadeComments}
                onChange={(e) => setCascadeComments(e.target.checked)}
                disabled={!cascadeCards}
              />
              <Typography variant="body2">Also delete card comments</Typography>
            </Box>
            <Alert severity="warning">This action can’t be undone.</Alert>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDel(null)} disabled={busyDel}>
            Cancel
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={busyDel}
            onClick={async () => {
              if (!confirmDel) return;
              setBusyDel(true);
              try {
                await deleteBoardById(issuer, confirmDel.boardId, {
                  cascadeCards,
                  cascadeComments,
                });
                setDoc((prev) =>
                  prev
                    ? {
                        ...prev,
                        boards: prev.boards.filter((x) => x.boardId !== confirmDel.boardId),
                        updatedAt: Date.now(),
                        seq: (prev.seq ?? 0) + 1,
                      }
                    : prev
                );
                alert(`Deleted board: ${confirmDel.title}`, 'success', { severity: 'success' });
              } catch (e: any) {
                const msg = String(e?.message || e || '');
                if (/not authorized/i.test(msg)) {
                  alert('You are not allowed to delete this board.', 'error', {
                    severity: 'error',
                  });
                } else if (/not found/i.test(msg)) {
                  alert('Board not found. It may already be deleted.', 'warning', {
                    severity: 'warning',
                  });
                } else {
                  alert(`Delete failed: ${msg}`, 'error', { severity: 'error' });
                }
              } finally {
                setBusyDel(false);
                setConfirmDel(null);
              }
            }}
          >
            {busyDel ? 'Deleting…' : 'Delete'}
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
