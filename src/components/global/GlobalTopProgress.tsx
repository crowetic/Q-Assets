import { Backdrop, Box, CircularProgress, Fade, LinearProgress } from '@mui/material';
import { useFetchTracker } from '../../state/global/fetchTracker';

export function GlobalBackdrop({ prefix = 'blocking:' }: { prefix?: string }) {
  const { isLoadingPrefix } = useFetchTracker();
  const show = isLoadingPrefix(prefix);
  return (
    <Backdrop open={show} sx={{ zIndex: (t) => t.zIndex.modal + 1 }}>
      <CircularProgress />
    </Backdrop>
  );
}

export default function GlobalTopProgress() {
  const { activeCount } = useFetchTracker();
  const show = activeCount > 0;

  return (
    <Fade in={show} unmountOnExit>
      <Box
        sx={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          height: 3,
          zIndex: (t) => t.zIndex.tooltip + 2,
        }}
      >
        <LinearProgress />
      </Box>
    </Fade>
  );
}
