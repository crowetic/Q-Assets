import * as React from 'react';
import { createBrowserRouter, RouterProvider, Outlet, RouteObject } from 'react-router-dom';
import { AppWrapper } from '../AppWrapper';
import Home from '../pages/Home';
import AssetExplorer from '../pages/AssetExplorer';
import AssetDetail from '../pages/AssetDetails';
import Portfolio from '../pages/Portfolio';
import IssueAsset from '../pages/IssueAsset';
import TradeMarkets from '../pages/TradeMarkets';
import TradePair from '../pages/TradePair';
import Information from '../pages/Information';
import { PortfolioProvider } from '../portfolio/PortfolioProvider';

import { QortalLinkProvider } from '../components/qortal-links/QortalLinkProvider';
import { QortalLinkHandler } from '../components/qortal-links/QortalLinkHandler';
import { AlertProvider } from '../components/alerts';
import AssetDataPage from '../pages/AssetDataPage';
import QDeckAllBoards from '../pages/QDeckAllBoards';
import QDeckHome from '../pages/QDeckHome';

// --- Q-Deck (lazy) ---
// import QDeckAllBoards from '../pages/QDeckAllBoards';
const QDeckIndex = React.lazy(() => import('../pages/QDeckMyBoards'));
const QDeckPage = React.lazy(() => import('../pages/QDeckPage'));
const QDeckProvider = React.lazy(() =>
  import('../components/qdeck/QDeckProvider').then((m) => ({ default: m.QDeckProvider }))
);

function PortfolioProviderLayout() {
  return (
    <PortfolioProvider>
      <Outlet />
    </PortfolioProvider>
  );
}
declare global {
  interface CustomWindow extends Window {
    _qdnContext?: 'render' | 'preview' | string;
    _qdnBase: string; // e.g. "/render/APP/Q-Assets"
    _qdnPath?: string; // e.g. "/info#ann2"
  }
}

// const baseURL = (window as CustomWindow)._qdnBase;

function getBasename(): string {
  let base = (window as CustomWindow)._qdnBase || '';
  // Normalize: ensure no trailing slash (RR is fine either way, but consistency helps).
  if (base.endsWith('/') && base !== '/') base = base.slice(0, -1);
  return base;
}

export function Routes() {
  const routes: RouteObject[] = [
    {
      path: '/',
      element: (
        <>
          {/* <QdnRuntimeGuard />
          <QdnPathGuard /> */}
          <AlertProvider>
            <QortalLinkProvider>
              <QortalLinkHandler>
                <React.Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
                  <AppWrapper />
                </React.Suspense>
              </QortalLinkHandler>
            </QortalLinkProvider>
          </AlertProvider>
        </>
      ),
      children: [
        { index: true, element: <Home /> },
        { path: 'assets', element: <AssetExplorer /> },
        { path: 'assets/:assetId', element: <AssetDetail /> },
        { path: 'assetdata/:assetId', element: <AssetDataPage /> },
        {
          element: <PortfolioProviderLayout />,
          children: [{ path: 'portfolio', element: <Portfolio /> }],
        },
        { path: 'issue', element: <IssueAsset /> },
        { path: 'trade', element: <TradeMarkets /> },
        { path: 'trade/:assetId', element: <TradePair /> },
        { path: 'info', element: <Information /> },
        {
          path: 'qdeck',
          element: (
            <React.Suspense fallback={<div style={{ padding: 16 }}>Loading Q-Deck…</div>}>
              <QDeckProvider>
                <QDeckHome />
              </QDeckProvider>
            </React.Suspense>
          ),
          children: [
            { index: true, element: <QDeckIndex /> },
            { path: 'public', element: <QDeckAllBoards /> },
            { path: ':issuer/:boardId', element: <QDeckPage /> },
          ],
        },
      ],
    },
  ];

  const router = createBrowserRouter(routes, { basename: getBasename() });

  return <RouterProvider router={router} />;
}
