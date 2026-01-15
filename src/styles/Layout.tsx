import { Outlet } from 'react-router-dom';
import { useIframe } from '../hooks/useIframeListener';
import Header from '../components/Header';
import NotificationsJoinPrompt from '../components/NotificationsJoinPrompt';

const Layout = () => {
  useIframe();
  return (
    <>
      <Header />
      <NotificationsJoinPrompt />
      <main>
        <Outlet /> {/* This is where page content will be rendered */}
      </main>
      {/* Add Footer here */}
    </>
  );
};

export default Layout;
