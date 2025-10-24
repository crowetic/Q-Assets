import { memo, useEffect, useState } from 'react';
import { Dialog, DialogTitle, DialogContent, DialogActions, Button } from '@mui/material';
import TiptapEditor from '../TipTapEditor';
import { dialogPaperSx } from '../comments/CommentsSection';
import { useTheme, useMediaQuery } from '@mui/material';

type SectionEditorDialogProps = {
  open: boolean;
  initialHtml: string;
  onClose: () => void;
  onPublish: (html: string) => void;
  disabled?: boolean;
};

const SectionEditorDialog = memo(function SectionEditorDialog({
  open,
  initialHtml,
  onClose,
  onPublish,
  disabled,
}: SectionEditorDialogProps) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm'));

  // Local state only—prevents parent re-renders on each keystroke
  const [value, setValue] = useState(initialHtml);

  // Reset content each time the dialog is (re)opened
  useEffect(() => {
    if (open) setValue(initialHtml);
  }, [open, initialHtml]);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullScreen={isXs}
      fullWidth
      maxWidth={false}
      slotProps={{ paper: { sx: dialogPaperSx(isXs) } }}
    >
      <DialogTitle>Edit Section</DialogTitle>
      <DialogContent
        dividers
        sx={{ overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}
      >
        <TiptapEditor value={value} onChange={setValue} />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="contained" onClick={() => onPublish(value)} disabled={disabled}>
          Publish
        </Button>
      </DialogActions>
    </Dialog>
  );
});

export default SectionEditorDialog;
