import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import HoverPanel from '../components/HoverPanel';
import { Box, Skeleton } from '@mui/material';
import QAssetsNewsSection from '../components/news/QAssetsNewsSection';
// import { Grid } from '@mui/material';

const NewsLoadingPlaceholder = () => (
  <Box sx={{ width: '100%', maxWidth: '95%', mt: 4 }}>
    <Skeleton variant="text" width="30%" sx={{ mx: 'auto', mb: 1 }} />
    <Skeleton variant="text" width="60%" sx={{ mx: 'auto', mb: 2 }} />
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: 'repeat(3, 1fr)' },
        gap: 2,
      }}
    >
      {[0, 1, 2].map((i) => (
        <Skeleton key={i} variant="rounded" height={160} />
      ))}
    </Box>
  </Box>
);

const Home = () => {
  // const theme = useTheme();
  const navigate = useNavigate();
  const newsAnchorRef = useRef<HTMLDivElement | null>(null);
  const [showNews, setShowNews] = useState(false);

  useEffect(() => {
    if (showNews) return;
    const target = newsAnchorRef.current;
    if (!target) return;
    if ('IntersectionObserver' in window) {
      const observer = new IntersectionObserver(
        ([entry]) => {
          if (entry.isIntersecting) {
            setShowNews(true);
            observer.disconnect();
          }
        },
        { rootMargin: '200px 0px' }
      );
      observer.observe(target);
      return () => observer.disconnect();
    }
    const timer = setTimeout(() => setShowNews(true), 600);
    return () => clearTimeout(timer);
  }, [showNews]);

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
      <Box ref={newsAnchorRef} sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
        {showNews ? <QAssetsNewsSection /> : <NewsLoadingPlaceholder />}
      </Box>
    </Box>
  );
};

export default Home;
