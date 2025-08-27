import { useState, useMemo } from 'react';
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

// qortalRequest is provided by Hub; declare for TS if not globally typed
// declare const qortalRequest: (args: unknown) => Promise<unknown>;

export default function ActionsToolbar({
  assetId,
  assetName,
  primaryGroup,
  onOpenComment,
  onOpenUpvotes,
  onOpenAssetData,
}: ActionsToolbarProps) {
  const navigate = useNavigate();

  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  // Normalize to a numeric groupId if possible (e.g. "691" -> 691)
  const groupIdNum = useMemo(() => {
    if (!primaryGroup?.id) return null;
    const n = Number(primaryGroup.id);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }, [primaryGroup?.id]);

  const handleJoinPrimaryGroup = async () => {
    setJoinErr(null);

    // If we don't have a numeric group id, fallback to previous behavior
    if (!groupIdNum) {
      if (primaryGroup?.joinLink) {
        window.open(primaryGroup.joinLink, '_blank');
        return;
      }
      if (primaryGroup?.id) {
        navigate(`/groups/${primaryGroup.id}`);
        return;
      }
      setJoinErr('No group id');
      return;
    }

    try {
      setJoining(true);
      await qortalRequest({
        action: 'JOIN_GROUP',
        groupId: groupIdNum,
      } as any);
      setJoined(true);
    } catch (e: any) {
      // Keep it blunt and visible on the button label
      const msg = e?.message || 'Join failed';
      setJoinErr(msg);
      setJoined(false);
    } finally {
      setJoining(false);
    }
  };

  const btnStyle = {
    width: { xs: '100%', sm: 'auto' },
    minWidth: { sm: '12rem' },
    padding: '0.25rem 0.5rem',
    fontSize: '0.8em',
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
          columnGap: { sm: '0.75rem' },
          rowGap: { xs: '0.5rem', sm: '0.75rem' },
        }}
      >
        <Button
          variant="outlined"
          size="small"
          onClick={() => navigate(`/trade/${assetId}`)}
          sx={btnStyle}
        >
          Trade {assetName}
        </Button>

        <Button
          variant="outlined"
          size="small"
          onClick={onOpenAssetData}
          disabled={true}
          sx={btnStyle}
        >
          Asset Data (Coming Soon)
        </Button>

        <Button
          variant="outlined"
          size="small"
          onClick={handleJoinPrimaryGroup}
          disabled={joining || joined || !primaryGroup}
          sx={btnStyle}
        >
          {joined
            ? 'Joined ✓'
            : joining
              ? 'Joining…'
              : joinErr
                ? `Join Failed`
                : groupIdNum
                  ? 'Join Primary Asset Group'
                  : 'Open Primary Asset Group'}
        </Button>

        {onOpenComment && (
          <Button variant="outlined" onClick={onOpenComment} sx={btnStyle}>
            Asset-Comments
          </Button>
        )}

        {onOpenUpvotes && (
          <Button variant="outlined" onClick={onOpenUpvotes} disabled={true} sx={btnStyle}>
            Upvotes (Coming Soon)
          </Button>
        )}
      </Stack>
    </>
  );
}
