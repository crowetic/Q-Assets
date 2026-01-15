import { Link, Outlet, useLocation } from 'react-router-dom';
import { Box, Tabs, Tab } from '@mui/material';

function a11yProps(index: number) {
  return { id: `qdeck-tab-${index}`, 'aria-controls': `qdeck-tabpanel-${index}` };
}

export default function QDeckHome() {
  const { pathname } = useLocation();

  // Active tab by path
  const isLanding = pathname === '/qdeck' || pathname === '/qdeck/';
  const isProjects = pathname.includes('/qdeck/projects');
  const isBoards = pathname.includes('/qdeck/my') || pathname.includes('/qdeck/public');
  const tab = isLanding ? 0 : isProjects ? 1 : isBoards ? 2 : 0;

  return (
    <Box sx={{ p: 2 }}>
      <Tabs value={tab} variant="scrollable" allowScrollButtonsMobile>
        <Tab label="Overview" component={Link} to="/qdeck" {...a11yProps(0)} />
        <Tab label="Projects" component={Link} to="/qdeck/projects" {...a11yProps(1)} />
        <Tab label="Boards" component={Link} to="/qdeck/my" {...a11yProps(2)} />
      </Tabs>

      {/* Content area */}
      <Box sx={{ mt: 2 }}>
        <Outlet />
      </Box>
    </Box>
  );
}
