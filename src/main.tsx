import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ThemeProviderWrapper from './styles/theme/theme-provider.tsx';
import './index.css';
import './i18n/i18n.ts';
import { Routes } from './routes/Routes.tsx';
import { FetchTrackerProvider } from './state/global/fetchTracker';
import GlobalTopProgress from './components/global/GlobalTopProgress.tsx';

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
