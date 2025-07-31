import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import Home from '../pages/Home';
import { AppWrapper } from '../AppWrapper';
import AssetExplorer from '../pages/AssetExplorer';
import AssetDetail from '../pages/AssetDetails';
import Portfolio from '../pages/Portfolio';
import IssueAsset from '../pages/IssueAsset';
import TradeAsset from '../pages/TradeAsset';

interface CustomWindow extends Window {
  _qdnBase: string;
}

const customWindow = window as unknown as CustomWindow;
const baseURL = customWindow?._qdnBase || '';

export function Routes() {
  const router = createBrowserRouter(
    [
      {
        path: '/',
        element: <AppWrapper />,
        children: [
          { index: true, element: <Home /> },
          { path: 'assets', element: <AssetExplorer /> },
          { path: 'assets/:assetId', element: <AssetDetail /> },
          { path: 'portfolio', element: <Portfolio /> },
          { path: 'issue', element: <IssueAsset /> },
          { path: 'trade', element: <TradeAsset /> },
        ],
      },
    ],
    {
      basename: baseURL,
    }
  );

  return <RouterProvider router={router} />;
}
