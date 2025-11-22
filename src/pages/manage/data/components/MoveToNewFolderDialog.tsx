import { useEffect, useMemo, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button, Stack, TextField, Alert, Typography } from '@mui/material';
import { normalizePathSegments } from '../../../../utils/qdnResourceUtils';

type MoveToNewFolderDialogProps = {
  open: boolean;
  basePath: string;
  selectionCount: number;
  error: string | null;
  onClose: () => void;
  onSubmit: (folderName: string) => void;
};

export function MoveToNewFolderDialog({
  open,
  basePath,
  selectionCount,
  error,
  onClose,
  onSubmit,
}: MoveToNewFolderDialogProps) {
  const [folderName, setFolderName] = useState('');

  useEffect(() => {
    if (open) {
      setFolderName('');
    }
  }, [open, basePath]);

  const displayPath = useMemo(() => `/${normalizePathSegments(basePath).join('/')}`, [basePath]);

  const handleSubmit = () => {
    onSubmit(folderName);
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Move to new folder</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {selectionCount} item{selectionCount === 1 ? '' : 's'} will move into a new folder under
            {' '}
            <strong>{displayPath || '/'}</strong>.
          </Typography>
          <TextField
            label="New folder name"
            fullWidth
            value={folderName}
            onChange={(event) => setFolderName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSubmit();
              }
            }}
            helperText="Creates a folder locally and moves the selected files into it."
          />
          {error && <Alert severity="warning">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit}>
          Move
        </Button>
      </DialogActions>
    </Dialog>
  );
}
