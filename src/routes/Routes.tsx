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

// --- Manage (new) ---
import ManageHome from '../pages/manage/ManageHome';
import ManageDividends from '../pages/manage/ManageDividends';
import ManageDividendsAsset from '../pages/manage/ManageDividendsAsset';
import AdminPanel from '../pages/manage/AdminPanel';
import PublishAssetNewsPage from '../pages/PublishAssetNews';

// --- Q-Deck (lazy) ---
const QDeckIndex = React.lazy(() => import('../pages/QDeckMyBoards'));
const QDeckPage = React.lazy(() => import('../pages/QDeckPage'));
const QDeckProvider = React.lazy(() =>
  import('../components/qdeck/QDeckProvider').then((m) => ({ default: m.QDeckProvider }))
);
// --- Data Management (lazy) ---
const DataManagement = React.lazy(() => import('../pages/manage/DataManagement'));
const MyPublishedData = React.lazy(() => import('../pages/manage/data/MyPublishedData'));
const PublishData = React.lazy(() => import('../pages/manage/data/PublishData'));
const BulkPublish = React.lazy(() => import('../pages/manage/data/BulkPublish'));
const NameBasedAssetData = React.lazy(() => import('../pages/manage/data/NameBasedAssetData'));
const DataExplorer = React.lazy(() => import('../pages/manage/data/DataExplorer'));
const Archives = React.lazy(() => import('../pages/manage/data/Archives'));

function PortfolioProviderLayout() {
  return (
    <PortfolioProvider>
      <Outlet />
    </PortfolioProvider>
  );
}

function ManageDataLayout() {
  return (
    <React.Suspense fallback={<div style={{ padding: 16 }}>Loading Data Management…</div>}>
      <Outlet />
    </React.Suspense>
  );
}

declare global {
  interface CustomWindow extends Window {
    _qdnContext?: 'render' | 'preview' | string;
    _qdnBase: string; // e.g. "/render/APP/Q-Assets"
    _qdnPath?: string; // e.g. "/info#ann2"
  }
}

function getBasename(): string {
  let base = (window as CustomWindow)._qdnBase || '';
  if (base.endsWith('/') && base !== '/') base = base.slice(0, -1);
  return base;
}

export function Routes() {
  const routes: RouteObject[] = [
    {
      path: '/',
      element: (
        <AlertProvider>
          <QortalLinkProvider>
            <QortalLinkHandler>
              <React.Suspense fallback={<div style={{ padding: 16 }}>Loading…</div>}>
                <AppWrapper />
              </React.Suspense>
            </QortalLinkHandler>
          </QortalLinkProvider>
        </AlertProvider>
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
        { path: 'publish-asset-news', element: <PublishAssetNewsPage /> },

        // --- Manage ---
        { path: 'manage', element: <ManageHome /> },
        { path: 'manage/dividends', element: <ManageDividends /> },
        { path: 'manage/dividends/:assetId', element: <ManageDividendsAsset /> },
        { path: 'manage/admin', element: <AdminPanel /> },

        // --- Manage / Data Management (panel + subpages)
        {
          path: 'manage/data',
          element: <ManageDataLayout />,
          children: [
            // main panel (the big buttons)
            { index: true, element: <DataManagement /> },

            // subpages
            { path: 'my-data', element: <MyPublishedData /> },
            { path: 'publish', element: <PublishData /> },
            { path: 'bulk', element: <BulkPublish /> },
            { path: 'name-assets', element: <NameBasedAssetData /> },
            { path: 'explorer', element: <DataExplorer /> },
            { path: 'archives', element: <Archives /> },
          ],
        },

        // --- Q-Deck
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
