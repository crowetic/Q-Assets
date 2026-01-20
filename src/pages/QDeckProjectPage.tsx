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
  Autocomplete,
  Avatar,
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
  createBoardAndIndex,
  canEncryptToGroup,
} from '../utils/qdeckApi';
import { boardUrl } from '../utils/qdeckApi';
import { QDeckId } from '../constants/qdeckIdentifiers';
import { searchSimpleByIdPrefixOnly } from '../utils/searchSimple';
import { useAlert } from '../components/alerts';
import { getGroupNameById, getPrimaryAccountName } from '../utils/qortalApi';
import CalendarView from '../components/qdeck/CalendarView';
import { CreateBoardDialog } from '../components/qdeck/CreateBoardDialog';
import type { QDeckCard } from '../types/qdeck';
import pLimit from 'p-limit';
import { pastelHexFromId } from '../utils/qdeckColors';
import { ensureAssetsIndexLoaded, readAssetsIndexSync } from '../bootstrap/assetsBootstrap';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
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

type CreateBoardPayload = {
  title: string;
  visibility: 'public' | 'private';
  privateMeta?: { groupId?: number; isAdmins?: boolean };
  groupsAllowed: number[];
  usersAllowed?: string[];
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

const normalizeHex = (value: string) => {
  const trimmed = value.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(trimmed)) return trimmed;
  return null;
};

const isCoreAssetName = (name?: string) =>
  !!name && ['QORT', 'QORT-from-QORA', 'Legacy-QORA'].includes(name);

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
  const [createBoardOpen, setCreateBoardOpen] = React.useState(false);
  const [createBoardBusy, setCreateBoardBusy] = React.useState(false);
  const [boardIssuer, setBoardIssuer] = React.useState('');
  const [boardIdInput, setBoardIdInput] = React.useState('');
  const [boardOptions, setBoardOptions] = React.useState<
    Array<{ boardId: string; title: string; issuerName: string }>
  >([]);
  const [boardOptionsLoading, setBoardOptionsLoading] = React.useState(false);

  const [pendingBoardAdd, setPendingBoardAdd] = React.useState<PendingBoardAdd | null>(null);

  const [assetSelection, setAssetSelection] = React.useState<{
    assetId: number;
    name: string;
  } | null>(null);
  const [assetOptions, setAssetOptions] = React.useState<Array<{ assetId: number; name: string }>>(
    []
  );
  const [assetOptionsLoading, setAssetOptionsLoading] = React.useState(false);
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
  const [groupNameMap, setGroupNameMap] = React.useState<Record<number, string>>({});
  const [assetDetails, setAssetDetails] = React.useState<
    Record<
      string,
      {
        status: 'loading' | 'loaded' | 'error';
        name?: string;
        assetId?: number;
        owner?: string;
        issuerName?: string;
        avatarUrl?: string | null;
      }
    >
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
    if (!addBoardOpen) return;
    let alive = true;
    (async () => {
      try {
        setBoardOptionsLoading(true);
        const [pubHeads, privHeads] = await Promise.all([
          searchSimpleByIdPrefixOnly(QDeckId.prefixPublicBoards, false),
          searchSimpleByIdPrefixOnly(QDeckId.prefixPrivateBoards, true),
        ]);
        if (!alive) return;

        const limit = pLimit(10);
        const options: Array<{ boardId: string; title: string; issuerName: string }> = [];
        const seen = new Set<string>();
        const isTombstone = (size?: number) =>
          typeof size === 'number' && size >= 175 && size <= 177;

        const hydrate = async (
          head: { identifier: string; name: string; size?: number },
          hint: 'public' | 'private'
        ) => {
          const key = `${head.name}::${head.identifier}`;
          if (!head?.identifier || !head?.name || seen.has(key)) return;
          if (isTombstone(head.size)) return;
          seen.add(key);
          try {
            const res = await resolveBoardForReadWithMeta(head.name, head.identifier, hint);
            const board = res?.doc;
            if (!board || (board as any)?._type === 'QDECK_TOMBSTONE') return;
            options.push({ boardId: board.boardId, title: board.title, issuerName: head.name });
          } catch {
            /* ignore */
          }
        };

        await Promise.all([
          ...pubHeads.map((head) => limit(() => hydrate(head, 'public'))),
          ...privHeads.map((head) => limit(() => hydrate(head, 'private'))),
        ]);

        if (!alive) return;
        const deduped = new Map<string, { boardId: string; title: string; issuerName: string }>();
        options.forEach((opt) => deduped.set(`${opt.issuerName}:${opt.boardId}`, opt));
        setBoardOptions(
          Array.from(deduped.values()).sort((a, b) => a.title.localeCompare(b.title))
        );
      } catch {
        if (alive) setBoardOptions([]);
      } finally {
        if (alive) setBoardOptionsLoading(false);
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
    const limit = pLimit(10);
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
    const ids = project.assetIds.map((a) => String(a.assetId ?? '').trim()).filter(Boolean);
    const missing = ids.filter((id) => !assetDetails[id]);
    if (!missing.length) return;
    const token = ++assetTokenRef.current;
    setAssetDetails((prev) => {
      const next = { ...prev };
      for (const id of missing) {
        next[id] = { status: 'loading' };
      }
      return next;
    });

    (async () => {
      const fillFromIndex = (
        index?: Record<number, { assetId: number; name: string; owner?: string }> | null
      ) => {
        if (!index || assetTokenRef.current !== token) return;
        setAssetDetails((prev) => {
          const next = { ...prev };
          let changed = false;
          for (const id of missing) {
            const idKey = String(id ?? '').trim();
            if (next[idKey]?.status === 'loaded') continue;
            if (!/^\d+$/.test(idKey)) continue;
            const numericId = Number(idKey);
            const cached = index[numericId];
            if (cached?.name) {
              next[idKey] = {
                status: 'loaded',
                name: cached.name,
                assetId: cached.assetId,
                owner: cached.owner,
              };
              changed = true;
            }
          }
          return changed ? next : prev;
        });
      };

      fillFromIndex(readAssetsIndexSync());

      try {
        const idx = await ensureAssetsIndexLoaded();
        fillFromIndex(idx);
      } catch {
        /* ignore */
      }

      if (assetTokenRef.current !== token) return;
      setAssetDetails((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const id of missing) {
          const idKey = String(id ?? '').trim();
          if (next[idKey]?.status === 'loaded') continue;
          next[idKey] = { status: 'error' };
          changed = true;
        }
        return changed ? next : prev;
      });
    })();
  }, [project?.assetIds, assetDetails]);

  React.useEffect(() => {
    if (!project?.assetIds?.length) return;
    const targets = project.assetIds
      .map((asset) => String(asset.assetId ?? '').trim())
      .filter(Boolean)
      .filter((idKey) => {
        const detail = assetDetails[idKey];
        return (
          detail?.status === 'loaded' && detail?.name && typeof detail.avatarUrl === 'undefined'
        );
      });
    if (!targets.length) return;

    let alive = true;
    const limit = pLimit(10);

    (async () => {
      await Promise.all(
        targets.map((idKey) =>
          limit(async () => {
            if (!alive) return;
            const detail = assetDetails[idKey];
            if (!detail?.name) return;
            let issuerName = detail.issuerName;
            if (!issuerName) {
              if (isCoreAssetName(detail.name)) {
                issuerName = 'Q-Assets';
              } else if (detail.owner) {
                issuerName = await getPrimaryAccountName(detail.owner).catch(() => '');
              }
              if (issuerName) {
                setAssetDetails((prev) => {
                  const current = prev[idKey];
                  if (!current || current.issuerName) return prev;
                  return { ...prev, [idKey]: { ...current, issuerName } };
                });
              }
            }
            if (!issuerName) return;
            const url = await fetchAssetAvatar(issuerName, detail.name).catch(() => null);
            if (!alive) return;
            setAssetDetails((prev) => {
              const current = prev[idKey];
              if (!current || typeof current.avatarUrl !== 'undefined') return prev;
              return { ...prev, [idKey]: { ...current, avatarUrl: url } };
            });
          })
        )
      );
    })();

    return () => {
      alive = false;
    };
  }, [project?.assetIds, assetDetails]);

  React.useEffect(() => {
    if (!project?.projectId) return;
    const cached = readAssetsIndexSync();
    if (cached) {
      const options = Object.values(cached)
        .map((asset) => ({ assetId: asset.assetId, name: asset.name }))
        .sort((a, b) => a.name.localeCompare(b.name));
      setAssetOptions(options);
    }

    let alive = true;
    setAssetOptionsLoading(true);
    ensureAssetsIndexLoaded()
      .then((idx) => {
        if (!alive) return;
        const options = Object.values(idx)
          .map((asset) => ({ assetId: asset.assetId, name: asset.name }))
          .sort((a, b) => a.name.localeCompare(b.name));
        setAssetOptions(options);
      })
      .catch(() => {
        /* ignore */
      })
      .finally(() => {
        if (alive) setAssetOptionsLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [project?.projectId]);

  React.useEffect(() => {
    const ids = new Set<number>();
    Object.values(boardDetails).forEach((detail) => {
      (detail.editorGroups ?? []).forEach((gid) => ids.add(Number(gid)));
      (detail.ownerGroups ?? []).forEach((gid) => ids.add(Number(gid)));
      (detail.groupsAllowed ?? []).forEach((gid) => ids.add(Number(gid)));
    });
    const missing = Array.from(ids).filter((gid) => Number.isFinite(gid) && !groupNameMap[gid]);
    if (!missing.length) return;
    let alive = true;
    (async () => {
      const rows = await Promise.all(
        missing.map(async (gid) => ({
          gid,
          name: await getGroupNameById(gid).catch(() => null),
        }))
      );
      if (!alive) return;
      setGroupNameMap((prev) => {
        const next = { ...prev };
        let changed = false;
        for (const row of rows) {
          if (row.name && !next[row.gid]) {
            next[row.gid] = row.name;
            changed = true;
          }
        }
        return changed ? next : prev;
      });
    })();
    return () => {
      alive = false;
    };
  }, [boardDetails, groupNameMap]);

  const formatGroupLabel = React.useCallback(
    (gid: number) => {
      const name = groupNameMap[gid];
      return name ? `${name} (#${gid})` : `Group #${gid}`;
    },
    [groupNameMap]
  );

  const renderValueChips = React.useCallback(
    (items?: Array<string | number>, opts?: { group?: boolean }) => {
      const list = (items ?? [])
        .map((v) => (opts?.group ? Number(v) : String(v)))
        .filter((v) => (opts?.group ? Number.isFinite(v as number) : String(v).trim()))
        .map((v) => (opts?.group ? formatGroupLabel(v as number) : String(v)));
      if (!list.length) {
        return (
          <Typography variant="body2" color="text.secondary">
            None
          </Typography>
        );
      }
      return (
        <Stack direction="row" spacing={0.5} flexWrap="wrap">
          {list.map((label) => (
            <Chip key={label} size="small" label={label} variant="outlined" />
          ))}
        </Stack>
      );
    },
    [formatGroupLabel]
  );

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

  const createBoardForProject = async (opts: CreateBoardPayload) => {
    if (!project) return false;
    setCreateBoardBusy(true);
    try {
      if (opts.visibility === 'private') {
        const groupId = opts.privateMeta?.groupId;
        if (groupId == null) {
          await alert('Private boards require a group to encrypt to.', 'Create board', {
            severity: 'warning',
          });
          return false;
        }
        const ok = await canEncryptToGroup(groupId, opts.privateMeta?.isAdmins);
        if (!ok) {
          await alert(
            'Missing group encryption key for this private board. Create the key in Qortal or switch to a public board.',
            'Create board',
            { severity: 'error' }
          );
          return false;
        }
      }

      const board = await createBoardAndIndex({
        issuerName: auth?.name ?? '',
        title: opts.title,
        groupsAllowed: opts.groupsAllowed ?? [],
        usersAllowed: opts.usersAllowed,
        visibility: opts.visibility,
        privateOpts:
          opts.visibility === 'private'
            ? {
                groupId: opts.privateMeta?.groupId,
                isAdmins: opts.privateMeta?.isAdmins,
                mode: 'group',
              }
            : undefined,
        adminOverride: project.adminOverride,
      });

      const boardIssuerName = board.createdBy || auth?.name || issuer || '';
      if (!boardIssuerName) {
        await alert('Could not resolve the new board issuer.', 'Create board', {
          severity: 'error',
        });
        return false;
      }

      await handleAddBoard(false, board, boardIssuerName);
      return true;
    } catch (e: any) {
      await alert(e?.message || 'Failed to create board.', 'Create board', {
        severity: 'error',
      });
      return false;
    } finally {
      setCreateBoardBusy(false);
    }
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
    if (!assetSelection) return;
    const assetId = String(assetSelection.assetId).trim();
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
    setAssetSelection(null);
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
        </Stack>
      </Stack>

      <Paper variant="outlined" sx={{ p: 2, mb: 2 }}>
        <Stack
          direction={{ xs: 'column', sm: 'row' }}
          alignItems={{ xs: 'stretch', sm: 'center' }}
          justifyContent="space-between"
          spacing={1}
          sx={{ mb: 1 }}
        >
          <Typography variant="subtitle1">Boards</Typography>
          <Stack direction="row" spacing={1}>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setCreateBoardOpen(true)}
              disabled={saving || createBoardBusy}
            >
              Create board
            </Button>
            <Button
              variant="contained"
              size="small"
              onClick={() => setAddBoardOpen(true)}
              disabled={saving || createBoardBusy}
            >
              Add board
            </Button>
          </Stack>
        </Stack>
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
                  {detail ? (
                    <Box
                      sx={{
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', sm: 'repeat(2, minmax(0, 1fr))' },
                        gap: 1,
                      }}
                    >
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Visibility
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap">
                          <Chip
                            size="small"
                            label={detail.visibility === 'private' ? 'Private' : 'Public'}
                            color={detail.visibility === 'private' ? 'warning' : 'success'}
                            variant="outlined"
                          />
                        </Stack>
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Editors
                        </Typography>
                        {renderValueChips(detail.editors ?? detail.usersAllowed)}
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Editor groups
                        </Typography>
                        {renderValueChips(detail.editorGroups ?? detail.groupsAllowed, {
                          group: true,
                        })}
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Owners
                        </Typography>
                        {renderValueChips(detail.owners)}
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Owner groups
                        </Typography>
                        {renderValueChips(detail.ownerGroups, { group: true })}
                      </Box>
                      <Box>
                        <Typography variant="caption" color="text.secondary">
                          Admin override
                        </Typography>
                        <Stack direction="row" spacing={0.5} flexWrap="wrap">
                          <Chip
                            size="small"
                            label={detail.adminOverride ? 'Enabled' : 'Off'}
                            variant="outlined"
                          />
                        </Stack>
                      </Box>
                    </Box>
                  ) : (
                    <Typography variant="caption" color="text.secondary">
                      Loading board details…
                    </Typography>
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
          <Autocomplete
            options={assetOptions}
            loading={assetOptionsLoading}
            getOptionLabel={(option) => `${option.name} (#${option.assetId})`}
            isOptionEqualToValue={(option, value) => option.assetId === value.assetId}
            value={assetSelection}
            onChange={(_, value) => {
              setAssetSelection(value);
            }}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Select asset"
                size="small"
                helperText="Select from the Q-Assets index."
              />
            )}
            sx={{ minWidth: { xs: '100%', sm: 240 }, flex: 1 }}
          />
          <Button variant="outlined" onClick={addAsset} disabled={!assetSelection || saving}>
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
                  <Avatar
                    src={detail?.avatarUrl ?? undefined}
                    sx={{ width: 32, height: 32 }}
                    variant="rounded"
                  >
                    {(detail?.name || String(asset.assetId)).slice(0, 1).toUpperCase()}
                  </Avatar>
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

      <CreateBoardDialog
        open={createBoardOpen}
        onClose={() => setCreateBoardOpen(false)}
        onCreate={createBoardForProject}
        busy={createBoardBusy}
      />

      <Dialog open={addBoardOpen} onClose={() => setAddBoardOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>Add board to project</DialogTitle>
        <DialogContent dividers sx={{ display: 'grid', gap: 1.5 }}>
          {boardOptionsLoading ? (
            <Alert severity="info">Loading accessible boards…</Alert>
          ) : boardOptions.length ? (
            <FormControl size="small" fullWidth>
              <InputLabel id="board-pick">Pick from accessible boards</InputLabel>
              <Select
                labelId="board-pick"
                label="Pick from accessible boards"
                value={boardIdInput && boardIssuer ? `${boardIssuer}::${boardIdInput}` : ''}
                onChange={(e) => {
                  const val = e.target.value as string;
                  const [issuerName, boardId] = val.split('::');
                  setBoardIdInput(boardId ?? '');
                  setBoardIssuer(issuerName ?? '');
                }}
              >
                {boardOptions.map((b) => (
                  <MenuItem
                    key={`${b.issuerName}:${b.boardId}`}
                    value={`${b.issuerName}::${b.boardId}`}
                  >
                    {b.title} — {b.issuerName}/{b.boardId}
                  </MenuItem>
                ))}
              </Select>
            </FormControl>
          ) : (
            <Alert severity="info">No accessible boards found.</Alert>
          )}

          <Divider />

          <TextField
            label="Board issuer"
            value={boardIdInput ? boardIssuer : ''}
            size="small"
            fullWidth
            InputProps={{ readOnly: true }}
            helperText="Selected from the board picker."
          />
          <TextField
            label="Board ID"
            value={boardIdInput}
            size="small"
            fullWidth
            InputProps={{ readOnly: true }}
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
