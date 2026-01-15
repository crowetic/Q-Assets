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
  // repairOwnerIndex, //todo readd this in the future after verifying.
} from '../utils/qdeckApi';
import { loadBoardsIndexMerged } from '../utils/qdeckIndexCache';
import { searchSimpleByIdPrefixOnly } from '../utils/searchSimple';
import { parsePrivateBoardIdentV2, QDeckId } from '../constants/qdeckIdentifiers';
import type { QDeckBoard, BoardsIndexDoc, AnyBoard } from '../types/qdeck';
import { coerceService, coerceVisibility } from '../types/qdeck';
import { getAccountGroups, GroupSummary } from '../utils/qortalApi';
import { useAlert } from '../components/alerts';
import { collectRecipientPublicKeys } from '../utils/qdeckAccess';
import { RowActions, RowLinkGuard } from './QDeckPage';
import { pastelBgFromId, pastelBorderFromId } from '../utils/qdeckColors';
import { useFetchTracker } from '../state/global/fetchTracker';
type BoardLoadStatus = 'queued' | 'loading' | 'decrypting' | 'loaded' | 'error';
type OwnedBoardDetail = {
  status: BoardLoadStatus;
  statusMessage?: string;
  updatedAt?: number;
  createdAt?: number;
  identifier?: string;
  listCount?: number;
  service?: AnyBoard['service'];
  visibility?: AnyBoard['visibility'];
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

export default function MyBoards() {
  const [doc, setDoc] = React.useState<BoardsIndexDoc | null>(null);
  const [open, setOpen] = React.useState(false);
  const [title, setTitle] = React.useState('');
  const [boardDetails, setBoardDetails] = React.useState<Record<string, OwnedBoardDetail>>({});

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

  const { track, isLoadingPrefix } = useFetchTracker();
  const busyWhile = React.useCallback(
    async <T,>(fn: () => Promise<T> | T, label: string) => track(Promise.resolve().then(fn), label),
    [track]
  );
  const boardHydrateTokenRef = React.useRef(0);

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
  // const repairTimer = React.useRef<number | null>(null); //todo - re-add this feature in the future after verifying it.
  // const runRepair = async () => {
  //   if (repairTimer.current) window.clearTimeout(repairTimer.current);
  //   repairTimer.current = window.setTimeout(async () => {
  //     try {
  //       await busyWhile(async () => {
  //         await repairOwnerIndex(issuer);
  //         await load();
  //       }, 'blocking:qdeck:repair');
  //       alert('Index repair finished.', 'success', { severity: 'success' });
  //     } catch (e: any) {
  //       alert(`Index repair failed: ${e?.message || e}`, 'error', { severity: 'error' });
  //     }
  //     repairTimer.current = null;
  //   }, 600);
  // };

  const hydrateOwnedBoard = React.useCallback(
    async (
      head: { identifier: string; name: string; created?: number; updated?: number },
      token: number
    ) => {
      const isPrivate = head.identifier.startsWith(QDeckId.prefixPrivateBoards);
      const parsed = isPrivate ? parsePrivateBoardIdentV2(head.identifier) : undefined;
      const shortId = isPrivate
        ? (parsed?.boardId ?? head.identifier)
        : head.identifier.replace(QDeckId.prefixPublicBoards, '');
      if (!shortId) return;

      if (boardHydrateTokenRef.current !== token) return;
      setBoardDetails((prev) => ({
        ...prev,
        [shortId]: {
          ...(prev[shortId] ?? {}),
          identifier: head.identifier,
          status: isPrivate ? 'decrypting' : 'loading',
          statusMessage: isPrivate ? 'Decrypting private board…' : 'Fetching board metadata…',
        },
      }));

      try {
        const doc = await qdeckFetch<QDeckBoard>(
          head.name,
          head.identifier,
          isPrivate,
          parsed?.mode === 'group' ? parsed.groupId : undefined,
          parsed?.mode === 'group' ? !!parsed.isAdmins : undefined,
          parsed?.mode ?? 'group'
        );
        if (boardHydrateTokenRef.current !== token) return;
        if (!doc || (doc as any)?._type === 'QDECK_TOMBSTONE') {
          setBoardDetails((prev) => ({
            ...prev,
            [shortId]: {
              ...(prev[shortId] ?? {}),
              status: 'error',
              statusMessage: 'Board not found or deleted.',
            },
          }));
          return;
        }
        setBoardDetails((prev) => ({
          ...prev,
          [shortId]: {
            status: 'loaded',
            statusMessage: 'Board ready.',
            identifier: head.identifier,
            updatedAt: doc.updatedAt,
            createdAt: doc.createdAt,
            listCount: Array.isArray(doc.lists) ? doc.lists.length : prev[shortId]?.listCount,
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
        if (boardHydrateTokenRef.current !== token) return;
        setBoardDetails((prev) => ({
          ...prev,
          [shortId]: {
            ...(prev[shortId] ?? {}),
            status: 'error',
            identifier: head.identifier,
            statusMessage:
              typeof error?.message === 'string' ? error.message : 'Unable to load board metadata.',
          },
        }));
      }
    },
    []
  );

  const load = React.useCallback(async () => {
    if (!issuer) return;

    await busyWhile(async () => {
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
          if (!parsed) return null; // v2 only

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
    }, 'blocking:qdeck:boards');
  }, [issuer, busyWhile]);

  React.useEffect(() => {
    load().catch(console.error);
  }, [load]);

  React.useEffect(() => {
    if (!doc?.issuerName) {
      setBoardDetails({});
      return;
    }
    const token = ++boardHydrateTokenRef.current;
    (async () => {
      try {
        const [pubHeads, privHeads] = await Promise.all([
          searchSimpleByIdPrefixOnly(QDeckId.prefixPublicBoards, false),
          searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateBoards, true),
        ]);
        const targets = [...pubHeads, ...privHeads].filter((h) => h.name === doc.issuerName);
        const seen = new Set<string>();
        targets.forEach((head) => {
          if (!head?.identifier || seen.has(head.identifier)) return;
          seen.add(head.identifier);
          hydrateOwnedBoard(head, token);
        });
      } catch {
        /* silent */
      }
    })();
  }, [doc?.issuerName, hydrateOwnedBoard]);

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
      const data = await (globalThis as any)?.qortalRequest?.({
        action: 'GET_NAME_DATA',
        name: nm,
      });
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

      await busyWhile(async () => {
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
      }, 'blocking:qdeck:create');
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
      {/* Optional contextual hint while decrypting/collecting boards */}
      {isLoadingPrefix('blocking:qdeck:boards') && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Loading boards… decrypting private boards can take a moment on first load.
        </Alert>
      )}

      {/* Responsive header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={{ xs: 1, sm: 2 }}
        sx={{ mb: { xs: 1.25, sm: 2 } }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
          <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
            My Boards
          </Typography>
          <Stack direction="row" spacing={1} sx={{ ml: { sm: 1 } }}>
            <Chip label="My boards" color="primary" />
            <Chip
              label="All boards"
              component={RouterLink}
              to="/qdeck/public"
              variant="outlined"
              clickable
              color="primary"
            />
          </Stack>
        </Stack>

        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          useFlexGap
          flexWrap="wrap"
          sx={{
            '& > *': {
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

          <Button
            component={RouterLink}
            to="/manage/qdeck-permissions"
            sx={{ order: { xs: 2, sm: 0 } }}
          >
            Manage Permissions
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
          const detail = boardDetails[b.boardId];
          const targetId = detail?.identifier ?? b.boardId;
          const to = `/qdeck/${encodeURIComponent(publisher)}/${encodeURIComponent(targetId)}`;
          const visibility = detail?.visibility ?? b.visibility ?? 'public';
          const isPrivate = visibility === 'private';
          const statusColor =
            detail?.status === 'error'
              ? 'error.main'
              : detail?.status === 'loaded'
                ? 'success.main'
                : 'info.main';
          const statusMessage =
            detail?.statusMessage ?? (!detail ? 'Queued for hydration…' : undefined);
          const listsLabel =
            typeof detail?.listCount === 'number' ? `${detail.listCount} lists` : undefined;

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
                ...(isTouch ? {} : { '&:hover': { transform: 'translateY(-1px)', boxShadow: 2 } }),
                '&:focus-visible': { outlineOffset: 2 },
              }}
            >
              {/* Left */}
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
                  {listsLabel && <Chip size="small" variant="outlined" label={listsLabel} />}
                </Stack>

                <Typography
                  variant="caption"
                  sx={{
                    opacity: 0.7,
                    display: 'block',
                    wordBreak: 'break-all',
                  }}
                >
                  Board ID: {b.boardId}
                </Typography>
                <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>
                  Updated {formatRelativeTime(detail?.updatedAt ?? b.updatedAt)} • Created{' '}
                  {formatRelativeTime(detail?.createdAt ?? b.createdAt)}
                </Typography>
                {statusMessage && (
                  <Typography variant="caption" color={statusColor} sx={{ display: 'block' }}>
                    {statusMessage}
                  </Typography>
                )}
                {(detail?.owners?.length || detail?.ownerGroups?.length) && (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                    {detail?.owners?.map((owner) => (
                      <Chip key={`owner-${owner}`} size="small" label={`Admin: ${owner}`} />
                    ))}
                    {detail?.ownerGroups?.map((gid) => (
                      <Chip key={`owner-group-${gid}`} size="small" label={`Admin group #${gid}`} />
                    ))}
                  </Stack>
                )}
                {(detail?.editors?.length || detail?.editorGroups?.length) && (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                    {detail?.editors?.map((editor) => (
                      <Chip
                        key={`editor-${editor}`}
                        size="small"
                        color="info"
                        label={`Editor: ${editor}`}
                      />
                    ))}
                    {detail?.editorGroups?.map((gid) => (
                      <Chip
                        key={`editor-group-${gid}`}
                        size="small"
                        color="info"
                        label={`Editor group #${gid}`}
                      />
                    ))}
                  </Stack>
                )}
                {(detail?.groupsAllowed?.length || detail?.usersAllowed?.length) && (
                  <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                    {detail?.groupsAllowed?.map((gid) => (
                      <Chip
                        key={`allowed-group-${gid}`}
                        size="small"
                        color="secondary"
                        label={`Group allowed #${gid}`}
                      />
                    ))}
                    {detail?.usersAllowed?.map((user) => (
                      <Chip
                        key={`allowed-user-${user}`}
                        size="small"
                        color="secondary"
                        label={`User allowed: ${user}`}
                      />
                    ))}
                  </Stack>
                )}
              </Box>

              {/* Right actions */}
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

      {/* Create dialog */}
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
                  checked={allowOverride}
                  onChange={(e) => setAllowOverride(e.target.checked)}
                />
                <Typography variant="body2">
                  Allow admins of selected editor group(s) to override cards
                </Typography>
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

            {visibility === 'private' && groupsAllowedIds.length > 0 && (
              <>
                <FormControl size="small" fullWidth disabled={!canUseGroupEncryption}>
                  <InputLabel id="priv-board-group">Private board group</InputLabel>
                  <Select
                    labelId="priv-board-group"
                    label="Private board group"
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
                await busyWhile(async () => {
                  await deleteBoardById(issuer, confirmDel.boardId, {
                    cascadeCards,
                    cascadeComments,
                  });
                }, 'blocking:qdeck:delete');
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
