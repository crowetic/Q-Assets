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

function PortfolioProviderLayout() {
  return (
    <PortfolioProvider>
      <Outlet />
    </PortfolioProvider>
  );
}

interface CustomWindow extends Window {
  _qdnBase: string;
}
const baseURL = (window as CustomWindow)._qdnBase;

export function Routes() {
  const routes: RouteObject[] = [
    {
      path: '/',
      element: <AppWrapper />,
      children: [
        { index: true, element: <Home /> },
        { path: 'assets', element: <AssetExplorer /> },
        { path: 'assets/:assetId', element: <AssetDetail /> },
        {
          element: <PortfolioProviderLayout />,
          children: [{ path: 'portfolio', element: <Portfolio /> }],
        },
        { path: 'issue', element: <IssueAsset /> },
        { path: 'trade', element: <TradeMarkets /> },
        { path: 'trade/:assetId', element: <TradePair /> },
        { path: 'info', element: <Information /> },
      ],
    },
  ];

  const router = createBrowserRouter(routes, { basename: baseURL });

  return <RouterProvider router={router} />;
}
