// QDeckAllBoards.tsx
import * as React from 'react';
import {
  Box,
  Stack,
  Paper,
  Typography,
  Button,
  TextField,
  Chip,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  Checkbox,
  Alert,
  DialogActions,
  useMediaQuery,
  Skeleton,
} from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import LockIcon from '@mui/icons-material/Lock';
import LockOpenIcon from '@mui/icons-material/LockOpen';
import PublicIcon from '@mui/icons-material/Public';
import { useAuth } from 'qapp-core';

import { QDeckId, parsePrivateBoardIdentV2 } from '../constants/qdeckIdentifiers';
import { deleteBoardById, qdeckFetch } from '../utils/qdeckApi';
import type { AnyBoard, QDeckBoard } from '../types/qdeck';
import { coerceService, coerceVisibility } from '../types/qdeck';
import { searchSimpleByIdPrefixOnly } from '../utils/searchSimple';
import { RowActions, RowLinkGuard } from './QDeckPage';
import { useAlert } from '../components/alerts';
import { pastelBgFromId, pastelBorderFromId } from '../utils/qdeckColors';
import { useFetchTracker } from '../state/global/fetchTracker';

type BoardLoadStatus = 'queued' | 'loading' | 'decrypting' | 'loaded' | 'error';
type ListedBoard = AnyBoard & {
  status: BoardLoadStatus;
  statusMessage?: string;
  createdAt?: number;
  updatedAt?: number;
  identifier?: string;
  listCount?: number;
  issuerName: string;
  owners?: string[];
  ownerGroups?: number[];
  editors?: string[];
  editorGroups?: number[];
  groupsAllowed?: number[];
  usersAllowed?: string[];
};

const statusPriority: Record<BoardLoadStatus, number> = {
  loaded: 4,
  decrypting: 3,
  loading: 2,
  queued: 1,
  error: 0,
};

const formatRelativeTime = (timestamp?: number) => {
  if (!timestamp) return 'Unknown';
  const diff = Date.now() - timestamp;
  if (diff < 60 * 1000) return 'Just now';
  if (diff < 60 * 60 * 1000) return `${Math.floor(diff / (60 * 1000))}m ago`;
  if (diff < 24 * 60 * 60 * 1000) return `${Math.floor(diff / (60 * 60 * 1000))}h ago`;
  return new Date(timestamp).toLocaleDateString();
};

export default function QDeckAllBoards() {
  const { name: myName } = useAuth();
  const [boardMap, setBoardMap] = React.useState<Record<string, ListedBoard>>({});
  const [q, setQ] = React.useState('');
  const [stats, setStats] = React.useState({ pubFound: 0, privFound: 0 });

  const [confirmDel, setConfirmDel] = React.useState<null | {
    issuer: string;
    boardId: string;
    title: string;
  }>(null);
  const [cascadeCards, setCascadeCards] = React.useState(false);
  const [cascadeComments, setCascadeComments] = React.useState(false);
  const [busyDel, setBusyDel] = React.useState(false);

  const { alert } = useAlert();

  const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

  // Global loader plumbing
  const { track, isLoadingPrefix } = useFetchTracker();
  const busyWhile = React.useCallback(
    async <T,>(fn: () => Promise<T> | T, label: string) => track(Promise.resolve().then(fn), label),
    [track]
  );

  const loadTokenRef = React.useRef(0);

  const upsertBoard = React.useCallback(
    (key: string, next: ListedBoard | ((prev?: ListedBoard) => ListedBoard)) => {
      setBoardMap((prev) => {
        const current = prev[key];
        const updated =
          typeof next === 'function' ? (next as (arg?: ListedBoard) => ListedBoard)(current) : next;
        if (!updated) return prev;
        return { ...prev, [key]: updated };
      });
    },
    []
  );

  const removeBoard = React.useCallback((key: string) => {
    setBoardMap((prev) => {
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  }, []);

  const hydrateBoard = React.useCallback(
    async (
      head: { identifier: string; name: string; created?: number; updated?: number },
      kind: 'public' | 'private',
      token: number
    ) => {
      const key = `${head.name}::${head.identifier}`;
      const parsedPrivate =
        kind === 'private' ? parsePrivateBoardIdentV2(head.identifier) : undefined;
      const shortId =
        kind === 'public'
          ? head.identifier.replace(QDeckId.prefixPublicBoards, '')
          : (parsedPrivate?.boardId ?? head.identifier);
      if (!shortId) return;

      const placeholder: ListedBoard = {
        name: head.name,
        issuerName: head.name,
        shortId,
        identifier: head.identifier,
        title: kind === 'public' ? shortId : '(Private board)',
        createdAt: head.created,
        updatedAt: head.updated,
        visibility: kind === 'public' ? 'public' : 'private',
        service: kind === 'public' ? ('DOCUMENT' as const) : ('DOCUMENT_PRIVATE' as const),
        accessible: kind === 'public',
        status: kind === 'public' ? 'loading' : 'decrypting',
        statusMessage: kind === 'public' ? 'Fetching board metadata…' : 'Decrypting private board…',
        privMode: parsedPrivate?.mode,
        owners: [],
        ownerGroups: [],
        editors: [],
        editorGroups: [],
        groupsAllowed: [],
        usersAllowed: [],
      };

      if (loadTokenRef.current !== token) return;
      upsertBoard(key, (prev) => ({ ...(prev ?? placeholder), ...placeholder }));

      try {
        const doc = await qdeckFetch<QDeckBoard>(
          head.name,
          head.identifier,
          kind === 'private',
          parsedPrivate?.mode === 'group' ? parsedPrivate.groupId : undefined,
          parsedPrivate?.mode === 'group' ? !!parsedPrivate.isAdmins : undefined,
          parsedPrivate?.mode ?? 'group'
        );
        if (loadTokenRef.current !== token) return;
        if (!doc || (doc as any)?._type === 'QDECK_TOMBSTONE') {
          removeBoard(key);
          return;
        }
        upsertBoard(key, (prev) => ({
          ...(prev ?? placeholder),
          title: doc.title,
          createdAt: doc.createdAt,
          updatedAt: doc.updatedAt,
          visibility: coerceVisibility(doc.visibility ?? prev?.visibility ?? 'public'),
          service: coerceService(doc.service ?? prev?.service ?? 'DOCUMENT'),
          accessible: true,
          listCount: Array.isArray(doc.lists) ? doc.lists.length : undefined,
          status: 'loaded',
          statusMessage: 'Board metadata loaded.',
          owners: doc.owners ?? prev?.owners ?? [],
          ownerGroups: doc.ownerGroups ?? prev?.ownerGroups ?? [],
          editors: doc.editors ?? prev?.editors ?? [],
          editorGroups: doc.editorGroups ?? prev?.editorGroups ?? [],
          groupsAllowed: doc.groupsAllowed ?? prev?.groupsAllowed ?? [],
          usersAllowed: doc.usersAllowed ?? prev?.usersAllowed ?? [],
        }));
      } catch (error: any) {
        if (loadTokenRef.current !== token) return;
        const message =
          typeof error?.message === 'string' ? error.message : 'Unable to load board.';
        upsertBoard(key, (prev) => ({
          ...(prev ?? placeholder),
          status: 'error',
          statusMessage: message,
          accessible: false,
        }));
      }
    },
    [upsertBoard, removeBoard]
  );

  const load = React.useCallback(async () => {
    const token = ++loadTokenRef.current;
    setBoardMap({});
    await busyWhile(async () => {
      const [pubRaw, privRaw] = await Promise.all([
        searchSimpleByIdPrefixOnly(QDeckId.prefixPublicBoards, false),
        searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateBoards, true),
      ]);
      if (loadTokenRef.current !== token) return;
      setStats({ pubFound: pubRaw.length, privFound: privRaw.length });
      [...pubRaw, ...privRaw].forEach((head) => {
        if (!head?.identifier || !head?.name) return;
        const kind = head.identifier.startsWith(QDeckId.prefixPrivateBoards) ? 'private' : 'public';
        hydrateBoard(head, kind, token);
      });
    }, 'blocking:qdeck:allboards');
  }, [busyWhile, hydrateBoard]);

  React.useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const boardList = React.useMemo(() => {
    const values = Object.values(boardMap);
    const dedup = new Map<string, ListedBoard>();
    values.forEach((entry) => {
      const existing = dedup.get(entry.shortId);
      if (!existing) {
        dedup.set(entry.shortId, entry);
        return;
      }
      const statusDiff = statusPriority[entry.status] - statusPriority[existing.status];
      if (statusDiff > 0) {
        dedup.set(entry.shortId, entry);
        return;
      }
      if (statusDiff === 0) {
        const tsDiff = (entry.updatedAt ?? 0) - (existing.updatedAt ?? 0);
        if (tsDiff > 0) dedup.set(entry.shortId, entry);
      }
    });
    return Array.from(dedup.values()).sort((a, b) => {
      const statusDiff = statusPriority[b.status] - statusPriority[a.status];
      if (statusDiff !== 0) return statusDiff;
      return (b.updatedAt ?? 0) - (a.updatedAt ?? 0);
    });
  }, [boardMap]);

  const filtered = React.useMemo(() => {
    if (!q) return boardList;
    const needle = q.toLowerCase();
    return boardList.filter(
      (b) =>
        b.title?.toLowerCase().includes(needle) ||
        b.name.toLowerCase().includes(needle) ||
        b.shortId.toLowerCase().includes(needle)
    );
  }, [boardList, q]);

  const hydratedCount = React.useMemo(
    () => boardList.filter((b) => b.status === 'loaded').length,
    [boardList]
  );

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto' }}>
      {/* Optional contextual hint while scanning/decrypting */}
      {isLoadingPrefix('blocking:qdeck:allboards') && (
        <Alert severity="info" sx={{ mb: 1 }}>
          Loading all boards… decrypting private boards may take a moment.
        </Alert>
      )}

      {/* header */}
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        alignItems={{ xs: 'stretch', sm: 'center' }}
        justifyContent="space-between"
        spacing={{ xs: 1, sm: 2 }}
        sx={{ mb: { xs: 1.25, sm: 2 } }}
      >
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems="center">
          <Typography variant="h5">All Boards</Typography>
          <Stack direction="row" spacing={1} sx={{ ml: { sm: 1 } }}>
            <Chip
              label="My boards"
              component={RouterLink}
              to="/qdeck/my"
              variant="outlined"
              clickable
              color="primary"
            />
            <Chip label="All boards" color="primary" />
          </Stack>
        </Stack>
        <TextField
          size="small"
          label="Filter"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          sx={{ width: { xs: '100%', sm: '22rem' } }}
        />
      </Stack>

      <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1 }}>
        Public hits: {stats.pubFound} • Private hits: {stats.privFound} • Loaded: {hydratedCount}
      </Typography>

      {filtered.map((b) => {
        const targetId = b.identifier ?? b.shortId;
        const to = `/qdeck/${encodeURIComponent(b.name)}/${encodeURIComponent(targetId)}`;
        const canDelete = myName === b.name;
        const bg = (t: any) => pastelBgFromId(b.shortId, t.palette.mode);
        const border = (t: any) => `1px solid ${pastelBorderFromId(b.shortId, t.palette.mode)}`;
        const isLoaded = b.status === 'loaded';
        const statusColor =
          b.status === 'error'
            ? 'error.main'
            : b.status === 'loaded'
              ? 'success.main'
              : 'info.main';

        const chip =
          b.visibility === 'public' ? (
            <Chip
              size="small"
              icon={<PublicIcon fontSize="small" />}
              label="Public"
              variant="outlined"
              color="success"
            />
          ) : b.accessible ? (
            <Chip
              size="small"
              icon={<LockOpenIcon fontSize="small" />}
              label={b.privMode === 'group' ? 'Private (group access)' : 'Private (direct access)'}
              variant="outlined"
              color="primary"
            />
          ) : (
            <Chip
              size="small"
              icon={<LockIcon fontSize="small" />}
              label="Private (locked)"
              variant="outlined"
              color="warning"
            />
          );

        return (
          <Paper
            key={`${b.name}:${b.shortId}`}
            elevation={0}
            component={RouterLink}
            to={to}
            sx={{
              p: { xs: 1.25, sm: 2 },
              display: 'grid',
              mb: 2,
              gridTemplateColumns: { xs: '1fr', sm: '1fr auto' },
              rowGap: { xs: '0.75rem', sm: 0 },
              alignItems: { xs: 'stretch', sm: 'center' },
              bgcolor: bg,
              border: border,
              textDecoration: 'none',
              cursor: 'pointer',
              ...(isTouch ? {} : { '&:hover': { boxShadow: 2, transform: 'translateY(-0.1rem)' } }),
              transition: 'transform 120ms ease, box-shadow 120ms ease',
            }}
          >
            {/* left */}
            <Box sx={{ minWidth: 0 }}>
              {isLoaded ? (
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
              ) : (
                <Skeleton variant="text" width="60%" height={28} />
              )}

              <Stack
                direction="row"
                spacing={1}
                alignItems="center"
                sx={{ mb: 0.5, mt: 0.5, minWidth: 0, flexWrap: 'wrap' }}
              >
                {chip}
                {typeof b.listCount === 'number' && (
                  <Chip size="small" variant="outlined" label={`${b.listCount} lists`} />
                )}
              </Stack>

              <Typography
                variant="caption"
                sx={{ opacity: 0.7, display: 'block', wordBreak: 'break-all' }}
              >
                {b.name} — {b.shortId}
              </Typography>
              <Typography variant="caption" sx={{ display: 'block', opacity: 0.8 }}>
                Updated {formatRelativeTime(b.updatedAt)} • Created{' '}
                {formatRelativeTime(b.createdAt)}
              </Typography>
              {b.statusMessage && (
                <Typography variant="caption" sx={{ display: 'block' }} color={statusColor}>
                  {b.statusMessage}
                </Typography>
              )}
              {(b.owners?.length || b.ownerGroups?.length) && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                  {b.owners?.map((owner) => (
                    <Chip key={`owner-${owner}`} size="small" label={`Admin: ${owner}`} />
                  ))}
                  {b.ownerGroups?.map((gid) => (
                    <Chip key={`owner-group-${gid}`} size="small" label={`Admin group #${gid}`} />
                  ))}
                </Stack>
              )}
              {(b.editors?.length || b.editorGroups?.length) && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                  {b.editors?.map((editor) => (
                    <Chip
                      key={`editor-${editor}`}
                      size="small"
                      color="info"
                      label={`Editor: ${editor}`}
                    />
                  ))}
                  {b.editorGroups?.map((gid) => (
                    <Chip
                      key={`editor-group-${gid}`}
                      size="small"
                      color="info"
                      label={`Editor group #${gid}`}
                    />
                  ))}
                </Stack>
              )}
              {(b.groupsAllowed?.length || b.usersAllowed?.length) && (
                <Stack direction="row" spacing={0.5} flexWrap="wrap" sx={{ mt: 0.5 }}>
                  {b.groupsAllowed?.map((gid) => (
                    <Chip
                      key={`allowed-group-${gid}`}
                      size="small"
                      color="secondary"
                      label={`Group allowed #${gid}`}
                    />
                  ))}
                  {b.usersAllowed?.map((user) => (
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

            {/* right */}
            <Box sx={{ display: 'flex', justifyContent: { xs: 'flex-start', sm: 'flex-end' } }}>
              {b.visibility === 'public' || b.accessible ? (
                <RowLinkGuard>
                  <RowActions
                    onOpen={() => {}}
                    onDelete={() => {
                      setCascadeCards(false);
                      setCascadeComments(false);
                      setConfirmDel({ issuer: b.name, boardId: b.shortId, title: b.title });
                    }}
                    canDelete={canDelete}
                  />
                </RowLinkGuard>
              ) : (
                <Tooltip title="You don't have access to this private board">
                  <span>
                    <Button variant="outlined" disabled>
                      No Access
                    </Button>
                  </span>
                </Tooltip>
              )}
            </Box>
          </Paper>
        );
      })}

      {/* Delete dialog (single instance, outside map) */}
      <Dialog open={!!confirmDel} onClose={() => setConfirmDel(null)} maxWidth="xs" fullWidth>
        <DialogTitle>Delete board?</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <Typography>
              Delete <b>{confirmDel?.title}</b> (issuer: {confirmDel?.issuer})?
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
            <Alert severity="warning">This publishes tombstones. Proceed with caution.</Alert>
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
                  await deleteBoardById(confirmDel.issuer, confirmDel.boardId, {
                    cascadeCards,
                    cascadeComments,
                  });
                }, 'blocking:qdeck:delete');
                setBoardMap((prev) => {
                  const next = { ...prev };
                  Object.keys(next).forEach((key) => {
                    const entry = next[key];
                    if (!entry) return;
                    if (entry.name === confirmDel.issuer && entry.shortId === confirmDel.boardId) {
                      delete next[key];
                    }
                  });
                  return next;
                });
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
