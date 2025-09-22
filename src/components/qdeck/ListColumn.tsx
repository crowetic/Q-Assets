// ListColumn.tsx
import { useDroppable } from '@dnd-kit/core';
import { Box } from '@mui/material';
import { DraggableCard } from './DraggableCard';

export function ListColumn({
  list,
  cardIds,
  onCardClick,
}: {
  issuerName: string;
  list: any;
  cardIds: string[];
  onCardClick?: (cardId: string) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `list::${list.listId}` });

  return (
    <Box
      ref={setNodeRef}
      sx={{
        px: '0.5rem',
        pb: '0.5rem',
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        outline: isOver ? '2px dashed rgba(128,128,128,0.6)' : 'none',
        outlineOffset: '2px',
        borderRadius: '0.25rem',
      }}
    >
      {cardIds.map((cid) => (
        <DraggableCard key={cid} cardId={cid} listId={list.listId} onClick={onCardClick} />
      ))}
    </Box>
  );
}
