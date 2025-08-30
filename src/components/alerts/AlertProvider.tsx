// src/components/alerts/AlertProvider.tsx
import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Button,
  Typography,
  Box,
} from '@mui/material';
import WarningAmberIcon from '@mui/icons-material/WarningAmber';
import InfoIcon from '@mui/icons-material/Info';
import CheckCircleIcon from '@mui/icons-material/CheckCircle';
import ErrorOutlineIcon from '@mui/icons-material/ErrorOutline';

type Severity = 'info' | 'success' | 'warning' | 'error';

export type AlertOptions = {
  title?: string;
  message?: React.ReactNode; // allow rich content
  severity?: Severity;
  confirmText?: string; // for confirm()
  cancelText?: string; // for confirm()
  hideCancel?: boolean; // true for alert(); confirm() sets false
  disableBackdropClose?: boolean; // default false
  disableEscapeKeyDown?: boolean; // default false
};

type QueueItem =
  | { kind: 'alert'; opts: AlertOptions; resolve: () => void }
  | { kind: 'confirm'; opts: AlertOptions; resolve: (v: boolean) => void };

type AlertContextShape = {
  alert: (message: React.ReactNode, title?: string, opts?: Partial<AlertOptions>) => Promise<void>;
  confirm: (
    message: React.ReactNode,
    title?: string,
    opts?: Partial<AlertOptions>
  ) => Promise<boolean>;
};

const AlertContext = createContext<AlertContextShape | null>(null);

export function useAlert() {
  const ctx = useContext(AlertContext);
  if (!ctx) throw new Error('useAlert() must be used within <AlertProvider>');
  return ctx;
}

export const AlertProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const queueRef = useRef<QueueItem[]>([]);
  const [active, setActive] = useState<QueueItem | null>(null);

  const dequeue = useCallback(() => {
    const next = queueRef.current.shift() ?? null;
    setActive(next);
  }, []);

  const push = useCallback(
    (item: QueueItem) => {
      queueRef.current.push(item);
      if (!active) {
        // No active modal -> open immediately
        const next = queueRef.current.shift() ?? null;
        setActive(next);
      }
    },
    [active]
  );

  const closeActive = useCallback(() => {
    setActive(null);
    // small timeout to avoid focus jank between dialogs in the queue
    setTimeout(dequeue, 10);
  }, [dequeue]);

  const ctxVal = useMemo<AlertContextShape>(
    () => ({
      alert: (message, title, opts) =>
        new Promise<void>((resolve) => {
          push({
            kind: 'alert',
            resolve,
            opts: {
              title,
              message,
              hideCancel: true,
              severity: 'info',
              ...opts,
            },
          });
        }),
      confirm: (message, title, opts) =>
        new Promise<boolean>((resolve) => {
          push({
            kind: 'confirm',
            resolve,
            opts: {
              title,
              message,
              hideCancel: false,
              confirmText: 'OK',
              cancelText: 'Cancel',
              severity: 'warning',
              ...opts,
            },
          });
        }),
    }),
    [push]
  );

  // Render active dialog
  const opts = active?.opts;
  const severity = (opts?.severity ?? 'info') as Severity;

  const Icon = {
    info: InfoIcon,
    success: CheckCircleIcon,
    warning: WarningAmberIcon,
    error: ErrorOutlineIcon,
  }[severity];

  const paletteKey = {
    info: 'info',
    success: 'success',
    warning: 'warning',
    error: 'error',
  }[severity];

  const onPrimary = () => {
    if (!active) return;
    if (active.kind === 'alert') active.resolve();
    else active.resolve(true);
    closeActive();
  };

  const onCancel = () => {
    if (!active) return;
    if (active.kind === 'alert') active.resolve();
    else active.resolve(false);
    closeActive();
  };

  return (
    <AlertContext.Provider value={ctxVal}>
      {children}

      <Dialog
        open={!!active}
        onClose={(_, reason) => {
          // honor disable flags
          if (active?.opts?.disableBackdropClose && reason === 'backdropClick') return;
          if (active?.opts?.disableEscapeKeyDown && reason === 'escapeKeyDown') return;
          onCancel();
        }}
        fullWidth
        maxWidth="xs"
      >
        {opts && (
          <>
            <DialogTitle sx={{ display: 'flex', alignItems: 'center', gap: 1.25 }}>
              <Box
                sx={(theme) => ({
                  display: 'inline-flex',
                  borderRadius: '10px',
                  p: 0.75,
                  bgcolor: (theme.palette as any)[paletteKey]?.light ?? theme.palette.grey[200],
                  color: (theme.palette as any)[paletteKey]?.main ?? theme.palette.text.primary,
                })}
              >
                <Icon fontSize="small" />
              </Box>
              <Typography variant="h6" component="span">
                {opts.title ?? (active?.kind === 'confirm' ? 'Please confirm' : 'Notice')}
              </Typography>
            </DialogTitle>

            <DialogContent dividers>
              {typeof opts.message === 'string' ? (
                <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                  {opts.message}
                </Typography>
              ) : (
                opts.message
              )}
            </DialogContent>

            <DialogActions sx={{ px: 2, py: 1.25 }}>
              {!opts.hideCancel && (
                <Button onClick={onCancel}>{opts.cancelText ?? 'Cancel'}</Button>
              )}
              <Button
                variant="contained"
                onClick={onPrimary}
                autoFocus
                sx={{ color: { paletteKey } }}
              >
                {opts.confirmText ?? (active?.kind === 'confirm' ? 'OK' : 'Got it')}
              </Button>
            </DialogActions>
          </>
        )}
      </Dialog>
    </AlertContext.Provider>
  );
};
