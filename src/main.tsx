import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ThemeProviderWrapper from './styles/theme/theme-provider.tsx';
import './index.css';
import './i18n/i18n.ts';
import { Routes } from './routes/Routes.tsx';
import { FetchTrackerProvider } from './state/global/fetchTracker';
import GlobalTopProgress from './components/global/GlobalTopProgress.tsx';

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
