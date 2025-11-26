import { Box, Typography, Paper, Button, Stack } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import CloudUploadRoundedIcon from '@mui/icons-material/CloudUploadRounded';
import LibraryBooksRoundedIcon from '@mui/icons-material/LibraryBooksRounded';
import BackupTableRoundedIcon from '@mui/icons-material/BackupTableRounded';
import SchemaRoundedIcon from '@mui/icons-material/SchemaRounded';
import TravelExploreRoundedIcon from '@mui/icons-material/TravelExploreRounded';
import Inventory2RoundedIcon from '@mui/icons-material/Inventory2Rounded';

type Panel = {
  title: string;
  description: string;
  to: string; // use RELATIVE paths: 'my-data', 'publish', ...
  icon: React.ReactNode;
  disabled?: boolean;
};

const panels: Panel[] = [
  {
    title: 'My Published Data',
    description: 'Browse everything you have on QDN under all your names.',
    to: 'my-data',
    icon: <LibraryBooksRoundedIcon fontSize="inherit" />,
  },
  {
    title: 'Publish New Data',
    description: 'Single resource publishing with metadata templates.',
    to: 'publish',
    icon: <CloudUploadRoundedIcon fontSize="inherit" />,
    disabled: true,
  },
  {
    title: 'Bulk Publish',
    description: 'Queue folders / large files, show progress, resumable.',
    to: 'bulk',
    icon: <BackupTableRoundedIcon fontSize="inherit" />,
    disabled: true,
  },
  {
    title: 'Name-Based Asset Data',
    description: 'Publish and Create Name-Based Assets with QDN Data.',
    to: 'name-assets',
    icon: <SchemaRoundedIcon fontSize="inherit" />,
    disabled: true,
  },
  {
    title: 'Data Explorer',
    description: 'Filter by service/type; search identifiers & versions.',
    to: 'explorer',
    icon: <TravelExploreRoundedIcon fontSize="inherit" />,
  },
  {
    title: 'Archives / Deletions',
    description: 'Soft-delete, recover, version history management.',
    to: 'archives',
    icon: <Inventory2RoundedIcon fontSize="inherit" />,
    disabled: true,
  },
];

function BigPanel({ p }: { p: Panel }) {
  const componentProps = p.disabled ? {} : { component: RouterLink, to: p.to };

  return (
    // <RouterLink
    //   to={p.to}
    //   style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}
    //   aria-label={p.title}
    // >
    <Paper
      variant="outlined"
      {...componentProps}
      sx={{
        p: 3,
        borderRadius: 3,
        height: '100%',
        display: 'grid',
        cursor: p.disabled ? 'not-allowed' : 'pointer',
        textDecoration: 'none',
        gridTemplateRows: 'auto 1fr',
        boxShadow: 3,
        transition: 'transform 120ms ease, box-shadow 120ms ease',
        '&:hover': p.disabled ? {} : { transform: 'scale(1.02)', boxShadow: 6 },
        '.MuiPaper-root:hover &': { opacity: 1, color: 'primary.light' },
      }}
    >
      <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, fontSize: 44, mb: 1 }}>
        <span
          style={{
            width: 52,
            height: 52,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}
        >
          {p.icon}
        </span>
        <Typography variant="h6" sx={{ lineHeight: 1.1 }}>
          {p.title}
        </Typography>
      </Box>

      <Typography variant="body2" sx={{ opacity: 0.8 }}>
        {p.description}
      </Typography>

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
        {p.icon}
      </Box>
    </Paper>
    // </RouterLink>
  );
}

export default function DataManagement() {
  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: '1100px' }}>
      <Stack
        direction={{ xs: 'column', sm: 'row' }}
        spacing={1}
        alignItems={{ xs: 'flex-start', sm: 'center' }}
        justifyContent="space-between"
        sx={{ mb: 2 }}
      >
        <Box>
          <Typography variant="h4" sx={{ lineHeight: 1.15 }}>
            Data Management
          </Typography>
          <Typography variant="body2" color="text.secondary">
            Publish and organize everything tied to your Qortal names.
          </Typography>
        </Box>
        <Button component={RouterLink} to="/manage" variant="text">
          ← Back to Manage
        </Button>
      </Stack>

      <Box
        sx={{
          display: 'grid',
          gap: { xs: 2, sm: 2.5 },
          gridTemplateColumns: {
            xs: 'repeat(1, minmax(0, 1fr))',
            sm: 'repeat(auto-fit, minmax(260px, 1fr))',
          },
        }}
      >
        {panels.map((p) => (
          <BigPanel key={p.title} p={p} />
        ))}
      </Box>
    </Box>
  );
}
