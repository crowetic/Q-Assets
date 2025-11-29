import { useQDeck } from './QDeckProvider';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Paper, Box, Typography, IconButton, Avatar, Chip, Stack, Tooltip } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import ArchiveIcon from '@mui/icons-material/Archive';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';
import { resolvePrimaryImageDataUrl } from '../../utils/qdeckApi';
import { priorityMeta, formatMinutes } from './ui';
import { useTheme } from '@mui/material';
import { alpha } from '@mui/material/styles';
import { CSSProperties, FC, MouseEvent, useCallback, useEffect, useMemo, useState } from 'react';

type DraggableProps = {
  cardId: string;
  listId: string;
  onClick?: (cardId: string) => void;
  index: number;
  totalCards: number;
  onManualReorder?: () => void;
  forceMinimized?: boolean;
};

export const DraggableCard: FC<DraggableProps> = ({
  cardId,
  listId,
  onClick,
  index,
  totalCards,
  onManualReorder,
  forceMinimized,
}) => {
  const theme = useTheme();
  const { board, cards, moveCard, archiveCard, updateCard, isCardCollapsed, setCardCollapsed } =
    useQDeck();
  const card = cards[cardId];

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
  const cardBorder = isDone ? theme.palette.success.main : pMeta.border;
  const cardBg = isDone ? alpha(theme.palette.success.light, 0.25) : pMeta.bg;
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
      try {
        await updateCard(nextCard);
      } catch (err: any) {
        if (err?.message?.includes('Stale write')) {
          console.warn('Retrying complete toggle after stale seq', err);
          nextCard.seq += 1;
          try {
            await updateCard(nextCard);
          } catch (retryErr) {
            console.error('Failed to toggle complete on retry', retryErr);
          }
        } else {
          console.error('Failed to toggle complete', err);
        }
      }
    },
    [card, cards, doneListId, updateCard]
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
        borderLeft: `0.42rem solid ${cardBorder}`,
        bgColor: cardBg,
        '&:hover': { boxShadow: 4, border: '0.1rem', borderColor: 'primary.main.contrastText' },
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
      </Box>
    </Paper>
  );
};
