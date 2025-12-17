import { useEffect, useMemo, useState } from 'react';
import type { Service } from 'qapp-core';
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  MenuItem,
  Stack,
  Switch,
  TextField,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material';
import type { GroupSummary } from '../../../../utils/qortalApi';
import { ALL_QDN_SERVICES } from '../constants';
import { formatBytes } from '../viewHelpers';
import { getServiceLimit } from '../../../../utils/useQdnBatchPublisher';
import { MAX_INLINE_FILE_SIZE, CHUNK_FORCED_THRESHOLD } from '../../../../utils/fileChunking';

export type PublishFormState = {
  service: Service;
  identifier: string;
  folderPath: string;
  title: string;
  description: string;
  structured: boolean;
};

export type PublishSubmitPayload = {
  form: PublishFormState;
  files: File[];
  encryptionMode: 'none' | 'group' | 'direct';
  groupId: number | null;
  groupAdminsOnly: boolean;
  directRecipients: string;
  chunkedPublishing: boolean;
};

type PublishDialogProps = {
  open: boolean;
  variant: 'single' | 'multiple';
  defaults: PublishFormState;
  publishing: boolean;
  status: string | null;
  groups: GroupSummary[];
  groupsLoading: boolean;
  onClose: () => void;
  onSubmit: (payload: PublishSubmitPayload) => void;
  onStatusChange: (value: string | null) => void;
};

export function PublishDialog({
  open,
  variant,
  defaults,
  publishing,
  status,
  groups,
  groupsLoading,
  onClose,
  onSubmit,
  onStatusChange,
}: PublishDialogProps) {
  const [form, setForm] = useState<PublishFormState>(defaults);
  const [files, setFiles] = useState<File[]>([]);
  const [encryptionMode, setEncryptionMode] = useState<'none' | 'group' | 'direct'>('none');
  const [groupId, setGroupId] = useState<number | null>(null);
  const [groupAdminsOnly, setGroupAdminsOnly] = useState(false);
  const [directRecipients, setDirectRecipients] = useState('');
  const [chunkedPublishing, setChunkedPublishing] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(defaults);
    setFiles([]);
    setEncryptionMode('none');
    setGroupId(null);
    setGroupAdminsOnly(false);
    setDirectRecipients('');
    setChunkedPublishing(false);
    onStatusChange(null);
  }, [defaults, open, onStatusChange]);

  const publishServiceLimitLabel = useMemo(
    () => formatBytes(getServiceLimit(form.service)),
    [form.service]
  );

  const hasOptionalChunkable = files.some((file) => file.size > MAX_INLINE_FILE_SIZE);
  const hasForcedChunking = files.some((file) => file.size > CHUNK_FORCED_THRESHOLD);

  useEffect(() => {
    if (hasForcedChunking) {
      setChunkedPublishing(true);
    }
  }, [hasForcedChunking]);

  useEffect(() => {
    if (chunkedPublishing && encryptionMode !== 'group') {
      setEncryptionMode('group');
    }
  }, [chunkedPublishing, encryptionMode]);

  useEffect(() => {
    if (encryptionMode === 'none' && chunkedPublishing) {
      setChunkedPublishing(false);
    }
  }, [encryptionMode, chunkedPublishing]);

  const handleSelectFiles = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFiles = Array.from(event.target.files ?? []);
    setFiles(nextFiles);
    event.target.value = '';
  };

  const handleSubmit = () => {
    onSubmit({
      form,
      files,
      encryptionMode,
      groupId,
      groupAdminsOnly,
      directRecipients,
      chunkedPublishing,
    });
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="sm">
      <DialogTitle>
        {variant === 'single' ? 'Publish resource' : 'Publish multiple resources'}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <TextField
            select
            label="Service"
            value={form.service}
            onChange={(event) =>
              setForm((prev) => ({ ...prev, service: event.target.value as Service }))
            }
            fullWidth
          >
            {ALL_QDN_SERVICES.map((option) => (
              <MenuItem key={option} value={option}>
                {option}
              </MenuItem>
            ))}
          </TextField>
          <Typography variant="caption" color="text.secondary">
            Publish limit for {form.service}: {publishServiceLimitLabel}
          </Typography>

          <TextField
            label="Identifier (optional)"
            fullWidth
            value={form.identifier}
            onChange={(event) => setForm((prev) => ({ ...prev, identifier: event.target.value }))}
            helperText="Leave blank to auto-generate."
          />

          <FormControlLabel
            control={
              <Switch
                checked={form.structured}
                onChange={(_event, checked) =>
                  setForm((prev) => ({ ...prev, structured: checked }))
                }
              />
            }
            label="Track inside Q-Assets file workspace"
          />

          {form.structured && (
            <TextField
              label="Folder path"
              fullWidth
              value={form.folderPath}
              onChange={(event) => setForm((prev) => ({ ...prev, folderPath: event.target.value }))}
              helperText="Use / to create nested folders, e.g. docs/reports"
            />
          )}

          <TextField
            label="Title (optional)"
            fullWidth
            value={form.title}
            onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
          />
          <TextField
            label="Description (optional)"
            fullWidth
            value={form.description}
            onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
            multiline
            minRows={2}
          />

          <Typography variant="subtitle2">Encryption</Typography>
          <ToggleButtonGroup
            size="small"
            exclusive
            value={encryptionMode}
            onChange={(_event, value) => value && setEncryptionMode(value)}
          >
            <ToggleButton value="none" disabled={chunkedPublishing}>
              None
            </ToggleButton>
            <ToggleButton value="group">Group</ToggleButton>
            <ToggleButton value="direct" disabled={chunkedPublishing}>
              Direct
            </ToggleButton>
          </ToggleButtonGroup>
          {encryptionMode === 'group' && (
            <>
              <TextField
                select
                label="Select private group"
                value={groupId ?? ''}
                onChange={(event) => setGroupId(Number(event.target.value) || null)}
                helperText={
                  groupsLoading
                    ? 'Loading groups…'
                    : 'Only groups where you have keys can receive encrypted resources.'
                }
              >
                {groups
                  .filter((g) => !g.isOpen)
                  .map((g) => (
                    <MenuItem key={g.groupId} value={g.groupId}>
                      {g.groupName} (#{g.groupId})
                    </MenuItem>
                  ))}
                {!groups.length && <MenuItem value="">No groups found</MenuItem>}
              </TextField>
              <FormControlLabel
                control={
                  <Switch
                    checked={groupAdminsOnly}
                    onChange={(_event, checked) => setGroupAdminsOnly(checked)}
                  />
                }
                label="Admins only"
              />
            </>
          )}
          {encryptionMode === 'direct' && (
            <TextField
              label="Recipients (comma separated names or addresses)"
              fullWidth
              value={directRecipients}
              onChange={(event) => setDirectRecipients(event.target.value)}
              helperText="Direct encryption will use resolved public keys for the listed recipients."
              disabled={chunkedPublishing}
            />
          )}

          {encryptionMode !== 'none' && hasOptionalChunkable && (
            <FormControlLabel
              control={
                <Switch
                  checked={chunkedPublishing}
                  onChange={(_event, checked) => setChunkedPublishing(checked)}
                  disabled={hasForcedChunking}
                />
              }
              label={
                hasForcedChunking
                  ? 'Chunked upload required for files over 100MB'
                  : 'Use chunked publishing for large files'
              }
            />
          )}
          {chunkedPublishing && !groupId && (
            <Typography variant="caption" color="warning.main">
              Chunked publishing requires a private group and group encryption.
            </Typography>
          )}

          <Button variant="outlined" component="label">
            {files.length ? 'Replace selection' : 'Select files'}
            <input
              type="file"
              hidden
              multiple={variant === 'multiple'}
              onChange={handleSelectFiles}
            />
          </Button>
          {files.length > 0 && (
            <Stack spacing={0.5}>
              {files.map((file) => (
                <Typography key={`${file.name}-${file.lastModified}`} variant="body2">
                  {file.name} • {formatBytes(file.size)}
                </Typography>
              ))}
            </Stack>
          )}

          {publishing && <LinearProgress />}
          {status && <Alert severity="warning">{status}</Alert>}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={publishing}>
          Cancel
        </Button>
        <Button variant="contained" onClick={handleSubmit} disabled={publishing}>
          {publishing ? 'Publishing…' : 'Publish'}
        </Button>
      </DialogActions>
    </Dialog>
  );
}
