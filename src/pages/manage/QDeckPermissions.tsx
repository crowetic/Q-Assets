import { Box, Typography } from '@mui/material';
import QDeckPermissionsPanel from '../../components/qdeck/QDeckPermissionsPanel';
import { SafeBoundary } from '../../components/common/SafeBoundary';

export default function QDeckPermissionsPage() {
  return (
    <Box sx={{ p: { xs: 1.5, md: 2 }, maxWidth: 1200, mx: 'auto' }}>
      <SafeBoundary
        fallback={
          <Typography color="text.secondary" variant="body2">
            Permissions panel is still loading. Please try again in a moment.
          </Typography>
        }
      >
        <QDeckPermissionsPanel />
      </SafeBoundary>
    </Box>
  );
}
