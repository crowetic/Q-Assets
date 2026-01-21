import * as React from 'react';
import { Chip } from '@mui/material';
import type { ChipProps } from '@mui/material';

type ExpandableChipItem = {
  key: string;
  label: string;
  color?: ChipProps['color'];
};

type ExpandableChipListProps = {
  items: ExpandableChipItem[];
  maxVisible?: number;
  chipColor?: ChipProps['color'];
  chipSize?: ChipProps['size'];
  expandLabel?: (hiddenCount: number) => string;
};

export function ExpandableChipList({
  items,
  maxVisible = 2,
  chipColor,
  chipSize = 'small',
  expandLabel,
}: ExpandableChipListProps) {
  const [expanded, setExpanded] = React.useState(false);

  if (!items?.length) return null;

  const hiddenCount = Math.max(0, items.length - maxVisible);
  const showAll = expanded || hiddenCount === 0;
  const visibleItems = showAll ? items : items.slice(0, maxVisible);

  const handleExpand = (event: React.MouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setExpanded(true);
  };

  return (
    <>
      {visibleItems.map((item) => (
        <Chip key={item.key} size={chipSize} label={item.label} color={item.color ?? chipColor} />
      ))}
      {!showAll && (
        <Chip
          size={chipSize}
          label={expandLabel ? expandLabel(hiddenCount) : `+${hiddenCount} more`}
          variant="outlined"
          clickable
          onClick={handleExpand}
        />
      )}
    </>
  );
}
