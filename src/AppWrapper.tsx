import { useEffect, useState } from 'react';
import { GlobalProvider } from 'qapp-core';
import Layout from './styles/Layout';
import { publicSalt } from './qapp-config';
import { TxTrackerProvider } from './unconfirmedTxTracker/TxTrackerProvider';
import { UnconfirmedTxWidget } from './unconfirmedTxTracker/UnconfirmedTxWidget';
import { UnconfirmedTxAutoScanner } from './unconfirmedTxTracker/UnconfirmedTxAutoScanner';
import { NotificationProvider } from './notifications/NotificationProvider';
import { NotificationAutoFetcher } from './notifications/NotificationAutoFetcher';
import { useQdnBatchPublisher } from './utils/useQdnBatchPublisher';

const QdnPublishBootstrapper = () => {
  useQdnBatchPublisher();
  return null;
};

export const AppWrapper = () => {
  const [notificationsBootReady, setNotificationsBootReady] = useState(false);
  const [txScannerBootReady, setTxScannerBootReady] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => setNotificationsBootReady(true), 2500);
    return () => window.clearTimeout(id);
  }, []);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const id = window.setTimeout(() => setTxScannerBootReady(true), 4500);
    return () => window.clearTimeout(id);
  }, []);

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
          <QdnPublishBootstrapper />
          <Layout />
          <UnconfirmedTxWidget />
          {notificationsBootReady && (
            <NotificationAutoFetcher
              scopes={['global']}
              intervalMs={60_000}
              startDelayMs={1000}
              maxScopesPerCycle={1}
            />
          )}
        </NotificationProvider>
        {txScannerBootReady && (
          <UnconfirmedTxAutoScanner
            intervalMs={3_000}
            hiddenIntervalMs={15_000}
            startDelayMs={2500}
            missGoneThreshold={2}
            limit={75}
          />
        )}
      </TxTrackerProvider>
    </GlobalProvider>
  );
};
