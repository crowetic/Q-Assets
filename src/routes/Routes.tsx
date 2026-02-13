import { Suspense, lazy, type ReactNode } from 'react';
import {
  createBrowserRouter,
  RouterProvider,
  Outlet,
  RouteObject,
  Navigate,
} from 'react-router-dom';
import { AppWrapper } from '../AppWrapper';
import Home from '../pages/Home';
import { PortfolioProvider } from '../portfolio/PortfolioProvider';

import { QortalLinkProvider } from '../components/qortal-links/QortalLinkProvider';
import { QortalLinkHandler } from '../components/qortal-links/QortalLinkHandler';
import { AlertProvider } from '../components/alerts';
import { QDeckProvider } from '../components/qdeck/QDeckProvider';
import { SafeBoundary } from '../components/common/SafeBoundary';

const AssetExplorer = lazy(() => import('../pages/AssetExplorer'));
const AssetDetail = lazy(() => import('../pages/AssetDetails'));
const Portfolio = lazy(() => import('../pages/Portfolio'));
const IssueAsset = lazy(() => import('../pages/IssueAsset'));
const TradeMarkets = lazy(() => import('../pages/TradeMarkets'));
const TradePair = lazy(() => import('../pages/TradePair'));
const Information = lazy(() => import('../pages/Information'));
const XqloreExplorer = lazy(() => import('../pages/XqloreExplorer'));
const XqloreAccountPage = lazy(() => import('../pages/xqlore/XqloreAccountPage'));
const XqloreAppPage = lazy(() => import('../pages/xqlore/XqloreAppPage'));
const XqloreMintingPage = lazy(() => import('../pages/xqlore/XqloreMintingPage'));
const XqloreTradingPage = lazy(() => import('../pages/xqlore/XqloreTradingPage'));
const XqloreAdminPage = lazy(() => import('../pages/xqlore/XqloreAdminPage'));
const XqloreStatsPage = lazy(() => import('../pages/xqlore/XqloreStatsPage'));
const AssetDataPage = lazy(() => import('../pages/AssetDataPage'));
const QDeckAllBoards = lazy(() => import('../pages/QDeckAllBoards'));
const QDeckHome = lazy(() => import('../pages/QDeckHome'));
const QDeckLanding = lazy(() => import('../pages/QDeckLanding'));
const QDeckMyBoards = lazy(() => import('../pages/QDeckMyBoards'));
const QDeckPage = lazy(() => import('../pages/QDeckPage'));
const QDeckAllProjects = lazy(() => import('../pages/QDeckAllProjects'));
const QDeckProjects = lazy(() => import('../pages/QDeckProjects'));
const QDeckProjectPage = lazy(() => import('../pages/QDeckProjectPage'));

const ManageHome = lazy(() => import('../pages/manage/ManageHome'));
const ManageDividends = lazy(() => import('../pages/manage/ManageDividends'));
const ManageDividendsAsset = lazy(() => import('../pages/manage/ManageDividendsAsset'));
const QDeckPermissionsPage = lazy(() => import('../pages/manage/QDeckPermissions'));
const QDeckProjectPermissionsPage = lazy(() => import('../pages/manage/QDeckProjectPermissions'));
const AdminPanel = lazy(() => import('../pages/manage/AdminPanel'));
const ManageAssets = lazy(() => import('../pages/manage/ManageAssets'));
const PublishAssetNewsPage = lazy(() => import('../pages/PublishAssetNews'));
const DataManagement = lazy(() => import('../pages/manage/DataManagement'));
const MyPublishedData = lazy(() => import('../pages/manage/data/MyPublishedData'));
const PublishData = lazy(() => import('../pages/manage/data/PublishData'));
const BulkPublish = lazy(() => import('../pages/manage/data/BulkPublish'));
const NameBasedAssetData = lazy(() => import('../pages/manage/data/NameBasedAssetData'));
const DataExplorer = lazy(() => import('../pages/manage/data/DataExplorer'));
const Archives = lazy(() => import('../pages/manage/data/Archives'));

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

const RouteLoadingFallback = () => (
  <div style={{ padding: '1rem', textAlign: 'center' }}>Loading...</div>
);

const RouteSuspense = ({ children }: { children: ReactNode }) => (
  <Suspense fallback={<RouteLoadingFallback />}>{children}</Suspense>
);

const lazyRoute = (element: ReactNode) => <RouteSuspense>{element}</RouteSuspense>;

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
        { path: 'assets', element: lazyRoute(<AssetExplorer />) },
        { path: 'xqlore', element: lazyRoute(<XqloreExplorer />) },
        { path: 'xqlore/accounts/:address', element: lazyRoute(<XqloreAccountPage />) },
        { path: 'xqlore/apps/:appName', element: lazyRoute(<XqloreAppPage />) },
        { path: 'xqlore/minting', element: lazyRoute(<XqloreMintingPage />) },
        { path: 'xqlore/trading', element: lazyRoute(<XqloreTradingPage />) },
        { path: 'xqlore/admin', element: lazyRoute(<XqloreAdminPage />) },
        { path: 'xqlore/stats', element: lazyRoute(<XqloreStatsPage />) },
        { path: 'assets/:assetId', element: lazyRoute(<AssetDetail />) },
        { path: 'assetdata/:assetId', element: lazyRoute(<AssetDataPage />) },

        {
          element: <PortfolioProviderLayout />,
          children: [{ path: 'portfolio', element: lazyRoute(<Portfolio />) }],
        },

        { path: 'issue', element: lazyRoute(<IssueAsset />) },
        { path: 'trade', element: lazyRoute(<TradeMarkets />) },
        { path: 'trade/:assetId', element: lazyRoute(<TradePair />) },
        { path: 'info', element: lazyRoute(<Information />) },
        { path: 'publish-asset-news', element: lazyRoute(<PublishAssetNewsPage />) },

        { path: 'manage', element: lazyRoute(<ManageHome />) },
        { path: 'manage/assets', element: lazyRoute(<ManageAssets />) },
        { path: 'manage/dividends', element: lazyRoute(<ManageDividends />) },
        { path: 'manage/dividends/:assetId', element: lazyRoute(<ManageDividendsAsset />) },
        { path: 'manage/qdeck-permissions', element: lazyRoute(<QDeckPermissionsPage />) },
        {
          path: 'manage/qdeck-project-permissions',
          element: lazyRoute(<QDeckProjectPermissionsPage />),
        },
        { path: 'manage/admin', element: lazyRoute(<AdminPanel />) },

        {
          path: 'manage/data',
          element: <ManageDataLayout />,
          children: [
            { index: true, element: lazyRoute(<DataManagement />) },
            { path: 'my-data', element: lazyRoute(<MyPublishedData />) },
            { path: 'publish', element: lazyRoute(<PublishData />) },
            { path: 'bulk', element: lazyRoute(<BulkPublish />) },
            { path: 'name-assets', element: lazyRoute(<NameBasedAssetData />) },
            { path: 'explorer', element: lazyRoute(<DataExplorer />) },
            { path: 'archives', element: lazyRoute(<Archives />) },
          ],
        },

        {
          path: 'qdeck',
          element: (
            <QDeckProvider>
              <RouteSuspense>
                <QDeckHome />
              </RouteSuspense>
            </QDeckProvider>
          ),
          children: [
            { index: true, element: lazyRoute(<QDeckLanding />) },
            { path: 'my', element: lazyRoute(<QDeckMyBoards />) },
            { path: 'public', element: lazyRoute(<QDeckAllBoards />) },
            { path: 'projects', element: lazyRoute(<QDeckProjects />) },
            { path: 'projects/all', element: lazyRoute(<QDeckAllProjects />) },
            { path: 'projects/:issuer/:projectId', element: lazyRoute(<QDeckProjectPage />) },
            { path: ':issuer/:boardId', element: lazyRoute(<QDeckPage />) },
          ],
        },
      ],
    },
  ];

  const router = createBrowserRouter(routes, { basename: getBasename() });
  return <RouterProvider router={router} />;
}
