import { useEffect, useMemo, useState } from 'react';
import { Box, Button, Typography, useTheme } from '@mui/material';
import { useAuth } from 'qapp-core';
import { useMemberGroupIds } from '../hooks/useMemberGroupIds';
import { NOTIF_GROUP_ID } from '../notifications/notifyIndex';

const DISMISS_KEY = 'qassets:notifications:join-dismissed';

export default function NotificationsJoinPrompt() {
  const theme = useTheme();
  const { address } = useAuth();
  const { memberGroupIds, loading } = useMemberGroupIds();
  const [dismissed, setDismissed] = useState(false);
  const [joining, setJoining] = useState(false);
  const [joined, setJoined] = useState(false);
  const [joinErr, setJoinErr] = useState<string | null>(null);

  useEffect(() => {
    const stored = localStorage.getItem(DISMISS_KEY);
    if (stored === '1') setDismissed(true);
  }, []);

  const isMember = useMemo(() => memberGroupIds.includes(NOTIF_GROUP_ID), [memberGroupIds]);

  const shouldShow = Boolean(address) && !loading && !dismissed && !joined && !isMember;

  const handleDismiss = () => {
    localStorage.setItem(DISMISS_KEY, '1');
    setDismissed(true);
  };

  const handleJoin = async () => {
    setJoinErr(null);
    try {
      setJoining(true);
      await qortalRequest({ action: 'JOIN_GROUP', groupId: NOTIF_GROUP_ID } as any);
      setJoined(true);
    } catch (e: any) {
      setJoinErr(e?.message || 'Join failed');
    } finally {
      setJoining(false);
    }
  };

  if (!shouldShow) return null;

  return (
    <Box
      sx={{
        px: { xs: 2, md: 3 },
        py: 1.5,
        display: 'flex',
        justifyContent: 'center',
        background: `linear-gradient(90deg, ${theme.palette.primary.light}, ${theme.palette.primary.main})`,
        color: theme.palette.primary.contrastText,
      }}
    >
      <Box
        sx={{
          width: '100%',
          maxWidth: 980,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 1.5,
          flexWrap: 'wrap',
          textAlign: 'center',
        }}
      >
        <Typography variant="body2" sx={{ fontWeight: 600 }}>
          Want Q-Assets notifications?
        </Typography>
        <Button
          variant="contained"
          size="small"
          onClick={handleJoin}
          disabled={joining}
          sx={{ fontWeight: 700 }}
        >
          {joining ? 'Joining...' : 'Join notifications group'}
        </Button>
        <Button variant="text" size="small" onClick={handleDismiss} sx={{ color: 'inherit' }}>
          No thanks!
        </Button>
        {joinErr && (
          <Typography variant="caption" sx={{ color: theme.palette.warning.contrastText }}>
            {joinErr}
          </Typography>
        )}
      </Box>
    </Box>
  );
}
