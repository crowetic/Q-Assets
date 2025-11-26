import { useMemo, useState, MouseEvent } from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Badge,
  Box,
  Button,
  Divider,
  IconButton,
  List,
  ListItem,
  ListItemText,
  Popover,
  Stack,
  Tooltip,
  Typography,
  Chip,
} from '@mui/material';
import NotificationsNoneIcon from '@mui/icons-material/NotificationsNone';
import DoneAllIcon from '@mui/icons-material/DoneAll';
import CloseIcon from '@mui/icons-material/Close';
import { useNotifications } from './NotificationProvider';

const toPlain = (html?: string) =>
  (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const formatTs = (ts?: number) => {
  if (!ts) return '';
  try {
    return new Date(ts).toLocaleString();
  } catch {
    return '';
  }
};

const scopeLabel = (scope: string) => {
  if (!scope) return 'Global';
  if (scope === 'global') return 'Global';
  if (scope.startsWith('group:')) return `Group #${scope.slice(6)}`;
  if (scope.startsWith('asset:')) return `Asset #${scope.slice(6)}`;
  if (scope.startsWith('custom:')) return scope.slice(7);
  if (scope.startsWith('system')) return 'System';
  return scope;
};

const isInternalHref = (href: string) => href.startsWith('/') || href.startsWith('#');

export function NotificationBell() {
  const { state, markRead, dismiss, markAllRead } = useNotifications();
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);

  const items = useMemo(
    () =>
      Object.values(state.byKey)
        .filter((entry) => !entry.dismissed)
        .sort((a, b) => (b.notif.createdAt || 0) - (a.notif.createdAt || 0)),
    [state.byKey]
  );

  const unread = items.filter((entry) => !entry.read).length;
  const open = Boolean(anchorEl);

  const handleToggle = (event: MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => setAnchorEl(null);

  return (
    <>
      <Tooltip title="Notifications">
        <IconButton onClick={handleToggle} color={open ? 'primary' : 'default'} size="small">
          <Badge
            color="error"
            badgeContent={Math.min(unread, 99)}
            overlap="circular"
            invisible={!unread}
          >
            <NotificationsNoneIcon />
          </Badge>
        </IconButton>
      </Tooltip>

      <Popover
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
        transformOrigin={{ vertical: 'top', horizontal: 'right' }}
        slotProps={{ paper: { sx: { width: { xs: 300, sm: 360 }, maxWidth: '95vw', p: 1.5 } } }}
      >
        <Stack direction="row" spacing={1} alignItems="center" justifyContent="space-between">
          <Stack direction="row" spacing={1} alignItems="center">
            <Typography variant="subtitle1" fontWeight={700}>
              Notifications
            </Typography>
            {unread > 0 && (
              <Chip label={`${unread} new`} color="warning" size="small" variant="outlined" />
            )}
          </Stack>
          {items.length > 0 && (
            <Tooltip title="Mark all as read">
              <IconButton size="small" onClick={markAllRead}>
                <DoneAllIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
        </Stack>
        <Divider sx={{ my: 1 }} />
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            You're all caught up.
          </Typography>
        ) : (
          <List dense disablePadding sx={{ maxHeight: 360, overflowY: 'auto' }}>
            {items.map((entry) => {
              const summary = toPlain(entry.notif.bodyHtml);
              const snippet = summary.slice(0, 240);
              return (
                <ListItem
                  key={entry.key}
                  alignItems="flex-start"
                  disableGutters
                  sx={{
                    mb: 1,
                    px: 1,
                    py: 1,
                    borderRadius: 1.5,
                    border: '1px solid',
                    borderColor: entry.read ? 'divider' : 'primary.main',
                    bgcolor: entry.read ? 'action.hover' : 'background.paper',
                  }}
                >
                  <Stack spacing={0.75} sx={{ width: '100%' }}>
                    <Stack direction="row" spacing={1} alignItems="center">
                      <Typography variant="subtitle2" fontWeight={600} sx={{ flex: 1 }}>
                        {entry.notif.title}
                      </Typography>
                      <Chip size="small" label={scopeLabel(entry.scope)} />
                      <IconButton size="small" onClick={() => dismiss(entry.key)}>
                        <CloseIcon fontSize="small" />
                      </IconButton>
                    </Stack>
                    <ListItemText
                      primary={null}
                      secondary={
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{ display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}
                        >
                          {snippet}
                          {summary.length > 240 ? '…' : ''}
                        </Typography>
                      }
                    />
                    <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
                      <Typography variant="caption" color="text.secondary">
                        {formatTs(entry.notif.createdAt)}
                      </Typography>
                      {!entry.read && (
                        <Button size="small" onClick={() => markRead(entry.key)}>
                          Mark read
                        </Button>
                      )}
                      {entry.notif.links?.map((link) => {
                        const internal = isInternalHref(link.href);
                        const commonProps = internal
                          ? { component: RouterLink, to: link.href, onClick: handleClose }
                          : {
                              component: 'a',
                              href: link.href,
                              target: '_blank',
                              rel: 'noreferrer',
                            };
                        return (
                          <Button key={link.href} size="small" {...commonProps}>
                            {link.label}
                          </Button>
                        );
                      })}
                    </Stack>
                  </Stack>
                </ListItem>
              );
            })}
          </List>
        )}
      </Popover>
    </>
  );
}
