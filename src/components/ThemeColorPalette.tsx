import { Tooltip, IconButton, Box, Divider } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import PaletteIcon from '@mui/icons-material/Palette';
import ClearIcon from '@mui/icons-material/FormatColorReset';
import type { Editor } from '@tiptap/react';
import { THEME_COLOR_TOKENS, ThemeColorToken } from '../tiptap/themeColorTokens';

type Props = { editor: Editor };

function resolveTokenColor(theme: any, token: ThemeColorToken): string {
  // token like "primary.main" -> theme.palette.primary.main
  const [k1, k2] = token.split('.') as [keyof typeof theme.palette, string];
  const maybe = theme.palette?.[k1]?.[k2 as any];
  return typeof maybe === 'string' ? maybe : theme.palette.text.primary;
}

export default function ThemeColorPalette({ editor }: Props) {
  const theme = useTheme();
  const active = editor?.getAttributes('themedColor')?.token as string | undefined;

  return (
    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
      <PaletteIcon fontSize="small" />
      <Box sx={{ display: 'flex', gap: 0.5, flexWrap: 'wrap' }}>
        {THEME_COLOR_TOKENS.map((token) => {
          const color = resolveTokenColor(theme, token);
          const isActive = active === token;
          return (
            <Tooltip key={token} title={`Theme: ${token}`}>
              <IconButton
                size="small"
                onClick={() => {
                  if (isActive) editor.commands.unsetThemeColor();
                  else editor.commands.setThemeColor(token, color);
                }}
                sx={{
                  width: 24,
                  height: 24,
                  p: 0.5,
                  border: isActive
                    ? `2px solid ${theme.palette.primary.main}`
                    : `1px solid ${theme.palette.divider}`,
                  borderRadius: '4px',
                  backgroundColor: color,
                }}
              />
            </Tooltip>
          );
        })}
      </Box>
      <Divider orientation="vertical" flexItem sx={{ mx: 1 }} />
      <Tooltip title="Clear theme color">
        <IconButton size="small" onClick={() => editor.commands.unsetThemeColor()}>
          <ClearIcon fontSize="small" />
        </IconButton>
      </Tooltip>
    </Box>
  );
}
