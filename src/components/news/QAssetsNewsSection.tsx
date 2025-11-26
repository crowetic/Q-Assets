import { useEffect, useState } from 'react';
import { Box, Card, CardContent, Typography, Divider, Skeleton, Chip, Button } from '@mui/material';
import Grid from '@mui/material/Grid';
import { useNavigate } from 'react-router-dom';
import { fetchAnnouncements, fetchLatestAssetNews, fetchActivePromotions } from '../../utils/news';
import { useTheme, alpha } from '@mui/material/styles';
import NewsActionBar from '../../components/news/NewsActionBar';

import type { NewsSummary, NewsType } from '../../types/newsAndPromos';

interface PromotionDetail {
  title?: string;
  contentHtml?: string;
  assetId?: number;
  assetName?: string;
  amountQort?: number;
  startsAt?: number;
  endsAt?: number;
  createdBy?: string;
}

type SelectedState = NewsSummary & {
  promotionDetail?: PromotionDetail;
};

// function stripHtml(html: string): string {
//   if (!html) return '';
//   return html
//     .replace(/<[^>]*>/g, ' ')
//     .replace(/\s+/g, ' ')
//     .trim();
// }

function NewsListColumn(props: {
  title: string;
  items: NewsSummary[];
  emptyText: string;
  onClickItem: (item: NewsSummary) => void;
  variant?: 'announcement' | 'news' | 'promotion';
}) {
  const { title, items, emptyText, onClickItem, variant = 'news' } = props;
  const theme = useTheme();
  const now = Date.now();
  const isNew = (ts?: number) => !!ts && now - ts < 72 * 3600_000;

  const typeColor = (t?: NewsType) => {
    if (t === 'announcement') return theme.palette.info.main;
    if (t === 'promotion') return theme.palette.warning.main;
    return theme.palette.success.main; // assetNews
  };

  const backgroundMap = {
    announcement: {
      header: `linear-gradient(90deg, ${theme.palette.info.dark}, ${theme.palette.info.main})`,
      body: `linear-gradient(180deg, ${alpha(theme.palette.info.light, 0.25)}, ${alpha(theme.palette.info.light, 0.08)})`,
      hover: alpha(theme.palette.info.light, 0.3),
    },
    news: {
      header: `linear-gradient(90deg, ${theme.palette.success.dark}, ${theme.palette.success.main})`,
      body: `linear-gradient(180deg, ${alpha(theme.palette.success.light, 0.25)}, ${alpha(theme.palette.success.light, 0.08)})`,
      hover: alpha(theme.palette.success.light, 0.3),
    },
    promotion: {
      header: `linear-gradient(90deg, ${theme.palette.primary.dark}, ${theme.palette.primary.main})`,
      body: `linear-gradient(180deg, ${alpha(theme.palette.primary.light, 0.25)}, ${alpha(theme.palette.primary.light, 0.08)})`,
      hover: alpha(theme.palette.primary.light, 0.35),
    },
  } as const;
  const current = backgroundMap[variant];

  return (
    <Card
      sx={{
        height: '100%',
        display: 'flex',
        flexDirection: 'column',
        borderRadius: 3,
        overflow: 'hidden',
        boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        background: current.body,
        border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
      }}
    >
      <Box
        sx={{
          px: 2,
          py: 1,
          background: current.header,
          color: theme.palette.getContrastText(theme.palette.primary.main),
          fontWeight: 700,
          textAlign: 'center',
        }}
      >
        {title}
      </Box>
      <CardContent sx={{ pb: 1 }}>
        <Divider sx={{ mb: 1 }} />
        {items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {emptyText}
          </Typography>
        ) : (
          items.slice(0, 5).map((item) => (
            <Box
              key={item.identifier}
              sx={{
                mb: 1.25,
                p: 1,
                borderRadius: 2,
                position: 'relative',
                cursor: 'pointer',
                borderLeft: `4px solid ${typeColor(item.type)}`,
                backgroundColor: alpha(theme.palette.background.default, 0.6),
                transition: 'transform 120ms ease, background 120ms ease',
                '&:hover': {
                  transform: 'translateY(-2px)',
                  backgroundColor: current.hover,
                },
              }}
              onClick={() => onClickItem(item)}
            >
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 0.5, flexWrap: 'wrap' }}>
                <Typography variant="subtitle2" sx={{ fontWeight: 700 }}>
                  {item.title}
                </Typography>
                {isNew(item.created) && (
                  <Chip
                    size="small"
                    label="NEW"
                    sx={{ height: 18, fontSize: 11, fontWeight: 700 }}
                  />
                )}
                {item.assetName && <Chip size="small" label={item.assetName} sx={{ height: 18 }} />}
              </Box>

              {(item.publisherName || item.assetName) && (
                <Typography
                  variant="caption"
                  sx={{ display: 'block', color: theme.palette.text.secondary, mt: 0.25 }}
                >
                  {item.publisherName && (
                    <Box
                      component="span"
                      sx={{ color: theme.palette.primary.main, fontWeight: 600 }}
                    >
                      {item.publisherName}
                    </Box>
                  )}
                  {item.publisherName && item.assetName && (
                    <Box component="span" sx={{ color: theme.palette.text.disabled }}>
                      {' '}
                      •{' '}
                    </Box>
                  )}
                  {item.assetName && (
                    <Box
                      component="span"
                      sx={{ color: theme.palette.secondary.main, fontWeight: 600 }}
                    >
                      {item.assetName}
                    </Box>
                  )}
                </Typography>
              )}

              <Typography
                variant="body2"
                color="text.secondary"
                sx={{
                  mt: 0.3,
                  display: '-webkit-box',
                  WebkitLineClamp: 2,
                  WebkitBoxOrient: 'vertical',
                  overflow: 'hidden',
                }}
              >
                {item.excerpt}
              </Typography>
            </Box>
          ))
        )}
      </CardContent>
    </Card>
  );
}

export default function QAssetsNewsSection() {
  const [announcements, setAnnouncements] = useState<NewsSummary[] | null>(null);
  const [assetNews, setAssetNews] = useState<NewsSummary[] | null>(null);
  const [promotions, setPromotions] = useState<NewsSummary[] | null>(null);

  const [selected, setSelected] = useState<SelectedState | null>(null);
  // const [detailLoading, setDetailLoading] = useState(false);
  // const [detailError, setDetailError] = useState<string | null>(null);

  const navigate = useNavigate();

  const theme = useTheme();

  // Initial load of lists
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const [a, n, p] = await Promise.all([
          fetchAnnouncements(5),
          fetchLatestAssetNews(8),
          fetchActivePromotions(),
        ]);
        if (cancelled) return;
        setAnnouncements(a);
        setAssetNews(n);
        setPromotions(p);
      } catch (e) {
        console.error('Failed to load Q-Assets news', e);
        if (!cancelled) {
          setAnnouncements([]);
          setAssetNews([]);
          setPromotions([]);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const loadingLists = announcements === null || assetNews === null || promotions === null;

  const handleClickItem = (item: NewsSummary) => {
    setSelected(item);
  };

  const handleBack = () => {
    setSelected(null);
    // setDetailError(null);
    // setDetailLoading(false);
  };

  // Helper for label
  const typeLabel = (type: NewsType | undefined) => {
    if (!type) return '';
    if (type === 'assetNews') return 'Asset News';
    if (type === 'promotion') return 'Promotion';
    return 'Announcement';
  };

  // --- DETAIL MODE ---
  if (selected) {
    return (
      <Box sx={{ width: '100%', maxWidth: '75%', mt: 4 }}>
        <Button variant="text" onClick={handleBack} sx={{ mb: 2 }}>
          ← Back to Q-Assets News
        </Button>

        <Typography variant="h4" sx={{ mb: 0.5 }}>
          {selected.title}
        </Typography>

        {(selected.publisherName || selected.assetName) && (
          <Typography
            variant="body2"
            sx={{
              mb: 1,
              color: theme.palette.text.secondary,
              display: 'flex',
              flexWrap: 'wrap',
              alignItems: 'center',
              gap: 0.5,
            }}
          >
            {selected.publisherName && (
              <>
                Published by{' '}
                <Box
                  component="span"
                  sx={{
                    color: theme.palette.primary.main,
                    fontWeight: 600,
                  }}
                >
                  {selected.publisherName}
                </Box>
              </>
            )}
            {selected.publisherName && selected.assetName && (
              <Box component="span" sx={{ color: theme.palette.text.disabled }}>
                •
              </Box>
            )}
            {selected.assetName && (
              <>
                for{' '}
                <Box
                  component="span"
                  sx={{
                    color: theme.palette.secondary.main,
                    fontWeight: 600,
                  }}
                >
                  {selected.assetName}
                </Box>
              </>
            )}
          </Typography>
        )}

        <Box sx={{ display: 'flex', gap: 1, mb: 2, flexWrap: 'wrap' }}>
          <Chip
            size="small"
            label={typeLabel(selected.type)}
            sx={{
              backgroundColor:
                selected.type === 'announcement'
                  ? theme.palette.info.light
                  : selected.type === 'assetNews'
                    ? theme.palette.success.light
                    : theme.palette.warning.light,
              color: theme.palette.getContrastText(
                selected.type === 'announcement'
                  ? theme.palette.info.light
                  : selected.type === 'assetNews'
                    ? theme.palette.success.light
                    : theme.palette.warning.light
              ),
              fontWeight: 600,
            }}
          />
          {selected.assetName && (
            <Chip
              size="small"
              label={selected.assetName}
              sx={{
                backgroundColor: theme.palette.secondary.main,
                color: theme.palette.secondary.contrastText,
                fontWeight: 500,
              }}
            />
          )}
          {selected.promotionEndsAt && (
            <Chip
              size="small"
              label={`Ends ${new Date(selected.promotionEndsAt).toLocaleString()}`}
              sx={{
                backgroundColor: theme.palette.error.light,
                color: theme.palette.error.contrastText,
              }}
            />
          )}
        </Box>

        {/* Link to Asset Details if we know the asset */}
        {selected.assetId != null && (
          <Box sx={{ mb: 2 }}>
            <Button
              variant="outlined"
              size="small"
              onClick={() => navigate(`/assets/${selected.assetId}`)}
            >
              View Asset Details
            </Button>
          </Box>
        )}

        {selected.fullHtml && (
          <Box
            sx={{
              '& img': { maxWidth: '100%', height: 'auto' },
              '& h1, & h2, & h3': { mt: 2 },
            }}
            dangerouslySetInnerHTML={{ __html: selected.fullHtml }}
          />
        )}
      </Box>
    );
  }

  // --- LIST MODE (three columns) ---
  return (
    <Box sx={{ width: '100%', maxWidth: '95%', mt: 4 }}>
      <Typography variant="h5" sx={{ mb: 1, textAlign: 'center' }}>
        Q-Assets News
      </Typography>
      <Typography variant="body2" color="text.secondary" sx={{ mb: 2, textAlign: 'center' }}>
        Announcements from Q-Assets, latest news from all issuers, and paid promotional content.
      </Typography>

      {loadingLists ? (
        <Grid container spacing={2}>
          {[0, 1, 2].map((i) => (
            <Grid key={i} size={{ xs: 12, md: 4 }}>
              <Card>
                <CardContent>
                  <Skeleton variant="text" width="60%" />
                  <Skeleton variant="text" width="90%" />
                  <Skeleton variant="text" width="80%" />
                </CardContent>
              </Card>
            </Grid>
          ))}
        </Grid>
      ) : (
        <Grid container spacing={2}>
          <Grid size={{ xs: 12, md: 4 }}>
            <NewsListColumn
              title="Q-Assets Announcements"
              items={announcements ?? []}
              emptyText="No Q-Assets announcements yet."
              onClickItem={handleClickItem}
              variant="announcement"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <NewsListColumn
              title="Asset News Publications"
              items={assetNews ?? []}
              emptyText="No Assets have not published news yet."
              onClickItem={handleClickItem}
              variant="news"
            />
          </Grid>
          <Grid size={{ xs: 12, md: 4 }}>
            <NewsListColumn
              title="Promotions"
              items={promotions ?? []}
              emptyText="No active promotions."
              onClickItem={handleClickItem}
              variant="promotion"
            />
          </Grid>
        </Grid>
      )}
      <NewsActionBar
        treasuryAddress="Q-Assets" // TODO put real address I have an import from another p
        defaultPromoPriceQort={5}
      />
    </Box>
  );
}
