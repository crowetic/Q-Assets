// src/components/asset/ActionsToolbar.tsx
import { Stack, Button, Divider } from '@mui/material';
import { useNavigate } from 'react-router-dom';

export interface ActionsToolbarProps {
  assetId: number;
  assetName: string;
  primaryGroup?: { id?: string; joinLink?: string };
  onOpenComment?: () => void;
  onOpenUpvotes?: () => void;
  onOpenAssetData?: () => void;
}

export default function ActionsToolbar({
  assetId,
  assetName,
  primaryGroup,
  onOpenComment,
  onOpenUpvotes,
  onOpenAssetData,
}: ActionsToolbarProps) {
  const navigate = useNavigate();

  const btnStyle = {
    // Full width on mobile; auto on >=sm
    width: { xs: '100%', sm: 'auto' },
    // Reasonable min width on >=sm so they don’t scrunch
    minWidth: { sm: '12rem' },
    // Comfortable tap targets without px
    padding: '0.25rem 0.5rem',
    // Inherit font sizing from parent (keeps typography consistent)
    fontSize: '0.8em',
    // lineHeight: 1.2,
  } as const;

  return (
    <>
      <Divider sx={{ mt: '1rem', mb: '0.5rem', opacity: 0.3 }} />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        justifyContent={'space-around'}
        useFlexGap
        flexWrap="wrap"
        sx={{
          width: '100%',
          // gap in rem so row-wrap spacing is consistent
          columnGap: { sm: '0.75rem' },
          rowGap: { xs: '0.5rem', sm: '0.75rem' },
        }}
      >
        <Button variant="outlined" onClick={() => navigate(`/trade/${assetId}`)} sx={btnStyle}>
          Trade {assetName}
        </Button>

        <Button variant="outlined" onClick={onOpenAssetData} sx={btnStyle}>
          Asset Data
        </Button>

        <Button
          variant="outlined"
          disabled={!primaryGroup}
          onClick={() => {
            if (!primaryGroup) return;
            if (primaryGroup.joinLink) {
              window.open(primaryGroup.joinLink, '_blank'); // external
            } else if (primaryGroup.id) {
              navigate(`/groups/${primaryGroup.id}`); // internal
            }
          }}
          sx={btnStyle}
        >
          Join Primary Asset Group
        </Button>

        {onOpenComment && (
          <Button variant="outlined" onClick={onOpenComment} sx={btnStyle}>
            Comments
          </Button>
        )}

        {onOpenUpvotes && (
          <Button variant="outlined" onClick={onOpenUpvotes} sx={btnStyle}>
            Upvotes
          </Button>
        )}
      </Stack>
    </>
  );
}
