import * as React from 'react';
import { Link as RouterLink } from 'react-router-dom';
import {
  Box,
  Stack,
  Typography,
  Paper,
  Button,
  Divider,
  Chip,
  useMediaQuery,
} from '@mui/material';
import { useTheme } from '@mui/material/styles';
import ViewKanbanIcon from '@mui/icons-material/ViewKanban';
import PublicIcon from '@mui/icons-material/Public';
import FolderIcon from '@mui/icons-material/Folder';
import CalendarMonthIcon from '@mui/icons-material/CalendarMonth';
import ListAltIcon from '@mui/icons-material/ListAlt';
import PublishIcon from '@mui/icons-material/Publish';
import LockIcon from '@mui/icons-material/Lock';

type LaunchCard = {
  title: string;
  description: string;
  to: string;
  icon: React.ReactElement;
  tone: 'primary' | 'success' | 'info';
};

const launchCards: LaunchCard[] = [
  {
    title: 'Projects',
    description: 'Group boards, link assets, and view schedules in a shared project calendar.',
    to: '/qdeck/projects',
    icon: <FolderIcon />,
    tone: 'success',
  },
  {
    title: 'My Boards',
    description: 'Your private and shared workspaces. Create boards, manage lists, and queue work.',
    to: '/qdeck/my',
    icon: <ViewKanbanIcon />,
    tone: 'primary',
  },
  {
    title: 'All Boards',
    description: 'Browse public boards across QDN and discover community workspaces.',
    to: '/qdeck/public',
    icon: <PublicIcon />,
    tone: 'info',
  },
];

const infoCards = [
  {
    title: 'Cards & Lists',
    description:
      'Cards are the tasks. Lists define stages (like In Progress or Done) and drive board flow.',
    icon: <ListAltIcon />,
  },
  {
    title: 'Schedules & Calendar',
    description:
      'Add start/end times to cards to surface them in board and project calendars.',
    icon: <CalendarMonthIcon />,
  },
  {
    title: 'Publish Queue',
    description:
      'Make several edits, then publish all queued changes together when you are ready.',
    icon: <PublishIcon />,
  },
  {
    title: 'Permissions',
    description:
      'Boards and projects can be public or private with per-name and per-group access rules.',
    icon: <LockIcon />,
  },
];

export default function QDeckLanding() {
  const theme = useTheme();
  const isTouch = useMediaQuery('(hover: none), (pointer: coarse)');

  return (
    <Box sx={{ display: 'grid', gap: 3 }}>
      <Box>
        <Typography variant="h4" sx={{ fontWeight: 700, mb: 0.5 }}>
          Q-Deck
        </Typography>
        <Typography variant="body1" sx={{ opacity: 0.8, maxWidth: 720 }}>
          A QDN-native project workspace for boards, cards, and calendars. Organize tasks, schedule
          work, and publish updates in batches when you are ready.
        </Typography>
        <Stack direction="row" spacing={1} sx={{ mt: 1.5 }} flexWrap="wrap">
          <Chip size="small" label="Boards" />
          <Chip size="small" label="Projects" />
          <Chip size="small" label="Cards" />
          <Chip size="small" label="Calendar" />
        </Stack>
      </Box>

      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          Jump In
        </Typography>
        <Stack spacing={1.5}>
          {launchCards.map((card) => (
            <Paper
              key={card.title}
              component={RouterLink}
              to={card.to}
              elevation={0}
              sx={{
                p: { xs: 1.75, sm: 2.25 },
                display: 'grid',
                gridTemplateColumns: { xs: '1fr', sm: 'auto 1fr auto' },
                gap: 1.5,
                alignItems: { xs: 'start', sm: 'center' },
                textDecoration: 'none',
                borderRadius: 2,
                border: `1px solid ${theme.palette.divider}`,
                background:
                  card.tone === 'primary'
                    ? 'linear-gradient(120deg, rgba(54,84,255,0.08), rgba(54,84,255,0))'
                    : card.tone === 'success'
                      ? 'linear-gradient(120deg, rgba(24,178,109,0.1), rgba(24,178,109,0))'
                      : 'linear-gradient(120deg, rgba(2,136,209,0.12), rgba(2,136,209,0))',
                transition: 'transform 140ms ease, box-shadow 140ms ease',
                cursor: 'pointer',
                ...(isTouch ? {} : { '&:hover': { transform: 'translateY(-2px)', boxShadow: 3 } }),
              }}
            >
              <Box
                sx={{
                  width: 44,
                  height: 44,
                  borderRadius: 2,
                  display: 'grid',
                  placeItems: 'center',
                  bgcolor: 'background.paper',
                  border: `1px solid ${theme.palette.divider}`,
                  color:
                    card.tone === 'success'
                      ? 'success.main'
                      : card.tone === 'info'
                        ? 'info.main'
                        : 'primary.main',
                }}
              >
                {card.icon}
              </Box>
              <Box sx={{ minWidth: 0 }}>
                <Typography variant="h6" sx={{ mb: 0.5 }}>
                  {card.title}
                </Typography>
                <Typography variant="body2" sx={{ opacity: 0.8 }}>
                  {card.description}
                </Typography>
              </Box>
              <Button
                variant="contained"
                color={card.tone === 'primary' ? 'primary' : card.tone === 'success' ? 'success' : 'info'}
                sx={{ alignSelf: { xs: 'start', sm: 'center' } }}
              >
                Open
              </Button>
            </Paper>
          ))}
        </Stack>
      </Stack>

      <Divider />

      <Stack spacing={1.5}>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          What is inside Q-Deck?
        </Typography>
        <Stack
          direction={{ xs: 'column', md: 'row' }}
          spacing={1.5}
          flexWrap="wrap"
          useFlexGap
        >
          {infoCards.map((card) => (
            <Paper
              key={card.title}
              variant="outlined"
              sx={{
                p: 2,
                minWidth: { xs: '100%', md: 240 },
                flex: '1 1 240px',
                display: 'grid',
                gap: 1,
                borderRadius: 2,
              }}
            >
              <Box sx={{ color: 'text.secondary' }}>{card.icon}</Box>
              <Typography variant="subtitle1">{card.title}</Typography>
              <Typography variant="body2" sx={{ opacity: 0.8 }}>
                {card.description}
              </Typography>
            </Paper>
          ))}
        </Stack>
      </Stack>
    </Box>
  );
}
