import {
  useCallback,
  useState,
  useRef,
  memo,
  FC,
  useEffect,
  useMemo,
  ReactNode,
  CSSProperties,
  MouseEvent,
  KeyboardEvent,
} from 'react';

import { useQDeck } from './QDeckProvider';
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
  List as MList,
  ListItem,
  ListItemIcon,
  // ListItemText,
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
  ToggleButton,
  ToggleButtonGroup,
  useTheme,
  useMediaQuery,
} from '@mui/material';
import MoreVertIcon from '@mui/icons-material/MoreVert';
// import EditIcon from '@mui/icons-material/Edit';
import ContentCopyIcon from '@mui/icons-material/ContentCopy';
import DeleteForeverIcon from '@mui/icons-material/DeleteForever';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PlaylistAddIcon from '@mui/icons-material/PlaylistAdd';
import ArchiveIcon from '@mui/icons-material/Archive';
import UnarchiveIcon from '@mui/icons-material/Unarchive';
import TuneIcon from '@mui/icons-material/Tune';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import { ListColumn } from './ListColumn';
import { Priority } from '../../types/qdeck';
import CardDialog from './CardDialog';
// import { publishPrimaryImageForCard } from '../../utils/qdeckApi';
import { uniqueId6 } from '../../utils/ids';
import {
  qAssetsRevenueAddress,
  tempQAssetEscrowAccountAddress,
} from '../../constants/qdeckIdentifiers';
import { Refresh } from '@mui/icons-material';
// import { canUserEditBoard } from '../../utils/qdeckAccess';
import { getGroupById, type GroupSummary } from '../../utils/qortalApi';
import SettingsBackupRestoreIcon from '@mui/icons-material/SettingsBackupRestore';
import SecurityIcon from '@mui/icons-material/Security';
import { useAlert } from '../alerts';
import { useNavigate } from 'react-router-dom';

type NewCardDraft = {
  title: string;
  quickDescription?: string;
  priority: Priority;
  estimatedMinutes?: number;
  tags: string[];
};

type AddCardInlineProps = {
  listId: string;
  onCancel: () => void;
  onSubmit: (draft: NewCardDraft) => void;
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
}: AddCardInlineProps) {
  const [title, setTitle] = useState('');
  const [quick, setQuick] = useState('');
  const [priority, setPriority] = useState<Priority>('NORMAL');
  const [eta, setEta] = useState<number | ''>('');
  const [tagsCsv, setTagsCsv] = useState('');

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
    });
  }, [title, quick, priority, eta, tagsCsv, onSubmit]);

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
          onChange={(e) => setEta(e.target.value === '' ? '' : Number(e.target.value))}
          sx={{ width: '9rem' }}
        />
      </Stack>
      <TextField
        size="small"
        label="Tags (comma-separated)"
        placeholder="ui, qortal, v1"
        value={tagsCsv}
        onChange={(e) => setTagsCsv(e.target.value)}
      />
      <Stack direction="row" spacing={1} alignItems="center" justifyContent="flex-end">
        <Button size="small" onClick={onCancel}>
          Cancel
        </Button>
        <Button size="small" variant="contained" onClick={submit} disabled={!title.trim()}>
          Add
        </Button>
      </Stack>
    </Box>
  );
});

type BoardViewProps = {
  issuerName: string;
  onCloneBoard?: (title: string) => Promise<void> | void; // optional external handler
};

export const BoardView: FC<BoardViewProps> = ({ issuerName, onCloneBoard }) => {
  const {
    board,
    cards,
    cardVariants,
    archivedCardIds,
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
  } = useQDeck();
  const navigate = useNavigate();
  const { alert } = useAlert();

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
  const [manageListsOpen, setManageListsOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [cloneTitle, setCloneTitle] = useState('');
  const [confirmDeleteOpen, setConfirmDeleteOpen] = useState(false);

  // Manage Lists – drafts keyed by listId
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

  const handleOpenListMenu = useCallback(
    (event: MouseEvent<HTMLElement>, listId: string) => {
      event.stopPropagation();
      setListMenuState({ anchor: event.currentTarget, listId });
    },
    []
  );
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

  useEffect(() => {
    if (manageListsOpen && board) {
      // seed drafts from current board on open
      const seed: Record<string, string> = {};
      for (const l of lists) seed[l.listId] = l.title;
      setListTitleDrafts(seed);
    }
  }, [manageListsOpen, board, lists]);

  const saveManageListTitles = useCallback(async () => {
    if (!board) return;
    const nextLists = lists.map((l) => {
      const t = (listTitleDrafts[l.listId] ?? l.title).trim();
      return t && t !== l.title ? { ...l, title: t } : l;
    });
    // only persist if any title changed
    const changed = nextLists.some((l, i) => l.title !== lists[i].title);
    if (changed) {
      await persistBoard({ ...board, lists: nextLists, updatedAt: Date.now() });
    }
    setManageListsOpen(false);
  }, [board, listTitleDrafts, persistBoard, lists]);

  const cardsByList = useMemo(() => {
    const byList: Record<string, string[]> = {};
    for (const c of Object.values(cards)) {
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
  }, [cards, sortByPriority]);

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
      const order = getOrderForPosition(listId, position);
      try {
        await createCard({
          title: draft.title,
          quickDescription: draft.quickDescription,
          priority: draft.priority,
          estimatedCompletionTimeMinutes: draft.estimatedMinutes,
          tags: draft.tags,
          statusListId: listId,
          order,
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
      createCard,
      editorGroupIds,
      editorGroups,
      getOrderForPosition,
      handleJoinGroup,
      markManualReorder,
    ]
  );

  const sortedLists = useMemo(() => lists.slice().sort((a, b) => a.order - b.order), [lists]);

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
        markManualReorder();
      }
    } else {
      const newIndex = cardsByList[dstListId]?.length ?? 0;
      await moveCard(cardId, dstListId, newIndex);
      markManualReorder();
    }
  };

  // --- header actions ---
  const handleOpenMenu = (e: React.MouseEvent<HTMLElement>) => setMenuEl(e.currentTarget);
  const handleCloseMenu = () => setMenuEl(null);

  // const openCard = (cardId: string) => {
  //   setSelectedCardId(cardId);
  //   setDialogOpen(true);
  // };
  const openCard = useCallback((cardId: string) => {
    setSelectedCardId(cardId);
    setDialogOpen(true);
  }, []);
  const closeCard = () => setDialogOpen(false);

  if (!board) return <Typography>Loading board…</Typography>;

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

  const addList = async () => {
    if (!board) return;
    const id = uniqueId6();
    const next = {
      ...board,
      lists: [
        ...board.lists,
        {
          listId: id,
          title: 'New List',
          order: board.lists.length, // append at end
          faintColor: undefined,
        },
      ],
      updatedAt: Date.now(),
    };
    await persistBoard(next);
  };

  const removeList = async (listId: string) => {
    if (!board) return;
    const nextLists = board.lists
      .filter((l) => l.listId !== listId)
      .map((l, i) => ({ ...l, order: i })); // normalize orders
    await persistBoard({ ...board, lists: nextLists, updatedAt: Date.now() });
  };

  const handleClone = async () => {
    const t = cloneTitle.trim() || `${board.title} (Copy)`;
    setCloneOpen(false);
    handleCloseMenu();
    if (onCloneBoard) {
      await onCloneBoard(t);
    } else {
      // Stub: you can wire your clone API here
      console.log('[Q-Deck] clone requested with title:', t);
    }
  };

  const handleDelete = async () => {
    setConfirmDeleteOpen(false);
    // choose cascade options
    await deleteBoard({ cascadeCards: false, cascadeComments: false });
  };

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
        </Box>

        {/* Quick actions */}
        {/* <Button size="small" variant="outlined" startIcon={<PlaylistAddIcon />} onClick={addList}>
          Add list
        </Button> */}
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
          variant="contained"
          startIcon={<Refresh />}
          onClick={() => refreshBoard()}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Refresh
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
          <MenuItem
            onClick={() => {
              setManageListsOpen(true);
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
              setCloneTitle(`${board.title} (Copy)`);
              setCloneOpen(true);
            }}
          >
            <ContentCopyIcon fontSize="small" style={{ marginRight: '0.75rem' }} />
            Clone board…
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

      {/* ===== Board ===== */}
      {/* <DndContext collisionDetection={closestCenter} onDragEnd={onDragEnd}> */}
      <DndContext
        sensors={sensors}
        // More forgiving than closestCenter when columns vary in width/overflow
        collisionDetection={pointerWithin} // or rectIntersection
        measuring={{ droppable: { strategy: MeasuringStrategy.Always } }}
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
          {sortedLists
            .slice()
            .sort((a, b) => a.order - b.order)
            .map((list) => {
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
                            addingForList?.listId === list.listId &&
                            addingForList.position === 'top'
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
                        <ListColumn
                          issuerName={issuerName}
                          list={list}
                          cardIds={listCardIds}
                          onCardClick={openCard}
                          onManualReorder={markManualReorder}
                          forceMinimized={isMinimalView}
                        />
                      </Box>
                    </SortableContext>
                  </ListDroppable>
                  <Box sx={{ p: '0.5rem', borderTop: (t) => `1px solid ${t.palette.divider}` }}>
                    {addingForList?.listId === list.listId &&
                    addingForList.position === 'bottom' ? (
                      <AddCardInline
                        listId={list.listId}
                        onCancel={() => setAddingForList(null)}
                        onSubmit={(draft) => handleCreateCard(list.listId, 'bottom', draft)}
                      />
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() =>
                          setAddingForList({ listId: list.listId, position: 'bottom' })
                        }
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
          <Typography
            component="span"
            sx={{ fontWeight: 600, ml: 0.35 }}
            color="text.primary"
          >
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

      {/* ===== Manage Lists Dialog ===== */}
      <Dialog
        open={manageListsOpen}
        onClose={() => setManageListsOpen(false)}
        fullWidth
        maxWidth="sm"
        fullScreen={isXs}
      >
        <DialogTitle>Manage lists</DialogTitle>
        <DialogContent dividers>
          <MList dense>
            {sortedLists
              .slice()
              .sort((a, b) => a.order - b.order)
              .map((l) => (
                <ListItem
                  key={l.listId}
                  secondaryAction={
                    <Stack direction="row" spacing={1}>
                      <Button
                        size="small"
                        color="error"
                        onClick={() => removeList(l.listId)}
                        disabled={board.lists.length <= 1}
                      >
                        Remove
                      </Button>
                    </Stack>
                  }
                  sx={{ alignItems: 'flex-start', gap: 1 }}
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <TextField
                      fullWidth
                      size="small"
                      label="List title"
                      value={listTitleDrafts[l.listId] ?? l.title}
                      onChange={(e) =>
                        setListTitleDrafts((d) => ({ ...d, [l.listId]: e.target.value }))
                      }
                      onBlur={async () => {
                        // commit single field on blur (optional)
                        const newTitle = (listTitleDrafts[l.listId] ?? l.title).trim();
                        if (newTitle && newTitle !== l.title) {
                          await renameList(l.listId, newTitle);
                        }
                      }}
                    />
                    <Typography variant="caption" sx={{ opacity: 0.7 }}>
                      Order: {l.order}
                    </Typography>
                  </Box>
                </ListItem>
              ))}
          </MList>

          <Box sx={{ mt: '1rem', display: 'flex', gap: 1 }}>
            <Button variant="outlined" startIcon={<PlaylistAddIcon />} onClick={addList}>
              Add list
            </Button>
            <Box sx={{ flex: 1 }} />
            <Button variant="contained" onClick={saveManageListTitles}>
              Save changes
            </Button>
          </Box>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setManageListsOpen(false)}>Close</Button>
        </DialogActions>
      </Dialog>

      {/* ===== Clone Board Dialog ===== */}
      <Dialog
        open={cloneOpen}
        onClose={() => setCloneOpen(false)}
        fullWidth
        maxWidth="sm"
        fullScreen={isXs}
      >
        <DialogTitle>Clone board</DialogTitle>
        <DialogContent dividers>
          <TextField
            fullWidth
            label="New board title"
            value={cloneTitle}
            onChange={(e) => setCloneTitle(e.target.value)}
            sx={{ mt: '0.5rem' }}
          />
          <Typography variant="body2" sx={{ mt: '0.75rem' }}>
            This will duplicate the board structure. (Wire your clone logic to{' '}
            <code>onCloneBoard</code>.)
          </Typography>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCloneOpen(false)}>Cancel</Button>
          <Button variant="contained" onClick={handleClone}>
            Clone
          </Button>
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
