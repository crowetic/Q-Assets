import { Box, Typography, Paper, Stack } from '@mui/material';
import Grid from '@mui/material/Grid';
import { Link as RouterLink } from 'react-router-dom';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import FolderSpecialRoundedIcon from '@mui/icons-material/FolderSpecialRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';

type Tile = {
  title: string;
  description: string;
  to: string;
  icon: React.ReactNode;
  disabled?: boolean;
};

const tiles: Tile[] = [
  {
    title: 'Data Management',
    description: 'Publish, organize, and bulk-manage QDN data under your names.',
    to: '/manage/data',
    icon: <StorageRoundedIcon fontSize="inherit" />,
  },
  {
    title: 'Dividends',
    description: 'Distribute payouts to asset holders with snapshots & filters.',
    to: '/manage/dividends',
    icon: <PaymentsRoundedIcon fontSize="inherit" />,
  },
  {
    title: 'Asset Management',
    description: 'Avatars, groups, genesis posts, and issuer tools.',
    to: '/manage/assets',
    icon: <FolderSpecialRoundedIcon fontSize="inherit" />,
    disabled: true, // flip to false when ready / if already implemented
  },
  {
    title: 'Permissions / Roles',
    description: 'Admin/editor roles, group-based publishing rights.',
    to: '/manage/permissions',
    icon: <SecurityRoundedIcon fontSize="inherit" />,
    disabled: true,
  },
];

function TileCard({ t }: { t: Tile }) {
  const componentProps = t.disabled ? {} : { component: RouterLink, to: t.to };

  return (
    <Paper
      variant="outlined"
      {...componentProps}
      sx={{
        p: 2.5,
        borderRadius: 3,
        height: '100%',
        cursor: t.disabled ? 'not-allowed' : 'pointer',
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: 3,
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        '&:hover': t.disabled ? {} : { transform: 'scale(1.02)', boxShadow: 6 },
        '.MuiPaper-root:hover &': { opacity: 1, color: 'primary.light' },
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
      }}
    >
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, fontSize: 40 }}>
        <span
          style={{
            display: 'inline-flex',
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {t.icon}
        </span>
        <Typography variant="h6" sx={{ lineHeight: 1.1 }}>
          {t.title}
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.5 }}>
        {t.description}
      </Typography>

      {/* keep tiles visually square-ish on big screens */}
      <Box
        sx={{
          mt: 2,
          aspectRatio: '1.3 / 1',
          borderRadius: 2,
          bgcolor: 'action.hover',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          // big, responsive icon
          fontSize: { xs: 52, sm: 64, md: 72 },
          color: 'text.secondary',
          opacity: 0.75,
          transition: 'opacity 120ms ease',
          '.MuiPaper-root:hover &': { opacity: 0.95 },
        }}
        aria-hidden
      >
        {t.icon}
      </Box>
    </Paper>
  );
}

export default function ManageHome() {
  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: '1100px' }}>
      <Typography variant="h4" sx={{ mb: 2, lineHeight: 1.15 }}>
        Management
      </Typography>

      <Grid container spacing={2.5}>
        {tiles.map((t) => (
          <Grid key={t.title} size={{ xs: 12, sm: 6, md: 4 }}>
            <TileCard t={t} />
          </Grid>
        ))}
      </Grid>
    </Box>
  );
}
