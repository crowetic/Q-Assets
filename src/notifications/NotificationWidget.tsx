import { useMemo, useState } from 'react';
import { useNotifications } from './NotificationProvider';
import {
  Box,
  Paper,
  Typography,
  IconButton,
  Divider,
  Button,
  Tooltip,
  Stack,
  Chip,
} from '@mui/material';
import NotificationsActiveIcon from '@mui/icons-material/NotificationsActive';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import CloseIcon from '@mui/icons-material/Close';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

const formatTs = (ts?: number) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
};

const toPlain = (html?: string) =>
  (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const scopeLabel = (scope: string) => {
  if (!scope) return 'global';
  if (scope === 'global') return 'Global';
  if (scope.startsWith('group:')) return `Group #${scope.slice(6)}`;
  if (scope.startsWith('asset:')) return `Asset #${scope.slice(6)}`;
  if (scope.startsWith('system')) return 'System';
  if (scope.startsWith('custom:')) return scope.slice(7);
  return scope;
};

export function NotificationWidget() {
  const { state, markRead, dismiss, markAllRead } = useNotifications();
  const [open, setOpen] = useState(true);

  const items = useMemo(() => {
    return Object.values(state.byKey)
      .filter((n) => !n.dismissed)
      .sort((a, b) => (b.notif.createdAt || 0) - (a.notif.createdAt || 0));
  }, [state.byKey]);

  const unread = items.filter((it) => !it.read);
  if (!items.length) return null;

  return (
    <Box
      sx={{
        position: 'fixed',
        right: { xs: 8, md: '4%' },
        bottom: { xs: 16, md: '8%' },
        zIndex: 1300,
        maxWidth: { xs: '90%', md: 360 },
      }}
    >
      <Paper elevation={6} sx={{ borderRadius: 2, overflow: 'hidden', p: 1.5 }}>
        <Box display="flex" alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <NotificationsActiveIcon color={unread.length ? 'warning' : 'action'} />
            <Typography variant="subtitle1" fontWeight={700}>
              Notifications
            </Typography>
            {unread.length > 0 && (
              <Typography variant="body2" color="warning.main">
                {unread.length} new
              </Typography>
            )}
          </Stack>
          <Box display="flex" alignItems="center" gap={0.5}>
            <Tooltip title="Mark all as read">
              <IconButton size="small" onClick={markAllRead}>
                <DoneAllIcon fontSize="small" />
              </IconButton>
            </Tooltip>
            <IconButton size="small" onClick={() => setOpen((o) => !o)}>
              {open ? <ExpandMoreIcon /> : <ExpandLessIcon />}
            </IconButton>
          </Box>
        </Box>

        {open && (
          <>
            <Divider sx={{ my: 1 }} />
            <Box
              sx={{
                maxHeight: 320,
                overflowY: 'auto',
                display: 'flex',
                flexDirection: 'column',
                gap: 1,
              }}
            >
              {items.map((entry) => {
                const summary = toPlain(entry.notif.bodyHtml);
                const snippet = summary.slice(0, 240);
                return (
                  <Paper
                    key={entry.key}
                    variant="outlined"
                    sx={{
                      p: 1.25,
                      borderRadius: 1.5,
                      borderColor: entry.read ? 'divider' : 'primary.main',
                    }}
                  >
                    <Box display="flex" alignItems="center" justifyContent="space-between" gap={1}>
                      <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                        <Typography variant="subtitle2" fontWeight={600}>
                          {entry.notif.title}
                        </Typography>
                        <Chip label={scopeLabel(entry.scope)} size="small" />
                      </Stack>
                      <IconButton size="small" onClick={() => dismiss(entry.key)}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Box>
                    <Typography
                      variant="body2"
                      sx={{
                        mt: 0.5,
                        opacity: entry.read ? 0.7 : 1,
                      }}
                    >
                      {snippet}
                      {summary.length > 240 ? '…' : ''}
                    </Typography>
                    <Stack direction="row" spacing={1} sx={{ mt: 0.75 }} alignItems="center">
                      <Typography variant="caption" color="text.secondary">
                        {formatTs(entry.notif.createdAt)}
                      </Typography>
                      {!entry.read && (
                        <Button size="small" onClick={() => markRead(entry.key)}>
                          Mark read
                        </Button>
                      )}
                      {entry.notif.links?.map((link) => (
                        <Button
                          key={link.href}
                          size="small"
                          component="a"
                          href={link.href}
                          target="_blank"
                          rel="noreferrer"
                        >
                          {link.label}
                        </Button>
                      ))}
                    </Stack>
                  </Paper>
                );
              })}
            </Box>
          </>
        )}
      </Paper>
    </Box>
  );
}
