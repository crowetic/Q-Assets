import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Dialog,
  DialogTitle,
  DialogContent,
  IconButton,
  Box,
  Button,
  Portal,
  Typography,
} from '@mui/material';
import MinimizeIcon from '@mui/icons-material/Minimize';
import CloseIcon from '@mui/icons-material/Close';

import { arbitraryToRenderUrl, toAbsoluteHubUrl } from './renderUrl';
import { getBaseArbitraryUrl } from './qrLinkTools';

import { parseQortalHref } from './parseQortalHref';
import { hubOpenLink } from './qrLinkTools';
import { Service } from 'qapp-core';
import { useTheme } from '@mui/material';
import { buildInternal } from './buildInternalPath';
import { getHubOrigin } from './qortalEnv';
// import { installQortalBridgeClient, installQortalBridgeHost } from './bridgeHost';
import { Rnd } from 'react-rnd';
import OpenInFullIcon from '@mui/icons-material/OpenInFull';
import CloseFullscreenIcon from '@mui/icons-material/CloseFullscreen';
import Popup from './Popup';

type Ctx = { openQortalLink: (href: string) => Promise<void> };
const QortalLinkCtx = createContext<Ctx>({ openQortalLink: async () => {} });

export const useQortalLink = () => useContext(QortalLinkCtx);

const THIS_APP = 'Q-Assets';

export function QortalLinkProvider({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const [popupSrc, setPopupSrc] = useState<string | null>(null);

  const [minimized, setMinimized] = useState(false);
  const [wnd, setWnd] = useState({
    width: 900,
    height: 600,
    x: Math.max(20, (window.innerWidth - 900) / 2),
    y: Math.max(20, (window.innerHeight - 600) / 2),
  });
  const theme = useTheme();
  const hubOrigin = useMemo(() => getHubOrigin(), []);
  console.log('[link provider] hubOrigin', hubOrigin);

  const themeMode: 'light' | 'dark' = useMemo(
    () =>
      theme.palette
        .mode /*(window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light')*/,
    []
  );

  function clampWindowPos(prev: { width: number; height: number; x: number; y: number }) {
    const W = Math.max(320, window.innerWidth || document.documentElement.clientWidth || 0);
    const H = Math.max(240, window.innerHeight || document.documentElement.clientHeight || 0);
    const pad = 8;
    const width = Math.max(480, Math.min(prev.width, Math.floor(W * 0.9)));
    const height = Math.max(360, Math.min(prev.height, Math.floor(H * 0.9)));
    const x = Math.max(
      pad,
      Math.min(isFinite(prev.x) ? prev.x : Math.floor((W - width) / 2), W - width - pad)
    );
    const y = Math.max(
      pad,
      Math.min(isFinite(prev.y) ? prev.y : Math.floor((H - height) / 2), H - height - pad)
    );
    return { width, height, x, y };
  }

  const openQortalLink = useCallback(
    async (raw: string) => {
      const p = parseQortalHref(raw);
      console.log(p);
      if (!p) return;
      const isOurApp = p.service === 'APP' && p.name === THIS_APP;

      console.log('theme mode from link provider', themeMode);

      // const extSrc = renderUrlForQortalHref(p.raw, { theme: themeMode });
      // const extSrc = await resolveRenderUrl(extCands); // e.g. "/render/APP/Other/..."
      const internalPath = buildInternal(p);

      try {
        if (isOurApp && internalPath) {
          console.log('it is our app, nav internal', isOurApp);
          console.log('[openQortalLink] navigate internal', internalPath);
          navigate(internalPath);
          // setPopupSrc(internalPath);
          return;
        }
        const baseArb = await getBaseArbitraryUrl(p.service as Service, p.name, p.identifier);
        console.log('baseArbitraryUrl', baseArb);
        // 2) build /render URL for iframe (always open in popup)
        const pathToAppend = p.service === 'APP' || p.service === 'WEBSITE' ? p.path : undefined;
        const renderUrl = arbitraryToRenderUrl(baseArb, pathToAppend);
        const fullUrl = toAbsoluteHubUrl(hubOrigin, renderUrl);
        console.log('[openQortalLink] popup renderUrl', renderUrl);

        const clamped = clampWindowPos(wnd);
        setWnd(clamped);
        setMinimized(false);
        setPopupSrc(fullUrl);
      } catch (e) {
        console.warn('GET_QDN_RESOURCE_URL failed, falling back to Hub LINK_TO_QDN_RESOURCE', e);
        // As a last resort, let Hub open it natively (will change main view)
        await hubOpenLink(p.service, p.name, p.identifier, p.path);
      }
    },
    [navigate, hubOrigin, themeMode]
  );

  // useEffect(() => {
  //   const remove = installQortalBridgeHost();
  //   return () => remove();
  // }, []);

  useEffect(() => {
    const onResize = () => {
      setWnd((prev) => {
        const pad = 12;
        const maxX = Math.max(0, window.innerWidth - prev.width - pad);
        const maxY = Math.max(0, window.innerHeight - prev.height - pad);
        return {
          ...prev,
          x: Math.min(prev.x, maxX),
          y: Math.min(prev.y, maxY),
        };
      });
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    console.log('[QortalLinkProvider] mounted');
    (window as any)._openQ = openQortalLink; // <-- temp: manual trigger
    return () => console.log('[QortalLinkProvider] unmounted');
  }, [openQortalLink]);

  // optional: listen for custom events
  useEffect(() => {
    const onQdnOpen = (e: Event) => {
      const href = (e as CustomEvent).detail?.href as string | undefined;
      if (href?.startsWith('qortal://')) void openQortalLink(href);
    };
    window.addEventListener('qdn-open-link', onQdnOpen);
    return () => window.removeEventListener('qdn-open-link', onQdnOpen);
  }, [openQortalLink]);

  return (
    <QortalLinkCtx.Provider value={{ openQortalLink }}>
      {children}

      {popupSrc && !minimized && (
        <Popup
          src={popupSrc}
          title={popupSrc}
          onMinimize={() => setMinimized(true)}
          onClose={() => setPopupSrc(null)}
        />
      )}

      {popupSrc && minimized && (
        <Box
          sx={{
            position: 'fixed',
            right: 16,
            bottom: 16,
            zIndex: (t) => t.zIndex.modal + 1,
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            bgcolor: 'background.paper',
            border: (t) => `1px solid ${t.palette.divider}`,
            borderRadius: 2,
            p: 1,
            boxShadow: 3,
          }}
        >
          <Box
            sx={{
              fontFamily: 'monospace',
              fontSize: 12,
              maxWidth: '10rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {popupSrc}
          </Box>
          <Button size="small" variant="outlined" onClick={() => setMinimized(false)}>
            Restore
          </Button>
          <IconButton size="small" onClick={() => setPopupSrc(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}

      {popupSrc && minimized && (
        <Box
          sx={{
            position: 'fixed',
            left: 16,
            bottom: 16,
            zIndex: (t) => t.zIndex.modal + 1,
            display: 'flex',
            gap: 1,
            alignItems: 'center',
            bgcolor: 'background.paper',
            border: (t) => `1px solid ${t.palette.divider}`,
            borderRadius: 2,
            p: 1,
            boxShadow: 3,
          }}
        >
          <Box
            sx={{
              fontFamily: 'monospace',
              fontSize: 12,
              maxWidth: '10rem',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {popupSrc}
          </Box>
          <Button size="small" variant="outlined" onClick={() => setMinimized(false)}>
            Restore
          </Button>
          <IconButton size="small" onClick={() => setPopupSrc(null)}>
            <CloseIcon fontSize="small" />
          </IconButton>
        </Box>
      )}
    </QortalLinkCtx.Provider>
  );
}
