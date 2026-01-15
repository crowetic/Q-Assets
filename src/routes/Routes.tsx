import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  RouteObject,
  Navigate,
} from 'react-router-dom';
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
import QDeckLanding from '../pages/QDeckLanding';
import QDeckMyBoards from '../pages/QDeckMyBoards';
import QDeckPage from '../pages/QDeckPage';
import QDeckAllProjects from '../pages/QDeckAllProjects';
import QDeckProjects from '../pages/QDeckProjects';
import QDeckProjectPage from '../pages/QDeckProjectPage';
import { QDeckProvider } from '../components/qdeck/QDeckProvider';

// --- Manage (new) ---
import ManageHome from '../pages/manage/ManageHome';
import ManageDividends from '../pages/manage/ManageDividends';
import ManageDividendsAsset from '../pages/manage/ManageDividendsAsset';
import QDeckPermissionsPage from '../pages/manage/QDeckPermissions';
import AdminPanel from '../pages/manage/AdminPanel';
import ManageAssets from '../pages/manage/ManageAssets';
import PublishAssetNewsPage from '../pages/PublishAssetNews';
import { SafeBoundary } from '../components/common/SafeBoundary';
import DataManagement from '../pages/manage/DataManagement';
import MyPublishedData from '../pages/manage/data/MyPublishedData';
import PublishData from '../pages/manage/data/PublishData';
import BulkPublish from '../pages/manage/data/BulkPublish';
import NameBasedAssetData from '../pages/manage/data/NameBasedAssetData';
import DataExplorer from '../pages/manage/data/DataExplorer';
import Archives from '../pages/manage/data/Archives';

function PortfolioProviderLayout() {
  return (
    <PortfolioProvider>
      <Outlet />
    </PortfolioProvider>
  );
}

function ManageDataLayout() {
  return <Outlet />;
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
              <SafeBoundary fallback={<Navigate to="/" replace />}>
                <AppWrapper />
              </SafeBoundary>
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
        { path: 'manage/assets', element: <ManageAssets /> },
        { path: 'manage/dividends', element: <ManageDividends /> },
        { path: 'manage/dividends/:assetId', element: <ManageDividendsAsset /> },
        { path: 'manage/qdeck-permissions', element: <QDeckPermissionsPage /> },
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
            <QDeckProvider>
              <QDeckHome />
            </QDeckProvider>
          ),
          children: [
            { index: true, element: <QDeckLanding /> },
            { path: 'my', element: <QDeckMyBoards /> },
            { path: 'public', element: <QDeckAllBoards /> },
            { path: 'projects', element: <QDeckProjects /> },
            { path: 'projects/all', element: <QDeckAllProjects /> },
            { path: 'projects/:issuer/:projectId', element: <QDeckProjectPage /> },
            { path: ':issuer/:boardId', element: <QDeckPage /> },
          ],
        },
      ],
    },
  ];

  const router = createBrowserRouter(routes, { basename: getBasename() });
  return <RouterProvider router={router} />;
}
