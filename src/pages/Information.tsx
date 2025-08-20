// src/pages/Information.tsx
import { JSX, useEffect, useMemo, useState } from 'react';
import {
  Box,
  Typography,
  Paper,
  TextField,
  InputAdornment,
  List,
  ListItemButton,
  ListItemText,
  Divider,
  Chip,
  Button,
  Tooltip,
  Dialog,
  DialogTitle,
  DialogContent,
  DialogActions,
  Stack,
  IconButton,
} from '@mui/material';
import SearchIcon from '@mui/icons-material/Search';
import DeleteIcon from '@mui/icons-material/Delete';
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward';
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  loadAllWikiSections,
  loadWikiMenu,
  saveWikiMenu,
  publishWikiSection,
  isNameInManagementGroup,
  isUserInManagementGroup,
  isAddressAdminInManagementGroup,
  // type LoadedSection,
  type WikiMenuItem,
} from '../utils/wikiAccess';
import { useAuth } from 'qapp-core';
import TiptapEditor from '../components/TipTapEditor';
// import { themeAtom } from '../state/global/system';
// import useTheme from '@mui/material';
import { useTheme } from '@mui/material';
import { Theme } from '@mui/material';
// import EditIcon from '@mui/icons-material/Edit';
import EditToggleButton from '../components/buttons/EditToggleButton';
import { Edit } from '@mui/icons-material';
import { renderToStaticMarkup } from 'react-dom/server';
import { Q_ASSET_VERSION } from '../constants/qdnConstants';
import { prepareHtmlForPublish } from '../utils/publicationPublisher';
import PublishedHtmlRenderer from '../components/PublishedHtmlRenderer';

// ---- Hard-coded defaults remain source of truth when no remote exists ----
type InfoSection = {
  id: string;
  title: string;
  tags?: string[];
  body: JSX.Element;
};

const makeDefaultSections = (theme: Theme): InfoSection[] => [
  {
    id: 'about',
    title: 'What is Q-Assets?',
    tags: ['overview', 'qortal', 'qdn'],
    body: (
      <>
        <Typography>
          Q-Assets is the asset layer UI for the Qortal Network—100% user-run, no custodians, no
          spoof “decentralization.” Trades settle peer-to-peer via Qortal’s DEX primitives, with
          QORT as the quote asset by default. Avatars, publications, and docs live on QDN.
        </Typography>
        <Typography>
          This page is a living “wiki.” You can search, deep-link to sections, and (later) we can
          feed the content from QDN so the community can iterate without code pushes.
        </Typography>
      </>
    ),
  },
  {
    id: 'what-are-assets', // ❗ make id unique (was 'about')
    title: 'What are Assets on Qortal?',
    tags: ['overview', 'qortal', 'assets'],
    body: (
      <>
        <Typography variant="h3" sx={{ color: theme.palette.primary.light }}>
          What are Assets
        </Typography>
        <Typography>
          Qortal Assets are TRUE 'tokens'. Unlike those that are on EVM chains, Qortal Assets are
          layer 1. They are validated by consensus, and treated the same way that QORT is by the
          core protocol.
        </Typography>
        <Typography variant="h3" sx={{ color: theme.palette.primary.light }}>
          What are the Differences from QORT
        </Typography>
        <Typography>
          There is one primary difference between an asset created with the Qortal asset system here
          on Q-Assets, and QORT. That is that QORT is created by CONSENSUS, the minters. QORT was
          issued at block 0 with 0 coins on the chain, and MINTED INTO EXISTENCE BY THE QORTAL
          MINTERS. Assets, on the other hand, are CREATED BY USERS ISSUING THEM, and therefore the
          ISSUANCE IS CENTRALIZED.
        </Typography>
        <Typography variant="h3" sx={{ color: theme.palette.primary.light }}>
          Q-Asset Use Cases
        </Typography>
        <Typography>
          The original intent behind ANY blockchain-based asset system (which EVM chains do NOT
          have...) was to be utilized to replace things like STOCKS in companies, or DISTRIBUTED
          OWNERSHIP PROOF. However, there are MANY use cases possible for Q-Assets. Group ownership,
          Stocks, proof of holdings, etc. The main thing that must be remembered, is that THE
          ISSUANCE OF ANY Q-ASSET, IS CENTRALIZED IN THE HANDS OF THE ASSET ISSUER.
        </Typography>
      </>
    ),
  },
  {
    id: 'trading-basics',
    title: 'Trading Basics',
    tags: ['trading', 'orders', 'dex'],
    body: (
      <>
        <Typography variant="subtitle1" gutterBottom>
          Order types
        </Typography>
        <Typography>
          Limit orders only (by design). Click an <b>ask</b> to prefill the buy box; click a{' '}
          <b>bid</b> to prefill the sell box. Hold Ctrl/⌘ to set price only.
        </Typography>
        <Typography variant="subtitle1" gutterBottom>
          Totals & sweeping
        </Typography>
        <Typography>
          Clicking a price level sweeps all better levels to that price and shows a blended total.
          Editing fields returns to <code>price × qty</code>.
        </Typography>
        <Typography variant="subtitle1" gutterBottom>
          Fees
        </Typography>
        <Typography>
          Network fee defaults to <code>0.01</code> QORT. No exchange fee.
        </Typography>
      </>
    ),
  },
  {
    id: 'orders',
    title: 'My Orders & Status',
    tags: ['orders', 'status', 'manage'],
    body: (
      <>
        <Typography>
          The “My Orders” strip on each pair shows your open orders. Cancel from there. Historical
          views can include <code>includeClosed</code>/<code>includeFulfilled</code>.
        </Typography>
        <Typography paragraph>
          Status: <code>OPEN</code>, <code>FILLED</code>, <code>CANCELLED</code>. Remaining qty is
          <code>amount − fulfilled</code> in <code>amountAssetId</code> units.
        </Typography>
      </>
    ),
  },
  {
    id: 'avatars',
    title: 'Asset Avatars & Publications',
    tags: ['avatars', 'qdn', 'publication'],
    body: (
      <>
        <Typography>
          Avatars are fetched from QDN using issuer namespace or project bucket{' '}
          <code>Q-Assets</code>. Fallback is a deterministic SVG.
        </Typography>
        <Typography>Issuers can publish rich HTML “Asset Publications” on QDN.</Typography>
      </>
    ),
  },
  {
    id: 'api',
    title: 'Useful API Endpoints',
    tags: ['api', 'dev', 'integration'],
    body: (
      <>
        <Typography>Endpoints used by Q-Assets:</Typography>
        <ul style={{ marginTop: 0 }}>
          <li>
            <code>/assets/openorders/&lt;have&gt;/&lt;want&gt;</code>
          </li>
          <li>
            <code>/assets/orders/&lt;address&gt;</code>
          </li>
          <li>
            <code>/assets/order</code> (POST – create)
          </li>
          <li>
            <code>/assets/order/delete</code> (POST – cancel)
          </li>
          <li>
            <code>/assets/trades/recent</code>
          </li>
        </ul>
        <Typography variant="caption" color="text.secondary">
          Prices on trade screens are treated as <b>QORT/ASSET</b>.
        </Typography>
      </>
    ),
  },
  {
    id: 'security',
    title: 'Security Model',
    tags: ['security', 'signing', 'keys'],
    body: (
      <>
        <Typography>
          Q-Assets are on-chain assets. They are treated exactly the same as QORT by the Qortal
          Core. <code>qortalRequest</code>. Publications are signed and stored on QDN distributedly.
        </Typography>
      </>
    ),
  },
  {
    id: 'faq',
    title: 'FAQ',
    tags: ['faq'],
    body: (
      <>
        <Typography>
          <b>Why QORT as quote?</b> Simplicity + native DEX.
        </Typography>
        <Typography>
          <b>Why no market orders?</b> Determinism. Sweep to a limit price instead.
        </Typography>
      </>
    ),
  },
  {
    id: 'release-notes',
    title: 'Release Notes',
    tags: ['changelog', 'updates'],
    body: (
      <>
        <Typography variant="h2" sx={{ color: theme.palette.secondary.light }}>
          Release Notes
        </Typography>
        <Typography>
          Just as the other secions of the wiki, the release notes section is able to be edited by
          the application publisher, and will be updated as the versions of the app are updated.
        </Typography>
        <Typography variant="h3" sx={{ color: theme.palette.secondary.light }}>
          Version {Q_ASSET_VERSION}
        </Typography>
        <Typography variant="body1">
          Version {Q_ASSET_VERSION} is the initial release of Q-Assets. - Asset Explorer. - Asset
          Issuance with default asset Genesis publications. - Asset Details with display of the
          default information published in the Asset Details Object. - Asset Trading with many
          features, leveraging the built-in API-based Asset/QORT trade options of Qortal. - Fully
          featured Wiki with user-published updates for the Information page. - Much more.
        </Typography>
      </>
    ),
  },
];

const normId = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

type RemoteRow = { html: string; publisher?: string; role?: 'admin' | 'member'; ts?: number };

export default function Information() {
  const theme = useTheme();
  const { name: userName, address: userAddress } = useAuth();
  const { hash } = useLocation();
  const navigate = useNavigate();

  const asMeta = (arr: { id: string; title?: string; tags?: string[] }[]) =>
    arr
      .map((m) => ({ id: normId(m.id), title: m.title || '', tags: m.tags || [] }))
      .filter((m) => m.id);

  /* ---------- Defaults (normalized IDs for consistent lookups) ---------- */
  const DEFAULT_SECTIONS = useMemo(
    () => makeDefaultSections(theme).map((s) => ({ ...s, id: normId(s.id) })),
    [theme]
  );
  const DEFAULT_BY_ID = useMemo(
    () => Object.fromEntries(DEFAULT_SECTIONS.map((s) => [s.id, s])),
    [DEFAULT_SECTIONS]
  );

  /* ------------------------------ Membership ----------------------------- */
  const [role, setRole] = useState<'admin' | 'editor' | null>(null);
  const [isMember, setIsMember] = useState(false);

  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const [admin, member] = await Promise.all([
          isAddressAdminInManagementGroup(userAddress),
          isUserInManagementGroup({ address: userAddress, name: userName }),
        ]);
        if (cancel) return;
        if (admin) {
          setRole('admin');
          setIsMember(true);
        } else if (member) {
          setRole('editor');
          setIsMember(true);
        } else {
          setRole(null);
          setIsMember(false);
        }
      } catch {
        if (!cancel) {
          setRole(null);
          setIsMember(false);
        }
      }
    })();
    return () => {
      cancel = true;
    };
  }, [userAddress, userName]);

  /* --------------------------- Menu & Remote Rows ------------------------ */
  const [menu, setMenu] = useState<WikiMenuItem[]>([]);
  const [remote, setRemote] = useState<Record<string, RemoteRow>>({});

  // seed menu with defaults first (so page renders instantly)
  useEffect(() => {
    if (menu.length === 0 && DEFAULT_SECTIONS.length) {
      setMenu(DEFAULT_SECTIONS.map(({ id, title, tags }) => ({ id, title, tags })));
    }
  }, [DEFAULT_SECTIONS, menu.length]);

  // fetch remote sections + (optional) remote menu
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const rmenu = await loadWikiMenu();
        if (!cancel && rmenu?.items?.length) {
          setMenu(rmenu.items.map((m) => ({ ...m, id: normId(m.id) })));
        }
      } catch (e) {
        console.error('Info load menu error:', e);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  // Load sections for whatever list we currently have
  useEffect(() => {
    let cancel = false;

    (async () => {
      try {
        // If we already have a menu from QDN, use it; otherwise fall back to defaults
        const meta = asMeta(menu.length ? menu : DEFAULT_SECTIONS);

        const rows = await loadAllWikiSections(meta);
        if (cancel) return;

        const folded: Record<string, RemoteRow> = {};
        for (const r of rows || []) {
          const id = normId((r as any).id);
          const html = (r as any).html ?? (r as any).content ?? '';
          if (!id || !html) continue;
          const ts = Number((r as any).timestamp) || 0;
          const prev = folded[id];
          if (!prev || ts > (prev.ts || 0)) {
            folded[id] = {
              html,
              publisher: (r as any).publisher,
              role: (r as any).publisherRole,
              ts,
            };
          }
        }
        setRemote(folded);
      } catch (e) {
        console.error('Info load sections error:', e);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [menu, DEFAULT_SECTIONS]);

  /* ----------------------------- Search / TOC ---------------------------- */
  const [q, setQ] = useState('');
  const qnorm = q.trim().toLowerCase();

  const filteredMenu = useMemo(() => {
    if (!qnorm) return menu;
    return menu.filter((m) => {
      const d = DEFAULT_BY_ID[normId(m.id)];
      const defaultText = d ? String((d.body as any)?.props?.children ?? '').toLowerCase() : '';
      const overrideHtml = remote[normId(m.id)]?.html?.toLowerCase() ?? '';
      return (
        (m.title || '').toLowerCase().includes(qnorm) ||
        (m.tags || []).some((t) => t.toLowerCase().includes(qnorm)) ||
        defaultText.includes(qnorm) ||
        overrideHtml.includes(qnorm)
      );
    });
  }, [menu, qnorm, remote, DEFAULT_BY_ID]);

  const goto = (id: string) => navigate(`#${normId(id)}`, { replace: false });

  /* ------------------------- Current section resolve --------------------- */
  const currentId = useMemo(() => {
    const hid = normId((hash || '').replace(/^#/, ''));
    if (hid && menu.some((m) => normId(m.id) === hid)) return hid;
    return normId(menu[0]?.id) || DEFAULT_SECTIONS[0]?.id || 'about';
  }, [hash, menu, DEFAULT_SECTIONS]);

  const currentMenuItem = menu.find((m) => normId(m.id) === currentId);
  const nid = normId(currentMenuItem?.id);
  const currentOverride = nid ? remote[nid] : undefined;
  const currentDefault = nid ? DEFAULT_BY_ID[nid] : undefined;

  /* ------------------------------ Editor state --------------------------- */
  const [editingId, setEditingId] = useState<string | null>(null);
  const [htmlDraft, setHtmlDraft] = useState<string>('');

  const startEdit = (id: string) => {
    const n = normId(id);
    setEditingId(n);
    setHtmlDraft(
      remote[n]?.html ?? (currentDefault ? renderToStaticMarkup(currentDefault.body) : '')
    );
  };

  useEffect(() => {
    if (!editingId) return;
    let html = remote[editingId]?.html ?? '';
    if (!html) {
      const def = DEFAULT_BY_ID[editingId];
      if (def) html = renderToStaticMarkup(def.body);
    }
    setHtmlDraft(html);
  }, [editingId, remote, DEFAULT_BY_ID]);

  const saveEdit = async () => {
    if (!editingId || !userName) return;
    try {
      const prepared = prepareHtmlForPublish(htmlDraft, theme);
      await publishWikiSection(editingId, prepared, userName, userAddress);
      setRemote((m) => ({
        ...m,
        [editingId]: {
          ...(m[editingId] || {}),
          html: prepared,
          publisher: userName,
          ts: Date.now(),
        },
      }));
      setEditingId(null);
      setHtmlDraft('');
      alert('Section published to QDN.');
    } catch (e: any) {
      alert(`Publish failed: ${String(e?.message || e)}`);
    }
  };

  /* ---------------------------- Menu editing UI -------------------------- */
  const [openMenuDlg, setOpenMenuDlg] = useState(false);

  const moveItem = (idx: number, dir: -1 | 1) =>
    setMenu((list) => {
      const a = [...list];
      const j = idx + dir;
      if (j < 0 || j >= a.length) return a;
      [a[idx], a[j]] = [a[j], a[idx]];
      return a;
    });

  const removeItem = (idx: number) => setMenu((list) => list.filter((_, i) => i !== idx));
  const addItem = () => setMenu((list) => [...list, { id: '', title: '', tags: [] }]);

  const saveMenu = async () => {
    if (!userName) return;
    const cleaned = menu
      .map((m) => ({ ...m, id: normId(m.id), title: (m.title || '').trim() }))
      .filter((m) => m.id && m.title);
    try {
      await saveWikiMenu(cleaned, userName);
      setOpenMenuDlg(false);
      alert('Menu published to QDN.');
    } catch (e: any) {
      alert(`Menu publish failed: ${String(e?.message || e)}`);
    }
  };

  /* -------------------------------- Render -------------------------------- */

  return (
    <Box sx={{ p: { xs: 2, md: 3 }, display: 'grid', gap: 2 }}>
      {/* Top Bar */}
      <Paper sx={{ p: 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
          <Typography variant="h5" sx={{ flex: 1, minWidth: 160 }}>
            Information
          </Typography>
          <TextField
            size="small"
            placeholder="Search the wiki…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
              },
            }}
            sx={{ minWidth: 240 }}
          />
          {role && (
            <Chip
              label={role === 'admin' ? 'Role: Admin' : 'Role: Editor'}
              color={role === 'admin' ? 'error' : 'info'}
              variant="filled"
              sx={{ fontWeight: 600 }}
            />
          )}
          {isMember && (
            <EditToggleButton variant="outlined" onClick={() => setOpenMenuDlg(true)}>
              Manage Sections
            </EditToggleButton>
          )}
        </Box>
      </Paper>

      <Box
        sx={{
          display: 'grid',
          gridTemplateColumns: { xs: '1fr', md: '260px 1fr' },
          gap: 2,
          alignItems: 'start',
        }}
      >
        {/* Sidebar / TOC */}
        <Paper
          sx={{
            p: 1,
            position: 'sticky',
            top: 16,
            display: { xs: 'none', md: 'block' },
            maxHeight: 'calc(100vh - 32px)',
            overflow: 'auto',
          }}
        >
          <List dense disablePadding>
            {filteredMenu.map((m) => (
              <ListItemButton
                key={m.id || Math.random()}
                selected={normId(m.id) === currentId}
                onClick={() => m.id && goto(m.id)}
                sx={{ borderRadius: 1, mb: 0.25 }}
              >
                <ListItemText
                  primary={m.title || '(untitled)'}
                  primaryTypographyProps={{ noWrap: true }}
                />
              </ListItemButton>
            ))}
          </List>
        </Paper>

        {/* Content */}
        <Box sx={{ display: 'grid', gap: 2 }}>
          {currentMenuItem ? (
            <Paper id={currentMenuItem.id} sx={{ p: 2, scrollMarginTop: 24 }}>
              <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flexWrap: 'wrap' }}>
                <Typography variant="h6">{currentMenuItem.title}</Typography>
                {(currentMenuItem.tags || []).map((t) => (
                  <Chip key={t} size="small" label={t} sx={{ opacity: 0.7 }} />
                ))}
                {currentOverride?.publisher && (
                  <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                    Overridden by {currentOverride.publisher}
                    {currentOverride.role ? ` (${currentOverride.role})` : ''}
                  </Typography>
                )}
              </Box>
              <Divider sx={{ my: 1.25 }} />

              {currentOverride?.html ? (
                <PublishedHtmlRenderer html={currentOverride.html} />
              ) : currentDefault ? (
                <Box sx={{ display: 'grid', gap: 1 }}>{currentDefault.body}</Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No content yet. (Define locally or publish via QDN.)
                </Typography>
              )}

              {userName && currentMenuItem.id && (
                <Box sx={{ mt: 2, display: 'flex', justifyContent: 'flex-end' }}>
                  <Tooltip
                    title={isMember ? '' : 'Requires membership in Q-Assets-Management to publish'}
                  >
                    <span>
                      <EditToggleButton
                        size="small"
                        editing={Boolean(editingId)}
                        disabled={!isMember}
                        onClick={() => startEdit(currentMenuItem.id!)}
                      >
                        {editingId ? 'Editing…' : 'Edit'}
                      </EditToggleButton>
                    </span>
                  </Tooltip>
                </Box>
              )}
            </Paper>
          ) : (
            <Paper sx={{ p: 3 }}>
              <Typography>Select a section from the left.</Typography>
            </Paper>
          )}
        </Box>
      </Box>

      {/* Section Editor */}
      <Dialog open={Boolean(editingId)} onClose={() => setEditingId(null)} fullWidth maxWidth="md">
        <DialogTitle>Edit Section</DialogTitle>
        <DialogContent dividers>
          <TiptapEditor value={htmlDraft} onChange={setHtmlDraft} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingId(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={!editingId || !isMember}>
            Publish
          </Button>
        </DialogActions>
      </Dialog>

      {/* Manage Sections (Menu) */}
      <Dialog open={openMenuDlg} onClose={() => setOpenMenuDlg(false)} fullWidth maxWidth="md">
        <DialogTitle>Manage Sections (Menu)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {menu.map((m, i) => (
              <Box
                key={i}
                sx={{
                  display: 'grid',
                  gridTemplateColumns: '1fr 1fr 1fr auto',
                  gap: 1,
                  alignItems: 'center',
                }}
              >
                <TextField
                  label="Section ID"
                  value={m.id}
                  onChange={(e) =>
                    setMenu((list) =>
                      list.map((x, idx) => (idx === i ? { ...x, id: e.target.value } : x))
                    )
                  }
                  size="small"
                />
                <TextField
                  label="Title"
                  value={m.title}
                  onChange={(e) =>
                    setMenu((list) =>
                      list.map((x, idx) => (idx === i ? { ...x, title: e.target.value } : x))
                    )
                  }
                  size="small"
                />
                <TextField
                  label="Tags (comma sep)"
                  value={(m.tags || []).join(', ')}
                  onChange={(e) =>
                    setMenu((list) =>
                      list.map((x, idx) =>
                        idx === i
                          ? {
                              ...x,
                              tags: e.target.value
                                .split(',')
                                .map((s) => s.trim())
                                .filter(Boolean),
                            }
                          : x
                      )
                    )
                  }
                  size="small"
                />
                <Box sx={{ display: 'flex', gap: 0.5, justifyContent: 'flex-end' }}>
                  <IconButton size="small" onClick={() => moveItem(i, -1)}>
                    <ArrowUpwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" onClick={() => moveItem(i, +1)}>
                    <ArrowDownwardIcon fontSize="small" />
                  </IconButton>
                  <IconButton size="small" color="error" onClick={() => removeItem(i)}>
                    <DeleteIcon fontSize="small" />
                  </IconButton>
                </Box>
              </Box>
            ))}
            <Box>
              <Button onClick={addItem}>Add Section</Button>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenMenuDlg(false)}>Close</Button>
          <Button variant="contained" onClick={saveMenu} disabled={!isMember}>
            Publish Menu
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
