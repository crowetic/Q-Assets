import { Box, Stack, Typography, Button, Paper } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';

export default function ManageHome() {
  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: '85%' }}>
      <Typography variant="h4" sx={{ mb: 2, lineHeight: 1.15 }}>
        Management
      </Typography>

      <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 2 }, mb: 2 }}>
        <Typography variant="h6" sx={{ mb: 1 }}>
          Dividends
        </Typography>
        <Typography variant="body2" sx={{ opacity: 0.8, mb: 1.5 }}>
          Distribute payouts to asset holders. Supports holder snapshots and filtered distributions.
        </Typography>
        <Stack direction="row" spacing={1}>
          <Button component={RouterLink} to="/manage/dividends" variant="contained">
            Open Dividends
          </Button>
        </Stack>
      </Paper>

      {/* Future tiles go here */}
      <Paper variant="outlined" sx={{ p: { xs: 1.25, sm: 2 } }}>
        <Typography variant="subtitle2" sx={{ opacity: 0.7 }}>
          More management tools coming soon…
        </Typography>
      </Paper>
    </Box>
  );
}
