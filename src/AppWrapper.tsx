import { GlobalProvider } from 'qapp-core';
import Layout from './styles/Layout';
import { publicSalt } from './qapp-config';
import { TxTrackerProvider } from './unconfirmedTxTracker/TxTrackerProvider';
import { UnconfirmedTxWidget } from './unconfirmedTxTracker/UnconfirmedTxWidget';
import { UnconfirmedTxAutoScanner } from './unconfirmedTxTracker/UnconfirmedTxAutoScanner';
import { NotificationProvider } from './notifications/NotificationProvider';
import { NotificationAutoFetcher } from './notifications/NotificationAutoFetcher';

export const AppWrapper = () => {
  return (
    <GlobalProvider
      config={{
        appName: 'Q-Assets',
        auth: {
          balanceSetting: { interval: 180000, onlyOnMount: false },
          authenticateOnMount: true,
        },
        publicSalt,
      }}
    >
      <TxTrackerProvider>
        <NotificationProvider>
          <Layout />
          <UnconfirmedTxWidget />
          <NotificationAutoFetcher scopes={['global']} intervalMs={60_000} />
        </NotificationProvider>
        <UnconfirmedTxAutoScanner intervalMs={3_000} missGoneThreshold={2} limit={75} />
      </TxTrackerProvider>
    </GlobalProvider>
  );
};
