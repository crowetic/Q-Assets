import { useNavigate } from 'react-router-dom';
import HoverPanel from '../components/HoverPanel';
import { Box } from '@mui/material';
import QAssetsNewsSection from '../components/news/QAssetsNewsSection';
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
        minHeight: '100%',
        alignItems: 'center',
        padding: '2rem',
        gap: '2rem',
        boxSizing: 'border-box',
      }}
    >
      <Box
        sx={{
          display: 'flex',
          flexWrap: 'wrap',
          justifyContent: 'center',
          gap: '2rem',
          width: '100%',
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

      {/* Q-Assets News hub (list/detail toggles live inside this component) */}
      <QAssetsNewsSection />
    </Box>
  );
};

export default Home;
