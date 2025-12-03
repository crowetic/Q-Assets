import { useEffect, useState } from 'react';
import type { KeyboardEvent } from 'react';
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
import type { StructuredEntry } from '../DataExplorer.types';

type EditManifestDialogProps = {
  open: boolean;
  entry: StructuredEntry | null;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: { folderPath: string; fileName: string }) => void;
};

export function EditManifestDialog({
  open,
  entry,
  saving,
  error,
  onClose,
  onSubmit,
}: EditManifestDialogProps) {
  const [folderPath, setFolderPath] = useState('');
  const [fileName, setFileName] = useState('');

  useEffect(() => {
    if (!open || !entry) {
      setFolderPath('');
      setFileName('');
      return;
    }
    setFolderPath(entry.folderSegments.join('/'));
    setFileName(entry.fileName);
  }, [entry, open]);

  const handleSubmit = () => {
    if (!entry) return;
    onSubmit({ folderPath, fileName });
  };

  const handleDialogClose = () => {
    if (saving) return;
    onClose();
  };

  const handleEnter = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      handleSubmit();
    }
  };

  return (
    <Dialog open={open} onClose={handleDialogClose} fullWidth maxWidth="sm">
      <DialogTitle>Rename manifest entry</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            label="Folder path"
            fullWidth
            value={folderPath}
            onChange={(event) => setFolderPath(event.target.value)}
            helperText="Adjust folder structure (use / for nesting)"
          />
          <TextField
            label="File name"
            fullWidth
            value={fileName}
            onChange={(event) => setFileName(event.target.value)}
            onKeyDown={handleEnter}
          />
          {error && <Alert severity="warning">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={handleDialogClose} disabled={saving}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={saving || !entry}>
          {saving ? 'Saving…' : 'Rename'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
