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
// import { useAlert } from '../alerts';
// import { canUserEditBoard } from '../../utils/qdeckAccess';

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
  } = useQDeck();

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

  // quick-add per-list
  const [addingForListId, setAddingForListId] = useState<string | null>(null);

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
    if (addingForListId && inputRef.current) {
      const t = setTimeout(() => inputRef.current?.focus(), 30);
      return () => clearTimeout(t);
    }
  }, [addingForListId]);

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
    for (const listId of Object.keys(byList)) {
      byList[listId].sort((a, b) => cards[a].order - cards[b].order);
    }
    return byList;
  }, [cards]);

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
      }
    } else {
      const newIndex = cardsByList[dstListId]?.length ?? 0;
      await moveCard(cardId, dstListId, newIndex);
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

        {/* Quick actions */}
        {/* <Button size="small" variant="outlined" startIcon={<PlaylistAddIcon />} onClick={addList}>
          Add list
        </Button> */}
        <Button
          size="small"
          variant="contained"
          startIcon={<Refresh />}
          onClick={() => refreshBoard()}
          sx={{ width: { xs: '100%', sm: 'auto' } }}
        >
          Refresh
        </Button>

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
                          onChange={(e) => setEditingListTitle(e.target.value)}
                          onKeyDown={async (e) => {
                            if (e.key === 'Enter') {
                              await renameList(list.listId, editingListTitle);
                              setEditingListId(null);
                            } else if (e.key === 'Escape') {
                              setEditingListId(null);
                            }
                          }}
                          onBlur={async () => {
                            // commit on blur if title changed
                            if (editingListTitle.trim() && editingListTitle.trim() !== list.title) {
                              await renameList(list.listId, editingListTitle);
                            }
                            setEditingListId(null);
                          }}
                          autoFocus
                          sx={{ flex: 1, minWidth: 0 }}
                        />
                        <Button
                          size="small"
                          variant="contained"
                          onClick={async () => {
                            await renameList(list.listId, editingListTitle);
                            setEditingListId(null);
                          }}
                        >
                          Save
                        </Button>
                        <Button size="small" onClick={() => setEditingListId(null)}>
                          Cancel
                        </Button>
                      </>
                    ) : (
                      <>
                        <Typography
                          variant="h6"
                          sx={{ flex: 1, minWidth: 0, lineHeight: 1.3, userSelect: 'none' }}
                          onDoubleClick={() => {
                            setEditingListId(list.listId);
                            setEditingListTitle(list.title);
                          }}
                          title="Double-click to rename"
                        >
                          {list.title}
                        </Typography>
                        <Tooltip title="Rename list">
                          <IconButton
                            size="small"
                            onClick={() => {
                              setEditingListId(list.listId);
                              setEditingListTitle(list.title);
                            }}
                          >
                            {/* You can swap for an Edit icon if you prefer */}
                            <MoreVertIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </>
                    )}
                  </Box>

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
                        />
                      </Box>
                    </SortableContext>
                  </ListDroppable>
                  <Box sx={{ p: '0.5rem', borderTop: (t) => `1px solid ${t.palette.divider}` }}>
                    {addingForListId === list.listId ? (
                      <AddCardInline
                        listId={list.listId}
                        onCancel={() => setAddingForListId(null)}
                        onSubmit={(draft) => {
                          // keep this callback stable with useCallback if you want
                          const nextIndex = cardsByList[list.listId]?.length ?? 0;
                          void createCard({
                            title: draft.title,
                            statusListId: list.listId,
                            order: nextIndex,
                            quickDescription: draft.quickDescription,
                            priority: draft.priority,
                            estimatedCompletionTimeMinutes: draft.estimatedMinutes,
                            tags: draft.tags,
                          });
                          setAddingForListId(null);
                        }}
                      />
                    ) : (
                      <Button
                        size="small"
                        variant="outlined"
                        onClick={() => setAddingForListId(list.listId)}
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
