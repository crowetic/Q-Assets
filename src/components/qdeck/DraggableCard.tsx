import * as React from 'react';
import { useQDeck } from './QDeckProvider';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Paper, Box, Typography, IconButton, Avatar, Chip, Stack, Tooltip } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import AccessTimeIcon from '@mui/icons-material/AccessTime';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';
import { resolvePrimaryImageDataUrl } from '../../utils/qdeckApi';
import { priorityMeta, formatMinutes } from './ui';
import { useTheme } from '@mui/material';

type DraggableProps = {
  cardId: string;
  listId: string;
  onClick?: (cardId: string) => void;
};

// function colorFor(name: string) {
//   let h = 0;
//   for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
//   return `hsl(${((h % 360) + 360) % 360} 70% 45%)`;
// }

export const DraggableCard: React.FC<DraggableProps> = ({ cardId, listId, onClick }) => {
  const theme = useTheme();
  const { board, cards } = useQDeck();
  const card = cards[cardId];

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${cardId}::${listId}`,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: 'default',
  };

  const author = card?.createdBy ?? 'U';
  const initial = author.slice(0, 1).toUpperCase();
  const [avatarUrl, setAvatarUrl] = React.useState<string | undefined>();
  const [primaryImg, setPrimaryImg] = React.useState<string | undefined>();

  // Resolve avatar
  React.useEffect(() => {
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
  React.useEffect(() => {
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

  const pMeta = priorityMeta(theme, card.priority);
  const PriIcon = pMeta.icon;

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
        minHeight: '5.75rem',
        height: '100%',
        borderLeft: `0.42rem solid ${pMeta.border}`,
        bgColor: pMeta.bg,
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
        sx={{ pl: '2rem', pr: '2.75rem', width: '100%', maxWidth: '100%', minWidth: 0 }}
      >
        <Box
          sx={{
            position: 'absolute',
            top: '5%',
            right: '1%',
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 0.5, // space between ETA pill and avatar
            pointerEvents: 'none', // let clicks pass through
            zIndex: 2,
          }}
        >
          {/* author avatar */}
          <Avatar
            src={avatarUrl}
            sx={{
              width: '1.6rem',
              height: '1.6rem',
              // bgcolor: colorFor(author),

              fontSize: '0.82rem',
            }}
          >
            {initial}
          </Avatar>
          {/* </Box> */}
          {/* <Box
          sx={{
            position: 'absolute',
            top: '35%',
            right: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 0.1, // space between ETA pill and avatar
            pointerEvents: 'none', // let clicks pass through
            zIndex: 2,
          }}
        > */}
          <Chip
            size="small"
            label={pMeta.label}
            icon={<PriIcon sx={{ color: pMeta.fg }} />}
            sx={{
              height: '1.35rem',
              '& .MuiChip-label': {
                px: '0.4rem',
                color: pMeta.fg,
                fontWeight: 300,
                fontSize: '0.8rem',
              },
              '& .MuiChip-icon': { color: pMeta.fg, ml: '0.2rem' },
              bgcolor: pMeta.bg,
            }}
          />
          {/* </Box> */}
          {/* <Box
          sx={{
            position: 'absolute',
            top: '65%',
            right: 6,
            display: 'flex',
            alignItems: 'center',
            gap: 0.1, // space between ETA pill and avatar
            pointerEvents: 'none', // let clicks pass through
            zIndex: 2,
          }}
        > */}
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
        </Box>

        <Typography
          variant="subtitle1"
          sx={{
            mb: '0.25rem',
            fontWeight: 600,
            // 🔽 stop long words/URLs from forcing width
            overflowWrap: 'anywhere',
            wordBreak: 'break-word',
          }}
        >
          {card.title}
        </Typography>

        {card.quickDescription && (
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

        {primaryImg && (
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
        {card.tags?.length ? (
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
