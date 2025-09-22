import { Link, Outlet, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';

function a11yProps(index: number) {
  return { id: `qdeck-tab-${index}`, 'aria-controls': `qdeck-tabpanel-${index}` };
}

export default function QDeckHome() {
  const { pathname } = useLocation();

  // Active tab by path
  const isPublic = pathname.endsWith('/public') || pathname.includes('/qdeck/public');
  const tab = isPublic ? 1 : 0;

  return (
    <Box sx={{ p: 2 }}>
      <Tabs value={tab} variant="scrollable" allowScrollButtonsMobile>
        <Tab label="My Boards" component={Link} to="/qdeck" {...a11yProps(0)} />
        <Tab label="All Boards" component={Link} to="/qdeck/public" {...a11yProps(1)} />
      </Tabs>

      {/* Content area */}
      <Box sx={{ mt: 2 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
