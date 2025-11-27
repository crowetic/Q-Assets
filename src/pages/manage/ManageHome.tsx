import { useEffect, useState, type ReactNode } from 'react';
import { Box, Typography, Paper, Stack, CircularProgress } from '@mui/material';
import { Link as RouterLink } from 'react-router-dom';
import StorageRoundedIcon from '@mui/icons-material/StorageRounded';
import PaymentsRoundedIcon from '@mui/icons-material/PaymentsRounded';
import FolderSpecialRoundedIcon from '@mui/icons-material/FolderSpecialRounded';
import SecurityRoundedIcon from '@mui/icons-material/SecurityRounded';
import AdminPanelSettingsRoundedIcon from '@mui/icons-material/AdminPanelSettingsRounded';
import { alpha, darken, lighten, useTheme, type Theme } from '@mui/material/styles';
import { getUserRoles, type UserRoles, userHasPermission } from '../../utils/roles';
import { fetchAccountAvatarDataUrl } from '../../utils/qdnAvatar';
import { useFetchTracker } from '../../state/global/fetchTracker';

type Tile = {
  title: string;
  description: string;
  to: string;
  icon: ReactNode;
  disabled?: boolean;
  requiresAdmin?: boolean;
};

const tiles: Tile[] = [
  {
    title: 'Data Explorer',
    description: 'Publish, organize, and bulk-manage QDN data under your names.',
    to: '/manage/data/explorer',
    icon: <StorageRoundedIcon fontSize="inherit" />,
  },
  {
    title: 'Dividends',
    description: 'Distribute payouts to asset holders with snapshots & filters.',
    to: '/manage/dividends',
    icon: <PaymentsRoundedIcon fontSize="inherit" />,
  },
  {
    title: 'Asset Management',
    description: 'Avatars, groups, genesis posts, and issuer tools.',
    to: '/manage/assets',
    icon: <FolderSpecialRoundedIcon fontSize="inherit" />,
    disabled: true, // flip to false when ready / if already implemented
  },
  {
    title: 'Q-Deck Permissions',
    description: 'Admins/editors and card controls for your Q-Deck boards.',
    to: '/manage/qdeck-permissions',
    icon: <SecurityRoundedIcon fontSize="inherit" />,
    disabled: false,
  },
  {
    title: 'Admin Panel',
    description: 'Moderate promotions, announcements, and system-wide tooling.',
    to: '/manage/admin',
    icon: <AdminPanelSettingsRoundedIcon fontSize="inherit" />,
    requiresAdmin: true,
  },
];

const getTileAccent = (title: string, theme: Theme) => {
  const build = (color: string) => ({
    panelBg: `linear-gradient(135deg, ${alpha(color, 0.38)}, ${alpha(color, 0.12)})`,
    borderColor: alpha(color, 0.45),
    iconBg: alpha(color, 0.3),
    iconColor: theme.palette.getContrastText(color),
  });

  switch (title) {
    case 'Dividends':
      return build(theme.palette.success.main);
    case 'Permissions / Roles':
      return build(theme.palette.warning.main);
    case 'Asset Management':
      return build(theme.palette.info.main);
    default:
      return build(theme.palette.primary.main);
  }
};

function TileCard({ t }: { t: Tile }) {
  const theme = useTheme();
  const accent = getTileAccent(t.title, theme);
  const componentProps = t.disabled
    ? {}
    : { component: RouterLink, to: t.to, style: { textDecoration: 'none' } };

  return (
    <Paper
      variant="outlined"
      {...componentProps}
      sx={{
        p: 2.5,
        borderRadius: 3,
        height: '100%',
        cursor: t.disabled ? 'not-allowed' : 'pointer',
        textDecoration: 'none',
        color: 'inherit',
        boxShadow: 4,
        background: accent.panelBg,
        borderColor: accent.borderColor,
        transition: 'transform 120ms ease, box-shadow 120ms ease, filter 120ms ease',
        '&:hover': t.disabled
          ? {}
          : {
              transform: 'translateY(2px)',
              boxShadow: 2,
              filter: 'brightness(0.98)',
              '.tile-link-text': { color: theme.palette.getContrastText(accent.iconColor) },
            },
        '&:hover, &:focus-visible': { textDecoration: 'none' },
        display: 'grid',
        gridTemplateRows: 'auto 1fr',
        position: 'relative',
        opacity: t.disabled ? 0.45 : 1,
        '& .tile-link-text': { transition: 'color 120ms ease' },
        '&:hover .tile-link-text': t.disabled ? {} : { color: theme.palette.text.primary },
      }}
    >
      {t.disabled && (
        <Box
          sx={{
            position: 'absolute',
            top: 8,
            right: 12,
            fontSize: 11,
            letterSpacing: 1,
            textTransform: 'uppercase',
            color: theme.palette.text.secondary,
          }}
        >
          Coming soon
        </Box>
      )}
      <Stack direction="row" alignItems="center" spacing={1.5} sx={{ mb: 1, fontSize: 40 }}>
        <span
          style={{
            display: 'inline-flex',
            width: 48,
            height: 48,
            alignItems: 'center',
            justifyContent: 'center',
            background: accent.iconBg,
            borderRadius: 12,
            color: accent.iconColor,
          }}
        >
          {t.icon}
        </span>
        <Typography variant="h6" className="tile-link-text" sx={{ lineHeight: 1.1 }}>
          {t.title}
        </Typography>
      </Stack>

      <Typography variant="body2" sx={{ opacity: 0.8, mt: 0.5 }}>
        {t.description}
      </Typography>

      {/* keep tiles visually square-ish on big screens */}
      <Box
        sx={{
          mt: 2,
          aspectRatio: '1.3 / 1',
          borderRadius: 2,
          bgcolor: alpha(accent.iconColor, 0.08),
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: { xs: 52, sm: 64, md: 72 },
          color: accent.iconColor,
          opacity: 0.75,
          transition: 'opacity 120ms ease',
          '.MuiPaper-root:hover &': { opacity: 0.95 },
        }}
        aria-hidden
      >
        {t.icon}
      </Box>
    </Paper>
  );
}

function DataExplorerHero({ tile }: { tile: Tile }) {
  const theme = useTheme();
  const [logoUrl, setLogoUrl] = useState<string | null>(null);
  const primaryBase =
    theme.palette.primary[theme.palette.mode === 'dark' ? 'dark' : 'main'] ||
    theme.palette.primary.main;
  const primaryAccent = lighten(
    theme.palette.primary[theme.palette.mode === 'dark' ? 'light' : 'main'] ||
      theme.palette.primary.light,
    theme.palette.mode === 'dark' ? 0.05 : 0.25
  );
  const gradient = `linear-gradient(130deg, ${darken(
    primaryBase,
    theme.palette.mode === 'dark' ? 0.2 : 0.05
  )}, ${primaryAccent})`;
  const componentProps = tile.disabled
    ? {}
    : { component: RouterLink, to: tile.to, style: { textDecoration: 'none' } };

  useEffect(() => {
    let alive = true;
    (async () => {
      const url = await fetchAccountAvatarDataUrl('DataExplorer');
      if (alive && url) setLogoUrl(url);
    })();
    return () => {
      alive = false;
    };
  }, []);

  return (
    <Paper
      variant="outlined"
      {...componentProps}
      sx={{
        borderRadius: 3,
        p: { xs: 2.5, md: 4 },
        boxShadow: 6,
        background: gradient,
        color: 'common.white',
        textDecoration: 'none',
        cursor: tile.disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 3,
        flexDirection: { xs: 'column', md: 'row' },
        minHeight: { xs: 220, md: 260 },
        position: 'relative',
        overflow: 'hidden',
        '& .hero-text': { transition: 'color 140ms ease' },
        '&:after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at top right, rgba(255,255,255,0.25), rgba(255,255,255,0))',
          opacity: tile.disabled ? 0 : 1,
          pointerEvents: 'none',
        },
        transition: 'transform 140ms ease, box-shadow 140ms ease, filter 140ms ease',
        '&:hover': tile.disabled
          ? {}
          : {
              transform: 'translateY(3px)',
              boxShadow: 4,
              filter: 'brightness(0.98)',
              '.hero-text': { color: alpha(theme.palette.common.white, 0.8) },
            },
        '&:hover, &:focus-visible': { textDecoration: 'none' },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={3} sx={{ zIndex: 1 }}>
        <Box
          sx={{
            width: { xs: 110, md: 140 },
            height: { xs: 110, md: 140 },
            borderRadius: '30%',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              'radial-gradient(circle at 20% 20%, rgba(255,255,255,0.4), transparent 55%), rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255,255,255,0.35)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Box
            sx={{
              position: 'absolute',
              inset: 0,
              background: 'linear-gradient(170deg, rgba(255,255,255,0.55), transparent 65%)',
              pointerEvents: 'none',
            }}
          />
          {logoUrl ? (
            <Box
              component="img"
              alt="Data Explorer logo"
              src={logoUrl}
              sx={{
                width: '100%',
                height: '100%',
                objectFit: 'cover',
                zIndex: 1,
              }}
            />
          ) : (
            <Typography variant="h3" sx={{ letterSpacing: 3, zIndex: 1, fontWeight: 600 }}>
              DE
            </Typography>
          )}
        </Box>
        <Box>
          <Typography variant="h3" className="hero-text" sx={{ fontWeight: 600, lineHeight: 1 }}>
            {tile.title}
          </Typography>
          <Typography
            variant="subtitle2"
            className="hero-text"
            sx={{ textTransform: 'uppercase', letterSpacing: 2 }}
          >
            Explorer mode
          </Typography>
          <Typography
            variant="body1"
            className="hero-text"
            sx={{ mt: 1, opacity: 0.9, maxWidth: 520 }}
          >
            Control, share, delete, and organize your published data like never before.
          </Typography>
        </Box>
      </Stack>

      <Box
        sx={{
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          textAlign: { xs: 'center', md: 'right' },
        }}
      >
        <Typography
          variant="caption"
          className="hero-text"
          sx={{ textTransform: 'uppercase', letterSpacing: 1.5 }}
        >
          Save, share, multi-publish, and more
        </Typography>
        <Typography variant="h5" className="hero-text" sx={{ fontWeight: 500 }}>
          QData Management
        </Typography>
        <Typography variant="body2" className="hero-text" sx={{ opacity: 0.82 }}>
          Files, folders, public/private sharing, and name-assets for all registered names.
        </Typography>
      </Box>
    </Paper>
  );
}

function AdminPanelHero({ tile }: { tile: Tile }) {
  const theme = useTheme();
  const secondaryBase =
    theme.palette.secondary[theme.palette.mode === 'dark' ? 'dark' : 'main'] ||
    theme.palette.secondary.main;
  const secondaryAccent = lighten(
    theme.palette.secondary[theme.palette.mode === 'dark' ? 'light' : 'main'] ||
      theme.palette.secondary.light,
    theme.palette.mode === 'dark' ? 0.05 : 0.3
  );
  const gradient = `linear-gradient(135deg, ${darken(
    secondaryBase,
    theme.palette.mode === 'dark' ? 0.25 : 0.08
  )}, ${secondaryAccent})`;
  const componentProps = tile.disabled
    ? {}
    : { component: RouterLink, to: tile.to, style: { textDecoration: 'none' } };

  return (
    <Paper
      variant="outlined"
      {...componentProps}
      sx={{
        borderRadius: 3,
        p: { xs: 2.5, md: 4 },
        boxShadow: 6,
        background: gradient,
        color: 'common.white',
        textDecoration: 'none',
        cursor: tile.disabled ? 'not-allowed' : 'pointer',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 3,
        flexDirection: { xs: 'column', md: 'row' },
        minHeight: { xs: 220, md: 240 },
        position: 'relative',
        overflow: 'hidden',
        '&:after': {
          content: '""',
          position: 'absolute',
          inset: 0,
          background:
            'radial-gradient(circle at bottom left, rgba(255,255,255,0.25), rgba(255,255,255,0))',
          opacity: tile.disabled ? 0 : 1,
          pointerEvents: 'none',
        },
        transition: 'transform 140ms ease, box-shadow 140ms ease, filter 140ms ease',
        '&:hover': tile.disabled
          ? {}
          : {
              transform: 'translateY(3px)',
              boxShadow: 4,
              filter: 'brightness(0.98)',
              '.hero-text': { color: alpha(theme.palette.common.white, 0.78) },
            },
        '&:hover, &:focus-visible': { textDecoration: 'none' },
      }}
    >
      <Stack direction="row" alignItems="center" spacing={3} sx={{ zIndex: 1 }}>
        <Box
          sx={{
            width: { xs: 110, md: 130 },
            height: { xs: 110, md: 130 },
            borderRadius: 3,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background:
              'radial-gradient(circle at 25% 25%, rgba(255,255,255,0.4), transparent 60%), rgba(255, 255, 255, 0.1)',
            border: '1px solid rgba(255,255,255,0.35)',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          <Typography variant="h3" sx={{ letterSpacing: 2, zIndex: 1, fontWeight: 600 }}>
            AP
          </Typography>
        </Box>
        <Box>
          <Typography variant="h3" className="hero-text" sx={{ fontWeight: 600, lineHeight: 1 }}>
            {tile.title}
          </Typography>
          <Typography
            variant="subtitle2"
            className="hero-text"
            sx={{ textTransform: 'uppercase', letterSpacing: 2 }}
          >
            System tools
          </Typography>
          <Typography
            variant="body1"
            className="hero-text"
            sx={{ mt: 1, opacity: 0.9, maxWidth: 520 }}
          >
            Moderate promotions, announcements, and platform-wide automation from a dedicated
            console tailored to management admins.
          </Typography>
        </Box>
      </Stack>

      <Box
        sx={{
          zIndex: 1,
          display: 'flex',
          flexDirection: 'column',
          gap: 0.5,
          textAlign: { xs: 'center', md: 'right' },
        }}
      >
        <Typography
          variant="caption"
          className="hero-text"
          sx={{ textTransform: 'uppercase', letterSpacing: 1.5 }}
        >
          Elevated controls
        </Typography>
        <Typography variant="h5" className="hero-text" sx={{ fontWeight: 500 }}>
          Admin Panel
        </Typography>
        <Typography variant="body2" className="hero-text" sx={{ opacity: 0.82 }}>
          Track submissions, review promos, and maintain system stability with specialized
          workflows.
        </Typography>
      </Box>
    </Paper>
  );
}

export default function ManageHome() {
  const { track } = useFetchTracker();
  const [roles, setRoles] = useState<UserRoles | null>(null);
  const [rolesLoading, setRolesLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    (async () => {
      setRolesLoading(true);
      try {
        const loaded = await track(getUserRoles(), 'blocking:manage:roles');
        if (alive) setRoles(loaded);
      } catch {
        // ignore errors; default roles null hides admin-only tile
      } finally {
        if (alive) setRolesLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, [track]);

  const visibleTiles = tiles.filter(
    (t) => !t.requiresAdmin || userHasPermission(roles, 'permissions.manage.manifest')
  );
  const dataTile = visibleTiles.find((tile) => tile.to === '/manage/data/explorer') ?? null;
  const adminTile = visibleTiles.find((tile) => tile.to === '/manage/admin') ?? null;
  const otherTiles = visibleTiles.filter(
    (tile) => tile.to !== '/manage/data/explorer' && tile.to !== '/manage/admin'
  );

  return (
    <Box sx={{ p: { xs: 1.5, sm: 2 }, mx: 'auto', maxWidth: '1100px' }}>
      <Stack spacing={1}>
        <Typography variant="h4" sx={{ lineHeight: 1.15 }}>
          Management
        </Typography>
        <Typography variant="body2" color="text.secondary">
          Launch publishing, payouts, and administrator tooling from one hub.
        </Typography>
      </Stack>

      {rolesLoading && (
        <Paper
          variant="outlined"
          sx={{
            p: 2,
            mt: 2,
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            borderRadius: 2,
          }}
        >
          <CircularProgress size={18} />
          <Typography variant="body2">Checking management permissions…</Typography>
        </Paper>
      )}

      <Box
        sx={{
          mt: 2.5,
          display: 'grid',
          gap: { xs: 2, sm: 2.5 },
          gridTemplateColumns: {
            xs: 'repeat(1, minmax(0, 1fr))',
            sm: 'repeat(auto-fit, minmax(260px, 1fr))',
          },
        }}
      >
        {dataTile && (
          <Box sx={{ gridColumn: { md: '1 / -1' } }}>
            <DataExplorerHero tile={dataTile} />
          </Box>
        )}
        {otherTiles.map((t) => (
          <TileCard key={t.title} t={t} />
        ))}
        {adminTile && (
          <Box sx={{ gridColumn: { md: '1 / -1' } }}>
            <AdminPanelHero tile={adminTile} />
          </Box>
        )}
      </Box>
    </Box>
  );
}
