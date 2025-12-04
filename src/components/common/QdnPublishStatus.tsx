import { Box, Button, LinearProgress, Typography } from '@mui/material';
import type { PublishJobProgress, PublishJobStatus } from '../../utils/qdnProgressivePublisher';
import type { PublishThrottleState } from '../../hooks/useQdnProgressivePublisher';

type Props = {
  progress: PublishJobProgress | null;
  throttle: PublishThrottleState | null;
  contextLabel?: string;
};

const statusLabels: Record<PublishJobStatus, string> = {
  pending: 'Queued',
  publishing: 'Publishing',
  waiting: 'Waiting for network',
  completed: 'Completed',
  error: 'Error',
  cancelled: 'Cancelled',
};

function formatStatus(progress: PublishJobProgress | null) {
  if (!progress) return null;
  const label = statusLabels[progress.status];
  const total = progress.totalResources;
  const completed = progress.completedResources;
  const chunkLabel =
    progress.totalChunks > 1 ? `Chunk ${progress.chunkIndex + 1}/${progress.totalChunks}` : null;
  const resourceLabel = total ? `${completed}/${total} resources` : null;
  return [label, chunkLabel, resourceLabel].filter(Boolean).join(' · ');
}

export default function QdnPublishStatus({ progress, throttle, contextLabel }: Props) {
  const showProgress =
    progress && progress.status !== 'completed' && progress.status !== 'cancelled';

  if (!showProgress && !throttle) return null;

  const percent =
    progress && progress.totalResources > 0
      ? Math.min(100, Math.round((progress.completedResources / progress.totalResources) * 100))
      : undefined;

  return (
    <Box sx={{ display: 'grid', gap: 1 }}>
      {showProgress && (
        <Box
          sx={{
            p: 1,
            border: (t) => `1px solid ${t.palette.info.main}`,
            borderRadius: 1,
            bgcolor: (t) => t.palette.info.light,
            color: (t) => t.palette.getContrastText(t.palette.info.light),
          }}
        >
          <Typography variant="body2" fontWeight={700} gutterBottom>
            {contextLabel || 'Publishing'}
          </Typography>
          <LinearProgress
            variant={typeof percent === 'number' ? 'determinate' : 'indeterminate'}
            value={percent}
            sx={{ height: 8, borderRadius: 1, mb: 0.5 }}
          />
          <Typography variant="caption" component="div">
            {formatStatus(progress)}
          </Typography>
        </Box>
      )}
      {throttle && (
        <Box
          sx={{
            p: 1,
            border: (t) => `1px solid ${t.palette.warning.main}`,
            borderRadius: 1,
            bgcolor: (t) => t.palette.warning.light,
            color: (t) => t.palette.getContrastText(t.palette.warning.light),
          }}
        >
          <Typography variant="body2" fontWeight={700}>
            Network throttle detected
          </Typography>
          <Typography variant="body2">
            Too many unconfirmed transactions. Auto-resuming in {throttle.secondsLeft}s.
          </Typography>
          <Box sx={{ mt: 1, display: 'flex', gap: 1, flexWrap: 'wrap' }}>
            <Button size="small" variant="contained" color="warning" onClick={throttle.cancel}>
              Cancel publish
            </Button>
            <Button size="small" variant="outlined" onClick={throttle.resume}>
              Resume now
            </Button>
          </Box>
        </Box>
      )}
    </Box>
  );
}
