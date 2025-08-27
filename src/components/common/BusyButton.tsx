// src/components/common/BusyButton.tsx
import { Button, CircularProgress } from '@mui/material';
import type { ButtonProps } from '@mui/material';

export default function BusyButton({
  loading,
  children,
  ...btn
}: ButtonProps & { loading?: boolean }) {
  return (
    <Button
      disabled={btn.disabled || loading}
      {...btn}
      startIcon={loading ? <CircularProgress size="1rem" /> : btn.startIcon}
    >
      {children}
    </Button>
  );
}
