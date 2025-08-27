// src/components/common/Loading.tsx
import { Box, CircularProgress, Skeleton, Stack } from '@mui/material';

export function LoadingOverlay() {
  return (
    <Box
      sx={{
        position: 'relative',
        minHeight: '6rem',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        p: '1rem',
      }}
    >
      <CircularProgress size="2rem" />
    </Box>
  );
}

export function SkeletonComment() {
  return (
    <Stack direction="row" spacing={1.25} sx={{ p: '0.75rem' }}>
      <Skeleton variant="circular" width="2.5rem" height="2.5rem" />
      <Box sx={{ flex: 1 }}>
        <Skeleton variant="text" sx={{ fontSize: '0.9rem', width: '35%' }} />
        <Skeleton variant="text" sx={{ fontSize: '1rem', width: '80%' }} />
        <Skeleton variant="text" sx={{ fontSize: '1rem', width: '60%' }} />
      </Box>
    </Stack>
  );
}
