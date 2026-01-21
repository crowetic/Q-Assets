import { useCallback, useEffect, useRef, useState } from 'react';
import { Box, Card, CardContent, Typography, Divider, Skeleton, Chip, Button } from '@mui/material';
import Grid from '@mui/material/Grid';
import { useNavigate } from 'react-router-dom';
import {
  fetchAnnouncements,
  fetchLatestAssetNews,
  fetchActivePromotions,
  NEWS_REFRESH_EVENT,
  invalidateAnnouncementCache,
} from '../../utils/news';
import { useTheme, alpha } from '@mui/material/styles';
import NewsActionBar from '../../components/news/NewsActionBar';
import PublishedHtmlRenderer from '../PublishedHtmlRenderer';
import { useMemberGroupIds } from '../../hooks/useMemberGroupIds';

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

const maxPerList = 5;

const isAbortError = (error: unknown) =>
  Boolean(error && typeof error === 'object' && (error as { name?: string }).name === 'AbortError');

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
          items.map((item) => (
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
  const [loadingAnnouncements, setLoadingAnnouncements] = useState(true);
  const [loadingAssetNews, setLoadingAssetNews] = useState(true);
  const [loadingPromotions, setLoadingPromotions] = useState(true);

  const [showMoreAnnouncements, setShowMoreAnnouncements] = useState(false);
  const [showMoreNews, setShowMoreNews] = useState(false);

  const [selected, setSelected] = useState<SelectedState | null>(null);
  // const [detailLoading, setDetailLoading] = useState(false);
  // const [detailError, setDetailError] = useState<string | null>(null);

  const navigate = useNavigate();
  const { memberGroupIds, loading: groupsLoading } = useMemberGroupIds();

  const theme = useTheme();
  const annControllerRef = useRef<AbortController | null>(null);
  const newsControllerRef = useRef<AbortController | null>(null);
  const promoControllerRef = useRef<AbortController | null>(null);

  const createAbortController = useCallback((ref: { current: AbortController | null }) => {
    ref.current?.abort();
    const ctrl = new AbortController();
    ref.current = ctrl;
    return ctrl;
  }, []);

  const isSignalCurrent = (ref: { current: AbortController | null }, signal: AbortSignal) =>
    ref.current?.signal === signal;

  const loadAnnouncements = useCallback(
    (forceFresh = false) => {
      const controller = createAbortController(annControllerRef);
      const signal = controller.signal;
      setLoadingAnnouncements(true);

      if (forceFresh) {
        invalidateAnnouncementCache();
      }

      const announcementLimit = showMoreAnnouncements ? 50 : 5;

      void (async () => {
        try {
          const results = await fetchAnnouncements(announcementLimit, { forceFresh, signal });
          if (!isSignalCurrent(annControllerRef, signal)) return;
          setAnnouncements(results);
        } catch (err) {
          if (isAbortError(err)) return;
          console.error('Failed to load Q-Assets announcements', err);
          if (isSignalCurrent(annControllerRef, signal)) {
            setAnnouncements([]);
          }
        } finally {
          if (isSignalCurrent(annControllerRef, signal)) {
            setLoadingAnnouncements(false);
          }
        }
      })();
    },
    [createAbortController, showMoreAnnouncements]
  );

  const loadAssetNews = useCallback(() => {
    const controller = createAbortController(newsControllerRef);
    const signal = controller.signal;
    setLoadingAssetNews(true);

    const assetNewsLimit = showMoreNews ? 50 : 8;

    void (async () => {
      try {
        const results = await fetchLatestAssetNews(assetNewsLimit, {
          allowedGroupIds: memberGroupIds,
          signal,
        });
        if (!isSignalCurrent(newsControllerRef, signal)) return;
        setAssetNews(results);
      } catch (err) {
        if (isAbortError(err)) return;
        console.error('Failed to load asset news publications', err);
        if (isSignalCurrent(newsControllerRef, signal)) {
          setAssetNews([]);
        }
      } finally {
        if (isSignalCurrent(newsControllerRef, signal)) {
          setLoadingAssetNews(false);
        }
      }
    })();
  }, [createAbortController, memberGroupIds, showMoreNews]);

  const loadPromotions = useCallback(() => {
    const controller = createAbortController(promoControllerRef);
    const signal = controller.signal;
    setLoadingPromotions(true);

    void (async () => {
      try {
        const results = await fetchActivePromotions(Date.now(), { signal });
        if (!isSignalCurrent(promoControllerRef, signal)) return;
        setPromotions(results);
      } catch (err) {
        if (isAbortError(err)) return;
        console.error('Failed to load promotions', err);
        if (isSignalCurrent(promoControllerRef, signal)) {
          setPromotions([]);
        }
      } finally {
        if (isSignalCurrent(promoControllerRef, signal)) {
          setLoadingPromotions(false);
        }
      }
    })();
  }, [createAbortController]);

  const handleClickItem = (item: NewsSummary) => {
    setSelected(item);
  };

  const handleBack = () => {
    setSelected(null);
    // setDetailError(null);
    // setDetailLoading(false);
  };

  useEffect(() => {
    loadAnnouncements();
    return () => {
      annControllerRef.current?.abort();
      annControllerRef.current = null;
    };
  }, [loadAnnouncements]);

  useEffect(() => {
    loadPromotions();
    return () => {
      promoControllerRef.current?.abort();
      promoControllerRef.current = null;
    };
  }, [loadPromotions]);

  useEffect(() => {
    if (groupsLoading) return;
    loadAssetNews();
    return () => {
      newsControllerRef.current?.abort();
      newsControllerRef.current = null;
    };
  }, [groupsLoading, loadAssetNews]);

  useEffect(() => {
    const handler = () => {
      loadAnnouncements(true);
      loadPromotions();
      if (!groupsLoading) {
        loadAssetNews();
      }
    };
    window.addEventListener(NEWS_REFRESH_EVENT, handler);
    return () => {
      window.removeEventListener(NEWS_REFRESH_EVENT, handler);
    };
  }, [groupsLoading, loadAnnouncements, loadAssetNews, loadPromotions]);

  useEffect(() => {
    return () => {
      annControllerRef.current?.abort();
      newsControllerRef.current?.abort();
      promoControllerRef.current?.abort();
    };
  }, []);

  const announcementList = announcements ?? [];

  const announcementActive = announcementList.filter((item) => !item.isExpired);
  const assetNewsList = assetNews || [];
  const newsActive = assetNewsList.filter((item) => !item.isExpired);

  const visibleAnnouncements = announcementActive.slice(
    0,
    showMoreAnnouncements ? Number.MAX_SAFE_INTEGER : maxPerList
  );
  const visibleNews = newsActive.slice(0, showMoreNews ? Number.MAX_SAFE_INTEGER : maxPerList);

  const promotionsList = promotions ?? [];

  const showAnnouncementSkeleton = loadingAnnouncements && announcements === null;
  const showAssetNewsSkeleton = loadingAssetNews && assetNews === null;
  const showPromotionsSkeleton = loadingPromotions && promotions === null;

  const ColumnSkeleton = () => (
    <Card
      sx={{
        height: '100%',
        borderRadius: 3,
        display: 'flex',
        flexDirection: 'column',
        justifyContent: 'center',
        boxShadow: '0 8px 24px rgba(0,0,0,0.08)',
        border: `1px solid ${alpha(theme.palette.common.white, 0.08)}`,
      }}
    >
      <CardContent>
        <Skeleton variant="text" width="60%" sx={{ mb: 1 }} />
        <Skeleton variant="text" width="90%" />
        <Skeleton variant="text" width="80%" />
      </CardContent>
    </Card>
  );

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
          <PublishedHtmlRenderer
            html={selected.fullHtml}
            sx={{
              '& img': { maxWidth: '100%', height: 'auto' },
              '& h1, & h2, & h3': { mt: 2 },
            }}
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

      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 4 }}>
          {showAnnouncementSkeleton ? (
            <ColumnSkeleton />
          ) : (
            <>
              <NewsListColumn
                title="Q-Assets Announcements"
                items={visibleAnnouncements}
                emptyText="No Q-Assets announcements yet."
                onClickItem={handleClickItem}
                variant="announcement"
              />
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  mt: 1,
                }}
              >
                {announcementActive.length > maxPerList && (
                  <Button
                    size="small"
                    onClick={() => setShowMoreAnnouncements((v) => !v)}
                    variant="outlined"
                  >
                    {showMoreAnnouncements ? 'Show less' : 'Show more'}
                  </Button>
                )}
              </Box>
            </>
          )}
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          {showAssetNewsSkeleton ? (
            <ColumnSkeleton />
          ) : (
            <>
              <NewsListColumn
                title="Asset News Publications"
                items={visibleNews}
                emptyText="No Asset news published by issuers recently... "
                onClickItem={handleClickItem}
                variant="news"
              />
              <Box
                sx={{
                  display: 'flex',
                  gap: 1,
                  flexWrap: 'wrap',
                  justifyContent: 'center',
                  mt: 1,
                }}
              >
                {newsActive.length > maxPerList && (
                  <Button
                    size="small"
                    onClick={() => setShowMoreNews((v) => !v)}
                    variant="outlined"
                  >
                    {showMoreNews ? 'Show less' : 'Show more'}
                  </Button>
                )}
              </Box>
            </>
          )}
        </Grid>
        <Grid size={{ xs: 12, md: 4 }}>
          {showPromotionsSkeleton ? (
            <ColumnSkeleton />
          ) : (
            <NewsListColumn
              title="Promotions"
              items={promotionsList}
              emptyText="No active promotions."
              onClickItem={handleClickItem}
              variant="promotion"
            />
          )}
        </Grid>
      </Grid>
      <NewsActionBar
        treasuryAddress="Q-Assets" // TODO put real address for the treasury account. We do not want to utilize Q-Assets.
        defaultPromoPriceQort={5}
      />
    </Box>
  );
}
