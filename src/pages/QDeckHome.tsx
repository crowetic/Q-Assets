import { Link, Outlet, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';

function a11yProps(index: number) {
  return { id: `qdeck-tab-${index}`, 'aria-controls': `qdeck-tabpanel-${index}` };
}

export default function QDeckHome() {
  const { pathname } = useLocation();

  // Active tab by path
  const isLanding = pathname === '/qdeck' || pathname === '/qdeck/';
  const isPublic = pathname.endsWith('/public') || pathname.includes('/qdeck/public');
  const isProjects = pathname.includes('/qdeck/projects');
  const isMyBoards = pathname.includes('/qdeck/my');
  const tab = isLanding ? 0 : isProjects ? 1 : isMyBoards ? 2 : isPublic ? 3 : 0;

  return (
    <Box sx={{ p: 2 }}>
      <Tabs value={tab} variant="scrollable" allowScrollButtonsMobile>
        <Tab label="Overview" component={Link} to="/qdeck" {...a11yProps(0)} />
        <Tab label="Projects" component={Link} to="/qdeck/projects" {...a11yProps(1)} />
        <Tab label="My Boards" component={Link} to="/qdeck/my" {...a11yProps(2)} />
        <Tab label="All Boards" component={Link} to="/qdeck/public" {...a11yProps(3)} />
      </Tabs>

      {/* Content area */}
      <Box sx={{ mt: 2 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
