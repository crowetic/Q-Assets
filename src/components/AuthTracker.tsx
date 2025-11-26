import { useEffect, useMemo, useState } from 'react';
import { Box, CircularProgress, Stack, Tooltip, Typography, Button } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import { useTheme } from '@mui/material/styles';
import { getUserRoles, type UserRoles, userHasPermission } from '../utils/roles';
import {
  fetchPendingAnnouncementsDetailed,
  type PendingAnnouncementSummary,
} from '../utils/announcementApprovals';
import { fetchPendingPromotionRequests } from '../utils/promotions';

export function AuthTracker() {
  const theme = useTheme();
  const [roles, setRoles] = useState<UserRoles | null>(null);
  const [loadingRoles, setLoadingRoles] = useState(true);
  const [pendingAnnouncements, setPendingAnnouncements] = useState<
    PendingAnnouncementSummary[] | null
  >(null);
  const [pendingPromotions, setPendingPromotions] = useState<number | null>(null);
  const [pendingError, setPendingError] = useState<string | null>(null);

  const isAdmin = userHasPermission(roles, 'permissions.manage.manifest');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setLoadingRoles(true);
        const result = await getUserRoles();
        if (alive) setRoles(result);
      } finally {
        if (alive) setLoadingRoles(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!isAdmin) return;
    let alive = true;
    setPendingError(null);
    setPendingAnnouncements(null);
    setPendingPromotions(null);
    (async () => {
      try {
        const [ann, promos] = await Promise.all([
          fetchPendingAnnouncementsDetailed(5),
          fetchPendingPromotionRequests(200),
        ]);
        if (!alive) return;
        setPendingAnnouncements(ann);
        setPendingPromotions(promos.length);
      } catch (e: any) {
        if (!alive) return;
        setPendingError(e?.message || 'Unable to load pending items.');
      }
    })();
    return () => {
      alive = false;
    };
  }, [isAdmin]);

  const tooltipContent = useMemo(() => {
    if (!isAdmin) return '';
    if (pendingError) {
      return (
        <Typography variant="body2" color="error.main">
          {pendingError}
        </Typography>
      );
    }
    const pendingAnnouncementCount = pendingAnnouncements?.length ?? 0;
    const pendingPromotionCount = pendingPromotions ?? 0;
    return (
      <Box sx={{ maxWidth: 260 }}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600, mb: 0.5 }}>
          Admin overview
        </Typography>
        <Typography variant="body2" sx={{ mb: 1 }}>
          Pending announcements: {pendingAnnouncementCount}
        </Typography>
        {pendingAnnouncements?.slice(0, 3).map((item) => (
          <Typography
            variant="caption"
            color="text.secondary"
            key={item.identifier}
            display="block"
          >
            • {item.title} ({item.publisherName})
          </Typography>
        ))}
        <Typography variant="body2" sx={{ mt: 1 }}>
          Pending promotions: {pendingPromotionCount}
        </Typography>
        <Button
          component={RouterLink}
          to="/manage/admin"
          variant="text"
          size="small"
          sx={{ mt: 1, px: 0 }}
        >
          Open Admin Panel
        </Button>
      </Box>
    );
  }, [isAdmin, pendingAnnouncements, pendingPromotions, pendingError]);

  if (loadingRoles || !isAdmin) return null;

  const pendingTotal = (pendingAnnouncements?.length ?? 0) + (pendingPromotions ?? 0);
  const hasPendingInfo = pendingAnnouncements !== null || pendingPromotions !== null;

  const indicator = (
    <Box
      component={RouterLink}
      to="/manage/admin"
      sx={{
        width: 32,
        height: 32,
        borderRadius: '999px',
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        textDecoration: 'none',
        fontWeight: 700,
        color: theme.palette.getContrastText(theme.palette.success.main),
        backgroundColor: theme.palette.success.main,
        position: 'relative',
      }}
    >
      A
      {pendingTotal > 0 && (
        <Box
          component="span"
          sx={{
            position: 'absolute',
            top: -2,
            right: -2,
            width: 16,
            height: 16,
            borderRadius: '50%',
            backgroundColor: theme.palette.error.main,
            color: theme.palette.getContrastText(theme.palette.error.main),
            fontSize: 10,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {pendingTotal > 9 ? '9+' : pendingTotal}
        </Box>
      )}
    </Box>
  );

  return (
    <Tooltip
      title={
        hasPendingInfo ? (
          tooltipContent
        ) : (
          <Stack direction="row" spacing={1} alignItems="center">
            <CircularProgress size={16} />
            <Typography variant="caption">Loading admin data…</Typography>
          </Stack>
        )
      }
      arrow
      placement="bottom"
    >
      {indicator}
    </Tooltip>
  );
}
