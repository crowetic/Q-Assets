import { Box, Typography } from '@mui/material';
export default function BulkPublish() {
  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h5">My Published Data</Typography>
      <Typography variant="body2" sx={{ opacity: 0.8 }}>
        Coming next: list QDN resources under each of your names, with filters/actions.
      </Typography>
    </Box>
  );
}
