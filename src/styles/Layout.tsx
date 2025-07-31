import { Outlet } from 'react-router-dom';
import { useIframe } from '../hooks/useIframeListener';
import Header from '../components/Header';

const Layout = () => {
  useIframe();
  return (
    <>
      <Header />
      <main>
        <Outlet /> {/* This is where page content will be rendered */}
      </main>
      {/* Add Footer here */}
    </>
  );
};

export default Layout;
