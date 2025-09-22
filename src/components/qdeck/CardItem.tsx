// CardItem.tsx
import * as React from 'react';
import { Paper, ButtonBase, Typography, Stack, IconButton } from '@mui/material';
import DragIndicatorIcon from '@mui/icons-material/DragIndicator';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

type CardItemProps = {
  card: { id: string; title: string; description?: string };
  onOpen: (cardId: string) => void; // navigate or open modal
};

export function CardItem({ card, onOpen }: CardItemProps) {
  const {
    setNodeRef,
    attributes, // attach to the drag handle only
    listeners, // attach to the drag handle only
    transform,
    transition,
    isDragging,
  } = useSortable({ id: card.id });

  const style = {
    transform: CSS.Translate.toString(transform), // or CSS.Transform.toString
    transition,
    opacity: isDragging ? 0.6 : 1,
  } as React.CSSProperties;

  return (
    <Paper
      ref={setNodeRef}
      style={style}
      sx={{
        p: 1,
        overflow: 'hidden',
        ':focus-within': { outline: '2px solid', outlineColor: 'primary.main' },
      }}
      elevation={isDragging ? 6 : 1}
    >
      <Stack direction="row" spacing={1} alignItems="flex-start">
        {/* Drag handle: ONLY this is draggable */}
        <IconButton
          size="small"
          aria-label="Drag card"
          {...attributes}
          {...listeners}
          onClick={(e) => e.stopPropagation()} // avoid triggering open on handle clicks
        >
          <DragIndicatorIcon fontSize="small" />
        </IconButton>

        {/* Clickable body */}
        <ButtonBase
          onClick={() => onOpen(card.id)}
          sx={{
            textAlign: 'left',
            alignSelf: 'stretch',
            borderRadius: 1,
            px: 1,
            py: 0.5,
            flex: 1,
            display: 'block',
          }}
        >
          <Typography variant="subtitle1" sx={{ lineHeight: 1.2 }}>
            {card.title}
          </Typography>
          {card.description && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
              {card.description}
            </Typography>
          )}
        </ButtonBase>
      </Stack>
    </Paper>
  );
}
