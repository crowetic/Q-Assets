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

// Helpers for pretty list rows
function hueFromId(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) % 360;
  return h;
}
function bgFromId(id: string, mode: 'light' | 'dark') {
  const h = hueFromId(id);
  const s = mode === 'dark' ? 45 : 55;
  const l = mode === 'dark' ? 16 : 92;
  return `hsl(${h} ${s}% ${l}%)`;
}

export default function QDeckAllBoards() {
  const { name: myName } = useAuth();
  const [boards, setBoards] = React.useState<AnyBoard[]>([]);
  const [q, setQ] = React.useState('');
  const [stats, setStats] = React.useState({ pubFound: 0, privFound: 0, hydrated: 0 });

  const [confirmDel, setConfirmDel] = React.useState<null | {
    issuer: string;
    boardId: string;
    title: string;
  }>(null);
  const [cascadeCards, setCascadeCards] = React.useState(false);
  const [cascadeComments, setCascadeComments] = React.useState(false);
  const [busyDel, setBusyDel] = React.useState(false);

  const { alert } = useAlert();

  const load = React.useCallback(async () => {
    // 1) Fetch heads
    const [pubRaw, privRaw] = await Promise.all([
      searchSimpleByIdPrefixOnly(QDeckId.prefixPublicBoards, false),
      searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateBoards, true),
    ]);

    // 2) Hydrate PUBLIC
    const pubBoards = await Promise.all(
      pubRaw.map(async (h) => {
        if (!h?.identifier || !h?.name) return null;
        const shortId = h.identifier.replace(QDeckId.prefixPublicBoards, '');
        try {
          const doc = await qdeckFetch<QDeckBoard>(h.name, h.identifier, false);
          if (!doc || (doc as any)?._type === 'QDECK_TOMBSTONE') return null;
          return {
            name: h.name,
            shortId,
            title: doc.title,
            updatedAt: doc.updatedAt,
            visibility: 'public' as const,
            service: 'DOCUMENT' as const,
            accessible: true,
          } as AnyBoard;
        } catch {
          return null;
        }
      })
    );

    // 3) Hydrate PRIVATE (v2 ident tells us how to fetch)
    const privBoards = await Promise.all(
      privRaw.map(async (h) => {
        if (!h?.identifier || !h?.name) return null;

        const parsed = parsePrivateBoardIdentV2(h.identifier);
        if (!parsed) {
          // If a non-v2 slips through, skip (your first release is v2-only)
          return null;
        }

        const shortId = parsed.boardId;

        // Fetch using encoded mode
        let doc: QDeckBoard | null = null;
        try {
          doc = await qdeckFetch<QDeckBoard>(
            h.name,
            h.identifier,
            /* isPrivate */ true,
            parsed.mode === 'group' ? parsed.groupId : undefined,
            parsed.mode === 'group' ? !!parsed.isAdmins : undefined,
            parsed.mode
          );
        } catch {
          doc = null;
        }

        if (!doc || (doc as any)?._type === 'QDECK_TOMBSTONE') {
          // Inaccessible or deleted: still list it, clearly marked
          return {
            name: h.name,
            shortId,
            title: '(Private board)',
            updatedAt: undefined,
            visibility: 'private' as const,
            service: 'DOCUMENT_PRIVATE' as const,
            accessible: false,
            privMode: parsed.mode, // we still know which kind it is
          } as AnyBoard;
        }

        return {
          name: h.name,
          shortId,
          title: doc.title,
          updatedAt: doc.updatedAt,
          visibility: coerceVisibility(doc.visibility ?? 'private'),
          service: coerceService(doc.service ?? 'DOCUMENT_PRIVATE'),
          accessible: true,
          privMode: parsed.mode,
        } as AnyBoard;
      })
    );

    const list = [...pubBoards, ...privBoards].filter(Boolean) as AnyBoard[];
    list.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
    setStats({ pubFound: pubRaw.length, privFound: privRaw.length, hydrated: list.length });
    setBoards(list);
  }, []);

  React.useEffect(() => {
    load().catch(console.error);
  }, [load]);

  const filtered = boards.filter(
    (b) =>
      !q ||
      b.title.toLowerCase().includes(q.toLowerCase()) ||
      b.name.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <Box sx={{ p: 2 }}>
      <Stack direction="row" justifyContent="space-between" alignItems="center" sx={{ mb: 2 }}>
        <Typography variant="h4">All Boards</Typography>
        <TextField size="small" label="Filter" value={q} onChange={(e) => setQ(e.target.value)} />
      </Stack>

      <Typography variant="caption" sx={{ opacity: 0.7, display: 'block', mb: 1 }}>
        Public hits: {stats.pubFound} • Private hits: {stats.privFound} • Listed: {stats.hydrated}
      </Typography>

      <Stack spacing={2}>
        {filtered.length === 0 && (
          <Typography sx={{ opacity: 0.7 }}>No boards match your filter.</Typography>
        )}

        {filtered.map((b) => {
          const bg = (t: any) => bgFromId(b.shortId, t.palette.mode);
          const border = (t: any) => `1px solid ${t.palette.divider}`;
          const to = `/qdeck/${encodeURIComponent(b.name)}/${b.shortId}`;
          const canDelete = myName === b.name;

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
                label={
                  b.privMode === 'group' ? 'Private (group access)' : 'Private (direct access)'
                }
                variant="outlined"
                color="primary"
              />
            ) : (
              <Chip
                size="small"
                icon={<LockIcon fontSize="small" />}
                label={
                  b.privMode === 'group'
                    ? 'Private (no access, group)'
                    : 'Private (no access, direct)'
                }
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
                p: 2,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                bgcolor: bg,
                border,
              }}
            >
              <Box>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
                  <Typography variant="h6" sx={{ lineHeight: 1.2 }}>
                    {b.title}
                  </Typography>
                  {chip}
                </Stack>
                <Typography variant="caption" sx={{ opacity: 0.7 }}>
                  {b.name} — {b.shortId}
                </Typography>
              </Box>

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
            </Paper>
          );
        })}
      </Stack>

      {/* Delete dialog */}
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
                await deleteBoardById(confirmDel.issuer, confirmDel.boardId, {
                  cascadeCards,
                  cascadeComments,
                });
                setBoards((prev) =>
                  prev.filter(
                    (x) => !(x.name === confirmDel.issuer && x.shortId === confirmDel.boardId)
                  )
                );
                setStats((s) => ({ ...s, hydrated: Math.max(0, s.hydrated - 1) }));
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
