// ListColumn.tsx
import { useDroppable } from '@dnd-kit/core';
import { Box } from '@mui/material';
import { DraggableCard } from './DraggableCard';

export function ListColumn({
  list,
  cardIds,
  onCardClick,
  forceMinimized,
  onManualReorder,
}: {
  issuerName: string;
  list: any;
  cardIds: string[];
  onCardClick?: (cardId: string) => void;
  onManualReorder?: () => void;
  forceMinimized?: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: `list::${list.listId}` });

  return (
    <Box
      ref={setNodeRef}
      sx={{
        // make the column itself shrinkable & full width
        width: '100%',
        maxWidth: '100%',
        minWidth: 0, // <-- important for flex/grid children
        flex: 1,
        display: 'block',

        px: '0.5rem',
        pb: '0.5rem',
        minHeight: 0,
        overflowY: 'auto',
        outline: isOver ? '2px dashed rgba(128,128,128,0.6)' : 'none',
        outlineOffset: '2px',
        borderRadius: '0.25rem',
      }}
    >
      {cardIds.map((cid, index) => (
        <DraggableCard
          key={cid}
          cardId={cid}
          listId={list.listId}
          onClick={onCardClick}
          index={index}
          totalCards={cardIds.length}
          onManualReorder={onManualReorder}
          forceMinimized={forceMinimized}
        />
      ))}
    </Box>
  );
}
