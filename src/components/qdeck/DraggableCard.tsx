import { useQDeck } from './QDeckProvider';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import {
  Paper,
  Box,
  Typography,
  IconButton,
  Avatar,
  Chip,
  Stack,
  Tooltip,
  Button,
} from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArchiveIcon from '@mui/icons-material/Archive';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import AttachFileIcon from '@mui/icons-material/AttachFile';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import FlagIcon from '@mui/icons-material/Flag';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';
import { resolvePrimaryImageDataUrl } from '../../utils/qdeckApi';
import { priorityMeta, formatMinutes } from './ui';
import { useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { useAuth } from 'qapp-core';
import {
  CSSProperties,
  FC,
  MouseEvent,
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from 'react';

type DraggableProps = {
  cardId: string;
  listId: string;
  onClick?: (cardId: string) => void;
  index: number;
  totalCards: number;
  onManualReorder?: () => void;
  forceMinimized?: boolean;
};

const DraggableCardInner: FC<DraggableProps> = ({
  cardId,
  listId,
  onClick,
  index,
  totalCards,
  onManualReorder,
  forceMinimized,
}) => {
  const theme = useTheme();
  const {
    board,
    cards,
    moveCard,
    archiveCard,
    updateCard,
    isCardCollapsed,
    setCardCollapsed,
    comments,
    loadCommentsForCard,
  } = useQDeck();
  const { name: userName } = useAuth();
  const card = cards[cardId];
  const commentThread = comments[cardId];
  const commentCount = commentThread?.comments?.length ?? 0;
  const attachmentCount = card?.attachments?.length ?? 0;
  const [loadedAssignees, setLoadedAssignees] = useState<string[] | null>(null);

  const [minimized, setMinimized] = useState(false);

  useEffect(() => {
    if (forceMinimized !== undefined) {
      setMinimized(forceMinimized);
      return;
    }
    const collapsed = isCardCollapsed(cardId, card);
    setMinimized(Boolean(collapsed));
  }, [forceMinimized, cardId, card, isCardCollapsed]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${cardId}::${listId}`,
  });

  const pMeta = priorityMeta(theme, card.priority);
  const PriIcon = pMeta.icon;
  const isDone = Boolean(card?.isDone);
  const isCardInProgress = Boolean(card?.scheduledStart && !card?.isDone);
  const baseTint = alpha(pMeta.border, 0.08);
  const cardBorder = isDone
    ? theme.palette.grey[500]
    : isCardInProgress
      ? theme.palette.success.main
      : 'transparent';
  const cardBg = isDone
    ? alpha(theme.palette.grey[600], 0.18)
    : isCardInProgress
      ? alpha(theme.palette.success.main, 0.04)
      : baseTint;
  const style: CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: 'default',
  };

  const persistCollapse = useCallback(
    (value: boolean, event?: MouseEvent<HTMLButtonElement>) => {
      event?.stopPropagation();
      setCardCollapsed(cardId, value);
      setMinimized(value);
    },
    [cardId, setCardCollapsed]
  );

  const moveInDirection = useCallback(
    async (direction: 'up' | 'down') => {
      const lastIndex = Math.max(0, totalCards - 1);
      const target = direction === 'up' ? Math.max(0, index - 1) : Math.min(lastIndex, index + 1);
      if (target === index) return;
      try {
        await moveCard(cardId, listId, target);
        onManualReorder?.();
      } catch (err) {
        console.error('Failed to move card', err);
      }
    },
    [cardId, index, listId, moveCard, onManualReorder, totalCards]
  );

  const toggleMinimized = useCallback(
    (event: MouseEvent<HTMLButtonElement>) => {
      persistCollapse(!minimized, event);
    },
    [minimized, persistCollapse]
  );

  const doneListId = useMemo(() => {
    const lists = board?.lists ?? [];
    const doneList = lists.find((l) => l.title?.toLowerCase().includes('done'));
    return doneList?.listId;
  }, [board?.lists]);

  const isInProgressTitle = useCallback((title?: string) => {
    const normalized = (title ?? '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, ' ')
      .trim();
    return normalized.includes('in progress');
  }, []);

  const inProgressListId = useMemo(() => {
    const lists = board?.lists ?? [];
    const hit = lists.find((l) => isInProgressTitle(l.title));
    return hit?.listId;
  }, [board?.lists, isInProgressTitle]);

  const handleArchive = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      try {
        await archiveCard(cardId, true);
      } catch (err) {
        console.error('Failed to archive card', err);
      }
    },
    [archiveCard, cardId]
  );

  const updateCardWithRetry = useCallback(
    async (nextCard: typeof card, contextLabel: string) => {
      try {
        await updateCard(nextCard);
      } catch (err: any) {
        if (err?.message?.includes('Stale write')) {
          console.warn(`Retrying ${contextLabel} after stale seq`, err);
          const retry = { ...nextCard, seq: nextCard.seq + 1 };
          try {
            await updateCard(retry);
          } catch (retryErr) {
            console.error(`Failed to ${contextLabel} on retry`, retryErr);
          }
        } else {
          console.error(`Failed to ${contextLabel}`, err);
        }
      }
    },
    [updateCard]
  );

  const handleToggleComplete = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!card) return;
      const nextIsDone = !card.isDone;
      const nextCard: typeof card = {
        ...card,
        isDone: nextIsDone,
        updatedAt: Date.now(),
        completedAt: nextIsDone ? Date.now() : undefined,
        isCollapsed: nextIsDone,
        collapsedWhenDone: nextIsDone,
      };
      nextCard.seq = card.seq + 1;
      if (nextIsDone && doneListId && doneListId !== card.statusListId) {
        const doneOrder = Object.values(cards).filter((c) => c.statusListId === doneListId).length;
        nextCard.statusListId = doneListId;
        nextCard.order = doneOrder;
      }
      await updateCardWithRetry(nextCard, 'toggle complete');
    },
    [card, cards, doneListId, updateCardWithRetry]
  );

  const taskButtonLabel = useMemo(() => {
    if (!card) return 'Start task';
    if (card.isDone) return 'Completed';
    const me = userName?.trim();
    const startedByMe = Boolean(me && card.scheduledStart && card.assignees?.includes(me));
    return startedByMe ? 'Complete task' : 'Start task';
  }, [card, userName]);

  const canUseTaskAction = Boolean(card && !card.isDone && userName?.trim());
  const isTaskCompleted = Boolean(card?.isDone);
  const isTaskInProgress = Boolean(
    userName?.trim() && card?.scheduledStart && card?.assignees?.includes(userName)
  );
  const taskIcon = isTaskCompleted ? (
    <CheckCircleIcon fontSize="small" />
  ) : isTaskInProgress ? (
    <FlagIcon fontSize="small" />
  ) : (
    <PlayArrowIcon fontSize="small" />
  );

  const handleTaskAction = useCallback(
    async (event: MouseEvent<HTMLButtonElement>) => {
      event.stopPropagation();
      if (!card) return;
      const me = userName?.trim();
      if (!me) return;
      const now = Date.now();
      const assignees = Array.from(new Set([...(card.assignees ?? []), me]));
      const startedByMe = Boolean(card.scheduledStart && assignees.includes(me));
      const shouldComplete = startedByMe && !card.isDone;
      const nextCard: typeof card = {
        ...card,
        assignees,
        scheduledStart: card.scheduledStart ?? now,
        scheduledEnd: shouldComplete ? (card.scheduledEnd ?? now) : card.scheduledEnd,
        isDone: shouldComplete ? true : card.isDone,
        completedAt: shouldComplete ? now : card.completedAt,
        isCollapsed: shouldComplete ? true : card.isCollapsed,
        collapsedWhenDone: shouldComplete ? true : card.collapsedWhenDone,
        updatedAt: now,
      };
      nextCard.seq = card.seq + 1;
      if (shouldComplete && doneListId && doneListId !== card.statusListId) {
        const doneOrder = Object.values(cards).filter((c) => c.statusListId === doneListId).length;
        nextCard.statusListId = doneListId;
        nextCard.order = doneOrder;
      } else if (!shouldComplete && inProgressListId && inProgressListId !== card.statusListId) {
        const inProgressOrder = Object.values(cards).filter(
          (c) => c.statusListId === inProgressListId
        ).length;
        nextCard.statusListId = inProgressListId;
        nextCard.order = inProgressOrder;
      }
      await updateCardWithRetry(nextCard, shouldComplete ? 'complete task' : 'start task');
    },
    [card, cards, doneListId, inProgressListId, updateCardWithRetry, userName]
  );

  const author = card?.createdBy ?? 'U';
  const initial = author.slice(0, 1).toUpperCase();
  const [avatarUrl, setAvatarUrl] = useState<string | undefined>();
  const [primaryImg, setPrimaryImg] = useState<string | undefined>();

  // Resolve avatar
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const url = await fetchAccountAvatarDataUrl(encodeURIComponent(author));
        if (alive) setAvatarUrl(url || undefined);
      } catch {
        /* noop */
      }
    })();
    return () => {
      alive = false;
    };
  }, [author]);

  // Resolve primary image (supports url string or encrypted ref)
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        if (!card) return;
        if (card.primaryImageUrl && !card.primaryImage) {
          if (alive) setPrimaryImg(card.primaryImageUrl);
        } else if (card.primaryImage && board) {
          const url = await resolvePrimaryImageDataUrl(
            card.createdBy, // issuerName used for fetch
            card.primaryImage,
            board.privateMeta?.groupId,
            board.privateMeta?.isAdmins
          );
          if (alive) setPrimaryImg(url);
        } else {
          if (alive) setPrimaryImg(undefined);
        }
      } catch {
        if (alive) setPrimaryImg(undefined);
      }
    })();
    return () => {
      alive = false;
    };
  }, [card, board]);

  useEffect(() => {
    if (!card || commentThread) return;
    const timer = window.setTimeout(() => {
      void loadCommentsForCard(cardId);
    }, 250);
    return () => clearTimeout(timer);
  }, [card, cardId, commentThread, loadCommentsForCard]);

  useEffect(() => {
    if (!card) {
      setLoadedAssignees(null);
      return;
    }
    const assignees = Array.isArray(card.assignees) ? card.assignees.filter(Boolean) : [];
    if (!assignees.length) {
      setLoadedAssignees([]);
      return;
    }
    const timer = window.setTimeout(() => {
      setLoadedAssignees(assignees);
    }, 250);
    return () => clearTimeout(timer);
  }, [card]);

  return (
    <Paper
      ref={setNodeRef}
      elevation={1}
      sx={{
        // 🔽 make the card shrink with the column
        width: '100%',
        maxWidth: '100%',
        minWidth: 0,

        p: '0.4rem',
        mb: '0.6rem',
        position: 'relative',
        minHeight: minimized ? '3.5rem' : '5.75rem',
        height: '100%',
        border: '1px solid',
        borderColor: cardBorder,
        bgcolor: cardBg,
        color: isDone ? theme.palette.text.secondary : theme.palette.text.primary,
        '&:hover': { boxShadow: 4, borderColor: cardBorder || theme.palette.divider },
        cursor: 'pointer',
      }}
      style={style}
    >
      {/* drag handle */}
      <IconButton
        size="small"
        {...attributes}
        {...listeners}
        sx={{ position: 'absolute', top: '0.25rem', left: '0.25rem', cursor: 'grab' }}
        aria-label="Drag"
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>

      {/* click surface */}
      <Box
        onClick={() => onClick?.(cardId)}
        sx={{
          pl: '2rem',
          pr: minimized ? '2rem' : '2.25rem',
          width: '100%',
          maxWidth: '100%',
          minWidth: 0,
        }}
      >
        <Stack
          direction="row"
          alignItems="flex-start"
          justifyContent="space-between"
          spacing={1}
          sx={{ mb: minimized ? 0.3 : 0.6 }}
        >
          <Stack direction="row" alignItems="center" spacing={0.5} sx={{ pointerEvents: 'none' }}>
            <Avatar
              src={avatarUrl}
              sx={{
                width: '1.6rem',
                height: '1.6rem',
                fontSize: '0.82rem',
              }}
            >
              {initial}
            </Avatar>
            <Stack direction="row" spacing={0.35} alignItems="center" sx={{ flexWrap: 'wrap' }}>
              <Chip
                size="small"
                label={pMeta.label}
                icon={<PriIcon sx={{ color: pMeta.fg }} />}
                sx={{
                  height: '1.35rem',
                  '& .MuiChip-label': {
                    px: '0.35rem',
                    color: pMeta.fg,
                    fontWeight: 300,
                    fontSize: '0.8rem',
                  },
                  '& .MuiChip-icon': { color: pMeta.fg, ml: '0.2rem' },
                  bgcolor: pMeta.bg,
                }}
              />
              {attachmentCount > 0 && (
                <Tooltip title={`${attachmentCount} attachment${attachmentCount === 1 ? '' : 's'}`}>
                  <Chip
                    size="small"
                    icon={<AttachFileIcon fontSize="small" />}
                    label={attachmentCount}
                    sx={{ height: '1.35rem' }}
                  />
                </Tooltip>
              )}
              {!!card.estimatedCompletionTimeMinutes && (
                <Tooltip title="Estimated completion time">
                  <Chip
                    size="small"
                    icon={<AccessTimeIcon />}
                    label={formatMinutes(card.estimatedCompletionTimeMinutes)}
                    sx={{ height: '1.35rem' }}
                  />
                </Tooltip>
              )}
            </Stack>
          </Stack>
          <Stack
            direction="row"
            spacing={0.2}
            sx={{
              pointerEvents: 'auto',
              minWidth: 'auto',
            }}
          >
            <Tooltip title={minimized ? 'Expand card' : 'Minimize card'}>
              <span style={{ display: 'inline-flex' }}>
                <IconButton
                  size="small"
                  onClick={(event) => toggleMinimized(event)}
                  aria-label={minimized ? 'Expand card' : 'Minimize card'}
                >
                  {minimized ? (
                    <ExpandMoreIcon fontSize="small" />
                  ) : (
                    <ExpandLessIcon fontSize="small" />
                  )}
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move card up">
              <span style={{ display: 'inline-flex' }}>
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    void moveInDirection('up');
                  }}
                  disabled={index === 0}
                  aria-label="Move card up"
                >
                  <ArrowUpwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Move card down">
              <span style={{ display: 'inline-flex' }}>
                <IconButton
                  size="small"
                  onClick={(event) => {
                    event.stopPropagation();
                    void moveInDirection('down');
                  }}
                  disabled={index >= totalCards - 1}
                  aria-label="Move card down"
                >
                  <ArrowDownwardIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title={card?.isDone ? 'Mark incomplete' : 'Mark complete'}>
              <span style={{ display: 'inline-flex' }}>
                <IconButton
                  size="small"
                  onClick={handleToggleComplete}
                  aria-label={card?.isDone ? 'Mark incomplete' : 'Mark complete'}
                  color={card?.isDone ? 'success' : 'default'}
                >
                  <CheckCircleIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
            <Tooltip title="Archive card">
              <span style={{ display: 'inline-flex' }}>
                <IconButton
                  size="small"
                  color="error"
                  onClick={handleArchive}
                  aria-label="Archive card"
                >
                  <ArchiveIcon fontSize="small" />
                </IconButton>
              </span>
            </Tooltip>
          </Stack>
        </Stack>

        {!minimized && (commentThread !== undefined || (loadedAssignees?.length ?? 0) > 0) && (
          <Stack
            direction="row"
            spacing={0.35}
            alignItems="center"
            useFlexGap
            flexWrap="wrap"
            sx={{ mb: minimized ? 0 : 0.4 }}
          >
            {commentThread && (
              <Chip
                size="small"
                label={`${commentCount} ${commentCount === 1 ? 'comment' : 'comments'}`}
                variant="outlined"
                sx={{ height: '1.35rem' }}
              />
            )}
            {(loadedAssignees || []).map((nm) => (
              <Chip
                key={nm}
                size="small"
                label={nm}
                variant="outlined"
                sx={{ height: '1.35rem' }}
              />
            ))}
          </Stack>
        )}

        <Typography
          variant="subtitle1"
          sx={{
            mb: '0.25rem',
            fontWeight: 600,
            // 🔽 stop long words/URLs from forcing width
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
            whiteSpace: minimized ? 'nowrap' : 'normal',
            overflow: minimized ? 'hidden' : 'visible',
            textOverflow: minimized ? 'ellipsis' : 'unset',
          }}
        >
          {card.title}
        </Typography>

        {!minimized && card.quickDescription && (
          <Typography
            variant="body2"
            sx={{
              whiteSpace: 'pre-wrap',
              mb: primaryImg ? '0.4rem' : '0.25rem',
              opacity: 0.9,
              overflowWrap: 'anywhere',
              wordBreak: 'break-word',
            }}
          >
            {card.quickDescription}
          </Typography>
        )}

        {!minimized && primaryImg && (
          <Box
            component="img"
            src={primaryImg}
            alt=""
            loading="lazy"
            sx={{
              display: 'block',
              width: '100%',
              height: 'auto',
              borderRadius: '0.35rem',
              objectFit: 'cover',
              maxHeight: '12rem',
              mb: '0.35rem',
            }}
          />
        )}

        {/* tags – subtle but visible */}
        {!minimized && card.tags?.length ? (
          <Stack direction="row" spacing={0.5} useFlexGap flexWrap="wrap">
            {card.tags.map((t) => (
              <Chip
                key={t}
                size="small"
                label={t}
                variant="outlined"
                sx={{ opacity: 0.85, height: '1.3rem' }}
              />
            ))}
          </Stack>
        ) : null}

        <Box sx={{ display: 'flex', justifyContent: 'center', mt: minimized ? 0.25 : 0.6 }}>
          <Button
            size="small"
            variant={isTaskCompleted ? 'contained' : 'outlined'}
            color={isTaskCompleted || isTaskInProgress ? 'success' : 'primary'}
            startIcon={taskIcon}
            onClick={handleTaskAction}
            disabled={isTaskCompleted ? true : !canUseTaskAction}
            sx={{
              height: '1.6rem',
              minWidth: '6.2rem',
              px: '0.6rem',
              textTransform: 'none',
              fontSize: '0.75rem',
              lineHeight: 1,
              borderRadius: '999px',
              boxShadow: 'none',
              color: !isTaskCompleted && !isTaskInProgress ? pMeta.border : undefined,
              borderColor: !isTaskCompleted && !isTaskInProgress ? pMeta.border : undefined,
              '&:hover':
                !isTaskCompleted && !isTaskInProgress
                  ? { borderColor: pMeta.border, backgroundColor: alpha(pMeta.border, 0.08) }
                  : undefined,
              '&.Mui-disabled': {
                opacity: 1,
                color: (t) => (isTaskCompleted ? t.palette.common.white : t.palette.text.disabled),
              },
            }}
          >
            {taskButtonLabel}
          </Button>
        </Box>
      </Box>
    </Paper>
  );
};

export const DraggableCard = memo(DraggableCardInner);
DraggableCard.displayName = 'DraggableCard';
