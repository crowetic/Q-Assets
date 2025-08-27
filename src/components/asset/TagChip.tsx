// src/components/asset/TagChip.tsx
import { Chip, ChipProps } from '@mui/material';

type RoleTag =
  | 'ASSET ISSUER'
  | 'PAG Admin'
  | 'M' // Minter member
  | 'MA' // Minter admin
  | 'D' // Dev member
  | 'DA'; // Dev admin

function tagChipProps(tag: RoleTag): Partial<ChipProps> {
  switch (tag) {
    case 'ASSET ISSUER':
      return { color: 'success', variant: 'filled' };
    case 'PAG Admin':
      return { color: 'warning', variant: 'filled' };
    case 'MA':
      return { color: 'primary', variant: 'filled' };
    case 'M':
      return { color: 'primary', variant: 'outlined' };
    case 'DA':
      return { color: 'secondary', variant: 'filled' };
    case 'D':
      return { color: 'secondary', variant: 'outlined' };
    default:
      return { color: 'default', variant: 'outlined' };
  }
}

export default function TagChip({ tag }: { tag: string }) {
  const props = tagChipProps(tag as RoleTag);
  return (
    <Chip
      label={tag}
      size="small"
      {...props}
      sx={{
        // Orbitron look
        fontFamily: '"Orbitron", system-ui, sans-serif',
        fontWeight: 700,
        letterSpacing: '0.04em',
        textTransform: 'uppercase',
        // compact / readable
        px: '0.4rem',
        height: '1.6rem',
        borderRadius: '0.6rem',
        ...props.sx,
      }}
    />
  );
}
