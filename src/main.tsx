import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ThemeProviderWrapper from './styles/theme/theme-provider.tsx';
import './index.css';
import './i18n/i18n.ts';
import { Routes } from './routes/Routes.tsx';
import { FetchTrackerProvider } from './state/global/fetchTracker';
import GlobalTopProgress from './components/global/GlobalTopProgress.tsx';
import interRegularUrl from './styles/fonts/Inter-Regular.ttf?url';
import exo2Url from './styles/fonts/Exo2-VariableFont_wght.ttf?url';

// Retry on chunk/script load errors to avoid "Cannot access before initialization" stalls
let chunkReloaded = false;
const handleChunkError = (ev: ErrorEvent | PromiseRejectionEvent) => {
  if (chunkReloaded) return;
  const msg = (ev as any)?.message || (ev as any)?.reason?.message || '';
  const lowerMsg = typeof msg === 'string' ? msg.toLowerCase() : '';
  const target = (ev as any)?.target as HTMLElement | undefined;
  const isChunkError =
    (typeof msg === 'string' &&
      (lowerMsg.includes('loading chunk') || lowerMsg.includes('dynamically imported module'))) ||
    (target && target.tagName === 'SCRIPT');
  if (isChunkError) {
    chunkReloaded = true;
    // Avoid looping
    setTimeout(() => window.location.reload(), 100);
  }
};
window.addEventListener('error', handleChunkError);
window.addEventListener('unhandledrejection', handleChunkError);

const preloadFont = (href: string) => {
  if (typeof document === 'undefined' || !href) return;
  const selector = `link[rel="preload"][as="font"][href="${href}"]`;
  if (document.head.querySelector(selector)) return;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'font';
  link.type = 'font/ttf';
  link.crossOrigin = 'anonymous';
  link.href = href;
  document.head.appendChild(link);
};

preloadFont(interRegularUrl);
preloadFont(exo2Url);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProviderWrapper>
      <FetchTrackerProvider>
        <GlobalTopProgress />
        <Routes />
      </FetchTrackerProvider>
    </ThemeProviderWrapper>
  </StrictMode>
);
