import React from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Box,
  Typography,
} from '@mui/material';

function copy(text: string) {
  try {
    navigator.clipboard.writeText(text);
  } catch {}
}

export default function TxDetailsDialog({
  open,
  tx,
  onClose,
  title = 'Transaction Details',
}: {
  open: boolean;
  tx: any | null;
  onClose: () => void;
  title?: string;
}) {
  if (!tx) return null;
  const json = JSON.stringify(tx, null, 2);

  return (
    <Dialog open={open} onClose={onClose} maxWidth="md" fullWidth>
      <DialogTitle>{title}</DialogTitle>
      <DialogContent dividers>
        {/* Pretty key/value view */}
        <Box
          sx={{
            display: 'grid',
            gridTemplateColumns: 'auto 1fr',
            columnGap: 2,
            rowGap: 0.5,
            fontFamily: 'monospace',
            fontSize: 12,
            wordBreak: 'break-all',
          }}
        >
          {Object.entries(tx).map(([k, v]) => (
            <React.Fragment key={k}>
              <Typography color="text.secondary">{k}</Typography>
              <Box>{typeof v === 'object' ? JSON.stringify(v) : String(v)}</Box>
            </React.Fragment>
          ))}
        </Box>

        {/* Raw JSON (collapsible could be added later) */}
        <Box
          component="pre"
          sx={{
            mt: 2,
            p: 1,
            bgcolor: 'background.default',
            border: '1px solid',
            borderColor: 'divider',
            borderRadius: 1,
            maxHeight: 300,
            overflow: 'auto',
          }}
        >
          {json}
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => copy(json)}>Copy JSON</Button>
        <Button variant="contained" onClick={onClose} autoFocus>
          Close
        </Button>
      </DialogActions>
    </Dialog>
  );
}
