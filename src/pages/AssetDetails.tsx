import { useEffect, useState, useMemo, useRef } from 'react';
import {
  Typography,
  Box,
  Card,
  // CardContent,
  Avatar,
  Paper,
  Link,
  Collapse,
  Button,
  Alert,
  Chip,
  useTheme,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  TextField,
  Switch,
  FormControlLabel,
  Stack,
  IconButton,
} from '@mui/material';
import Grid from '@mui/material/Grid';
import DeleteIcon from '@mui/icons-material/Delete';
import AddIcon from '@mui/icons-material/Add';
import { useParams } from 'react-router-dom';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { fetchAssetPublication } from '../utils/fetchAssetPublication';
import { useAuth } from 'qapp-core';
import { getPrimaryAccountName } from '../utils/qortalApi';
import { getAssetIdentifiers } from '../constants/qdnConstants';
import { fileToBase64 } from '../utils/data';
import { publishAssetPublication } from '../utils/publishAssetPublication';
import { formatAssetAmount } from '../utils/qortalAssetRequests';
import type { AssetPublication } from '../types/AssetPublicationMetadata';
import { getAssetBalances } from '../utils/qortalAssetRequests';
import TiptapEditor from '../components/TipTapEditor';
import EditToggleButton from '../components/buttons/EditToggleButton';
import InfoOutlineButton from '../components/buttons/InfoOutlineButton';
import CancelButton from '../components/buttons/CancelButton';
import SuccessButton from '../components/buttons/SuccessButton';
import {
  ensureAssetsIndexLoaded,
  ensureAssetMini,
  readAssetsIndexSync,
} from '../bootstrap/assetsBootstrap';
import { prepareHtmlForPublish } from '../utils/publicationPublisher';
import CommentsSection from '../components/comments/CommentsSection';
// import PaidUpvotesSection from '../components/asset/PaidUpvoteSection';
import NewsPublisher from '../components/news/NewsPublisher';
import PageContainer from '../components/layout/PageContainer';
import SectionCard from '../components/layout/SectionCard';
// import { useNavigate } from 'react-router-dom';
import ActionsToolbar from '../components/asset/ActionsToolbar';
import PublishedHtmlRenderer from '../components/PublishedHtmlRenderer';
import { useAlert } from '../components/alerts';
import { updateAsset, getAccount } from '../utils/qortalApi';
// import { getAssetInfo } from '../utils/qortalAssetRequests';

type Enriched = {
  assetId: number;
  name: string;
  description?: string;
  owner: string;
  quantity: number;
  isDivisible: boolean;
  isUnspendable: boolean;
  totalSupply: number;
  circulating: number;
};

export default function AssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();
  const [asset, setAsset] = useState<Enriched | null>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [assetPub, setAssetPub] = useState<AssetPublication | null>(null);
  const [html, setHtml] = useState('');
  const { address: userAddress, name: userName } = useAuth();
  const [issuerName, setIssuerName] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const editorRef = useRef<HTMLDivElement | null>(null);
  const theme = useTheme();
  // Primary Group State
  const [openPrimaryDlg, setOpenPrimaryDlg] = useState(false);
  const [primaryForm, setPrimaryForm] = useState(
    assetPub?.primaryGroup ?? { name: '', id: '', joinLink: '', isPrivate: false }
  );
  // Extra Groups
  const [openExtraDlg, setOpenExtraDlg] = useState(false);
  const [extraGroupsForm, setExtraGroupsForm] = useState(assetPub?.extraGroups ?? []);
  // News
  const [openNewsDlg, setOpenNewsDlg] = useState(false);
  const [newsForm, setNewsForm] = useState(assetPub?.news ?? []);

  type KV = { key: string; value: string };
  const [openExFieldDlg, setOpenExFieldDlg] = useState(false);
  const [kvForm, setKvForm] = useState<KV[]>(
    assetPub?.customFields
      ? Object.entries(assetPub.customFields).map(([key, value]) => ({ key, value }))
      : []
  );
  // near other dialog state
  const [openDivDlg, setOpenDivDlg] = useState(false);
  const [divEnabled, setDivEnabled] = useState<boolean>(assetPub?.dividends ?? false);
  const [divPeriod, setDivPeriod] = useState<'1W' | '2W' | '1M' | '3M' | '6M' | '1Y'>(
    assetPub?.dividendPeriod ?? '1M'
  );

  //asset desctiption / on-chain / update state
  const [openDescDlg, setOpenDescDlg] = useState(false);
  const [descForm, setDescForm] = useState<string>('');
  const [descErr, setDescErr] = useState<string>('');
  const savingDescRef = useRef(false);

  // const navigate = useNavigate();
  const isIssuer = !!asset && !!userAddress && asset.owner === userAddress;
  const { alert } = useAlert();

  const canPublish = isIssuer && issuerName && issuerName === (userName as string | undefined);
  const id = useMemo(() => Number(assetId), [assetId]);

  useEffect(() => {
    if (editing) setHtml(assetPub?.html ?? '');
  }, [isIssuer, editing]);

  useEffect(() => {
    if (!editing) setHtml(assetPub?.html ?? '');
  }, [assetPub, editing]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!Number.isFinite(id)) return;

      try {
        // 1) Try sync cache
        let mini = readAssetsIndexSync()?.[id] ?? null;

        // 2) Ensure index (fast if fresh)
        if (!mini) {
          const idx = await ensureAssetsIndexLoaded();
          mini = idx[id] ?? null;
        }

        // 3) Single-asset fallback
        if (!mini) {
          mini = await ensureAssetMini(id);
        }

        if (!mini) return; // not found

        setDescForm(mini?.description ?? '');

        // issuer name
        let iname = '';
        try {
          iname = await getPrimaryAccountName(mini.owner);
        } catch {}
        if (!cancelled) setIssuerName(iname || null);

        // total & circulating
        const isQort = mini.assetId === 0;

        // Total supply
        let totalSupply: number;
        if (isQort) {
          // /stats/supply/circulating returns text/plain
          const txt = await fetch('/stats/supply/circulating')
            .then((r) => r.text())
            .catch(() => '0');
          const n = parseFloat(txt);
          totalSupply = Number.isFinite(n) ? n : 0;
        } else {
          totalSupply = mini.quantity / 1e8;
        }

        // Issuer balance (getAssetBalances already returns human-normalized values)
        let issuerBal = 0;
        if (!isQort) {
          try {
            const res = await getAssetBalances({
              addresses: [mini.owner],
              assetIds: [mini.assetId],
              excludeZero: true,
            });
            issuerBal = res?.length ? parseFloat(res[0].balance) : 0;
          } catch {
            issuerBal = 0;
          }
        }

        // Circulating
        const circulating = isQort ? totalSupply : Math.max(0, totalSupply - issuerBal);

        // If you’re building an `asset` object:
        const enriched = {
          ...mini,
          totalSupply,
          circulating,
        };
        setAsset(enriched);
        if (!cancelled) setAsset(enriched);

        // Avatar
        try {
          let avatarIssuer =
            mini.name === 'QORT' || mini.name === 'QORT-from-QORA' || mini.name === 'Legacy-QORA'
              ? 'Q-Assets'
              : iname;

          if (avatarIssuer) {
            const url = await fetchAssetAvatar(avatarIssuer, mini.name);
            if (!cancelled) setAvatar(url);
          }
        } catch {}

        // Publication
        try {
          if (iname) {
            const pub = await fetchAssetPublication(iname, mini.name);
            if (!cancelled) setAssetPub(pub);
          }
        } catch {}
      } catch (e) {
        // swallow; page renders with error states below if needed
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    setPrimaryForm(assetPub?.primaryGroup ?? { name: '', id: '', joinLink: '', isPrivate: false });
    setExtraGroupsForm(assetPub?.extraGroups ?? []);
    setNewsForm(assetPub?.news ?? []);
    setKvForm(
      assetPub?.customFields
        ? Object.entries(assetPub.customFields).map(([key, value]) => ({ key, value }))
        : []
    );
    setDivEnabled(Boolean(assetPub?.dividends));
    setDivPeriod((assetPub?.dividendPeriod as any) ?? '1M');
  }, [assetPub]);

  if (!asset) return <Typography>Loading asset...</Typography>;

  return (
    <PageContainer>
      {/* Header row: title + (left info, right actions) */}
      {/* Header row: centered pair (Info + Actions) */}
      <Grid
        container
        spacing={2}
        justifyContent="center"
        alignItems="stretch"
        sx={{ maxWidth: '75%', mx: 'auto' }} // centers the pair
      >
        {/* Title (full width, centered) */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="h3" textAlign="center">
            Asset Details
          </Typography>
        </Grid>

        {/* Avatar + basic info */}
        <Grid size={{ xs: 12, md: 6, lg: 6 }} sx={{ display: 'flex', justifyContent: 'center' }}>
          <Card
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              alignContent: 'center',
              textAlign: 'center',
              borderRadius: '2.5rem',
              gap: 3,
              p: 3,
              width: '100%',
              maxWidth: '80rem', // keeps a nice readable width
              height: '100%', // matches Actions card height
            }}
          >
            {avatar && (
              <Avatar
                src={avatar}
                sx={{ minWidth: 120, minHeight: 120, width: 160, height: 160 }}
              />
            )}

            <Box flex={1}>
              <Typography variant="h4">{asset.name}</Typography>
              <Typography variant="subtitle1">
                <span>{asset.description}</span>
              </Typography>

              <Box
                mt={1}
                display="flex"
                flexWrap="wrap"
                gap={1}
                alignItems="center"
                alignContent={'center'}
                justifyContent={'center'}
              >
                <Chip label={`Asset ID: ${asset.assetId}`} />
                <Chip
                  label={`Dividends: ${assetPub?.dividends ? 'Yes' : 'No'}`}
                  color={assetPub?.dividends ? 'success' : 'default'}
                  variant={assetPub?.dividends ? 'filled' : 'outlined'}
                />
                {assetPub?.dividends && assetPub?.dividendPeriod && (
                  <Chip label={`Period: ${assetPub.dividendPeriod}`} color="secondary" />
                )}
              </Box>

              <Box mt={1}>
                <Typography>
                  Divisible:{' '}
                  <span style={{ color: theme.palette.secondary.light }}>
                    {asset.isDivisible ? 'Yes' : 'No'}
                  </span>
                </Typography>
                <Typography>
                  Unspendable:{' '}
                  <span style={{ color: theme.palette.secondary.light }}>
                    {asset.isUnspendable ? 'Yes' : 'No'}
                  </span>
                </Typography>
              </Box>

              {canPublish && (
                <Box mt={1} display="flex" justifyContent="center" gap={1} flexWrap="wrap">
                  <InfoOutlineButton onClick={() => setOpenDivDlg(true)}>
                    Edit Dividends
                  </InfoOutlineButton>
                  <InfoOutlineButton onClick={() => setOpenDescDlg(true)}>
                    Edit Description (on-chain)
                  </InfoOutlineButton>
                </Box>
              )}
            </Box>
          </Card>
        </Grid>
        <ActionsToolbar
          assetId={asset.assetId}
          assetName={asset.name}
          primaryGroup={{
            id: assetPub?.primaryGroup?.id,
            joinLink: assetPub?.primaryGroup?.joinLink,
          }}
          onOpenComment={() =>
            document
              .getElementById('comments-section-anchor')
              ?.scrollIntoView({ behavior: 'smooth', block: 'start' })
          }
          onOpenUpvotes={() => {
            /* later */
          }}
          showAssetData={true}
        />
      </Grid>

      {/* Row: Supply + Issuer */}
      <Grid container spacing={2}>
        <Grid size={{ xs: 12, md: 6, lg: 6 }}>
          <Typography variant="h4" textAlign="center">
            Supply
          </Typography>
          <SectionCard>
            <Box
              display="flex"
              textAlign="center"
              justifyContent={'center'}
              alignItems="center"
              gap={1}
            >
              <Typography>Circulating:</Typography>
              <Chip
                label={formatAssetAmount(asset.circulating, asset.isDivisible)}
                sx={{ color: theme.palette.text.primary }}
              />
            </Box>
            <Typography sx={{ mt: 1 }}>
              Total:{' '}
              <span style={{ color: theme.palette.secondary.light }}>
                {formatAssetAmount(asset.totalSupply, asset.isDivisible)}
              </span>
            </Typography>
          </SectionCard>
        </Grid>

        <Grid size={{ xs: 12, md: 6, lg: 6 }}>
          <Typography variant="h4" textAlign="center">
            Issuer
          </Typography>
          <SectionCard>
            <Typography>
              Name: <span style={{ color: theme.palette.primary.contrastText }}>{issuerName}</span>
            </Typography>
            <Typography sx={{ mt: 1 }}>
              Address:{' '}
              <span style={{ color: theme.palette.primary.contrastText }}>{asset.owner}</span>
            </Typography>
          </SectionCard>
        </Grid>

        {/* Row: Asset Groups */}
        <Grid size={{ xs: 12 }} minHeight={{ sm: '7rem', md: '7rem', lg: '7rem' }}>
          <Typography variant="h4" textAlign="center">
            Asset Groups
          </Typography>
          <SectionCard>
            {assetPub?.primaryGroup ? (
              <>
                <Typography>
                  Name:{' '}
                  <span style={{ color: theme.palette.primary.contrastText }}>
                    {assetPub.primaryGroup.name}
                  </span>
                </Typography>
                <Typography sx={{ mt: 1 }}>
                  GroupID:{' '}
                  <span style={{ color: theme.palette.secondary.light }}>
                    {assetPub.primaryGroup.id}
                  </span>
                </Typography>
                {canPublish && (
                  <Box mt={2} display="flex" justifyContent="center">
                    <InfoOutlineButton onClick={() => setOpenPrimaryDlg(true)}>
                      Add/Edit Primary Group
                    </InfoOutlineButton>
                  </Box>
                )}
              </>
            ) : (
              <Typography color="text.secondary">No group data</Typography>
            )}
          </SectionCard>

          {(assetPub?.extraGroups?.length ?? 0) > 0 ? (
            <SectionCard sx={{ mt: 2 }}>
              <Typography variant="h5" textAlign="center" sx={{ mb: 1 }}>
                Other Groups
              </Typography>
              <Stack spacing={1}>
                {assetPub!.extraGroups!.map((g, i) => (
                  <Box key={`${g.id}-${i}`}>
                    <Typography>
                      Name:{' '}
                      <span style={{ color: theme.palette.primary.contrastText }}>{g.name}</span>
                    </Typography>
                    <Typography>
                      GroupID: <span style={{ color: theme.palette.secondary.light }}>{g.id}</span>
                    </Typography>
                  </Box>
                ))}
              </Stack>
              {canPublish && (
                <Box mt={2} display="flex" justifyContent="center">
                  <InfoOutlineButton onClick={() => setOpenExtraDlg(true)}>
                    Add/Edit Extra Groups
                  </InfoOutlineButton>
                </Box>
              )}
            </SectionCard>
          ) : (
            canPublish && (
              // <SectionCard sx={{ mt: 2 }}>
              //   <Typography color="text.secondary">No extra groups yet.</Typography>
              //   <Box mt={2} display="flex" justifyContent="center" textAlign={'center'}>
              //     <InfoOutlineButton onClick={() => setOpenExtraDlg(true)}>
              //       Add Extra Groups
              //     </InfoOutlineButton>
              //   </Box>
              // </SectionCard>
              <Typography align="center">ExtraGroup Features coming soon...</Typography>
            )
          )}
        </Grid>

        {/* Row: Genesis Publication */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="h4" textAlign="center" sx={{ mt: 2 }}>
            Genesis Publication
          </Typography>
          {assetPub?.html ? (
            // <Paper elevation={2} sx={{ p: 3, backgroundColor: theme.palette.primary.light }}>
            //   <Box
            //     sx={{
            //       typography: 'body1',
            //       '& h1, h2, h3, h4, h5, h6': { mt: 2 },
            //       '& p': { mt: 1.5 },
            //     }}
            //     dangerouslySetInnerHTML={{ __html: PublishedHtmlRenderer(assetPub.html) }}
            //   />
            // </Paper>
            <Paper elevation={2} sx={{ p: 3, backgroundColor: theme.palette.primary.light }}>
              <PublishedHtmlRenderer
                html={assetPub.html}
                scopeClassName="qdn-content"
                sx={{
                  typography: 'body1',
                  '& h1, h2, h3, h4, h5, h6': { mt: 2 },
                  '& p': { mt: 1.5 },
                }}
              />
            </Paper>
          ) : (
            <Alert severity="info">No publication found.</Alert>
          )}
          {canPublish && (
            <Box display="flex" alignItems="center" justifyContent="center" gap={2} mb={1} p={2}>
              <Typography>You are the ISSUER of this asset. Click to edit.</Typography>
              <EditToggleButton
                editing={editing}
                onClick={() => setEditing((s) => !s)}
                aria-expanded={editing}
                aria-controls="asset-editor-panel"
              >
                {editing ? 'CLOSE EDITOR' : ' EDIT PUBLICATION / PUBLISH CHANGES'}
              </EditToggleButton>
            </Box>
          )}
        </Grid>

        {/* Row: Comments (full width on mobile, half on lg if you want) */}
        <Grid size={{ xs: 12, lg: 12 }}>
          <div id="comments-section-anchor" />
          <CommentsSection
            assetId={asset.assetId}
            primaryGroupId={parseInt(String(assetPub?.primaryGroup?.id || ''), 10)}
            issuerName={issuerName}
            isIssuer={!!canPublish}
          />
        </Grid>

        {/* NEWS */}
        <Grid size={{ xs: 12 }}>
          <Typography variant="h4" textAlign="center" sx={{ mt: 2 }}>
            News
          </Typography>
          <SectionCard sx={{ mt: 1 }}>
            {canPublish && (
              <Box
                sx={{ display: 'flex', justifyContent: 'center', gap: 1, mb: 2, flexWrap: 'wrap' }}
              >
                {/* <InfoOutlineButton onClick={() => setOpenNewsDlg(true)}>
                  Add/Edit News Links
                </InfoOutlineButton> */}
                <NewsPublisher
                  assetId={asset.assetId}
                  primaryGroupId={parseInt(String(assetPub?.primaryGroup?.id || ''), 10)}
                  isIssuer={!!canPublish}
                  onPublished={() => setNewsForm((s) => s.slice())}
                />
              </Box>
            )}
            {!assetPub?.news?.length ? (
              <Typography color="text.secondary" textAlign="center">
                News Publishing Functions, but Doesn't display yet.
              </Typography>
            ) : (
              <Stack spacing={1}>
                {assetPub.news
                  .slice()
                  .sort((a, b) => (a.date || '').localeCompare(b.date || ''))
                  .reverse()
                  .map((n, i) => (
                    <Box
                      key={`${n.postId || n.title}-${i}`}
                      sx={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto', gap: 1 }}
                    >
                      <Typography variant="body2" color="text.secondary">
                        {new Date(n.date).toLocaleDateString()}
                      </Typography>
                      <Typography variant="body1">{n.title}</Typography>
                      {n.postId ? (
                        <Link href={`/APP/Q-Blog/${n.postId}`} rel="noopener">
                          Open
                        </Link>
                      ) : null}
                    </Box>
                  ))}
              </Stack>
            )}
          </SectionCard>

          {canPublish && (
            <Box mt={1} display="flex" justifyContent="center">
              <InfoOutlineButton onClick={() => setOpenExFieldDlg(true)}>
                Add/Edit Custom Fields
              </InfoOutlineButton>
            </Box>
          )}
        </Grid>
      </Grid>

      <Dialog
        open={openPrimaryDlg}
        onClose={() => setOpenPrimaryDlg(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit Primary Group</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'grid', gap: 2, mt: 1 }}>
            <TextField
              label="Name"
              value={primaryForm.name}
              onChange={(e) => setPrimaryForm((s) => ({ ...s, name: e.target.value }))}
              size="small"
            />
            <TextField
              label="Group ID"
              value={primaryForm.id}
              onChange={(e) => setPrimaryForm((s) => ({ ...s, id: e.target.value }))}
              size="small"
            />
            <TextField
              label="Join Link"
              value={primaryForm.joinLink}
              onChange={(e) => setPrimaryForm((s) => ({ ...s, joinLink: e.target.value }))}
              size="small"
            />
            <FormControlLabel
              control={
                <Switch
                  checked={Boolean(primaryForm.isPrivate)}
                  onChange={(e) => setPrimaryForm((s) => ({ ...s, isPrivate: e.target.checked }))}
                />
              }
              label="Private group"
            />
          </Box>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenPrimaryDlg(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setAssetPub((prev) => ({
                ...(prev ?? {}),
                primaryGroup: { ...primaryForm },
              }));
              setOpenPrimaryDlg(false);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openExtraDlg} onClose={() => setOpenExtraDlg(false)} fullWidth maxWidth="md">
        <DialogTitle>Manage Extra Groups</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {extraGroupsForm.map((g, i) => (
              <Box
                key={i}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 2fr auto auto',
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <TextField
                  label="Name"
                  value={g.name}
                  size="small"
                  onChange={(e) =>
                    setExtraGroupsForm((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, name: e.target.value } : x))
                    )
                  }
                />
                <TextField
                  label="Group ID"
                  value={g.id}
                  size="small"
                  onChange={(e) =>
                    setExtraGroupsForm((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, id: e.target.value } : x))
                    )
                  }
                />
                <TextField
                  label="Join Link"
                  value={g.joinLink}
                  size="small"
                  onChange={(e) =>
                    setExtraGroupsForm((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, joinLink: e.target.value } : x))
                    )
                  }
                />
                <FormControlLabel
                  control={
                    <Switch
                      checked={Boolean(g.isPrivate)}
                      onChange={(e) =>
                        setExtraGroupsForm((s) =>
                          s.map((x, idx) => (idx === i ? { ...x, isPrivate: e.target.checked } : x))
                        )
                      }
                    />
                  }
                  label="Private"
                />
                <IconButton
                  color="error"
                  onClick={() => setExtraGroupsForm((s) => s.filter((_, idx) => idx !== i))}
                >
                  <DeleteIcon />
                </IconButton>
              </Box>
            ))}
            <Button
              startIcon={<AddIcon />}
              onClick={() =>
                setExtraGroupsForm((s) => [
                  ...s,
                  { name: '', id: '', joinLink: '', isPrivate: false },
                ])
              }
            >
              Add Group
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenExtraDlg(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setAssetPub((prev) => ({ ...(prev ?? {}), extraGroups: extraGroupsForm }));
              setOpenExtraDlg(false);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog open={openNewsDlg} onClose={() => setOpenNewsDlg(false)} fullWidth maxWidth="md">
        <DialogTitle>Manage News</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {newsForm.map((n, i) => (
              <Box
                key={i}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 2fr auto',
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <TextField
                  label="Title"
                  value={n.title}
                  size="small"
                  onChange={(e) =>
                    setNewsForm((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x))
                    )
                  }
                />
                <TextField
                  label="Date (YYYY-MM-DD)"
                  value={n.date}
                  size="small"
                  onChange={(e) =>
                    setNewsForm((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, date: e.target.value } : x))
                    )
                  }
                />
                <TextField
                  label="Post ID"
                  value={n.postId}
                  size="small"
                  onChange={(e) =>
                    setNewsForm((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, postId: e.target.value } : x))
                    )
                  }
                />
                <IconButton
                  color="error"
                  onClick={() => setNewsForm((s) => s.filter((_, idx) => idx !== i))}
                >
                  <DeleteIcon />
                </IconButton>
              </Box>
            ))}
            <Button
              startIcon={<AddIcon />}
              onClick={() =>
                setNewsForm((s) => [
                  ...s,
                  { title: '', date: new Date().toISOString().slice(0, 10), postId: '' },
                ])
              }
            >
              Add News Item
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenNewsDlg(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setAssetPub((prev) => ({ ...(prev ?? {}), news: newsForm }));
              setOpenNewsDlg(false);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={openExFieldDlg}
        onClose={() => setOpenExFieldDlg(false)}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Manage Custom Fields</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2}>
            {kvForm.map((row, i) => (
              <Box
                key={i}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 2fr auto',
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <TextField
                  label="Key"
                  value={row.key}
                  size="small"
                  onChange={(e) =>
                    setKvForm((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, key: e.target.value } : x))
                    )
                  }
                />
                <TextField
                  label="Value"
                  value={row.value}
                  size="small"
                  onChange={(e) =>
                    setKvForm((s) =>
                      s.map((x, idx) => (idx === i ? { ...x, value: e.target.value } : x))
                    )
                  }
                />
                <IconButton
                  color="error"
                  onClick={() => setKvForm((s) => s.filter((_, idx) => idx !== i))}
                >
                  <DeleteIcon />
                </IconButton>
              </Box>
            ))}
            <Button
              startIcon={<AddIcon />}
              onClick={() => setKvForm((s) => [...s, { key: '', value: '' }])}
            >
              Add Field
            </Button>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenExFieldDlg(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              const obj = kvForm.reduce<Record<string, string>>((acc, { key, value }) => {
                if (key.trim()) acc[key.trim()] = value;
                return acc;
              }, {});
              setAssetPub((prev) => ({ ...(prev ?? {}), customFields: obj }));
              setOpenExFieldDlg(false);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog open={openDivDlg} onClose={() => setOpenDivDlg(false)} fullWidth maxWidth="xs">
        <DialogTitle>Dividends</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={2} sx={{ mt: 1 }}>
            <FormControlLabel
              control={
                <Switch checked={divEnabled} onChange={(e) => setDivEnabled(e.target.checked)} />
              }
              label="This asset pays dividends"
            />
            <TextField
              select
              label="Dividend Period"
              value={divPeriod}
              onChange={(e) => setDivPeriod(e.target.value as any)}
              size="small"
              disabled={!divEnabled}
              SelectProps={{ native: true }}
            >
              {['1W', '2W', '1M', '3M', '6M', '1Y'].map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </TextField>
            <Typography variant="caption" color="text.secondary">
              Period is declarative metadata; payouts are enforced by your asset’s logic/process.
            </Typography>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenDivDlg(false)}>Cancel</Button>
          <Button
            variant="contained"
            onClick={() => {
              setAssetPub((prev) => ({
                ...(prev ?? {}),
                dividends: divEnabled,
                dividendPeriod: divEnabled ? divPeriod : undefined,
              }));
              setOpenDivDlg(false);
            }}
          >
            Save
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={openDescDlg}
        onClose={() => {
          setOpenDescDlg(false);
          setDescErr('');
        }}
        fullWidth
        maxWidth="sm"
      >
        <DialogTitle>Edit Asset Description</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1}>
            <Typography variant="body2" color="text.secondary">
              This updates the asset’s on-chain <code>description</code> using{' '}
              <code>/assets/update</code>.
            </Typography>

            <TextField
              label="Description"
              value={descForm}
              onChange={(e) => {
                setDescForm(e.target.value);
                setDescErr('');
              }}
              multiline
              minRows={4}
              inputProps={{ maxLength: 2000 }} // adjust if chain has a smaller/greater limit
              error={!!descErr}
              helperText={descErr || `${(descForm ?? '').length}/2000`}
            />
          </Stack>
        </DialogContent>

        <DialogActions>
          <Button onClick={() => setOpenDescDlg(false)}>Cancel</Button>
          <Button
            variant="contained"
            disabled={
              savingDescRef.current || !asset || (asset.description ?? '') === (descForm ?? '')
            }
            onClick={async () => {
              try {
                if (!asset) return;
                const newDescription = (descForm ?? '').trim();
                if (!newDescription) {
                  setDescErr('Description cannot be empty.');
                  return;
                }

                savingDescRef.current = true;

                // Need the owner public key for signing
                const acct = await getAccount(asset.owner);
                const ownerPubKey = acct?.publicKey;
                if (!ownerPubKey) throw new Error('Owner public key unavailable');

                await updateAsset(
                  asset.owner,
                  ownerPubKey,
                  asset.assetId,
                  { newDescription },
                  { fee: 0.01, txGroupId: 0 }
                );

                // Local UI reflect
                setAsset((prev) => (prev ? { ...prev, description: newDescription } : prev));
                alert('Description updated on-chain.');
                setOpenDescDlg(false);
              } catch (e: any) {
                setDescErr(`Update failed: ${e?.message || e || 'unknown error'}`);
              } finally {
                savingDescRef.current = false;
              }
            }}
          >
            Publish
          </Button>
        </DialogActions>
      </Dialog>

      {/* End of Dialogs ------------------------------------------------------------------------------------------------- */}

      {/* Editor for Issuer */}
      <Collapse
        in={Boolean(canPublish && editing)}
        unmountOnExit
        onEntered={() => editorRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
      >
        <Paper id="asset-editor-panel" ref={editorRef} elevation={3} sx={{ mt: 2, p: 3 }}>
          <Typography textAlign="center" variant="h4" gutterBottom>
            Edit Asset Publication / Publish All Edits
          </Typography>

          {/* Avatar Upload */}
          <Box mt={2}>
            <Typography variant="subtitle1">Update Avatar</Typography>
            <input
              type="file"
              accept="image/*"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) {
                  const base64 = await fileToBase64(file);
                  const { identifiers, services } = await getAssetIdentifiers(asset.name);
                  await qortalRequest({
                    action: 'PUBLISH_QDN_RESOURCE',
                    name: userName as string | undefined,
                    service: services.avatar,
                    identifier: identifiers.avatar,
                    data64: base64,
                  });
                  alert('Avatar published!');
                  setAvatar(`data:image/*;base64,${base64}`);
                }
              }}
            />
          </Box>

          <Box mt={3}>
            <Typography textAlign="center" variant="h5">
              Edit Genesis Publication
            </Typography>
            <TiptapEditor value={html} onChange={setHtml} />
          </Box>

          <Box mt={2} display="flex" justifyContent={'flex-end'} gap={1}>
            <SuccessButton
              onClick={async () => {
                const pub: AssetPublication = {
                  description: asset.description,
                  html: prepareHtmlForPublish(html, theme),
                  primaryGroup: assetPub?.primaryGroup ?? undefined,
                  extraGroups: assetPub?.extraGroups ?? [],
                  news: assetPub?.news ?? [],
                  dividends: assetPub?.dividends ?? divEnabled,
                  dividendPeriod:
                    (assetPub?.dividends ?? divEnabled)
                      ? (assetPub?.dividendPeriod ?? divPeriod)
                      : undefined,
                  customFields: assetPub?.customFields ?? {},
                };
                await publishAssetPublication(userName as string, asset.name, pub);

                alert('Publication updated!');
                setAssetPub(pub);
                setEditing(false); // close after save, because we’re merciful
              }}
            >
              Publish All Changes
            </SuccessButton>
            <CancelButton onClick={() => setEditing(false)}>Cancel</CancelButton>
          </Box>
        </Paper>
      </Collapse>
    </PageContainer>
  );
}
