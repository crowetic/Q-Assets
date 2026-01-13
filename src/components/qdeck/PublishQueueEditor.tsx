import * as React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Stack,
  Typography,
  Chip,
  IconButton,
  Tooltip,
  Divider,
} from '@mui/material';
import DeleteOutlineIcon from '@mui/icons-material/DeleteOutline';
import type { BatchPublishResource } from '../../utils/useQdnBatchPublisher';
import { isPrivateService } from '../../utils/qdnServices';
import { useQDeck } from './QDeckProvider';

type Props = {
  open: boolean;
  onClose: () => void;
  boardId: string;
};

const estimateBase64Bytes = (data64?: string) => {
  if (!data64) return 0;
  const padding = data64.endsWith('==') ? 2 : data64.endsWith('=') ? 1 : 0;
  return Math.max(0, Math.floor((data64.length * 3) / 4) - padding);
};

const formatBytes = (value: number) => {
  if (!value) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  let current = value;
  let unit = 0;
  while (current >= 1024 && unit < units.length - 1) {
    current /= 1024;
    unit += 1;
  }
  return `${current.toFixed(current >= 100 ? 0 : current >= 10 ? 1 : 2)} ${units[unit]}`;
};

const publishQueueKey = (res: BatchPublishResource) =>
  `${res.service}::${(res.name || '').toLowerCase()}::${res.identifier}`;

export default function PublishQueueEditor({ open, onClose, boardId }: Props) {
  const { getPublishQueueForBoard, removePublishQueueItem, clearPublishQueue } = useQDeck();
  const queued = getPublishQueueForBoard(boardId);
  const totalBytes = React.useMemo(
    () => queued.reduce((sum, resource) => sum + estimateBase64Bytes(resource.base64), 0),
    [queued]
  );

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>Publish queue</DialogTitle>
      <DialogContent dividers>
        {queued.length ? (
          <Stack spacing={2}>
            <Typography variant="body2" color="text.secondary">
              {queued.length} queued item{queued.length === 1 ? '' : 's'} •{' '}
              {formatBytes(totalBytes)} total
            </Typography>
            <Stack spacing={1.5}>
              {queued.map((resource) => {
                const size = estimateBase64Bytes(resource.base64);
                const privateMode =
                  resource.privateMode === 'group'
                    ? 'Group'
                    : resource.privateMode === 'direct'
                      ? 'Direct'
                      : null;
                return (
                  <Box
                    key={publishQueueKey(resource)}
                    sx={{
                      border: (theme) => `1px solid ${theme.palette.divider}`,
                      borderRadius: 2,
                      p: 1.5,
                    }}
                  >
                    <Stack
                      direction={{ xs: 'column', sm: 'row' }}
                      spacing={2}
                      justifyContent="space-between"
                    >
                      <Stack spacing={0.75} sx={{ minWidth: 0, flex: 1 }}>
                        <Stack direction="row" spacing={1} flexWrap="wrap" alignItems="center">
                          <Chip
                            size="small"
                            label={resource.service}
                            color={isPrivateService(resource.service) ? 'warning' : 'default'}
                          />
                          {privateMode && <Chip size="small" label={`${privateMode} encrypt`} />}
                          {resource.groupId != null && (
                            <Chip size="small" label={`Group #${resource.groupId}`} />
                          )}
                          {resource.isAdmins && <Chip size="small" label="Admins only" />}
                        </Stack>
                        <Typography variant="subtitle2" sx={{ wordBreak: 'break-all' }}>
                          {resource.identifier}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          Publisher: {resource.name || 'unknown'}
                        </Typography>
                        {resource.title && (
                          <Typography variant="caption" color="text.secondary">
                            Title: {resource.title}
                          </Typography>
                        )}
                        {resource.filename && (
                          <Typography variant="caption" color="text.secondary">
                            File: {resource.filename}
                          </Typography>
                        )}
                      </Stack>
                      <Stack spacing={1} alignItems="flex-end">
                        <Typography variant="caption" color="text.secondary">
                          {formatBytes(size)}
                        </Typography>
                        <Tooltip title="Remove from queue">
                          <IconButton
                            size="small"
                            color="error"
                            onClick={() => removePublishQueueItem(boardId, resource)}
                          >
                            <DeleteOutlineIcon fontSize="small" />
                          </IconButton>
                        </Tooltip>
                      </Stack>
                    </Stack>
                  </Box>
                );
              })}
            </Stack>
          </Stack>
        ) : (
          <Typography variant="body2" color="text.secondary">
            No queued publishes for this board.
          </Typography>
        )}
        <Divider sx={{ my: 2 }} />
        <Typography variant="caption" color="text.secondary">
          Removing an item only affects the queued publish list; it does not revert any local
          changes you made in this session.
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Close</Button>
        <Button
          color="error"
          variant="outlined"
          onClick={() => clearPublishQueue(boardId)}
          disabled={!queued.length}
        >
          Clear all
        </Button>
      </DialogActions>
    </Dialog>
  );
}
