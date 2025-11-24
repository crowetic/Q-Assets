import { JSX, memo, useMemo } from 'react';
import {
  Alert,
  Box,
  CircularProgress,
  IconButton,
  List,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Paper,
  Stack,
  Tooltip,
  Typography,
} from '@mui/material';
import { alpha, useTheme } from '@mui/material/styles';
import FolderRoundedIcon from '@mui/icons-material/FolderRounded';
import FolderOpenRoundedIcon from '@mui/icons-material/FolderOpenRounded';
import ChevronRightRoundedIcon from '@mui/icons-material/ChevronRightRounded';
import RefreshRoundedIcon from '@mui/icons-material/RefreshRounded';
import type { FolderNode, ServiceBucket } from '../DataExplorer.types';

type ExplorerSidebarProps = {
  entries: { name: string }[];
  activeName: string | null;
  namesLoading: boolean;
  namesError: string | null;
  serviceBuckets: ServiceBucket[];
  activeSection: 'services' | 'files' | 'shares';
  activeService: string | null;
  activeFilePath: string;
  visibleStructuredCount: number;
  shareCount: number;
  folderMap: Map<string, FolderNode>;
  onSelectName: (name: string) => void;
  onReloadNames: () => void;
  onServiceNavigate: (service: string | null) => void;
  onFolderNavigate: (path: string) => void;
  onShareNavigate: () => void;
};

const renderFolderTree = (
  folderMap: Map<string, FolderNode>,
  activeSection: 'services' | 'files' | 'shares',
  activeFilePath: string,
  onFolderNavigate: (path: string) => void
) => {
  const buildNodes = (parentKey: string, depth = 0): JSX.Element[] => {
    const parent = folderMap.get(parentKey);
    if (!parent) return [];
    return parent.childKeys
      .map((childKey) => {
        const node = folderMap.get(childKey);
        if (!node) return null;
        const isActive = activeSection === 'files' && activeFilePath === childKey;
        return (
          <Box key={childKey} sx={{ ml: depth ? depth * 1.5 : 0 }}>
            <ListItemButton
              onClick={() => onFolderNavigate(childKey)}
              selected={isActive}
              sx={{ borderRadius: 2, mb: 0.5 }}
            >
              <ListItemIcon sx={{ minWidth: 34 }}>
                <FolderRoundedIcon fontSize="small" color={isActive ? 'primary' : 'inherit'} />
              </ListItemIcon>
              <ListItemText
                primary={node.name || '/'}
                secondary={`${node.files.length} file${node.files.length === 1 ? '' : 's'}`}
                primaryTypographyProps={{ fontSize: 13 }}
              />
            </ListItemButton>
            {buildNodes(childKey, depth + 1)}
          </Box>
        );
      })
      .filter((node): node is JSX.Element => Boolean(node));
  };
  return buildNodes('');
};

export const ExplorerSidebar = memo(function ExplorerSidebar({
  entries,
  activeName,
  namesLoading,
  namesError,
  serviceBuckets,
  activeSection,
  activeService,
  activeFilePath,
  visibleStructuredCount,
  shareCount,
  folderMap,
  onSelectName,
  onReloadNames,
  onServiceNavigate,
  onFolderNavigate,
  onShareNavigate,
}: ExplorerSidebarProps) {
  const theme = useTheme();
  const folderTree = useMemo(
    () => renderFolderTree(folderMap, activeSection, activeFilePath, onFolderNavigate),
    [folderMap, activeSection, activeFilePath, onFolderNavigate]
  );

  return (
    <Paper
      variant="outlined"
      sx={{
        flexBasis: { lg: '280px' },
        flexShrink: 0,
        alignSelf: 'stretch',
        borderRadius: 3,
        p: 2,
        height: { xs: 'auto', lg: '100%' },
        maxHeight: { xs: 'auto', lg: 'calc(100vh - 220px)' },
        overflowY: 'auto',
        overflowX: 'hidden',
        scrollbarWidth: 'thin',
        scrollbarColor: `${alpha(theme.palette.primary.main, 0.4)} transparent`,
        '&::-webkit-scrollbar': {
          width: 6,
        },
        '&::-webkit-scrollbar-track': {
          backgroundColor: 'transparent',
        },
        '&::-webkit-scrollbar-thumb': {
          backgroundColor: alpha(theme.palette.primary.main, 0.18),
          borderRadius: 999,
        },
        '&:hover::-webkit-scrollbar-thumb': {
          backgroundColor: alpha(theme.palette.primary.main, 0.4),
        },
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" alignItems="center" justifyContent="space-between">
          <Typography variant="subtitle1">Names</Typography>
          <Tooltip title="Reload names">
            <IconButton size="small" onClick={onReloadNames}>
              <RefreshRoundedIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Stack>
        {namesError && <Alert severity="warning">{namesError}</Alert>}
        <List disablePadding>
          {entries.map((entry) => {
            const isActive = entry.name === activeName;
            return (
              <Box key={entry.name}>
                <ListItemButton
                  selected={isActive}
                  onClick={() => onSelectName(entry.name)}
                  sx={{ borderRadius: 2, mb: 0.5 }}
                >
                  <ListItemIcon sx={{ minWidth: 34 }}>
                    <FolderRoundedIcon fontSize="small" color={isActive ? 'primary' : 'inherit'} />
                  </ListItemIcon>
                  <ListItemText
                    primary={entry.name}
                    secondary={isActive ? 'Active' : ' '}
                    primaryTypographyProps={{ fontWeight: isActive ? 600 : 500 }}
                  />
                </ListItemButton>
                {isActive && (
                  <Box sx={{ pl: 3, pt: 1 }}>
                    <Typography variant="caption" color="text.secondary">
                      Services
                    </Typography>
                    <List component="div" disablePadding sx={{ mb: 1 }}>
                      <ListItemButton
                        onClick={() => onServiceNavigate(null)}
                        selected={activeSection === 'services' && !activeService}
                        sx={{ borderRadius: 2, mb: 0.5 }}
                      >
                        <ListItemIcon sx={{ minWidth: 34 }}>
                          <FolderOpenRoundedIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary="All services"
                          primaryTypographyProps={{ fontSize: 13 }}
                        />
                      </ListItemButton>
                      {serviceBuckets.map((bucket) => (
                        <ListItemButton
                          key={bucket.service}
                          onClick={() => onServiceNavigate(bucket.service)}
                          selected={
                            activeSection === 'services' && activeService === bucket.service
                          }
                          sx={{ borderRadius: 2, mb: 0.5 }}
                        >
                          <ListItemIcon sx={{ minWidth: 34 }}>
                            <ChevronRightRoundedIcon fontSize="small" />
                          </ListItemIcon>
                          <ListItemText
                            primary={bucket.label}
                            secondary={`${bucket.count} item${bucket.count === 1 ? '' : 's'}`}
                            primaryTypographyProps={{ fontSize: 13 }}
                          />
                        </ListItemButton>
                      ))}
                    </List>

                    <Typography variant="caption" color="text.secondary">
                      Files
                    </Typography>
                    <List component="div" disablePadding>
                      <ListItemButton
                        onClick={() => onFolderNavigate('')}
                        selected={activeSection === 'files' && !activeFilePath}
                        sx={{ borderRadius: 2, mb: 0.5 }}
                      >
                        <ListItemIcon sx={{ minWidth: 34 }}>
                          <FolderOpenRoundedIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary="All files"
                          secondary={`${visibleStructuredCount} file${
                            visibleStructuredCount === 1 ? '' : 's'
                          }`}
                          primaryTypographyProps={{ fontSize: 13 }}
                        />
                      </ListItemButton>
                      {folderTree}
                    </List>

                    <Typography variant="caption" color="text.secondary" sx={{ mt: 2 }}>
                      Shares
                    </Typography>
                    <List component="div" disablePadding>
                      <ListItemButton
                        onClick={onShareNavigate}
                        selected={activeSection === 'shares'}
                        sx={{ borderRadius: 2, mb: 0.5 }}
                      >
                        <ListItemIcon sx={{ minWidth: 34 }}>
                          <FolderOpenRoundedIcon fontSize="small" />
                        </ListItemIcon>
                        <ListItemText
                          primary="All shares"
                          secondary={`${shareCount} item${shareCount === 1 ? '' : 's'}`}
                          primaryTypographyProps={{ fontSize: 13 }}
                        />
                      </ListItemButton>
                    </List>
                  </Box>
                )}
              </Box>
            );
          })}
          {!entries.length && !namesLoading && (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              Register a Qortal name to begin publishing.
            </Typography>
          )}
          {namesLoading && (
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 1 }}>
              <CircularProgress size={16} />
              <Typography variant="caption">Loading names…</Typography>
            </Stack>
          )}
        </List>
      </Stack>
    </Paper>
  );
});
