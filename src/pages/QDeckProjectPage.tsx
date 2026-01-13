import * as React from 'react';
import { Link as RouterLink, useNavigate, useParams } from 'react-router-dom';
import {
  Box,
  Stack,
  Typography,
  Button,
  Chip,
  Paper,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Divider,
  Alert,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PublicIcon from '@mui/icons-material/Public';
import LockIcon from '@mui/icons-material/Lock';
import { useAuth } from 'qapp-core';

import type { QDeckBoard, QDeckProject } from '../types/qdeck';
import {
  resolveProjectForReadWithMeta,
  resolveBoardForReadWithMeta,
  buildProjectPublishPayload,
  buildProjectsIndexPublishPayload,
  loadNewestCardsIndex,
  loadCardDoc,
} from '../utils/qdeckApi';
import { loadBoardsIndexMerged } from '../utils/qdeckIndexCache';
import { boardUrl } from '../utils/qdeckApi';
import { useAlert } from '../components/alerts';
import CalendarView from '../components/qdeck/CalendarView';
import type { QDeckCard } from '../types/qdeck';
import pLimit from 'p-limit';
import { pastelHexFromId } from '../utils/qdeckColors';
import { getAssetInfo } from '../utils/qortalAssetRequests';
import { readAssetsIndexSync } from '../bootstrap/assetsBootstrap';
import { useFetchTracker } from '../state/global/fetchTracker';
import type { BatchPublishResource } from '../utils/useQdnBatchPublisher';
import { useQdnBatchPublisher } from '../utils/useQdnBatchPublisher';
import { loadProjectsIndexMerged, setLocalProjectsIndex } from '../utils/qdeckProjectIndexCache';
import { setLocalProjectDoc } from '../utils/qdeckProjectDocCache';

type PendingBoardAdd = {
  board: QDeckBoard;
  issuerName: string;
  mismatchFields: string[];
};

const PROJECT_QUEUE_STORAGE_KEY = 'qdeck_project_publish_queue_v1';

const publishQueueKey = (res: BatchPublishResource) =>
  `${res.service}::${(res.name || '').toLowerCase()}::${res.identifier}`;

const readQueueFromStorage = (projectId: string) => {
  if (!projectId || typeof window === 'undefined') return [] as BatchPublishResource[];
  try {
    const raw = window.sessionStorage.getItem(PROJECT_QUEUE_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return [];
    const list = parsed[projectId];
    return Array.isArray(list) ? (list as BatchPublishResource[]) : [];
  } catch {
    return [];
  }
};

const writeQueueToStorage = (projectId: string, queue: BatchPublishResource[]) => {
  if (!projectId || typeof window === 'undefined') return;
  try {
    const raw = window.sessionStorage.getItem(PROJECT_QUEUE_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Record<string, BatchPublishResource[]>) : {};
    parsed[projectId] = queue;
    window.sessionStorage.setItem(PROJECT_QUEUE_STORAGE_KEY, JSON.stringify(parsed));
  } catch {
    /* ignore */
  }
};

const normalizeList = (list?: Array<string | number>) => (list ?? []).map((v) => String(v)).sort();

const listsMatch = (a?: Array<string | number>, b?: Array<string | number>) => {
  const aa = normalizeList(a);
  const bb = normalizeList(b);
  if (aa.length !== bb.length) return false;
  return aa.every((v, i) => v === bb[i]);
};

const getPermissionMismatches = (project: QDeckProject, board: QDeckBoard) => {
  const mismatches: string[] = [];
  if (project.visibility !== board.visibility) mismatches.push('visibility');
  if (!listsMatch(project.groupsAllowed, board.groupsAllowed)) mismatches.push('editor groups');
  if (!listsMatch(project.usersAllowed, board.usersAllowed)) mismatches.push('editor users');
  if (!listsMatch(project.editors, board.editors)) mismatches.push('editors');
  if (!listsMatch(project.editorGroups, board.editorGroups)) mismatches.push('editor groups');
  if (!listsMatch(project.owners, board.owners)) mismatches.push('owners');
  if (!listsMatch(project.ownerGroups, board.ownerGroups)) mismatches.push('owner groups');
  if (!!project.adminOverride !== !!board.adminOverride) mismatches.push('admin override');
  return Array.from(new Set(mismatches));
};

const applyBoardPermissions = (project: QDeckProject, board: QDeckBoard): QDeckProject => ({
  ...project,
  visibility: board.visibility,
  service: board.service,
  privateMeta: board.visibility === 'private' ? { ...board.privateMeta } : undefined,
  groupsAllowed: board.groupsAllowed ?? [],
  usersAllowed: board.usersAllowed,
  owners: board.owners,
  ownerGroups: board.ownerGroups,
  editors: board.editors,
  editorGroups: board.editorGroups,
  adminOverride: board.adminOverride,
});

const formatList = (items?: Array<string | number>) => {
  const list = (items ?? []).map((v) => String(v)).filter(Boolean);
  return list.length ? list.join(', ') : 'None';
};

const normalizeHex = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  return null;
};

export default function QDeckProjectPage() {
  const { issuer, projectId } = useParams();
  const navigate = useNavigate();
  const auth = useAuth();
  const { alert } = useAlert();
  const theme = useTheme();
  const { publish: publishResources } = useQdnBatchPublisher();
  const { track } = useFetchTracker();

  const [project, setProject] = React.useState<QDeckProject | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [errorText, setErrorText] = React.useState<string | null>(null);
  const [saving, setSaving] = React.useState(false);
  const [pendingPublishes, setPendingPublishes] = React.useState<BatchPublishResource[]>([]);
  const [publishingQueue, setPublishingQueue] = React.useState(false);

  const [addBoardOpen, setAddBoardOpen] = React.useState(false);
  const [boardIssuer, setBoardIssuer] = React.useState(auth?.name ?? '');
  const [boardIdInput, setBoardIdInput] = React.useState('');
  const [boardOptions, setBoardOptions] = React.useState<Array<{ boardId: string; title: string }>>(
    []
  );

  const [pendingBoardAdd, setPendingBoardAdd] = React.useState<PendingBoardAdd | null>(null);

  const [assetInput, setAssetInput] = React.useState('');
  const [calendarIncludeDone, setCalendarIncludeDone] = React.useState(false);
  const [calendarLoading, setCalendarLoading] = React.useState(false);
  const [projectCards, setProjectCards] = React.useState<
    Array<{
      board: QDeckBoard;
      card: QDeckCard;
      boardRef: { boardId: string; issuerName: string; colorHex?: string };
    }>
  >([]);
  const [boardDetails, setBoardDetails] = React.useState<Record<string, QDeckBoard>>({});
  const [assetDetails, setAssetDetails] = React.useState<
    Record<string, { status: 'loading' | 'loaded' | 'error'; name?: string; assetId?: number }>
  >({});
  const loadTokenRef = React.useRef(0);
  const assetTokenRef = React.useRef(0);

  React.useEffect(() => {
    if (!issuer || !projectId) {
      const fallback = auth?.name;
      if (fallback && projectId) {
        navigate(`/qdeck/projects/${encodeURIComponent(fallback)}/${projectId}`, { replace: true });
      } else {
        navigate('/qdeck/projects', { replace: true });
      }
      return;
    }

    setLoading(true);
    setErrorText(null);
    track(resolveProjectForReadWithMeta(issuer, projectId), `qdeck:project:load:${projectId}`)
      .then((res) => {
        if (!res?.doc) {
          setProject(null);
          setErrorText('Project not found or inaccessible.');
          return;
        }
        setProject(res.doc);
      })
      .catch((e) => {
        setProject(null);
        setErrorText(String((e as any)?.message || e));
      })
      .finally(() => setLoading(false));
  }, [issuer, projectId, auth?.name, navigate, track]);

  React.useEffect(() => {
    if (!projectId) return;
    setPendingPublishes(readQueueFromStorage(projectId));
  }, [projectId]);

  React.useEffect(() => {
    if (!projectId) return;
    writeQueueToStorage(projectId, pendingPublishes);
  }, [projectId, pendingPublishes]);

  React.useEffect(() => {
    const issuerName = auth?.name ?? '';
    if (!addBoardOpen || !issuerName) return;
    let alive = true;
    (async () => {
      try {
        const idx = await loadBoardsIndexMerged(issuerName);
        if (!alive) return;
        setBoardOptions((idx?.boards ?? []).map((b) => ({ boardId: b.boardId, title: b.title })));
      } catch {
        if (alive) setBoardOptions([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, [addBoardOpen, auth?.name]);

  const persistProject = React.useCallback(
    async (next: QDeckProject) => {
      if (!issuer) return;
      setSaving(true);
      try {
        const updated: QDeckProject = {
          ...next,
          updatedAt: Date.now(),
          seq: (next.seq ?? 0) + 1,
        };
        const baseIndex = (await loadProjectsIndexMerged(issuer)) ?? {
          _type: 'QDECK_PROJECTS_INDEX' as const,
          version: 1 as const,
          issuerName: issuer,
          projects: [],
          updatedAt: 0,
          seq: 0,
        };

        const nextIndex = {
          ...baseIndex,
          projects: [
            ...baseIndex.projects.filter((p) => p.projectId !== updated.projectId),
            {
              projectId: updated.projectId,
              title: updated.title,
              createdAt: updated.createdAt,
              updatedAt: updated.updatedAt,
              visibility: updated.visibility,
              service: updated.service,
              mode: updated.privateMeta?.mode ?? 'group',
            },
          ],
          updatedAt: Date.now(),
          seq: (baseIndex.seq ?? 0) + 1,
        };

        setLocalProjectDoc(issuer, updated);
        setLocalProjectsIndex(issuer, nextIndex);

        const [projectPayload, indexPayload] = await Promise.all([
          buildProjectPublishPayload(issuer, updated),
          buildProjectsIndexPublishPayload(issuer, nextIndex),
        ]);

        setPendingPublishes((prev) => {
          const map = new Map(prev.map((item) => [publishQueueKey(item), item]));
          map.set(publishQueueKey(projectPayload), projectPayload);
          map.set(publishQueueKey(indexPayload), indexPayload);
          return Array.from(map.values());
        });
        setProject(updated);
      } catch (e: any) {
        await alert(e?.message || 'Failed to save project.', 'Project update', {
          severity: 'error',
        });
      } finally {
        setSaving(false);
      }
    },
    [issuer, alert]
  );

  const loadProjectCards = React.useCallback(async () => {
    if (!project?.boards?.length) {
      setProjectCards([]);
      setBoardDetails({});
      return;
    }
    const token = ++loadTokenRef.current;
    setCalendarLoading(true);
    const limit = pLimit(4);
    const rows: Array<{
      board: QDeckBoard;
      card: QDeckCard;
      boardRef: { boardId: string; issuerName: string; colorHex?: string };
    }> = [];
    const details: Record<string, QDeckBoard> = {};
    try {
      for (const ref of project.boards) {
        const probe = await resolveBoardForReadWithMeta(ref.issuerName, ref.boardId).catch(
          () => null
        );
        if (!probe?.doc) continue;
        const board = probe.doc;
        details[`${ref.issuerName}:${ref.boardId}`] = board;
        const index = await loadNewestCardsIndex(board, {
          issuerHints: [ref.issuerName, board.createdBy].filter(Boolean),
        }).catch(() => null);
        if (!index) continue;
        const entries =
          index.entries?.length && index.entries.some((e) => e.cardId && e.name)
            ? index.entries
            : (index.cardIds ?? []).map((cardId) => ({ name: board.createdBy, cardId }));
        const cards = await Promise.all(
          entries.map((entry) =>
            limit(() => loadCardDoc(entry.name || board.createdBy, board, entry.cardId)).catch(
              () => null
            )
          )
        );
        const byId = new Map<string, QDeckCard>();
        for (const doc of cards) {
          if (!doc || (doc as any)._type !== 'QDECK_CARD') continue;
          const prev = byId.get(doc.cardId);
          if (
            !prev ||
            (doc.updatedAt ?? 0) > (prev.updatedAt ?? 0) ||
            (doc.seq ?? 0) > (prev.seq ?? 0)
          ) {
            byId.set(doc.cardId, doc);
          }
        }
        for (const card of byId.values()) {
          rows.push({ board, card, boardRef: ref });
        }
      }
      if (loadTokenRef.current === token) {
        setProjectCards(rows);
        setBoardDetails(details);
      }
    } finally {
      if (loadTokenRef.current === token) setCalendarLoading(false);
    }
  }, [project]);

  React.useEffect(() => {
    if (!project?.projectId) {
      loadProjectCards().catch(() => setCalendarLoading(false));
      return;
    }
    track(loadProjectCards(), `qdeck:project:cards:${project.projectId}`).catch(() =>
      setCalendarLoading(false)
    );
  }, [loadProjectCards, project?.projectId, track]);

  React.useEffect(() => {
    if (!project?.assetIds?.length) {
      if (Object.keys(assetDetails).length) {
        setAssetDetails({});
      }
      return;
    }
    const token = ++assetTokenRef.current;
    const ids = project.assetIds.map((a) => String(a.assetId ?? '').trim()).filter(Boolean);
    const missing = ids.filter((id) => !assetDetails[id]);
    if (!missing.length) return;
    setAssetDetails((prev) => {
      const next = { ...prev };
      for (const id of missing) {
        next[id] = { status: 'loading' };
      }
      return next;
    });

    (async () => {
      await Promise.all(
        missing.map(async (id) => {
          const idKey = String(id ?? '').trim();
          const isNumeric = /^\d+$/.test(idKey);
          const numericId = isNumeric ? Number(idKey) : null;
          if (numericId != null) {
            const cached = readAssetsIndexSync()?.[numericId];
            if (cached?.name && assetTokenRef.current === token) {
              setAssetDetails((prev) => ({
                ...prev,
                [idKey]: { status: 'loaded', name: cached.name, assetId: cached.assetId },
              }));
              return;
            }
          }
          try {
            const info =
              numericId != null
                ? await getAssetInfo({ assetId: numericId })
                : await getAssetInfo({ assetName: idKey });
            if (assetTokenRef.current !== token) return;
            setAssetDetails((prev) => ({
              ...prev,
              [idKey]: {
                status: 'loaded',
                name: info?.name ?? info?.assetName ?? idKey,
                assetId: info?.assetId ?? numericId ?? undefined,
              },
            }));
          } catch {
            if (assetTokenRef.current !== token) return;
            setAssetDetails((prev) => ({
              ...prev,
              [idKey]: { status: 'error' },
            }));
          }
        })
      );
    })();
  }, [project?.assetIds, assetDetails]);

  const calendarEvents = React.useMemo(() => {
    const hourMs = 60 * 60 * 1000;
    return projectCards.flatMap(({ board, card, boardRef }) => {
      const hasSchedule = !!card.scheduledStart || !!card.scheduledEnd;
      const includeCompleted = calendarIncludeDone && !!card.completedAt;
      if (!hasSchedule && !includeCompleted) return [];
      const start =
        card.scheduledStart ??
        card.scheduledEnd ??
        (includeCompleted ? card.completedAt : undefined);
      if (!start) return [];
      let end = card.scheduledEnd;
      if (card.isDone && card.completedAt) end = card.completedAt;
      if (!end) end = card.scheduledAllDay ? start : start + hourMs;
      if (end < start) end = start;
      const list = board.lists.find((l) => l.listId === card.statusListId);
      const listTitle = list?.title ?? card.statusListId;
      const meta = `${board.title} · ${listTitle}`;
      return [
        {
          id: `${board.boardId}:${card.cardId}`,
          title: card.title,
          start,
          end,
          allDay: !!card.scheduledAllDay,
          color: boardRef.colorHex ?? pastelHexFromId(board.boardId) ?? list?.faintColor,
          meta,
        },
      ];
    });
  }, [projectCards, calendarIncludeDone]);

  const handleAddBoard = async (
    matchPermissions: boolean,
    board: QDeckBoard,
    issuerName: string
  ) => {
    if (!project) return;
    const existing = project.boards ?? [];
    if (existing.some((b) => b.boardId === board.boardId && b.issuerName === issuerName)) {
      await alert('This board is already in the project.', 'Add board', { severity: 'info' });
      return;
    }
    let next: QDeckProject = {
      ...project,
      boards: [
        ...existing,
        { boardId: board.boardId, issuerName, colorHex: pastelHexFromId(board.boardId) },
      ],
    };
    if (matchPermissions) {
      next = applyBoardPermissions(next, board);
    }
    await persistProject(next);
  };

  const submitAddBoard = async () => {
    if (!project) return;
    const issuerName = boardIssuer.trim();
    const boardId = boardIdInput.trim();
    if (!issuerName || !boardId) {
      await alert('Provide both board issuer and board ID.', 'Add board', {
        severity: 'warning',
      });
      return;
    }

    const probe = await resolveBoardForReadWithMeta(issuerName, boardId).catch(() => null);
    if (!probe?.doc) {
      await alert('Board not found or inaccessible.', 'Add board', { severity: 'error' });
      return;
    }

    const mismatchFields = getPermissionMismatches(project, probe.doc);
    if (mismatchFields.length) {
      setPendingBoardAdd({ board: probe.doc, issuerName, mismatchFields });
      return;
    }

    await handleAddBoard(false, probe.doc, issuerName);
    setAddBoardOpen(false);
    setBoardIdInput('');
  };

  const confirmAddBoard = async (matchPermissions: boolean) => {
    if (!pendingBoardAdd) return;
    await handleAddBoard(matchPermissions, pendingBoardAdd.board, pendingBoardAdd.issuerName);
    setPendingBoardAdd(null);
    setAddBoardOpen(false);
    setBoardIdInput('');
  };

  const removeBoard = async (boardId: string, issuerName: string) => {
    if (!project) return;
    const next = {
      ...project,
      boards: (project.boards ?? []).filter(
        (b) => !(b.boardId === boardId && b.issuerName === issuerName)
      ),
    };
    await persistProject(next);
  };

  const updateBoardColor = async (boardId: string, issuerName: string, colorHex: string) => {
    if (!project) return;
    const normalized = normalizeHex(colorHex);
    if (!normalized) return;
    const next = {
      ...project,
      boards: (project.boards ?? []).map((b) =>
        b.boardId === boardId && b.issuerName === issuerName ? { ...b, colorHex: normalized } : b
      ),
    };
    await persistProject(next);
  };

  const clearPublishQueue = () => {
    setPendingPublishes([]);
  };

  const publishQueuedChanges = async () => {
    if (!pendingPublishes.length) return;
    setPublishingQueue(true);
    try {
      await publishResources(pendingPublishes);
      setPendingPublishes([]);
      await alert('Queued project changes published.', 'Publish queue', {
        severity: 'success',
      });
    } catch (e: any) {
      await alert(e?.message || 'Failed to publish queued changes.', 'Publish queue', {
        severity: 'error',
      });
    } finally {
      setPublishingQueue(false);
    }
  };

  const addAsset = async () => {
    if (!project) return;
    const assetId = assetInput.trim();
    if (!assetId) return;
    const existing = project.assetIds ?? [];
    if (existing.some((a) => a.assetId === assetId)) {
      await alert('That asset is already linked.', 'Add asset', { severity: 'info' });
      return;
    }
    const next = {
      ...project,
      assetIds: [...existing, { assetId }],
    };
    await persistProject(next);
    setAssetInput('');
  };

  const removeAsset = async (assetId: string) => {
    if (!project) return;
    const next = {
      ...project,
      assetIds: (project.assetIds ?? []).filter((a) => a.assetId !== assetId),
    };
    await persistProject(next);
  };

  if (loading) {
    return <Typography sx={{ p: 2 }}>Loading project…</Typography>;
  }

  if (!project) {
    return (
      <Typography sx={{ p: 2 }}>
        {errorText ? `Project error: ${errorText}` : 'Project not found.'}
      </Typography>
    );
  }

  const isPrivate = project.visibility === 'private';

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        justifyContent="space-between"
        alignItems={{ xs: 'stretch', sm: 'center' }}
        spacing={{ xs: 1, sm: 2 }}
        sx={{ mb: 2 }}
      >
        <Box>
          <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 0.5 }}>
            <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
              {project.title}
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
          {project.description && (
            <Typography variant="body2" sx={{ opacity: 0.8 }}>
              {project.description}
            </Typography>
          )}
        </Box>
        <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
          <Chip
            size="small"
            label={`${pendingPublishes.length} queued`}
            color={pendingPublishes.length ? 'warning' : 'default'}
            variant={pendingPublishes.length ? 'filled' : 'outlined'}
          />
          <Button
            variant={pendingPublishes.length ? 'contained' : 'outlined'}
            color={pendingPublishes.length ? 'success' : 'primary'}
            onClick={publishQueuedChanges}
            disabled={!pendingPublishes.length || publishingQueue}
          >
            Publish queued
          </Button>
          <Button
            variant="text"
            onClick={clearPublishQueue}
            disabled={!pendingPublishes.length || publishingQueue}
          >
            Clear queue
          </Button>
          <Button variant="contained" onClick={() => setAddBoardOpen(true)} disabled={saving}>
            Add board
          </Button>
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Boards
        </Typography>
        {!project.boards?.length ? (
          <Typography variant="body2" color="text.secondary">
            No boards attached to this project yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {project.boards.map((b) => {
              const key = `${b.issuerName}:${b.boardId}`;
              const detail = boardDetails[key];
              const colorHex = b.colorHex ?? pastelHexFromId(b.boardId);
              return (
                <Paper
                  key={key}
                  variant="outlined"
                  sx={{ p: 1.25, display: 'grid', gap: 1, alignItems: 'center' }}
                >
                  <Stack direction="row" spacing={1} alignItems="center" sx={{ minWidth: 0 }}>
                    <Box
                      sx={{
                        width: 14,
                        height: 14,
                        borderRadius: '50%',
                        bgcolor: colorHex,
                        border: `1px solid ${theme.palette.divider}`,
                        flexShrink: 0,
                      }}
                    />
                    <Box sx={{ flex: 1, minWidth: 0 }}>
                      <Typography variant="subtitle2" noWrap>
                        {detail?.title || b.boardId}
                      </Typography>
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {b.issuerName} · {b.boardId}
                      </Typography>
                    </Box>
                    <TextField
                      type="color"
                      value={colorHex}
                      onChange={(e) => updateBoardColor(b.boardId, b.issuerName, e.target.value)}
                      size="small"
                      inputProps={{ 'aria-label': 'Board color' }}
                      sx={{ width: 56 }}
                    />
                    <Button
                      size="small"
                      component={RouterLink}
                      to={boardUrl(b.issuerName, b.boardId)}
                    >
                      Open
                    </Button>
                    <Button
                      size="small"
                      color="error"
                      onClick={() => removeBoard(b.boardId, b.issuerName)}
                      disabled={saving}
                    >
                      Remove
                    </Button>
                  </Stack>
                  {detail && (
                    <Stack spacing={0.25}>
                      <Typography variant="caption" color="text.secondary">
                        Visibility: {detail.visibility}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Editors: {formatList(detail.editors ?? detail.usersAllowed)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Editor groups: {formatList(detail.editorGroups ?? detail.groupsAllowed)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Owners: {formatList(detail.owners)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Owner groups: {formatList(detail.ownerGroups)}
                      </Typography>
                      <Typography variant="caption" color="text.secondary">
                        Admin override: {detail.adminOverride ? 'Yes' : 'No'}
                      </Typography>
                    </Stack>
                  )}
                </Paper>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2 }}>
        <Typography variant="subtitle1" sx={{ mb: 1 }}>
          Assets
        </Typography>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5 }}>
          <TextField
            label="Asset ID"
            value={assetInput}
            onChange={(e) => setAssetInput(e.target.value)}
            size="small"
            fullWidth
          />
          <Button variant="outlined" onClick={addAsset} disabled={!assetInput.trim() || saving}>
            Add asset
          </Button>
        </Stack>
        {!project.assetIds?.length ? (
          <Typography variant="body2" color="text.secondary">
            No assets linked to this project yet.
          </Typography>
        ) : (
          <Stack spacing={1}>
            {project.assetIds.map((asset) => {
              const detail = assetDetails[String(asset.assetId ?? '').trim()];
              const numericId = Number(asset.assetId);
              const resolvedId =
                detail?.assetId ??
                (Number.isFinite(numericId) && String(numericId) === String(asset.assetId)
                  ? numericId
                  : null);
              return (
                <Paper
                  key={asset.assetId}
                  variant="outlined"
                  sx={{ p: 1, display: 'flex', alignItems: 'center', gap: 1 }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {detail?.name ||
                        (detail?.status === 'loading'
                          ? 'Loading asset…'
                          : `Asset #${asset.assetId}`)}
                    </Typography>
                    {asset.issuerName && (
                      <Typography variant="caption" color="text.secondary" noWrap>
                        {asset.issuerName}
                      </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary" noWrap>
                      Asset ID: {asset.assetId}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    component={RouterLink}
                    to={resolvedId != null ? `/assets/${resolvedId}` : '/assets'}
                    disabled={resolvedId == null}
                  >
                    View
                  </Button>
                  <Button
                    size="small"
                    color="error"
                    onClick={() => removeAsset(asset.assetId)}
                    disabled={saving}
                  >
                    Remove
                  </Button>
                </Paper>
              );
            })}
          </Stack>
        )}
      </Paper>

      <Paper variant="outlined" sx={{ p: 2, mt: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          spacing={1}
          sx={{ mb: 1 }}
        >
          <Typography variant="subtitle1">Project calendar</Typography>
          <Stack direction="row" spacing={1} alignItems="center">
            <Button
              variant="outlined"
              size="small"
              onClick={() =>
                project?.projectId
                  ? track(loadProjectCards(), `qdeck:project:cards:${project.projectId}`)
                  : loadProjectCards()
              }
            >
              Refresh
            </Button>
            <Button
              variant={calendarIncludeDone ? 'contained' : 'outlined'}
              size="small"
              onClick={() => setCalendarIncludeDone((prev) => !prev)}
            >
              {calendarIncludeDone ? 'Hide done' : 'Show done'}
            </Button>
          </Stack>
        </Stack>
        {calendarLoading ? (
          <Typography variant="body2" color="text.secondary">
            Loading scheduled cards…
          </Typography>
        ) : (
          <CalendarView events={calendarEvents} />
        )}
      </Paper>

      <Dialog open={addBoardOpen} onClose={() => setAddBoardOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add board to project</DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
          {boardOptions.length ? (
            <FormControl size="small" fullWidth>
              <InputLabel id="board-pick">Pick from your boards</InputLabel>
              <Select
                labelId="board-pick"
                label="Pick from your boards"
                value={boardIdInput}
                onChange={(e) => {
                  const val = e.target.value as string;
                  setBoardIdInput(val);
                  setBoardIssuer(auth?.name ?? boardIssuer);
                }}
              >
                {boardOptions.map((b) => (
                  <MenuItem key={b.boardId} value={b.boardId}>
                    {b.title} — {b.boardId}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <Alert severity="info">No boards found in your index.</Alert>
          )}

          <Divider />

          <TextField
            label="Board issuer"
            value={boardIssuer}
            onChange={(e) => setBoardIssuer(e.target.value)}
            size="small"
            fullWidth
          />
          <TextField
            label="Board ID"
            value={boardIdInput}
            onChange={(e) => setBoardIdInput(e.target.value)}
            size="small"
            fullWidth
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setAddBoardOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={submitAddBoard} disabled={!boardIdInput.trim()}>
            Add board
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={!!pendingBoardAdd}
        onClose={() => setPendingBoardAdd(null)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Permissions mismatch</DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gap: 1 }}>
          <Typography variant="body2">
            This board has different permissions than the project:
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap">
            {pendingBoardAdd?.mismatchFields?.map((field) => (
              <Chip key={field} size="small" label={field} />
            ))}
          </Stack>
          <Typography variant="body2">
            Would you like to match the project permissions to this board?
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => confirmAddBoard(false)}>Keep project permissions</Button>
          <Button variant="contained" onClick={() => confirmAddBoard(true)}>
            Match to board
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
