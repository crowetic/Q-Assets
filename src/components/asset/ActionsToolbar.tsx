import { useState, useMemo } from 'react';
import { Stack, Divider } from '@mui/material';
import { useLocation, useNavigate } from 'react-router-dom';
import OrbitronButton from '../buttons/OrbitronButton';

export interface ActionsToolbarProps {
  assetId: number;
  assetName: string;
  primaryGroup?: { id?: string; joinLink?: string };
  onOpenComment?: () => void;
  onOpenUpvotes?: () => void;
  showAssetData?: boolean;
}

export default function ActionsToolbar({
  assetId,
  assetName,
  primaryGroup,
  onOpenComment,
  onOpenUpvotes,
  showAssetData = true,
}: ActionsToolbarProps) {
  const navigate = useNavigate();

  const [joining, setJoining] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);

  const { pathname } = useLocation();

  // Normalize to a numeric groupId if possible (e.g. "691" -> 691)
  const groupIdNum = useMemo(() => {
    if (!primaryGroup?.id) return null;
    const n = Number(primaryGroup.id);
    return Number.isFinite(n) && n > 0 ? Math.floor(n) : null;
  }, [primaryGroup?.id]);

  const handleJoinPrimaryGroup = async () => {
    setJoinErr(null);
    if (!groupIdNum) {
      setJoinErr('No group id');
      return;
    }

    try {
      setJoining(true);
      await qortalRequest({ action: 'JOIN_GROUP', groupId: groupIdNum } as any);
      setJoined(true);
    } catch (e: any) {
      setJoinErr(e?.message || 'Join failed');
      setJoined(false);
    } finally {
      setJoining(false);
    }
  };

  const tradePage = pathname.includes('/trade');

  const dataPage = pathname.startsWith('/assetdata');

  const assetDetailsPage = pathname.startsWith('/assetexplorer') || pathname.startsWith('/assets');

  const handleOpenAssetData = () => {
    navigate(`/assetdata/${assetId}`);
  };

  const fullWidthStyle = { width: { xs: '100%', sm: 'auto' }, minWidth: { sm: '12rem' } } as const;

  const joinActive = joined || joining || !!joinErr;

  const joinLabel = joined
    ? 'Joined ✓'
    : joining
      ? 'Joining…'
      : joinErr
        ? 'Join Failed'
        : groupIdNum
          ? 'Join Primary Asset Group'
          : 'No Asset Group Found';

  return (
    <>
      <Divider sx={{ mt: '0.25rem', mb: '0.25rem', opacity: 0.3 }} />
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        justifyContent="space-around"
        useFlexGap
        flexWrap="wrap"
        sx={{
          width: '100%',
          columnGap: { sm: '0.75rem' },
          rowGap: { xs: '0.1rem', sm: '0.25rem' },
        }}
      >
        {!tradePage && (
          <OrbitronButton
            variant="outlined"
            size="small"
            onClick={() => navigate(`/trade/${assetId}`)}
            sx={fullWidthStyle}
          >
            Trade {assetName}
          </OrbitronButton>
        )}

        {primaryGroup && (
          <OrbitronButton
            variant="outlined"
            size="small"
            onClick={handleJoinPrimaryGroup}
            disabled={joining || joined}
            active={joinActive}
            sx={fullWidthStyle}
          >
            {joinLabel}
          </OrbitronButton>
        )}

        {!assetDetailsPage && (
          <OrbitronButton
            variant="outlined"
            size="small"
            onClick={() => navigate(`/assetexplorer/${assetId}`)}
            sx={fullWidthStyle}
          >
            View Asset Details
          </OrbitronButton>
        )}

        {showAssetData && !dataPage && (
          <OrbitronButton
            variant="outlined"
            size="small"
            onClick={handleOpenAssetData}
            sx={fullWidthStyle}
          >
            Asset Data
          </OrbitronButton>
        )}

        {primaryGroup && onOpenComment && (
          <OrbitronButton
            variant="outlined"
            size="small"
            onClick={onOpenComment}
            sx={fullWidthStyle}
          >
            Asset-Comments
          </OrbitronButton>
        )}

        {primaryGroup && onOpenUpvotes && (
          <OrbitronButton
            variant="outlined"
            size="small"
            onClick={onOpenUpvotes}
            disabled
            sx={fullWidthStyle}
          >
            Upvotes (Coming Soon)
          </OrbitronButton>
        )}
      </Stack>
    </>
  );
}
