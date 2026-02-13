import {
  useCallback,
  useState,
  useRef,
  memo,
  FC,
  useEffect,
  useMemo,
  useDeferredValue,
  ReactNode,
  CSSProperties,
  MouseEvent,
  KeyboardEvent,
} from 'react';

import { useQDeck } from './QDeckProvider';
import PublishQueueEditor from './PublishQueueEditor';
import ManageListsDialog, { type ManageListsDialogHandle } from './ManageListsDialog';
import CalendarView from './CalendarView';
import {
  DndContext,
  DragEndEvent,
  useSensor,
  PointerSensor,
  useSensors,
  TouchSensor,
  useDroppable,
  MeasuringStrategy,
  pointerWithin,
} from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy } from '@dnd-kit/sortable';
import {
  Box,
  Paper,
  Typography,
  Button,
  TextField,
  IconButton,
  Menu,
  MenuItem,
  Checkbox,
  FormControlLabel,
  List as MList,
  ListItem,
  ListItemIcon,
  ListItemText,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Divider,
  Tooltip,
  FormControl,
  InputLabel,
  Select,
  Stack,
  Skeleton,
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
  useMediaQuery,
  InputAdornment,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
import EditIcon from '@mui/icons-material/Edit';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import ListAltIcon from '@mui/icons-material/ListAlt';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import TuneIcon from '@mui/icons-material/Tune';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { ListColumn } from './ListColumn';
import { Priority } from '../../types/qdeck';
import CardDialog from './CardDialog';
// import { publishPrimaryImageForCard } from '../../utils/qdeckApi';
import {
  qAssetsRevenueAddress,
  tempQAssetEscrowAccountAddress,
  QDeckId,
} from '../../constants/qdeckIdentifiers';
import { Refresh } from '@mui/icons-material';
// import { canUserEditBoard } from '../../utils/qdeckAccess';
import { getGroupById, type GroupSummary } from '../../utils/qortalApi';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import SecurityIcon from '@mui/icons-material/Security';
import { useAlert } from '../alerts';
import { useNavigate } from 'react-router-dom';
import { publishScopedNotification } from '../../utils/notificationPublisher';
import ClearIcon from '@mui/icons-material/Clear';
import {
  getLatestQDeckBoardLoadSample,
  isQDeckPerfEnabled,
  setQDeckPerfEnabled,
  subscribeQDeckBoardLoadPerf,
} from '../../utils/qdeckPerf';

type NewCardDraft = {
  title: string;
  quickDescription?: string;
  priority: Priority;
  estimatedMinutes?: number;
  tags: string[];
  startInProgress?: boolean;
};

type AddCardInlineProps = {
  listId: string;
  onCancel: () => void;
  onSubmit: (draft: NewCardDraft) => void;
  canStartInProgress?: boolean;
  disabled?: boolean;
};

type AddPosition = 'top' | 'bottom';

type AddFormState = {
  listId: string;
  position: AddPosition;
};

const priorityRank = (priority?: Priority) => {
  switch (priority) {
    case 'CRITICAL':
      return 0;
    case 'HIGH':
      return 1;
    case 'NORMAL':
      return 2;
    case 'LOW':
      return 3;
    default:
      return 4;
  }
};

export const AddCardInline = memo(function AddCardInline({
  listId,
  onCancel,
  onSubmit,
  canStartInProgress,
  disabled,
}: AddCardInlineProps) {
  const [title, setTitle] = useState('');
  const [quick, setQuick] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [eta, setEta] = useState<number | ''>('');
  const [tagsCsv, setTagsCsv] = useState('');
  const [startInProgress, setStartInProgress] = useState(false);

  const submit = useCallback(() => {
    const t = title.trim();
    if (!t) return;
    const tags = tagsCsv
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    onSubmit({
      title: t,
      quickDescription: quick.trim() || undefined,
      priority,
      estimatedMinutes: typeof eta === 'number' ? eta : undefined,
      tags,
      startInProgress,
    });
  }, [title, quick, priority, eta, tagsCsv, onSubmit, startInProgress]);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: '1fr',
        gap: '0.5rem',
        width: '100%',
        minWidth: 0,
      }}
    >
      <TextField
        size="small"
        placeholder="Card title…"
        value={title}
        disabled={disabled}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && title.trim()) submit();
          else if (e.key === 'Escape') onCancel();
        }}
      />
      <TextField
        size="small"
        placeholder="Quick description (plain text)…"
        value={quick}
        disabled={disabled}
        onChange={(e) => setQuick(e.target.value)}
        multiline
        minRows={2}
      />
      <Stack direction="row" spacing={1}>
        <FormControl size="small" sx={{ minWidth: 0, flex: 1 }}>
          <InputLabel id={`prio-${listId}`}>Priority</InputLabel>
          <Select
            native
            labelId={`prio-${listId}`}
            label="Priority"
            value={priority}
            disabled={disabled}
            onChange={(e) => setPriority((e.target as HTMLSelectElement).value as Priority)}
          >
            <option value="CRITICAL">CRITICAL</option>
            <option value="HIGH">HIGH</option>
            <option value="NORMAL">NORMAL</option>
            <option value="LOW">LOW</option>
          </Select>
        </FormControl>
        <TextField
          size="small"
          type="number"
          inputProps={{ min: 0 }}
          label="ETA (min)"
          value={eta}
          disabled={disabled}
          onChange={(e) => setEta(e.target.value === '' ? '' : Number(e.target.value))}
          sx={{ width: '9rem' }}
        />
      </Stack>
      <TextField
        size="small"
        label="Tags (comma-separated)"
        placeholder="ui, qortal, v1"
        value={tagsCsv}
        disabled={disabled}
        onChange={(e) => setTagsCsv(e.target.value)}
      />
      <FormControlLabel
        control={
          <Checkbox
            checked={startInProgress}
            onChange={(e) => setStartInProgress(e.target.checked)}
            disabled={disabled || !canStartInProgress}
          />
        }
        label="Create this card already in progress"
      />
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button
          size="small"
          variant="contained"
          onClick={submit}
          disabled={disabled || !title.trim()}
        >
          Add
        </Button>
      </Stack>
    </Box>
  );
});

type BoardViewProps = {
  issuerName: string;
};

export const BoardView: FC<BoardViewProps> = ({ issuerName }) => {
  const {
    identity,
    board,
    cards,
    cardVariants,
    archivedCardIds,
    cardsLoading,
    moveCard,
    createCard,
    // updateCard,
    persistBoard,
    deleteBoard,
    refreshBoard,
    archiveCard,
    publishMode,
    setPublishMode,
    pendingPublishCount,
    publishPendingResources,
    isPublishingQueue,
    clearPublishQueue,
    isRepairingIndex,
    repairCardsIndex,
    collectBoardChangeReport,
    resetBoardChangeLog,
    pendingRemoteChanges,
    applyPendingRemoteChanges,
    clearPendingRemoteChanges,
  } = useQDeck();
  const navigate = useNavigate();
  const { alert } = useAlert();
  const [perfEnabled, setPerfEnabled] = useState(() => isQDeckPerfEnabled());
  const [perfSample, setPerfSample] = useState(() =>
    perfEnabled ? getLatestQDeckBoardLoadSample(board?.boardId) : null
  );

  useEffect(() => {
    if (!perfEnabled) return;
    const sync = () => {
      setPerfSample(getLatestQDeckBoardLoadSample(board?.boardId));
    };
    sync();
    return subscribeQDeckBoardLoadPerf(sync);
  }, [board?.boardId, perfEnabled]);

  const perfPhaseSummary = useMemo(() => {
    if (!perfSample?.phases?.length) return '';
    return perfSample.phases
      .map((phase) => `${phase.name}: ${Math.round(phase.durationMs)}ms`)
      .join(' | ');
  }, [perfSample?.phases]);

  const togglePerfDiagnostics = useCallback(async () => {
    const next = !perfEnabled;
    setQDeckPerfEnabled(next);
    setPerfEnabled(next);
    if (next) {
      setPerfSample(getLatestQDeckBoardLoadSample(board?.boardId));
    } else {
      setPerfSample(null);
    }
    await alert(`Q-Deck load diagnostics ${next ? 'enabled' : 'disabled'}.`, 'Q-Deck diagnostics', {
      severity: 'info',
    });
  }, [alert, board?.boardId, perfEnabled]);

  const editorGroupIds = useMemo(() => {
    if (!board) return [] as number[];
    const ids = new Set<number>();
    const useEnhanced = board.featureFlags?.enhancedPerms === true;
    const source = useEnhanced
      ? board.editorGroups && board.editorGroups.length
        ? board.editorGroups
        : board.groupsAllowed
      : board.groupsAllowed;
    for (const g of source ?? []) {
      const n = Number(g);
      if (Number.isFinite(n)) ids.add(n);
    }
    return Array.from(ids.values());
  }, [board]);

  const [editorGroups, setEditorGroups] = useState<GroupSummary[]>([]);

  useEffect(() => {
    let cancelled = false;
    if (!editorGroupIds.length) {
      setEditorGroups([]);
      return;
    }
    (async () => {
      const details = await Promise.all(
        editorGroupIds.map((id) => getGroupById(id).catch(() => null))
      );
      if (!cancelled) setEditorGroups(details.filter(Boolean) as GroupSummary[]);
    })();
    return () => {
      cancelled = true;
    };
  }, [editorGroupIds]);

  const handleJoinGroup = useCallback(
    async (group: { groupId: number; groupName?: string }) => {
      try {
        await qortalRequest({ action: 'JOIN_GROUP', groupId: group.groupId } as any);
        await alert(
          `Join request sent for ${group.groupName ? `${group.groupName} (#${group.groupId})` : `group #${group.groupId}`}.`,
          'Join group',
          { severity: 'success' }
        );
      } catch (e: any) {
        await alert(e?.message || 'Failed to join group.', 'Join group', { severity: 'error' });
      }
    },
    [alert]
  );

  // --- header state ---
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const titleRef = useRef<HTMLInputElement | null>(null);

  // actions menu
  const [menuEl, setMenuEl] = useState<null | HTMLElement>(null);
  const menuOpen = Boolean(menuEl);

  // dialogs
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);
  const [notifyOpen, setNotifyOpen] = useState(false);
  const [queueEditorOpen, setQueueEditorOpen] = useState(false);
  const [notifyLoading, setNotifyLoading] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  const [calendarIncludeDone, setCalendarIncludeDone] = useState(false);
  const manageListsRef = useRef<ManageListsDialogHandle | null>(null);
  const [notifyPreview, setNotifyPreview] = useState<{
    title: string;
    html: string;
    openedAt: number;
    entries: Array<{
      type: string;
      cardId: string;
      title?: string;
      ts: number;
      fromListId?: string;
      toListId?: string;
      details?: string;
    }>;
    comments: Array<{
      cardId: string;
      cardTitle?: string;
      author: string;
      createdAt: number;
      bodyHtml: string;
    }>;
    boardLink: string;
  } | null>(null);

  // Manage Lists – drafts keyed by listId (inline rename)
  const [listTitleDrafts, setListTitleDrafts] = useState<Record<string, string>>({});
  // --- per-list inline rename state ---
  const [editingListId, setEditingListId] = useState<string | null>(null);
  const [editingListTitle, setEditingListTitle] = useState('');
  const [listMenuState, setListMenuState] = useState<{
    anchor: HTMLElement;
    listId: string;
  } | null>(null);

  // quick-add per-list
  const [addingForList, setAddingForList] = useState<AddFormState | null>(null);

  const handleListTitleDraftChange = useCallback((listId: string, value: string) => {
    setListTitleDrafts((prev) => ({ ...prev, [listId]: value }));
  }, []);

  const renameList = useCallback(
    async (listId: string, newTitleRaw: string) => {
      if (!board) return;
      const newTitle = newTitleRaw.trim().toUpperCase();
      if (!newTitle) return; // ignore empty
      const lists = board.lists.map((l) => (l.listId === listId ? { ...l, title: newTitle } : l));
      await persistBoard({ ...board, lists, updatedAt: Date.now() });
    },
    [board, persistBoard]
  );

  const commitListRename = useCallback(
    async (listId: string, fallbackTitle: string) => {
      const draft = (listTitleDrafts[listId] ?? fallbackTitle).trim();
      if (!draft || draft === fallbackTitle) return;
      await renameList(listId, draft);
    },
    [listTitleDrafts, renameList]
  );

  const handleListTitleKeyDown = useCallback(
    async (
      event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement | HTMLDivElement>,
      listId: string,
      baseTitle: string
    ) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        await commitListRename(listId, baseTitle);
        setEditingListId(null);
      } else if (event.key === 'Escape') {
        setEditingListId(null);
      }
    },
    [commitListRename]
  );

  const handleListTitleBlur = useCallback(
    async (listId: string, baseTitle: string) => {
      await commitListRename(listId, baseTitle);
      setEditingListId(null);
    },
    [commitListRename]
  );

  const handleListTitleSave = useCallback(
    async (listId: string, baseTitle: string) => {
      await commitListRename(listId, baseTitle);
      setEditingListId(null);
    },
    [commitListRename]
  );

  const handleCancelListEdit = useCallback(() => {
    setEditingListId(null);
  }, []);

  const startEditingList = useCallback(
    (list: { listId: string; title: string }) => {
      setEditingListId(list.listId);
      setEditingListTitle(list.title);
      handleListTitleDraftChange(list.listId, list.title);
    },
    [handleListTitleDraftChange]
  );

  const handleOpenListMenu = useCallback((event: MouseEvent<HTMLElement>, listId: string) => {
    event.stopPropagation();
    setListMenuState({ anchor: event.currentTarget, listId });
  }, []);
  const handleCloseListMenu = useCallback(() => setListMenuState(null), []);

  const selectedList = useMemo(
    () => board?.lists.find((l) => l.listId === listMenuState?.listId) ?? null,
    [board?.lists, listMenuState?.listId]
  );

  const handleRenameListFromMenu = useCallback(() => {
    if (!selectedList) return;
    handleCloseListMenu();
    startEditingList(selectedList);
  }, [handleCloseListMenu, selectedList, startEditingList]);

  const handleSetListDefaultDisplay = useCallback(
    async (listId: string, collapsed: boolean) => {
      handleCloseListMenu();
      if (!board) return;
      const nextLists = board.lists.map((l) =>
        l.listId === listId ? { ...l, defaultCollapsed: collapsed } : l
      );
      await persistBoard({ ...board, lists: nextLists, updatedAt: Date.now() });
    },
    [board, persistBoard, handleCloseListMenu]
  );

  const [sortByPriority, setSortByPriority] = useState(true);
  const markManualReorder = useCallback(() => setSortByPriority(false), []);

  const [viewMode, setViewMode] = useState<'full' | 'minimal'>('full');
  const [viewMenuAnchor, setViewMenuAnchor] = useState<null | HTMLElement>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const deferredSearchQuery = useDeferredValue(searchQuery);
  const isMinimalView = viewMode === 'minimal';
  const openViewMenu = (event: MouseEvent<HTMLElement>) => setViewMenuAnchor(event.currentTarget);
  const closeViewMenu = () => setViewMenuAnchor(null);
  const handleSelectViewMode = (mode: 'full' | 'minimal') => {
    setViewMode(mode);
    closeViewMenu();
  };

  const inputRef = useRef<HTMLInputElement | null>(null);

  // Select/open cards
  const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
  const [dialogOpen, setDialogOpen] = useState(false);

  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 5 } })
  );

  const lists = board?.lists ?? [];

  const archivedCards = useMemo(() => {
    if (!board) return [];
    const out: (typeof cards)[keyof typeof cards][] = [];
    archivedCardIds.forEach((cid) => {
      const variants = cardVariants?.[cid];
      if (variants?.length) {
        const preferredPublisher = board.preferredVariants?.[cid];
        const chosen =
          (preferredPublisher && variants.find((v) => v.createdBy === preferredPublisher)) ||
          variants.find((v) => v.createdBy === board.createdBy) ||
          variants[0];
        if (chosen) out.push(chosen);
      }
    });
    return out;
  }, [archivedCardIds, cardVariants, board]);

  const sortedLists = useMemo(() => lists.slice().sort((a, b) => a.order - b.order), [lists]);

  useEffect(() => {
    if (editingTitle) {
      setTitleInput(board?.title ?? '');
      setTimeout(() => titleRef.current?.focus(), 30);
    }
  }, [editingTitle, board?.title]);

  useEffect(() => {
    if (addingForList && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [addingForList]);

  const boardLink = useMemo(() => {
    if (!board) return '';
    return `qortal://APP/Q-Assets/qdeck/${encodeURIComponent(issuerName)}/${board.boardId}`;
  }, [board, issuerName]);

  const listTitleById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lists) {
      map.set(l.listId, l.title);
    }
    return map;
  }, [lists]);

  const listColorById = useMemo(() => {
    const map = new Map<string, string>();
    for (const l of lists) {
      if (l.faintColor) map.set(l.listId, l.faintColor);
    }
    return map;
  }, [lists]);

  const formatChangeEntry = useCallback(
    (entry: {
      type: string;
      title?: string;
      fromListId?: string;
      toListId?: string;
      details?: string;
    }) => {
      const title = entry.title || 'Untitled card';
      const fromList = entry.fromListId
        ? listTitleById.get(entry.fromListId) || entry.fromListId
        : undefined;
      const toList = entry.toListId
        ? listTitleById.get(entry.toListId) || entry.toListId
        : undefined;
      switch (entry.type) {
        case 'created':
          return `Created "${title}"${toList ? ` in ${toList}` : ''}`;
        case 'moved':
          return `Moved "${title}"${fromList ? ` from ${fromList}` : ''}${toList ? ` to ${toList}` : ''}`;
        case 'completed':
          return `Completed "${title}"`;
        case 'reopened':
          return `Reopened "${title}"`;
        case 'archived':
          return `Archived "${title}"`;
        case 'unarchived':
          return `Unarchived "${title}"`;
        case 'updated':
        default:
          return `Updated "${title}"${entry.details ? ` (${entry.details})` : ''}`;
      }
    },
    [listTitleById]
  );

  const buildNotifyHtml = useCallback(
    (report: {
      openedAt: number;
      entries: Array<{
        type: string;
        title?: string;
        ts: number;
        fromListId?: string;
        toListId?: string;
        details?: string;
      }>;
      comments: Array<{
        cardTitle?: string;
        author: string;
        createdAt: number;
        bodyHtml: string;
      }>;
    }) => {
      const stamp = new Date(report.openedAt).toLocaleString();
      const entryItems = report.entries
        .slice()
        .sort((a, b) => a.ts - b.ts)
        .map((entry) => `<li>${formatChangeEntry(entry)}</li>`);
      const commentItems = report.comments
        .slice()
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((c) => {
          const title = c.cardTitle ? ` on "${c.cardTitle}"` : '';
          return `<li><strong>${c.author}</strong>${title}<div>${c.bodyHtml}</div></li>`;
        });

      const sections: string[] = [];
      sections.push(`<p>Changes since ${stamp}.</p>`);
      if (entryItems.length) {
        sections.push(`<h4>Board changes</h4><ul>${entryItems.join('')}</ul>`);
      }
      if (commentItems.length) {
        sections.push(`<h4>Comments</h4><ul>${commentItems.join('')}</ul>`);
      }
      if (boardLink) {
        sections.push(`<p><a href="${boardLink}">Open board</a></p>`);
      }
      return sections.join('');
    },
    [boardLink, formatChangeEntry]
  );

  const handleOpenNotify = useCallback(async () => {
    if (!board) return;
    if (!identity?.name || !identity?.address) {
      await alert('Authenticate with a QDN name before notifying editors.', 'Notify editors', {
        severity: 'warning',
      });
      return;
    }
    if (!editorGroupIds.length) {
      await alert('No editor groups are configured for this board.', 'Notify editors', {
        severity: 'info',
      });
      return;
    }
    setNotifyLoading(true);
    try {
      const report = await collectBoardChangeReport();
      const title = `Q-Deck updates: ${board.title}`;
      const html = buildNotifyHtml(report);
      setNotifyPreview({
        title,
        html,
        openedAt: report.openedAt,
        entries: report.entries,
        comments: report.comments,
        boardLink,
      });
      setNotifyOpen(true);
    } catch (e: any) {
      await alert(e?.message || 'Failed to build notify preview.', 'Notify editors', {
        severity: 'error',
      });
    } finally {
      setNotifyLoading(false);
    }
  }, [
    board,
    identity?.name,
    identity?.address,
    editorGroupIds.length,
    collectBoardChangeReport,
    buildNotifyHtml,
    boardLink,
    alert,
  ]);

  const handleSendNotify = useCallback(async () => {
    if (!board || !notifyPreview) return;
    if (!identity?.name || !identity?.address) return;
    if (!editorGroupIds.length) return;
    setNotifyLoading(true);
    try {
      const identifier =
        board.visibility === 'public'
          ? QDeckId.boardPublic(board.boardId)
          : QDeckId.boardPrivate(
              board.boardId,
              board.privateMeta?.mode ?? 'group',
              board.privateMeta?.isAdmins,
              board.privateMeta?.groupId
            );
      const links = boardLink
        ? [
            {
              label: 'Open board',
              href: boardLink,
            },
          ]
        : undefined;
      for (const groupId of editorGroupIds) {
        await publishScopedNotification({
          scope: { kind: 'group', groupId, privacy: board.visibility },
          title: notifyPreview.title,
          html: notifyPreview.html,
          publisher: { name: identity.name, address: identity.address, role: 'editor' },
          qdnResource: { publisher: board.createdBy, identifier },
          sendMail: true,
          links,
        });
      }
      resetBoardChangeLog();
      setNotifyOpen(false);
      await alert('Notifications sent to editor groups.', 'Notify editors', {
        severity: 'success',
      });
    } catch (e: any) {
      await alert(e?.message || 'Failed to send notifications.', 'Notify editors', {
        severity: 'error',
      });
    } finally {
      setNotifyLoading(false);
    }
  }, [
    board,
    notifyPreview,
    identity?.name,
    identity?.address,
    editorGroupIds,
    boardLink,
    alert,
    resetBoardChangeLog,
  ]);

  const searchIndex = useMemo(() => {
    const index = new Map<string, string>();
    Object.values(cards).forEach((c) => {
      const listTitle = listTitleById.get(c.statusListId) ?? '';
      const haystack = [
        c.title,
        c.quickDescription,
        c.cardId,
        listTitle,
        ...(c.tags ?? []),
        ...(c.assignees ?? []),
      ]
        .filter(Boolean)
        .join(' ')
        .toLowerCase();
      index.set(c.cardId, haystack);
    });
    return index;
  }, [cards, listTitleById]);

  const cardsByList = useMemo(() => {
    const needle = deferredSearchQuery.trim().toLowerCase();
    const byList: Record<string, string[]> = {};
    for (const c of Object.values(cards)) {
      if (needle) {
        const text = searchIndex.get(c.cardId) ?? '';
        if (!text.includes(needle)) continue;
      }
      (byList[c.statusListId] ||= []).push(c.cardId);
    }
    const comparator = (a: string, b: string) => {
      if (sortByPriority) {
        const diff = priorityRank(cards[a]?.priority) - priorityRank(cards[b]?.priority);
        if (diff !== 0) return diff;
      }
      return (cards[a]?.order ?? 0) - (cards[b]?.order ?? 0);
    };
    for (const listId of Object.keys(byList)) {
      byList[listId].sort(comparator);
    }
    return byList;
  }, [cards, deferredSearchQuery, searchIndex, sortByPriority]);

  const calendarEvents = useMemo(() => {
    const hourMs = 60 * 60 * 1000;
    return Object.values(cards).flatMap((card) => {
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
      return [
        {
          id: card.cardId,
          title: card.title,
          start,
          end,
          allDay: !!card.scheduledAllDay,
          color: listColorById.get(card.statusListId),
          meta: listTitleById.get(card.statusListId) ?? card.statusListId,
        },
      ];
    });
  }, [cards, calendarIncludeDone, listColorById, listTitleById]);

  const getOrderForPosition = useCallback(
    (listId: string, position: AddPosition) => {
      const ids = cardsByList[listId] ?? [];
      if (position === 'top') {
        if (!ids.length) return 0;
        return (cards[ids[0]]?.order ?? 0) - 1;
      }
      return ids.length;
    },
    [cards, cardsByList]
  );

  const handleCreateCard = useCallback(
    async (listId: string, position: AddPosition, draft: NewCardDraft) => {
      if (cardsLoading) {
        await alert(
          'Cards are still loading. Please wait for the board to finish hydrating before creating a card.',
          'Board still loading',
          { severity: 'info' }
        );
        return;
      }
      const inProgressListId =
        draft.startInProgress && board
          ? board.lists.find((l) => {
              const normalized = (l.title ?? '')
                .toLowerCase()
                .replace(/[^a-z0-9]+/g, ' ')
                .trim();
              return normalized.includes('in progress');
            })?.listId
          : undefined;
      const targetListId = inProgressListId ?? listId;
      const order = getOrderForPosition(targetListId, position);
      const assignees = draft.startInProgress && identity?.name ? [identity.name] : undefined;
      const scheduledStart = draft.startInProgress && identity?.name ? Date.now() : undefined;
      try {
        await createCard({
          title: draft.title,
          quickDescription: draft.quickDescription,
          priority: draft.priority,
          estimatedCompletionTimeMinutes: draft.estimatedMinutes,
          tags: draft.tags,
          statusListId: targetListId,
          order,
          assignees,
          scheduledStart,
        });
        setAddingForList(null);
      } catch (e: any) {
        console.error('Failed to create card', e);
        const groupsToShow: Array<{ groupId: number; groupName?: string; isOpen?: boolean }> =
          editorGroups.length
            ? editorGroups
            : editorGroupIds.map((id) => ({ groupId: id, isOpen: false }));
        const errText =
          e?.message || 'You are not a member of any of the editor groups for this board.';
        await alert(
          <Box sx={{ display: 'grid', gap: 1 }}>
            <Typography variant="body2">{errText}</Typography>
            <Typography variant="body2" sx={{ fontWeight: 600 }}>
              Editor groups:
            </Typography>
            {groupsToShow?.length ? (
              <Box sx={{ display: 'grid', gap: 0.75 }}>
                {groupsToShow.map((g) => (
                  <Box key={g.groupId} sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                    <Typography variant="body2">
                      {g.groupName ? `${g.groupName} (#${g.groupId})` : `Group #${g.groupId}`}{' '}
                      {g.isOpen ? '(Public)' : '(Private)'}
                    </Typography>
                    {g.isOpen && (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() =>
                          handleJoinGroup({
                            groupId: g.groupId,
                            groupName: g.groupName,
                          })
                        }
                      >
                        Join group
                      </Button>
                    )}
                  </Box>
                ))}
              </Box>
            ) : (
              <Typography variant="body2">
                No editor groups are configured on this board.
              </Typography>
            )}
          </Box>,
          'Not allowed to add cards',
          { severity: 'error' }
        );
      }
    },
    [
      alert,
      cardsLoading,
      createCard,
      editorGroupIds,
      editorGroups,
      getOrderForPosition,
      handleJoinGroup,
      markManualReorder,
      identity?.name,
    ]
  );

  function ListDroppable({ id, children }: { id: string; children: ReactNode }) {
    const { setNodeRef } = useDroppable({ id });
    return (
      <Box ref={setNodeRef} sx={{ minHeight: 8, position: 'relative' }}>
        {children}
      </Box>
    );
  }

  const onDragEnd = async (e: DragEndEvent) => {
    const { active, over } = e;
    if (!over) return;

    const [cardId, srcListId] = active.id.toString().split('::');

    // over can be a list ("list::<id>") or another card ("<cardId>::<listId>")
    const overId = over.id.toString();
    const dstListId = overId.startsWith('list::') ? overId.slice(6) : overId.split('::')[1];

    if (!dstListId) return;

    if (srcListId === dstListId) {
      const ids = cardsByList[srcListId] ?? [];
      const oldIndex = ids.indexOf(cardId);
      const newIndex = over.data?.current?.sortable?.index ?? oldIndex;
      if (oldIndex !== newIndex) {
        await moveCard(cardId, dstListId, newIndex);
      }
    } else {
      const newIndex = cardsByList[dstListId]?.length ?? 0;
      await moveCard(cardId, dstListId, newIndex);
    }
  };

  // --- header actions ---
  const handleOpenMenu = (e: React.MouseEvent<HTMLElement>) => setMenuEl(e.currentTarget);
  const handleCloseMenu = () => setMenuEl(null);
  const handleRenameBoard = useCallback(() => {
    if (!board) return;
    setEditingTitle(true);
    handleCloseMenu();
  }, [board, handleCloseMenu]);

  // const openCard = (cardId: string) => {
  //   setSelectedCardId(cardId);
  //   setDialogOpen(true);
  // };
  const openCard = useCallback((cardId: string) => {
    setSelectedCardId(cardId);
    setDialogOpen(true);
  }, []);
  const closeCard = () => setDialogOpen(false);

  const saveTitle = async () => {
    const t = titleInput.trim();
    if (!t || !board) {
      setEditingTitle(false);
      return;
    }
    if (t !== board.title) {
      await persistBoard({ ...board, title: t, updatedAt: Date.now() });
    }
    setEditingTitle(false);
  };

  const handleDelete = async () => {
    setConfirmDeleteOpen(false);
    // choose cascade options
    await deleteBoard({ cascadeCards: false, cascadeComments: false });
  };

  const handleSaveLists = useCallback(
    async (nextLists: typeof lists) => {
      if (!board) return;
      await persistBoard({ ...board, lists: nextLists, updatedAt: Date.now() });
    },
    [board, persistBoard]
  );

  if (!board) return <Typography>Loading board…</Typography>;

  // layout vars
  const listCount = board.lists.length;
  const gapRem = 1;
  const colBasis = `calc((100% - (${gapRem}rem * ${Math.max(0, listCount - 1)})) / ${Math.max(
    1,
    listCount
  )})`;

  const qAssetEscrowAddress = tempQAssetEscrowAccountAddress;
  const qAssRevAddr = qAssetsRevenueAddress;
  // const fetchedBoardOwnerAddress = await qDeckBoardOwnerAddress(board.createdBy);
  const currentBoardId = board.boardId;
  const queuedCount = pendingPublishCount(currentBoardId);
  const queuePublishing = isPublishingQueue(currentBoardId);
  const queueButtonLabel = queuePublishing
    ? 'Publishing…'
    : `Publish queued changes${queuedCount ? ` (${queuedCount})` : ''}`;

  return (
    <Box
      sx={
        {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          p: { xs: '1rem', md: '1.25rem' },
          '--gap': `${gapRem}rem`,
          '--col-basis': colBasis,
        } as CSSProperties
      }
    >
      {/* ===== Header ===== */}
      <Box
        sx={{
          display: 'flex',
          alignItems: 'center',
          gap: '1rem',
          mb: '1rem',
          flexWrap: 'wrap',
        }}
      >
        {/* Title (inline rename) */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: '0.5rem',
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {editingTitle ? (
            <>
              <TextField
                inputRef={titleRef}
                size="small"
                value={titleInput}
                onChange={(e) => setTitleInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') saveTitle();
                  else if (e.key === 'Escape') setEditingTitle(false);
                }}
                sx={{ minWidth: '16rem', maxWidth: '100%' }}
              />
              <Button variant="contained" size="small" onClick={saveTitle}>
                Save
              </Button>
              <Button variant="text" size="small" onClick={() => setEditingTitle(false)}>
                Cancel
              </Button>
            </>
          ) : (
            <>
              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
                {board.title}
              </Typography>
              <Tooltip title="Board actions">
                <IconButton
                  onClick={handleOpenMenu}
                  aria-label="board actions"
                  sx={{ ml: { xs: 0, sm: '0.25rem' } }}
                >
                  <MoreVertIcon />
                </IconButton>
              </Tooltip>
            </>
          )}
        </Box>

        <Box
          sx={{
            flex: '1 1 auto',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <TextField
            size="small"
            label="Search cards"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            sx={{ minWidth: { xs: '100%', sm: '16rem' } }}
            InputProps={{
              endAdornment: searchQuery ? (
                <InputAdornment position="end">
                  <IconButton
                    size="small"
                    aria-label="Clear search"
                    onClick={() => setSearchQuery('')}
                  >
                    <ClearIcon fontSize="small" />
                  </IconButton>
                </InputAdornment>
              ) : null,
            }}
          />
          <ToggleButtonGroup
            size="small"
            value={publishMode}
            exclusive
            onChange={(_event, value) => value && setPublishMode(value)}
          >
            <ToggleButton value="immediate">Publish actively</ToggleButton>
            <ToggleButton value="batch">Queue updates</ToggleButton>
          </ToggleButtonGroup>
          <Button
            variant="contained"
            color="success"
            size="small"
            onClick={() => publishPendingResources(currentBoardId)}
            disabled={publishMode !== 'batch' || queuedCount === 0 || queuePublishing}
            sx={{ whiteSpace: 'nowrap' }}
          >
            {queueButtonLabel}
          </Button>
          <Button
            variant="outlined"
            color="error"
            size="small"
            onClick={() => clearPublishQueue(currentBoardId)}
            disabled={publishMode !== 'batch' || queuedCount === 0 || queuePublishing}
          >
            Clear queue
          </Button>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setQueueEditorOpen(true)}
            disabled={publishMode !== 'batch' || queuedCount === 0 || queuePublishing}
          >
            Edit queue
          </Button>
        </Box>

        {/* Quick actions */}
        <Button
          size="small"
          variant="outlined"
          startIcon={<TuneIcon />}
          onClick={openViewMenu}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          View: {isMinimalView ? 'Minimal' : 'Full'}
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => setCalendarOpen(true)}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Calendar
        </Button>
        <Button
          size="small"
          variant="contained"
          startIcon={<Refresh />}
          onClick={() => refreshBoard()}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Refresh
        </Button>
        <Button
          size="small"
          variant="outlined"
          onClick={() => void handleOpenNotify()}
          disabled={notifyLoading || !editorGroupIds.length}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Notify editors
        </Button>

        <Menu
          anchorEl={viewMenuAnchor}
          open={Boolean(viewMenuAnchor)}
          onClose={closeViewMenu}
          anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
          transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        >
          <MenuItem selected={viewMode === 'full'} onClick={() => handleSelectViewMode('full')}>
            <ListItemIcon>
              <VisibilityIcon fontSize="small" />
            </ListItemIcon>
            Full view
          </MenuItem>
          <MenuItem
            selected={viewMode === 'minimal'}
            onClick={() => handleSelectViewMode('minimal')}
          >
            <ListItemIcon>
              <VisibilityOffIcon fontSize="small" />
            </ListItemIcon>
            Minimal view
          </MenuItem>
        </Menu>

        <Tooltip title="Board actions">
          <IconButton onClick={handleOpenMenu} aria-label="board actions">
            <MoreVertIcon />
          </IconButton>
        </Tooltip>

        <Menu anchorEl={menuEl} open={menuOpen} onClose={handleCloseMenu}>
          <MenuItem onClick={handleRenameBoard}>
            <ListItemIcon>
              <EditIcon fontSize="small" />
            </ListItemIcon>
            Rename board…
          </MenuItem>
          <MenuItem
            onClick={() => {
              manageListsRef.current?.open();
              handleCloseMenu();
            }}
          >
            <ListAltIcon fontSize="small" style={{ marginRight: '0.75rem' }} />
            Manage lists…
          </MenuItem>
          <MenuItem
            onClick={() => {
              repairCardsIndex();
              handleCloseMenu();
            }}
            disabled={isRepairingIndex}
          >
            <ListItemIcon>
              <SettingsBackupRestoreIcon fontSize="small" />
            </ListItemIcon>
            {isRepairingIndex ? 'Repairing index…' : 'Repair cards index…'}
          </MenuItem>
          <MenuItem
            onClick={() => {
              navigate('/manage/qdeck-permissions');
              handleCloseMenu();
            }}
          >
            <ListItemIcon>
              <SecurityIcon fontSize="small" />
            </ListItemIcon>
            Permissions panel…
          </MenuItem>
          <MenuItem
            onClick={() => {
              handleCloseMenu();
              void togglePerfDiagnostics();
            }}
            sx={{ opacity: 0.66, minHeight: '2rem' }}
          >
            <ListItemText
              primary={perfEnabled ? 'Disable load diagnostics' : 'Enable load diagnostics'}
              secondary="Hidden dev tool"
              primaryTypographyProps={{ variant: 'caption' }}
              secondaryTypographyProps={{ variant: 'caption' }}
            />
          </MenuItem>
          <Divider />
          <MenuItem
            onClick={() => setConfirmDeleteOpen(true)}
            sx={{ color: (t) => t.palette.error.main }}
          >
            <DeleteForeverIcon fontSize="small" style={{ marginRight: '0.75rem' }} />
            Delete board…
          </MenuItem>
        </Menu>
      </Box>

      {pendingRemoteChanges && (
        <Paper
          elevation={0}
          sx={{
            mb: '0.9rem',
            p: '0.6rem 0.8rem',
            border: (t) => `1px solid ${t.palette.divider}`,
            backgroundColor: (t) => t.palette.action.hover,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            flexWrap: 'wrap',
          }}
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            New board changes found.
          </Typography>
          <Typography variant="caption" sx={{ color: 'text.secondary', flex: '1 1 auto' }}>
            Load updates when you’re ready.
          </Typography>
          <Stack direction="row" spacing={1} sx={{ ml: 'auto' }}>
            <Button
              size="small"
              variant="contained"
              onClick={() => void applyPendingRemoteChanges()}
            >
              Load updates
            </Button>
            <Button size="small" variant="text" onClick={clearPendingRemoteChanges}>
              Dismiss
            </Button>
          </Stack>
        </Paper>
      )}

      {perfEnabled && perfSample && (
        <Paper
          elevation={0}
          sx={{
            mb: '0.75rem',
            p: '0.55rem 0.7rem',
            border: (t) => `1px dashed ${t.palette.divider}`,
            backgroundColor: (t) => t.palette.action.hover,
          }}
        >
          <Typography variant="caption" sx={{ fontWeight: 700, display: 'block' }}>
            Q-Deck load timing ({perfSample.status})
            {typeof perfSample.totalMs === 'number' ? `: ${Math.round(perfSample.totalMs)}ms` : ''}
          </Typography>
          {perfPhaseSummary ? (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              {perfPhaseSummary}
            </Typography>
          ) : (
            <Typography variant="caption" sx={{ color: 'text.secondary' }}>
              Waiting for timing phases...
            </Typography>
          )}
        </Paper>
      )}

      {/* ===== Board ===== */}
      {/* <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}> */}
      <DndContext
        sensors={sensors}
        // More forgiving than closestCenter when columns vary in width/overflow
        collisionDetection={pointerWithin} // or rectIntersection
        measuring={{ droppable: { strategy: MeasuringStrategy.WhileDragging } }}
        onDragEnd={onDragEnd}
      >
        <Box
          sx={{
            display: 'flex',
            flexDirection: { xs: 'column', md: 'row' }, // <- key change
            flexWrap: { xs: 'nowrap', md: 'wrap' }, // <- no wrapping on xs
            gap: 'var(--gap)',
            flex: 1,
            minHeight: 0,
            minWidth: '100%',
            overflowX: 'hidden',
            overflowY: 'auto',
          }}
        >
          {sortedLists.map((list) => {
            const listCardIds = cardsByList[list.listId] ?? [];
            return (
              <Paper
                key={list.listId}
                elevation={2}
                sx={{
                  // 100% width on phones; multi-column only at md+
                  flex: { xs: '1 1 100%', md: '0 1 19%' },
                  // maxWidth: { xs: '100%', md: '28rem' },
                  // minWidth: { xs: '100%', md: '50%', lg: '20%' },
                  minWidth: { xs: '100%', md: '24rem' },
                  // maxWidth: { xs: '100%', md: '28rem' },
                  display: 'flex',
                  flexDirection: 'column',
                  // maxHeight: '100%',
                  bgcolor: list.faintColor ?? 'background.paper',
                  overflowY: 'hidden',
                  minInlineSize: 0,
                }}
              >
                <Box
                  sx={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 0.5,
                    px: '0.75rem',
                    py: '0.5rem',
                  }}
                >
                  {editingListId === list.listId ? (
                    <>
                      <TextField
                        size="small"
                        value={editingListTitle}
                        onChange={(e) => {
                          setEditingListTitle(e.target.value);
                          handleListTitleDraftChange(list.listId, e.target.value);
                        }}
                        onKeyDown={(e) => handleListTitleKeyDown(e, list.listId, list.title)}
                        onBlur={() => handleListTitleBlur(list.listId, list.title)}
                        autoFocus
                        sx={{ flex: 1, minWidth: 0 }}
                      />
                      <Button
                        size="small"
                        variant="contained"
                        onClick={() => handleListTitleSave(list.listId, list.title)}
                      >
                        Save
                      </Button>
                      <Button size="small" onClick={handleCancelListEdit}>
                        Cancel
                      </Button>
                    </>
                  ) : (
                    <>
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Typography
                          variant="h6"
                          sx={{ lineHeight: 1.3, userSelect: 'none' }}
                          onDoubleClick={() => startEditingList(list)}
                          title="Double-click to rename"
                        >
                          {list.title}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {`${listCardIds.length} ${listCardIds.length === 1 ? 'card' : 'cards'}`}
                        </Typography>
                      </Box>
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setAddingForList({ listId: list.listId, position: 'top' })}
                        disabled={
                          cardsLoading ||
                          (addingForList?.listId === list.listId &&
                            addingForList.position === 'top')
                        }
                        sx={{ textTransform: 'none' }}
                      >
                        Add card
                      </Button>
                      <Tooltip title="List options">
                        <IconButton
                          size="small"
                          onClick={(event) => handleOpenListMenu(event, list.listId)}
                        >
                          <MoreVertIcon fontSize="small" />
                        </IconButton>
                      </Tooltip>
                    </>
                  )}
                </Box>

                {addingForList?.listId === list.listId && addingForList.position === 'top' && (
                  <Box sx={{ px: '0.75rem', pb: '0.5rem' }}>
                    <AddCardInline
                      listId={list.listId}
                      onCancel={() => setAddingForList(null)}
                      onSubmit={(draft) => handleCreateCard(list.listId, 'top', draft)}
                      canStartInProgress={Boolean(identity?.name)}
                      disabled={cardsLoading}
                    />
                  </Box>
                )}
                <ListDroppable id={`list::${list.listId}`}>
                  <SortableContext
                    items={listCardIds.map((cid) => `${cid}::${list.listId}`)}
                    strategy={verticalListSortingStrategy}
                  >
                    <Box
                      sx={{
                        px: '0.5rem',
                        pb: '0.5rem',
                        flex: 1,
                        minHeight: 0,
                        // IMPORTANT: allow children to overflow INSIDE, but the Paper can still clip
                        overflowY: 'auto', // was 'hidden' — let the list scroll; clipping can break hit-testing
                        pr: '0.25rem',
                      }}
                    >
                      {cardsLoading && listCardIds.length === 0 ? (
                        <Stack spacing={1} sx={{ px: '0.25rem', pt: '0.25rem' }}>
                          {[0, 1, 2].map((idx) => (
                            <Paper
                              key={`${list.listId}-placeholder-${idx}`}
                              variant="outlined"
                              sx={{ p: 1 }}
                            >
                              <Skeleton variant="text" width="70%" />
                              <Skeleton variant="text" width="45%" />
                            </Paper>
                          ))}
                        </Stack>
                      ) : (
                        <ListColumn
                          issuerName={issuerName}
                          list={list}
                          cardIds={listCardIds}
                          onCardClick={openCard}
                          onManualReorder={markManualReorder}
                          forceMinimized={isMinimalView}
                        />
                      )}
                    </Box>
                  </SortableContext>
                </ListDroppable>
                <Box sx={{ p: '0.5rem', borderTop: (t) => `1px solid ${t.palette.divider}` }}>
                  {addingForList?.listId === list.listId && addingForList.position === 'bottom' ? (
                    <AddCardInline
                      listId={list.listId}
                      onCancel={() => setAddingForList(null)}
                      onSubmit={(draft) => handleCreateCard(list.listId, 'bottom', draft)}
                      canStartInProgress={Boolean(identity?.name)}
                      disabled={cardsLoading}
                    />
                  ) : (
                    <Button
                      size="small"
                      variant="outlined"
                      onClick={() => setAddingForList({ listId: list.listId, position: 'bottom' })}
                      disabled={cardsLoading}
                    >
                      Add card
                    </Button>
                  )}
                </Box>
              </Paper>
            );
          })}
        </Box>
      </DndContext>

      <Menu
        anchorEl={listMenuState?.anchor}
        open={Boolean(listMenuState)}
        onClose={handleCloseListMenu}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
      >
        <MenuItem onClick={handleRenameListFromMenu}>Rename list</MenuItem>
        <MenuItem disabled>
          Default display:{' '}
          <Typography component="span" sx={{ fontWeight: 600, ml: 0.35 }} color="text.primary">
            {selectedList?.defaultCollapsed ? 'Minimized' : 'Expanded'}
          </Typography>
        </MenuItem>
        <MenuItem
          onClick={() => {
            if (!listMenuState) return;
            const current = selectedList?.defaultCollapsed ?? false;
            handleSetListDefaultDisplay(listMenuState.listId, !current);
          }}
        >
          Set default display to {selectedList?.defaultCollapsed ? 'Expanded' : 'Minimized'}
        </MenuItem>
      </Menu>

      {/* Archived cards */}
      {board && board.featureFlags?.cardArchive && archivedCards.length > 0 && (
        <Paper
          variant="outlined"
          sx={{
            mt: 2,
            p: 1,
            borderStyle: 'dashed',
            borderColor: (t) => t.palette.divider,
            background: (t) => (t.palette.mode === 'dark' ? t.palette.background.paper : '#fafafa'),
          }}
        >
          <Box display="flex" alignItems="center" justifyContent="space-between" mb={1}>
            <Box display="flex" alignItems="center" gap={1}>
              <ArchiveIcon fontSize="small" />
              <Typography variant="subtitle2" fontWeight={700}>
                Archived cards
              </Typography>
            </Box>
            <Typography variant="caption" color="text.secondary">
              {archivedCards.length} hidden
            </Typography>
          </Box>
          <Stack spacing={0.5}>
            {archivedCards.map((c) => (
              <Paper key={c.cardId} variant="outlined" sx={{ p: 0.75 }}>
                <Box display="flex" justifyContent="space-between" alignItems="center" gap={1}>
                  <Box>
                    <Typography variant="body2" fontWeight={700} noWrap title={c.cardId}>
                      {c.title}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {c.cardId} · {c.createdBy}
                    </Typography>
                  </Box>
                  <Button
                    size="small"
                    startIcon={<UnarchiveIcon />}
                    onClick={() => void archiveCard(c.cardId, false)}
                  >
                    Unarchive
                  </Button>
                </Box>
              </Paper>
            ))}
          </Stack>
        </Paper>
      )}

      <PublishQueueEditor
        open={queueEditorOpen}
        onClose={() => setQueueEditorOpen(false)}
        boardId={currentBoardId}
      />

      <ManageListsDialog ref={manageListsRef} board={board} onSave={handleSaveLists} />

      <Dialog
        open={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        fullWidth
        maxWidth="lg"
        fullScreen={isXs}
      >
        <DialogTitle>Board calendar</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            <FormControlLabel
              control={
                <Checkbox
                  checked={calendarIncludeDone}
                  onChange={(e) => setCalendarIncludeDone(e.target.checked)}
                />
              }
              label="Include completed cards without schedules"
            />
            <CalendarView events={calendarEvents} />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCalendarOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ===== Delete Confirm Dialog ===== */}
      <Dialog
        open={confirmDeleteOpen}
        onClose={() => setConfirmDeleteOpen(false)}
        fullWidth
        maxWidth="xs"
        fullScreen={isXs}
      >
        <DialogTitle>Delete this board?</DialogTitle>
        <DialogContent dividers>
          <Typography>This action cannot be undone.</Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirmDeleteOpen(false)}>Cancel</Button>
          <Button
            variant="contained"
            color="error"
            onClick={handleDelete}
            startIcon={<DeleteForeverIcon />}
          >
            Delete
          </Button>
        </DialogActions>
      </Dialog>

      {/* ===== Notify Editors Dialog ===== */}
      <Dialog
        open={notifyOpen}
        onClose={notifyLoading ? undefined : () => setNotifyOpen(false)}
        fullWidth
        maxWidth="md"
        fullScreen={isXs}
      >
        <DialogTitle>Notify board editors</DialogTitle>
        <DialogContent dividers>
          {!notifyPreview ? (
            <Typography variant="body2" color="text.secondary">
              No preview available.
            </Typography>
          ) : (
            <Stack spacing={2}>
              <Typography variant="body2" color="text.secondary">
                Changes since {new Date(notifyPreview.openedAt).toLocaleString()}.
              </Typography>
              {notifyPreview.boardLink && (
                <Typography variant="body2">
                  Board link: <code>{notifyPreview.boardLink}</code>
                </Typography>
              )}
              <Box>
                <Typography variant="subtitle2" fontWeight={700}>
                  Board changes ({notifyPreview.entries.length})
                </Typography>
                {notifyPreview.entries.length ? (
                  <MList dense>
                    {notifyPreview.entries
                      .slice()
                      .sort((a, b) => a.ts - b.ts)
                      .map((entry, idx) => (
                        <ListItem key={`${entry.cardId}-${idx}`} alignItems="flex-start">
                          <ListItemText
                            primary={formatChangeEntry(entry)}
                            secondary={new Date(entry.ts).toLocaleString()}
                          />
                        </ListItem>
                      ))}
                  </MList>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No tracked card changes.
                  </Typography>
                )}
              </Box>
              <Box>
                <Typography variant="subtitle2" fontWeight={700}>
                  Comments ({notifyPreview.comments.length})
                </Typography>
                {notifyPreview.comments.length ? (
                  <MList dense>
                    {notifyPreview.comments.map((c) => (
                      <ListItem
                        key={`${c.cardId}-${c.createdAt}-${c.author}`}
                        alignItems="flex-start"
                      >
                        <ListItemText
                          primary={`${c.author}${c.cardTitle ? ` on ${c.cardTitle}` : ''}`}
                          secondary={
                            <>
                              <div dangerouslySetInnerHTML={{ __html: c.bodyHtml || '' }} />
                              <div>{new Date(c.createdAt).toLocaleString()}</div>
                            </>
                          }
                        />
                      </ListItem>
                    ))}
                  </MList>
                ) : (
                  <Typography variant="body2" color="text.secondary">
                    No new comments.
                  </Typography>
                )}
              </Box>
            </Stack>
          )}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setNotifyOpen(false)} disabled={notifyLoading}>
            Cancel
          </Button>
          <Button
            variant="contained"
            onClick={() => void handleSendNotify()}
            disabled={notifyLoading || !notifyPreview}
          >
            Send notifications
          </Button>
        </DialogActions>
      </Dialog>

      {selectedCardId && (
        <CardDialog
          open={dialogOpen}
          onClose={closeCard}
          cardId={selectedCardId}
          boardOwnerAddress={board?.creatorAddress ?? ''}
          qassetsRevenueAddress={qAssRevAddr}
          treasuryAddress={qAssetEscrowAddress}
        />
      )}
    </Box>
  );
};
