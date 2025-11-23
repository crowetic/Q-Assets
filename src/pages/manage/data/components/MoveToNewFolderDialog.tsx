import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Stack,
  TextField,
  Typography,
  Autocomplete,
} from '@mui/material';

export type MoveToNewFolderDialogProps = {
  open: boolean;
  entriesCount: number;
  folderOptions: string[];
  folderPath: string;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: () => void;
  onFolderChange: (value: string) => void;
};

export function MoveToNewFolderDialog({
  open,
  entriesCount,
  folderOptions,
  folderPath,
  saving,
  error,
  onClose,
  onSubmit,
  onFolderChange,
}: MoveToNewFolderDialogProps) {
  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>Move files</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            Move {entriesCount} structured file{entriesCount === 1 ? '' : 's'} to a different folder
            path.
          </Typography>
          <Autocomplete
            freeSolo
            selectOnFocus
            clearOnBlur
            handleHomeEndKeys
            options={folderOptions}
            value={folderPath}
            onInputChange={(_event, value) => onFolderChange(value)}
            renderInput={(params) => (
              <TextField
                {...params}
                label="Destination folder"
                helperText="Select an existing folder or type a new folder path (root is '/')."
              />
            )}
          />
          {saving && <LinearProgress />}
          {error && <Alert severity="warning">{error}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button onClick={onSubmit} variant="contained" disabled={saving}>
          {saving ? 'Moving…' : 'Move'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}

export default MoveToNewFolderDialog;
