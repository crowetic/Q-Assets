import { JSX, memo, useCallback, useEffect, useMemo, useState } from 'react';
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
  Skeleton,
  // useMediaQuery,
  useTheme,
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
  isUserInManagementGroup,
  isAddressAdminInManagementGroup,
  type WikiMenuItem,
  loadWikiOverrides,
  saveWikiOverrides,
  WikiOverrides,
} from '../utils/access';
import { useAuth } from 'qapp-core';
// import TiptapEditor from '../components/TipTapEditor';
import EditToggleButton from '../components/buttons/EditToggleButton';
import { renderToStaticMarkup } from 'react-dom/server';
import { Q_ASSETS_VERSION } from '../constants/qdnConstants';
import { prepareHtmlForPublish } from '../utils/publicationPublisher';
import PublishedHtmlRenderer from '../components/PublishedHtmlRenderer';
// import { dialogPaperSx } from '../components/comments/CommentsSection';
import { useAlert } from '../components/alerts';
import { useFetchTracker } from '../state/global/fetchTracker';
import type { Theme } from '@mui/material';
import SectionEditorDialog from '../components/infowiki/SectionEditorDialog';
import ManageSectionsDialog from '../components/infowiki/ManageSectionsDialog';

// ---- Hard-coded defaults remain source of truth when no remote exists ----
type InfoSection = {
  id: string;
  title: string;
  tags?: string[];
  body: JSX.Element;
};

const normId = (s: string | null | undefined) => (s ?? '').trim().toLowerCase();

// // be nice to anchors on QDN / browser
// const slug = (s: string) =>
//   s
//     .toLowerCase()
//     .trim()
//     .replace(/[^a-z0-9\- _]/g, '')
//     .replace(/\s+/g, '-');

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
    id: 'what-are-assets',
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
          QORT is created by CONSENSUS (minters). QORT began at block 0 with 0 coins and is MINTED
          INTO EXISTENCE BY QORTAL MINTERS. Assets are CREATED BY USERS ISSUING THEM—so ISSUANCE IS
          CENTRALIZED in the issuer’s hands.
        </Typography>
        <Typography variant="h3" sx={{ color: theme.palette.primary.light }}>
          Q-Asset Use Cases
        </Typography>
        <Typography>
          Replace STOCKS/ownership proofs, group ownership, distributions, etc. Remember: issuance
          of any Q-Asset is centralized by design, while validation and trading are on-chain and
          decentralized via Qortal.
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
          Status: <code>OPEN</code>, <code>FILLED</code>, <code>CANCELLED</code>. Remaining qty is{' '}
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
          Q-Assets are on-chain assets, validated by Qortal Core just like QORT. Publications are
          signed and distributed on QDN.
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
          Release notes are publisher-editable like other wiki sections, and will update alongside
          app versions.
        </Typography>
        <Typography variant="h3" sx={{ color: theme.palette.secondary.light }}>
          Version {Q_ASSETS_VERSION}
        </Typography>
        <Typography variant="body1">
          Version {Q_ASSETS_VERSION} is the initial release of Q-Assets. – Asset Explorer – Asset
          Issuance with default Genesis publications – Asset Details with issuer metadata – Trading
          UI leveraging Qortal’s native DEX – Wiki backed by QDN – and more.
        </Typography>
      </>
    ),
  },
];

type MenuRowProps = {
  index: number;
  item: WikiMenuItem;
  onChange: (index: number, patch: Partial<WikiMenuItem>) => void;
  onMove: (index: number, dir: -1 | 1) => void;
  onRemove: (index: number) => void;
};

export const MenuRow = memo(function MenuRow({
  index,
  item,
  onChange,
  onMove,
  onRemove,
}: MenuRowProps) {
  const [tagsInput, setTagsInput] = useState<string>(() => (item.tags || []).join(', '));

  // keep local draft in sync if parent changes (e.g., load)
  useEffect(() => {
    setTagsInput((item.tags || []).join(', '));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [Array.isArray(item.tags) ? item.tags.join('|') : '']);

  const commitTags = useCallback(() => {
    const tags = tagsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    onChange(index, { tags });
  }, [index, tagsInput, onChange]);

  return (
    <Box sx={{ display: 'flex', gap: '1rem', alignItems: 'center', flexWrap: 'wrap' }}>
      <TextField
        label="Section ID"
        value={item.id}
        onChange={(e) => onChange(index, { id: e.target.value })}
        size="small"
        sx={{ flex: '1 1 12rem' }}
      />
      <TextField
        label="Title"
        value={item.title}
        onChange={(e) => onChange(index, { title: e.target.value })}
        size="small"
        sx={{ flex: '1 1 12rem' }}
      />
      <TextField
        label="Tags (comma sep)"
        type="text"
        value={tagsInput}
        onChange={(e) => setTagsInput(e.target.value)}
        onBlur={commitTags}
        onKeyDown={(e) => {
          if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur();
        }}
        size="small"
        sx={{ flex: '2 1 16rem' }}
        slotProps={{ htmlInput: { inputMode: 'text', spellCheck: false } }}
      />
      <Box sx={{ display: 'flex', gap: '0.5rem', marginLeft: 'auto' }}>
        <IconButton size="small" onClick={() => onMove(index, -1)}>
          <ArrowUpwardIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" onClick={() => onMove(index, +1)}>
          <ArrowDownwardIcon fontSize="small" />
        </IconButton>
        <IconButton size="small" color="error" onClick={() => onRemove(index)}>
          <DeleteIcon fontSize="small" />
        </IconButton>
      </Box>
    </Box>
  );
});

type RemoteRow = { html: string; publisher?: string; role?: 'admin' | 'editor'; ts?: number };

export default function Information() {
  const theme = useTheme();
  // const isXs = useMediaQuery(theme.breakpoints.down('sm'));
  const { name: userName, address: userAddress } = useAuth();
  const { hash } = useLocation();
  const navigate = useNavigate();
  const { alert } = useAlert();
  const { track, isLoadingPrefix } = useFetchTracker();

  const asMeta = useCallback(
    (arr: { id: string; title?: string; tags?: string[] }[]) =>
      arr
        .map((m) => ({ id: normId(m.id), title: m.title || '', tags: m.tags || [] }))
        .filter((m) => m.id),
    []
  );

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
  type OverrideRule = { mode: 'latest' } | { mode: 'preferred'; preferred: { publisher: string } };

  const [menu, setMenu] = useState<WikiMenuItem[]>([]);
  const [variants, setVariants] = useState<Record<string, RemoteRow[]>>({});
  const [overrides, setOverrides] = useState<Record<string, OverrideRule>>({});

  function chooseActiveRow(
    rows: RemoteRow[] | undefined,
    rule?: OverrideRule
  ): RemoteRow | undefined {
    if (!rows || rows.length === 0) return undefined;
    if (!rule || rule.mode === 'latest') {
      return rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    }
    if (rule.mode === 'preferred') {
      const p = rule.preferred?.publisher?.toLowerCase();
      const hit = rows.find((r) => (r.publisher || '').toLowerCase() === p);
      return hit || rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    }
    return rows[0];
  }

  // seed menu with defaults first (so page renders instantly)
  useEffect(() => {
    if (menu.length === 0 && DEFAULT_SECTIONS.length) {
      setMenu(DEFAULT_SECTIONS.map(({ id, title, tags }) => ({ id, title, tags })));
    }
  }, [DEFAULT_SECTIONS, menu.length]);

  // fetch remote menu
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const rmenu = await track(loadWikiMenu(), 'wiki:menu');
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
  }, [track]);

  // fetch overrides
  useEffect(() => {
    let cancel = false;
    (async () => {
      try {
        const o = await track(loadWikiOverrides(), 'wiki:overrides');
        if (!cancel && o && typeof o === 'object') {
          setOverrides(o.overrides || {});
        }
      } catch {
        /* no manifest is fine */
      }
    })();
    return () => {
      cancel = true;
    };
  }, [track]);

  // Load sections for current menu (pause while menu dialog is open)
  const [openMenuDlg, setOpenMenuDlg] = useState(false);
  useEffect(() => {
    let cancel = false;
    if (openMenuDlg) return; // pause fetch storm during edits

    (async () => {
      try {
        const meta = asMeta(menu.length ? menu : DEFAULT_SECTIONS);
        const rows = await track(loadAllWikiSections(meta), 'wiki:sections');
        if (cancel) return;

        const grouped: Record<string, RemoteRow[]> = {};
        for (const r of rows || []) {
          const id = normId((r as any).id);
          const html = (r as any).html ?? (r as any).content ?? '';
          if (!id || !html) continue;
          const ts = Number((r as any).timestamp) || 0;
          const publisher = (r as any).publisher;
          const role = (r as any).publisherRole as 'admin' | 'editor' | undefined;
          (grouped[id] ||= []).push({ html, publisher, role, ts });
        }
        setVariants(grouped);
      } catch (e) {
        console.error('Info load sections error:', e);
      }
    })();

    return () => {
      cancel = true;
    };
  }, [menu, DEFAULT_SECTIONS, openMenuDlg, asMeta, track]);

  const wikiLoading = isLoadingPrefix('wiki:');

  /* ----------------------------- Search / TOC ---------------------------- */
  const latestRowFor = useCallback(
    (sid: string) => {
      const rows = variants[sid] || [];
      if (!rows.length) return undefined;
      return rows.slice().sort((a, b) => (b.ts || 0) - (a.ts || 0))[0];
    },
    [variants]
  );

  const activeRowFor = useCallback(
    (sid: string) => chooseActiveRow(variants[sid], overrides[sid]),
    [variants, overrides]
  );

  const textForSearch = useCallback(
    (sid: string) => {
      const row = activeRowFor(sid) || latestRowFor(sid);
      if (row?.html) return row.html.toLowerCase();
      const d = DEFAULT_BY_ID[sid];
      return d ? String((d.body as any)?.props?.children ?? '').toLowerCase() : '';
    },
    [activeRowFor, latestRowFor, DEFAULT_BY_ID]
  );

  const [q, setQ] = useState('');
  const qnorm = q.trim().toLowerCase();

  const filteredMenu = useMemo(() => {
    if (!qnorm) return menu;
    return menu.filter((m) => {
      const sid = normId(m.id);
      const pageText = textForSearch(sid);
      return (
        (m.title || '').toLowerCase().includes(qnorm) ||
        (m.tags || []).some((t) => t.toLowerCase().includes(qnorm)) ||
        pageText.includes(qnorm)
      );
    });
  }, [menu, qnorm, textForSearch]);

  const goto = (id: string) => navigate(`#${normId(id)}`, { replace: false });

  /* ------------------------- Current section resolve --------------------- */
  const currentId = useMemo(() => {
    const hid = normId((hash || '').replace(/^#/, ''));
    if (hid && menu.some((m) => normId(m.id) === hid)) return hid;
    return normId(menu[0]?.id) || DEFAULT_SECTIONS[0]?.id || 'about';
  }, [hash, menu, DEFAULT_SECTIONS]);

  const currentMenuItem = menu.find((m) => normId(m.id) === currentId);
  const nid = normId(currentMenuItem?.id);
  const currentDefault = nid ? DEFAULT_BY_ID[nid] : undefined;
  const currentRows = nid ? variants[nid] : undefined;
  const activeRow = chooseActiveRow(currentRows, nid ? overrides[nid] : undefined);

  /* ------------------------------ Editor state --------------------------- */
  const [editingId, setEditingId] = useState<string | null>(null);
  // const [htmlDraft, setHtmlDraft] = useState<string>('');

  const startEdit = (id: string) => {
    setEditingId(normId(id));
  };

  const initialHtmlFor = (sid: string): string => {
    const row = activeRowFor(sid) || latestRowFor(sid);
    if (row?.html) return row.html;
    const d = DEFAULT_BY_ID[sid];
    return d ? renderToStaticMarkup(d.body) : '';
  };

  const handlePublish = async (html: string) => {
    if (!editingId || !userName) return;
    try {
      const prepared = prepareHtmlForPublish(html, theme);
      await publishWikiSection(editingId, prepared, userName, userAddress);
      setVariants((prev) => {
        const next = { ...(prev || {}) };
        const arr = (next[editingId] || []).slice();
        arr.push({
          html: prepared,
          publisher: userName,
          role: isMember ? role || undefined : undefined,
          ts: Date.now(),
        });
        next[editingId] = arr;
        return next;
      });
      setEditingId(null);
      alert('Section published to QDN.', 'Section Published Successfully!', {
        severity: 'success',
      });
    } catch (e: any) {
      alert(`Publish failed: ${String(e?.message || e)}`, 'Publish FAILURE', { severity: 'error' });
    }
  };

  // const startEdit = (id: string) => {
  //   const n = normId(id);
  //   setEditingId(n);
  //   const row = activeRowFor(n) || latestRowFor(n);
  //   const fallback = DEFAULT_BY_ID[n] ? renderToStaticMarkup(DEFAULT_BY_ID[n].body) : '';
  //   setHtmlDraft(row?.html || fallback);
  // };

  // useEffect(() => {
  //   if (!editingId) return;
  //   const row = activeRowFor(editingId) || latestRowFor(editingId);
  //   const html =
  //     row?.html ||
  //     (DEFAULT_BY_ID[editingId] ? renderToStaticMarkup(DEFAULT_BY_ID[editingId].body) : '');
  //   setHtmlDraft(html);
  // }, [editingId, activeRowFor, latestRowFor, DEFAULT_BY_ID]);

  // const saveEdit = async () => {
  //   if (!editingId || !userName) return;
  //   try {
  //     const prepared = prepareHtmlForPublish(htmlDraft, theme);
  //     await publishWikiSection(editingId, prepared, userName, userAddress);
  //     setVariants((prev) => {
  //       const next = { ...(prev || {}) };
  //       const arr = (next[editingId] || []).slice();
  //       arr.push({
  //         html: prepared,
  //         publisher: userName,
  //         role: isMember ? role || undefined : undefined,
  //         ts: Date.now(),
  //       });
  //       next[editingId] = arr;
  //       return next;
  //     });
  //     setEditingId(null);
  //     setHtmlDraft('');
  //     alert('Section published to QDN.', 'Section Published Successfully!', {
  //       severity: 'success',
  //     });
  //   } catch (e: any) {
  //     alert(`Publish failed: ${String(e?.message || e)}`, 'Publish FAILURE', { severity: 'error' });
  //   }
  // };

  /* -------------------------------- Render -------------------------------- */

  const [openOverridesDlg, setOpenOverridesDlg] = useState(false);
  const [draftOverrides, setDraftOverrides] = useState<Record<string, OverrideRule>>({});

  useEffect(() => {
    if (openOverridesDlg) setDraftOverrides(overrides);
  }, [openOverridesDlg, overrides]);

  const publishersFor = useCallback(
    (sid: string) => {
      const rows = variants[sid] || [];
      const seen = new Set<string>();
      const out: string[] = [];
      for (const r of rows) {
        const p = (r.publisher || '').trim();
        if (!p) continue;
        const k = p.toLowerCase();
        if (!seen.has(k)) {
          seen.add(k);
          out.push(p);
        }
      }
      return out;
    },
    [variants]
  );

  const saveOverridesDlg = async () => {
    if (role !== 'admin' || !userName) return;
    const payload: WikiOverrides = {
      version: 1,
      updatedAt: Date.now(),
      overrides: draftOverrides,
    };
    await track(saveWikiOverrides(payload /*, userName*/), 'wiki:overrides:save');
    setOverrides(draftOverrides);
    setOpenOverridesDlg(false);
    alert('Overrides updated.', 'Wiki Overrides Saved', { severity: 'success' });
  };

  const invalidPreferred = Object.values(draftOverrides).some(
    (r) => r.mode === 'preferred' && !r.preferred?.publisher
  );

  // local draft for menu dialog
  const [draftMenu, setDraftMenu] = useState<WikiMenuItem[]>([]);
  useEffect(() => {
    if (openMenuDlg) setDraftMenu(menu.map((m) => ({ ...m })));
    console.log(draftMenu);
  }, [openMenuDlg, menu]);

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        gap: '1rem',
        p: { xs: '1rem', md: '1.5rem' },
      }}
    >
      {/* Top Bar */}
      <Paper sx={{ p: '1rem' }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: '1rem', flexWrap: 'wrap' }}>
          <Typography variant="h5" sx={{ flex: 1, minWidth: '12rem' }}>
            Information / Wiki
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
            sx={{ minWidth: '15rem', flex: '0 1 22rem' }}
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
          {role === 'admin' && (
            <EditToggleButton variant="outlined" onClick={() => setOpenOverridesDlg(true)}>
              Manage Versions
            </EditToggleButton>
          )}
        </Box>
      </Paper>

      {/* Main area: sidebar + content */}
      <Box
        sx={{
          display: 'flex',
          flexDirection: { xs: 'column', md: 'row' },
          alignItems: 'stretch',
          gap: '1rem',
        }}
      >
        {/* Sidebar / TOC */}
        <Paper
          sx={{
            p: '0.75rem',
            flex: { xs: '0 0 auto', md: '0 0 16rem' },
            width: { xs: '100%', md: '16rem' },
            position: { xs: 'static', md: 'sticky' },
            top: { md: '1rem' },
            maxHeight: { xs: 'none', md: 'calc(100dvh - 2rem)' },
            overflow: { xs: 'visible', md: 'auto' },
            display: 'block',
          }}
        >
          <List dense disablePadding>
            {wikiLoading && menu.length === 0
              ? Array.from({ length: 6 }).map((_, i) => (
                  <Box key={i} sx={{ py: 0.5 }}>
                    <Skeleton variant="rounded" height={28} />
                  </Box>
                ))
              : filteredMenu.map((m, i) => (
                  <ListItemButton
                    key={normId(m.id) || `toc-${i}`}
                    selected={normId(m.id) === currentId}
                    onClick={() => m.id && goto(m.id)}
                    sx={{ borderRadius: '0.5rem', mb: '0.25rem' }}
                  >
                    <ListItemText
                      primary={m.title || '(untitled)'}
                      slotProps={{ primary: { noWrap: true } }}
                    />
                  </ListItemButton>
                ))}
          </List>
        </Paper>

        {/* Content */}
        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            gap: '1rem',
            flex: '1 1 auto',
            minWidth: 0,
          }}
        >
          {currentMenuItem ? (
            <Paper id={currentMenuItem.id} sx={{ p: '1rem', scrollMarginTop: '1.5rem' }}>
              <Box
                sx={{ display: 'flex', alignItems: 'baseline', gap: '0.5rem', flexWrap: 'wrap' }}
              >
                <Typography variant="h6">{currentMenuItem.title}</Typography>
                {(currentMenuItem.tags || []).filter(Boolean).map((t, idx) => (
                  <Chip key={`${t}-${idx}`} size="small" label={t} sx={{ opacity: 0.7 }} />
                ))}
                {userName && currentMenuItem.id && (
                  <Box sx={{ mt: '1rem', ml: 'auto' }}>
                    <Tooltip
                      title={
                        isMember ? '' : 'Requires membership in Q-Assets-Management to publish'
                      }
                    >
                      <span>
                        <EditToggleButton
                          size="small"
                          editing={Boolean(editingId)}
                          disabled={!isMember}
                          onClick={() => startEdit(currentMenuItem.id!)}
                        >
                          {editingId ? 'Editing…' : 'Edit Section'}
                        </EditToggleButton>
                      </span>
                    </Tooltip>
                  </Box>
                )}
              </Box>

              <Divider sx={{ my: '0.75rem' }} />

              {isLoadingPrefix('wiki:sections') && !activeRow?.html ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
                  <Skeleton variant="text" height={36} />
                  <Skeleton variant="text" height={24} />
                  <Skeleton variant="rounded" height={160} />
                </Box>
              ) : activeRow?.html ? (
                <PublishedHtmlRenderer html={activeRow.html} />
              ) : currentDefault ? (
                <Box sx={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
                  {currentDefault.body}
                </Box>
              ) : (
                <Typography variant="body2" color="text.secondary">
                  No content yet. (Define locally or publish via QDN.)
                </Typography>
              )}

              {activeRow?.publisher && (
                <Typography variant="caption" color="text.secondary" sx={{ ml: 'auto' }}>
                  Active by {activeRow.publisher}
                  {activeRow.role ? ` (${activeRow.role})` : ''}
                </Typography>
              )}
            </Paper>
          ) : (
            <Paper sx={{ p: '1.25rem' }}>
              <Typography>Select a section from the left.</Typography>
            </Paper>
          )}
        </Box>
      </Box>

      {/* Section Editor */}
      {/* <Dialog
        open={Boolean(editingId)}
        onClose={() => setEditingId(null)}
        fullScreen={isXs}
        fullWidth
        maxWidth={false}
        slotProps={{ paper: { sx: dialogPaperSx(isXs) } }}
      >
        <DialogTitle>Edit Section</DialogTitle>
        <DialogContent
          dividers
          sx={{ overflow: 'hidden', flex: 1, display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          <TiptapEditor value={htmlDraft} onChange={setHtmlDraft} />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditingId(null)}>Cancel</Button>
          <Button variant="contained" onClick={saveEdit} disabled={!editingId || !isMember}>
            Publish
          </Button>
        </DialogActions>
      </Dialog> */}
      <SectionEditorDialog
        open={Boolean(editingId)}
        initialHtml={editingId ? initialHtmlFor(editingId) : ''}
        onClose={() => setEditingId(null)}
        onPublish={handlePublish}
        disabled={!editingId || !isMember}
      />

      {/* Manage Sections (Menu) */}
      <ManageSectionsDialog
        open={openMenuDlg}
        initialMenu={menu}
        onClose={() => setOpenMenuDlg(false)}
        onPublish={async (cleaned) => {
          if (!userName) return;
          try {
            await saveWikiMenu(cleaned, userName);
            // one state update → one sections reload
            setMenu(cleaned);
            setOpenMenuDlg(false);
            alert('Menu published to QDN.', 'Menu Published Successfully!', {
              severity: 'success',
            });
          } catch (e: any) {
            alert(`Menu publish failed: ${String(e?.message || e)}`, 'Publish FAILURE', {
              severity: 'error',
            });
          }
        }}
        canPublish={isMember}
      />
      {/* <Dialog open={openMenuDlg} onClose={() => setOpenMenuDlg(false)} fullWidth maxWidth="md">
        <DialogTitle>Manage Sections (Menu)</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {draftMenu.map((m, i) => (
              <MenuRow
                key={i} // stable key avoids remount-on-typing
                index={i}
                item={m}
                onChange={(idx, patch) => {
                  setDraftMenu((list) => {
                    const a = [...list];
                    a[idx] = { ...a[idx], ...patch };
                    return a;
                  });
                }}
                onMove={(idx, dir) => {
                  setDraftMenu((list) => {
                    const a = [...list];
                    const j = idx + dir;
                    if (j < 0 || j >= a.length) return a;
                    [a[idx], a[j]] = [a[j], a[idx]];
                    return a;
                  });
                }}
                onRemove={(idx) => {
                  setDraftMenu((list) => list.filter((_, ii) => ii !== idx));
                }}
              />
            ))}
            <Box>
              <Button
                onClick={() => setDraftMenu((list) => [...list, { id: '', title: '', tags: [] }])}
              >
                Add Section
              </Button>
            </Box>
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenMenuDlg(false)}>Close</Button>
          <Button
            variant="contained"
            onClick={async () => {
              if (!userName) return;
              const cleaned = draftMenu
                .map((m) => ({
                  ...m,
                  id: slug(normId(m.id)),
                  title: (m.title || '').trim(),
                  tags: (m.tags || []).map((t) => t.trim()).filter(Boolean),
                }))
                .filter((m) => m.id && m.title);

              try {
                await saveWikiMenu(cleaned, userName);
                setMenu(cleaned); // only now update live menu → triggers a single reload
                setOpenMenuDlg(false);
                alert('Menu published to QDN.', 'Menu Published Successfully!', {
                  severity: 'success',
                });
              } catch (e: any) {
                alert(`Menu publish failed: ${String(e?.message || e)}`, 'Publish FAILURE', {
                  severity: 'error',
                });
              }
            }}
            disabled={!isMember}
          >
            Publish Menu
          </Button>
        </DialogActions>
      </Dialog> */}

      {/* Manage Active Versions */}
      <Dialog
        open={openOverridesDlg}
        onClose={() => setOpenOverridesDlg(false)}
        fullWidth
        maxWidth="md"
      >
        <DialogTitle>Manage Active Versions</DialogTitle>
        <DialogContent dividers>
          <Stack spacing={1.5}>
            {menu.map((m) => {
              const sid = normId(m.id);
              const rule = draftOverrides[sid] || { mode: 'latest' as const };
              const pubs = publishersFor(sid);
              return (
                <Paper key={sid} sx={{ p: 1 }}>
                  <Box sx={{ display: 'flex', alignItems: 'center', gap: 2, flexWrap: 'wrap' }}>
                    <Typography sx={{ minWidth: 200 }}>{m.title}</Typography>

                    <Button
                      size="small"
                      variant={rule.mode === 'latest' ? 'contained' : 'outlined'}
                      onClick={() =>
                        setDraftOverrides((d) => ({ ...d, [sid]: { mode: 'latest' } }))
                      }
                    >
                      Latest
                    </Button>
                    <Button
                      size="small"
                      variant={rule.mode === 'preferred' ? 'contained' : 'outlined'}
                      onClick={() =>
                        setDraftOverrides((d) => ({
                          ...d,
                          [sid]: { mode: 'preferred', preferred: { publisher: pubs[0] || '' } },
                        }))
                      }
                    >
                      Preferred
                    </Button>

                    {rule.mode === 'preferred' && (
                      <TextField
                        select
                        label="Publisher"
                        size="small"
                        value={rule.preferred?.publisher || ''}
                        onChange={(e) =>
                          setDraftOverrides((d) => ({
                            ...d,
                            [sid]: { mode: 'preferred', preferred: { publisher: e.target.value } },
                          }))
                        }
                        sx={{ minWidth: 220 }}
                        slotProps={{ select: { native: true } }}
                      >
                        <option value="" disabled>
                          Choose publisher…
                        </option>
                        {pubs.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </TextField>
                    )}
                  </Box>
                </Paper>
              );
            })}
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setOpenOverridesDlg(false)}>Close</Button>
          <Button variant="contained" onClick={saveOverridesDlg} disabled={invalidPreferred}>
            Save Overrides
          </Button>
        </DialogActions>
      </Dialog>
    </Box>
  );
}
