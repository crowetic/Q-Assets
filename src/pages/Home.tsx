// import { useTheme } from '@mui/material/styles';
import { useNavigate } from 'react-router-dom';
import HoverPanel from '../components/HoverPanel';
import { Box } from '@mui/material';
// import { Grid } from '@mui/material';

const Home = () => {
  // const theme = useTheme();
  const navigate = useNavigate();

  const panels = [
    { title: 'Issue Asset', path: '/issue', icon: '🧬', isEmoji: true },
    { title: 'All Assets', path: '/assets', icon: '🛸', isEmoji: true },
    { title: 'Portfolio', path: '/portfolio', icon: '🪐', isEmoji: true },
    { title: 'Asset Trading', path: '/trade', icon: '🚀', isEmoji: true },
    // or use: icon: '/assets/icons/trade.png', isEmoji: false
  ];

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        minHeight: '100vh',

        alignItems: 'center',
        padding: '2rem',
        gap: '2rem',
        boxSizing: 'border-box',
      }}
    >
      {/* <Typography variant="h4" sx={{ textAlign: 'center' }}>
        Create and Manage Qortal Assets - Asset Publications - and More
      </Typography> */}
      {/* <Typography sx={{ textAlign: 'center', mt: 1, color: theme.palette.primary.light }}>
        Be sure to check the INFO page for in-depth information about Qortal Assets.
      </Typography> */}

      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '2rem',
          width: '100vw',
          marginTop: '2rem',
        }}
      >
        {panels.map(({ title, path, icon }) => (
          <HoverPanel
            key={title}
            title={title}
            icon={icon}
            isEmoji={true}
            onClick={() => navigate(path)}
          />
        ))}
      </Box>
    </Box>
  );
};

export default Home;
