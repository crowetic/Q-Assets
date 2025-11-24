import { useMemo } from 'react';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
} from '@mui/material';
import { normalizePathSegments } from '../../../../utils/qdnResourceUtils';

type CreateFolderDialogProps = {
  open: boolean;
  basePath: string;
  folderName: string;
  error: string | null;
  onClose: () => void;
  onChange: (value: string) => void;
  onSubmit: () => void;
};

export function CreateFolderDialog({
  open,
  basePath,
  folderName,
  error,
  onClose,
  onChange,
  onSubmit,
}: CreateFolderDialogProps) {
  const displayPath = useMemo(() => `/${normalizePathSegments(basePath).join('/')}`, [basePath]);

  const handleSubmit = () => {
    onSubmit();
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Create folder</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Base path"
            value={displayPath}
            InputProps={{ readOnly: true }}
            fullWidth
          />
          <TextField
            label="Folder name"
            fullWidth
            value={folderName}
            onChange={(event) => onChange(event.target.value)}
            helperText="Create one folder at a time."
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                handleSubmit();
              }
            }}
          />
          {error && <Alert severity="warning">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={handleSubmit}>
          Create
        </Button>
      </DialogActions>
    </Dialog>
  );
}
