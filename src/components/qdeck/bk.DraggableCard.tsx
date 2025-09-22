import * as React from 'react';
import { useQDeck } from './QDeckProvider';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Paper, Box, Typography, IconButton, Avatar } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';
import { resolvePrimaryImageDataUrl } from '../../utils/qdeckApi';

type DraggableCardProps = {
  cardId: string;
  listId: string;
  onClick?: (cardId: string) => void;
};

// rainbow fallback for initials
function colorFor(name: string) {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return `hsl(${((h % 360) + 360) % 360} 70% 45%)`;
}

export const DraggableCard: React.FC<DraggableCardProps> = ({ cardId, listId, onClick }) => {
  const { cards, board } = useQDeck();
  const card = cards[cardId];

  // Guard if card hasn't landed in state yet
  if (!card) return null;

  const author = card.createdBy || 'U';
  const initial = author.slice(0, 1).toUpperCase();

  const [avatarUrl, setAvatarUrl] = React.useState<string | undefined>(undefined);
  const [imgUrl, setImgUrl] = React.useState<string | undefined>(undefined);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      if (!board || !card.primaryImage) {
        setImgUrl(undefined);
        return;
      }
      const url = await resolvePrimaryImageDataUrl(
        board.createdBy,
        card.primaryImage,
        board.privateMeta?.groupId,
        board.privateMeta?.isAdmins
      );
      if (alive) setImgUrl(url);
    })();
    return () => {
      alive = false;
    };
  }, [
    board?.createdBy,
    board?.privateMeta?.groupId,
    board?.privateMeta?.isAdmins,
    card.primaryImage?.identifier,
  ]);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const name = encodeURIComponent(author);
        const url = await fetchAccountAvatarDataUrl(name);
        if (alive) setAvatarUrl(url || undefined);
      } catch {
        if (alive) setAvatarUrl(undefined);
      }
    })();
    return () => {
      alive = false;
    };
  }, [author]);

  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: `${cardId}::${listId}`,
  });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.6 : 1,
    cursor: 'default',
  };

  return (
    <Paper
      ref={setNodeRef}
      elevation={1}
      sx={{ p: '0.5rem', mb: '0.5rem', position: 'relative' }}
      style={style}
    >
      {/* drag handle in top-left; DOES NOT block clicks elsewhere */}
      <IconButton
        size="small"
        {...attributes}
        {...listeners}
        sx={{ position: 'absolute', top: '0.25rem', left: '0.25rem', cursor: 'grab' }}
        aria-label="Drag"
        // prevent handle mousedown from triggering the card click
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.preventDefault()}
      >
        <DragIndicatorIcon fontSize="small" />
      </IconButton>

      {/* author avatar top-right */}
      <Avatar
        src={avatarUrl}
        sx={{
          position: 'absolute',
          top: '0.25rem',
          right: '0.25rem',
          width: '1.5rem',
          height: '1.5rem',
          bgcolor: avatarUrl ? undefined : colorFor(author),
          fontSize: '0.8rem',
        }}
      >
        {initial}
      </Avatar>

      {/* click surface opens the card */}
      <Box onClick={() => onClick?.(cardId)} sx={{ pl: '2rem', pr: '2rem' }}>
        <Typography variant="subtitle1" sx={{ mb: '0.25rem' }}>
          {card.title}
        </Typography>

        {/* quickDescription (plain text) */}
        {card.quickDescription && (
          <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap', mb: '0.25rem' }}>
            {card.quickDescription}
          </Typography>
        )}

        {/* primary image */}
        {imgUrl && (
          <Box
            component="img"
            src={imgUrl}
            alt=""
            loading="lazy"
            sx={{
              display: 'block',
              width: '100%',
              height: 'auto',
              mt: '0.25rem',
              borderRadius: '0.25rem',
              objectFit: 'cover',
              maxHeight: '12rem',
            }}
          />
        )}
      </Box>
    </Paper>
  );
};
