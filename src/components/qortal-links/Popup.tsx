// src/components/qortal-links/Popup.tsx
import { createPortal } from 'react-dom';
import { Box, IconButton } from '@mui/material';
import MinimizeIcon from '@mui/icons-material/Minimize';
import CloseIcon from '@mui/icons-material/Close';

type PopupProps = {
  src: string;
  onMinimize: () => void;
  onClose: () => void;
  title?: string;
};

export default function Popup({ src, onMinimize, onClose, title }: PopupProps) {
  const node = document.body;
  if (!node) return null;

  return createPortal(
    <div
      style={{
        position: 'fixed',
        left: '5vw',
        top: '5vh',
        width: '90vw',
        height: '90vh',
        zIndex: 2_147_483_000, // high enough to beat anything
        pointerEvents: 'auto',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexDirection: 'column',
          width: '100%',
          height: '100%',
          bgcolor: 'background.paper',
          border: (t) => `1px solid ${t.palette.divider}`,
          borderRadius: 2,
          boxShadow: 6,
          overflow: 'hidden',
        }}
      >
        {/* Titlebar */}
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            px: 1.5,
            py: 1,
            bgcolor: 'background.default',
            borderBottom: (t) => `1px solid ${t.palette.divider}`,
            userSelect: 'none',
          }}
        >
          <Box
            sx={{
              fontFamily: 'monospace',
              fontSize: 12,
              whiteSpace: 'nowrap',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              flex: 1,
            }}
            title={title || src}
          >
            {title || src}
          </Box>
          <IconButton size="small" onClick={onMinimize} aria-label="Minimize">
            <MinimizeIcon fontSize="small" />
          </IconButton>
          <IconButton size="small" onClick={onClose} aria-label="Close">
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>

        {/* Content */}
        <Box sx={{ flex: 1 }}>
          <iframe
            src={src}
            title={title || src}
            style={{ width: '100%', height: '100%', border: 0, display: 'block' }}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        </Box>
      </Box>
    </div>,
    node
  );
}
