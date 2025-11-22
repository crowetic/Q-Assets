import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Box, Typography, Paper, Stack, Button, Chip, CircularProgress } from '@mui/material';
import Grid from '@mui/material/Grid';
import { Link as RouterLink } from 'react-router-dom';
import CampaignRoundedIcon from '@mui/icons-material/CampaignRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import AssessmentRoundedIcon from '@mui/icons-material/AssessmentRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import ShieldRoundedIcon from '@mui/icons-material/ShieldRounded';

import { getUserRoles, UserRoles } from '../../utils/roles';
import { Q_ASSETS_MANAGEMENT_GROUP_ID, Q_ASSETS_VERSION } from '../../constants/qdnConstants';
import { fetchAnnouncements, fetchActivePromotions, fetchLatestAssetNews } from '../../utils/news';
import type {
  NewsSummary,
  PromotionRequest,
  PromotionContribution,
  PaidPromotion,
} from '../../types/newsAndPromos';
import AnnouncementDialog from '../../components/news/AnnouncementDialog';
import {
  fetchPromotionRequests,
  fetchPromotionApprovals,
  summarizePromotionContributions,
  setPromotionActive,
} from '../../utils/promotions';

type FeedState = {
  announcements: NewsSummary[];
  promotions: NewsSummary[];
  assetNews: NewsSummary[];
};

const initialFeed: FeedState = { announcements: [], promotions: [], assetNews: [] };

function StatRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 2,
        fontSize: 14,
        borderBottom: '1px solid',
        borderColor: 'divider',
        py: 0.75,
      }}
    >
      <Typography variant="body2" color="text.secondary" sx={{ flexBasis: '45%' }}>
        {label}
      </Typography>
      <Typography
        variant="body2"
        sx={{ fontWeight: 600, flexGrow: 1, textAlign: 'right', wordBreak: 'break-all' }}
      >
        {value}
      </Typography>
    </Box>
  );
}

function FeedPanel({
  title,
  icon,
  color,
  items,
  loading,
  emptyText,
  renderMeta,
}: {
  title: string;
  icon: ReactNode;
  color: string;
  items: NewsSummary[];
  loading: boolean;
  emptyText: string;
  renderMeta?: (item: NewsSummary) => React.ReactNode;
}) {
  return (
    <Paper variant="outlined" sx={{ p: 2.5, borderRadius: 3, height: '100%' }}>
      <Stack
        direction="row"
        spacing={1}
        alignItems="center"
        sx={{ mb: 1.5, color }}
        aria-label={title}
      >
        <Box sx={{ fontSize: 28 }}>{icon}</Box>
        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
          {title}
        </Typography>
      </Stack>
      {loading ? (
        <Box sx={{ display: 'flex', justifyContent: 'center', py: 4 }}>
          <CircularProgress size={28} />
        </Box>
      ) : items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {emptyText}
        </Typography>
      ) : (
        <Stack spacing={1.5}>
          {items.map((item) => (
            <Box
              key={item.identifier}
              sx={{ borderBottom: '1px solid', borderColor: 'divider', pb: 1.25 }}
            >
              <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                {item.title}
              </Typography>
              <Typography variant="caption" color="text.secondary">
                {item.publisherName || 'Unknown publisher'} ·{' '}
                {new Date(item.created).toLocaleString()}
              </Typography>
              {renderMeta ? (
                <Typography variant="caption" color="info.main" sx={{ display: 'block' }}>
                  {renderMeta(item)}
                </Typography>
              ) : null}
              <Typography variant="body2" sx={{ mt: 0.75 }}>
                {item.excerpt}
              </Typography>
            </Box>
          ))}
        </Stack>
      )}
    </Paper>
  );
}

const formatAmount = (value?: number) =>
  Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });

const stripHtml = (html?: string) =>
  (html || '')
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

export default function AdminPanel() {
  const [roles, setRoles] = useState<UserRoles | null>(null);
  const [rolesLoading, setRolesLoading] = useState(true);
  const [announcementOpen, setAnnouncementOpen] = useState(false);
  const [feed, setFeed] = useState<FeedState>(initialFeed);
  const [feedLoading, setFeedLoading] = useState(false);
  const [feedError, setFeedError] = useState<string | null>(null);
  const [promoRequests, setPromoRequests] = useState<PromotionRequest[]>([]);
  const [promoLoading, setPromoLoading] = useState(false);
  const [promoError, setPromoError] = useState<string | null>(null);
  const [approvals, setApprovals] = useState<Map<string, PaidPromotion>>(new Map());
  const [contributions, setContributions] = useState<PromotionContribution[]>([]);
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        setRolesLoading(true);
        const loaded = await getUserRoles();
        if (alive) setRoles(loaded);
      } finally {
        if (alive) setRolesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const canAccess = Boolean(roles?.isManagementAdmin);

  const refreshFeed = useCallback(async () => {
    if (!canAccess) return;
    setFeedLoading(true);
    setFeedError(null);
    try {
      const [ann, promos, latestNews] = await Promise.all([
        fetchAnnouncements(5),
        fetchActivePromotions(),
        fetchLatestAssetNews(5),
      ]);
      setFeed({ announcements: ann, promotions: promos, assetNews: latestNews });
    } catch (e: any) {
      setFeedError(e?.message || 'Unable to load latest content.');
    } finally {
      setFeedLoading(false);
    }
  }, [canAccess]);

  useEffect(() => {
    refreshFeed();
  }, [refreshFeed]);

  const loadPromotionData = useCallback(async () => {
    if (!canAccess) return;
    setPromoLoading(true);
    setPromoError(null);
    try {
      const [requests, approvalsList] = await Promise.all([
        fetchPromotionRequests(200),
        fetchPromotionApprovals(200),
      ]);
      setPromoRequests(requests);
      setContributions(summarizePromotionContributions(requests));
      const map = new Map<string, PaidPromotion>();
      approvalsList.forEach((appr) => {
        const key = appr.requestIdentifier || appr.id;
        if (key) map.set(key, appr);
      });
      setApprovals(map);
    } catch (e: any) {
      setPromoError(e?.message || 'Unable to load promotions.');
    } finally {
      setPromoLoading(false);
    }
  }, [canAccess]);

  useEffect(() => {
    loadPromotionData();
  }, [loadPromotionData]);

  const handleTogglePromotion = useCallback(
    async (request: PromotionRequest, makeActive: boolean) => {
      if (!roles?.userName) {
        setPromoError('Unable to determine your admin name for publishing.');
        return;
      }
      setUpdatingId(request.identifier);
      try {
        await setPromotionActive(request, makeActive, roles.userName);
        await loadPromotionData();
      } catch (e: any) {
        setPromoError(e?.message || 'Failed to update promotion status.');
      } finally {
        setUpdatingId(null);
      }
    },
    [roles?.userName, loadPromotionData]
  );

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: 1100 }}>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} justifyContent="space-between">
        <Box>
          <Typography variant="h4" sx={{ lineHeight: 1.15 }}>
            Management Admin Panel
          </Typography>
          <Typography variant="body1" color="text.secondary">
            Tools and telemetry for Q-Assets-Management group admins.
          </Typography>
        </Box>
        <Button component={RouterLink} to="/manage" variant="text" sx={{ alignSelf: 'flex-start' }}>
          ← Back to Manage
        </Button>
      </Stack>

      {rolesLoading ? (
        <Paper variant="outlined" sx={{ p: 4, mt: 3, display: 'flex', justifyContent: 'center' }}>
          <CircularProgress />
        </Paper>
      ) : !canAccess ? (
        <Paper variant="outlined" sx={{ p: 3, mt: 3 }}>
          <Typography variant="h6" sx={{ mb: 1 }}>
            Admin access required
          </Typography>
          <Typography variant="body2" color="text.secondary">
            This panel is limited to administrators of the Q-Assets-Management group (ID{' '}
            {Q_ASSETS_MANAGEMENT_GROUP_ID}). If you recently gained access, refresh your session and
            try again.
          </Typography>
        </Paper>
      ) : (
        <>
          <Grid container spacing={2.5} sx={{ mt: 2 }}>
            <Grid size={{ xs: 12, md: 5 }}>
              <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, height: '100%' }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 2 }}>
                  <ShieldRoundedIcon color="success" />
                  <Typography variant="h6">Access snapshot</Typography>
                </Stack>
                <Stack spacing={1}>
                  <StatRow label="Name" value={roles?.userName || 'Primary name unavailable'} />
                  <StatRow label="Address" value={roles?.userAddress || 'Unknown'} />
                  <StatRow label="Group ID" value={Q_ASSETS_MANAGEMENT_GROUP_ID} />
                  <StatRow label="App Version" value={`v${Q_ASSETS_VERSION}`} />
                </Stack>
                <Stack direction="row" spacing={1} sx={{ mt: 2, flexWrap: 'wrap' }}>
                  <Chip label="Management Admin" color="success" size="small" />
                  {roles?.isAssetIssuer && <Chip label="Asset Issuer" color="info" size="small" />}
                </Stack>
                <Button
                  variant="contained"
                  size="small"
                  sx={{ mt: 2 }}
                  startIcon={<CampaignRoundedIcon fontSize="small" />}
                  onClick={() => setAnnouncementOpen(true)}
                >
                  New Announcement
                </Button>
              </Paper>
            </Grid>
            <Grid size={{ xs: 12, md: 7 }}>
              <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, height: '100%' }}>
                <Stack direction="row" spacing={1} alignItems="center" sx={{ mb: 1.5 }}>
                  <PaymentsRoundedIcon color="warning" />
                  <Typography variant="h6">Contribution dashboard</Typography>
                  <Chip
                    label={`${contributions.length} contributor${contributions.length === 1 ? '' : 's'}`}
                    size="small"
                    sx={{ ml: 'auto' }}
                  />
                </Stack>
                {contributions.length === 0 ? (
                  <Typography variant="body2" color="text.secondary">
                    No paid promotions have been submitted yet.
                  </Typography>
                ) : (
                  <Stack spacing={1.25} sx={{ mt: 1 }}>
                    {contributions.slice(0, 6).map((entry) => (
                      <Box
                        key={entry.account}
                        sx={{
                          border: '1px solid',
                          borderColor: 'divider',
                          borderRadius: 2,
                          p: 1.25,
                        }}
                      >
                        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
                          {entry.account}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                          {entry.requestCount} submission{entry.requestCount === 1 ? '' : 's'} ·
                          Last {new Date(entry.lastContributionAt).toLocaleString()}
                        </Typography>
                        <Stack direction="row" spacing={1} sx={{ mt: 0.5, flexWrap: 'wrap' }}>
                          {entry.totalQort > 0 && (
                            <Chip
                              size="small"
                              color="info"
                              label={`${formatAmount(entry.totalQort)} QORT`}
                            />
                          )}
                          {entry.totalQAsset > 0 && (
                            <Chip
                              size="small"
                              color="warning"
                              label={`${formatAmount(entry.totalQAsset)} Q-Asset`}
                            />
                          )}
                        </Stack>
                      </Box>
                    ))}
                  </Stack>
                )}
              </Paper>
            </Grid>
          </Grid>

          <Paper variant="outlined" sx={{ p: 3, borderRadius: 3, mt: 3 }}>
            <Stack
              direction={{ xs: 'column', sm: 'row' }}
              spacing={1}
              justifyContent="space-between"
              alignItems={{ xs: 'flex-start', sm: 'center' }}
            >
              <Box>
                <Typography variant="h6">Submitted promotions</Typography>
                <Typography variant="body2" color="text.secondary">
                  Review paid requests and toggle whether they are active on Q-Assets.
                </Typography>
              </Box>
              <Stack direction="row" spacing={1} alignItems="center">
                {promoError && (
                  <Typography variant="body2" color="error.main">
                    {promoError}
                  </Typography>
                )}
                <Button
                  size="small"
                  startIcon={<RefreshRoundedIcon />}
                  onClick={loadPromotionData}
                  disabled={promoLoading}
                >
                  Refresh
                </Button>
              </Stack>
            </Stack>
            {promoLoading ? (
              <Box sx={{ display: 'flex', justifyContent: 'center', py: 3 }}>
                <CircularProgress size={28} />
              </Box>
            ) : promoRequests.length === 0 ? (
              <Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
                No promotion submissions yet.
              </Typography>
            ) : (
              <Stack spacing={1.5} sx={{ mt: 2 }}>
                {promoRequests.map((req) => {
                  const approval = approvals.get(req.identifier);
                  const status = approval ? (approval.isActive ? 'active' : 'inactive') : 'pending';
                  const statusColor: 'success' | 'warning' | 'default' =
                    status === 'active' ? 'success' : status === 'pending' ? 'warning' : 'default';
                  const snippet = stripHtml(req.contentHtml).slice(0, 220);
                  return (
                    <Paper
                      key={req.identifier}
                      variant="outlined"
                      sx={{ p: 2, borderRadius: 2, borderColor: 'divider' }}
                    >
                      <Stack
                        direction={{ xs: 'column', sm: 'row' }}
                        justifyContent="space-between"
                        spacing={1}
                      >
                        <Typography variant="subtitle1" sx={{ fontWeight: 600 }}>
                          {req.title}
                        </Typography>
                        <Chip
                          label={status.charAt(0).toUpperCase() + status.slice(1)}
                          color={statusColor}
                          size="small"
                        />
                      </Stack>
                      <Typography variant="caption" color="text.secondary">
                        Submitted by {req.createdBy} on {new Date(req.createdAt).toLocaleString()}
                      </Typography>
                      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap' }}>
                        <Chip
                          size="small"
                          label={
                            req.scope === 'asset'
                              ? req.assetName || `Asset #${req.assetId ?? 'N/A'}`
                              : req.targetDescription || 'General promotion'
                          }
                        />
                        <Chip
                          size="small"
                          label={`${formatAmount(req.payment?.amountPaid)} ${
                            req.payment?.currency === 'QASSET' ? 'Q-Asset' : 'QORT'
                          }`}
                        />
                        <Chip
                          size="small"
                          label={`${new Date(req.startsAt).toLocaleDateString()} → ${new Date(
                            req.endsAt
                          ).toLocaleDateString()}`}
                        />
                      </Stack>
                      {snippet && (
                        <Typography
                          variant="body2"
                          color="text.secondary"
                          sx={{
                            mt: 1,
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            overflow: 'hidden',
                          }}
                        >
                          {snippet}
                          {snippet.length === 220 ? '…' : ''}
                        </Typography>
                      )}
                      <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
                        <Button
                          size="small"
                          variant="contained"
                          onClick={() => handleTogglePromotion(req, true)}
                          disabled={status === 'active' || updatingId === req.identifier}
                        >
                          Mark Active
                        </Button>
                        <Button
                          size="small"
                          variant="outlined"
                          onClick={() => handleTogglePromotion(req, false)}
                          disabled={
                            status === 'inactive' ||
                            status === 'pending' ||
                            updatingId === req.identifier
                          }
                        >
                          Mark Inactive
                        </Button>
                      </Stack>
                    </Paper>
                  );
                })}
              </Stack>
            )}
          </Paper>

          <Stack
            direction={{ xs: 'column', sm: 'row' }}
            spacing={1}
            alignItems={{ xs: 'stretch', sm: 'center' }}
            sx={{ mt: 3 }}
          >
            <Stack direction="row" spacing={1} alignItems="center">
              <AssessmentRoundedIcon color="primary" />
              <Typography variant="h6">Live content</Typography>
            </Stack>
            <Box sx={{ flexGrow: 1 }} />
            <Stack direction="row" spacing={1} alignItems="center">
              {feedError && (
                <Typography variant="body2" color="error.main">
                  {feedError}
                </Typography>
              )}
              <Button
                size="small"
                startIcon={<RefreshRoundedIcon />}
                onClick={refreshFeed}
                disabled={feedLoading}
              >
                Refresh
              </Button>
            </Stack>
          </Stack>

          <Grid container spacing={2.5} sx={{ mt: 1 }}>
            <Grid size={{ xs: 12, md: 4 }}>
              <FeedPanel
                title="Active Promotions"
                icon={<CampaignRoundedIcon />}
                color="#f57c00"
                items={feed.promotions}
                loading={feedLoading}
                emptyText="No promotions are currently active."
                renderMeta={(item) =>
                  item.promotionEndsAt
                    ? `Ends ${new Date(item.promotionEndsAt).toLocaleString()}`
                    : undefined
                }
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FeedPanel
                title="Latest Announcements"
                icon={<CampaignRoundedIcon />}
                color="#1976d2"
                items={feed.announcements}
                loading={feedLoading}
                emptyText="No announcements published yet."
              />
            </Grid>
            <Grid size={{ xs: 12, md: 4 }}>
              <FeedPanel
                title="Asset News"
                icon={<AssessmentRoundedIcon />}
                color="#2e7d32"
                items={feed.assetNews}
                loading={feedLoading}
                emptyText="No recent asset news available."
                renderMeta={(item) =>
                  item.assetName ? `${item.assetName} · ID#${item.assetId}` : undefined
                }
              />
            </Grid>
          </Grid>
        </>
      )}

      <AnnouncementDialog open={announcementOpen} onClose={() => setAnnouncementOpen(false)} />
    </Box>
  );
}
