import { Box, Typography } from '@mui/material';
import QDeckProjectPermissionsPanel from '../../components/qdeck/QDeckProjectPermissionsPanel';

export default function QDeckProjectPermissionsPage() {
  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: 1200 }}>
      <Typography variant="h5" sx={{ mb: 1 }}>
        Q-Deck Project Permissions
      </Typography>
      <QDeckProjectPermissionsPanel />
    </Box>
  );
}
