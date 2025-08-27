import { useRef, useState } from 'react';
import {
  useTheme,
  Box,
  Button,
  Select,
  MenuItem,
  IconButton,
  Tooltip,
  Popover,
  Divider,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import FormatColorResetIcon from '@mui/icons-material/FormatColorReset';
import CodeIcon from '@mui/icons-material/Code';
import DataObjectIcon from '@mui/icons-material/DataObject';
import type { Editor } from '@tiptap/react';
// import InfoOutlineButton from './buttons/InfoOutlineButton';
// import { BorderColor } from '@mui/icons-material';
import { ThemeColorToken, THEME_COLOR_TOKENS } from '../tiptap/themeColorTokens';
// import { ThemedColor } from '../tiptap/marks/ThemedColor';

type Props = { editor: Editor };

function resolveTokenColor(theme: any, token: ThemeColorToken): string {
  const [cat, shade] = token.split('.') as [keyof typeof theme.palette, string];
  const v = theme.palette?.[cat]?.[shade as any];
  return typeof v === 'string' ? v : theme.palette.text.primary;
}

export function TipTapToolbar({ editor }: Props) {
  const theme = useTheme();

  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const [lastColor, setLastColor] = useState<string>('#26a69a');

  // popover anchor for theme palette + custom color
  const [paletteAnchor, setPaletteAnchor] = useState<HTMLElement | null>(null);
  const paletteOpen = Boolean(paletteAnchor);

  const is = (name: string, attrs?: any) => editor.isActive(name as any, attrs);

  const buttonStyle = (active: boolean) => ({
    borderRadius: '0.5rem',
    backgroundColor: active ? theme.palette.primary.main : theme.palette.background.paper,
    color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
    textTransform: 'none',
    fontWeight: 600,
    boxShadow: 'none',
    '&:hover': {
      backgroundColor: active ? theme.palette.primary.dark : theme.palette.action.hover,
      color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
    },
  });

  const buttonStyle2 = (active: boolean) => ({
    borderRadius: '0.5rem',
    backgroundColor: active ? theme.palette.info.main : theme.palette.primary.main,
    color: theme.palette.primary.contrastText,
    textTransform: 'none',
    fontWeight: 600,
    boxShadow: 'none',
    '&:hover': {
      backgroundColor: theme.palette.secondary.dark,
      color: theme.palette.primary.light,
    },
  });

  // ---- Color commands
  const triggerColorPicker = () => colorInputRef.current?.click();

  const onPickColor: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const color = e.target.value;
    if (!color) return;
    setLastColor(color);
    editor.chain().focus().setColor(color).run(); // custom color is inline hex, by design
  };

  const clearColor = () => {
    editor.chain().focus().unsetColor().run(); // remove inline hex
    (editor.commands as any).unsetThemeColor?.(); // remove token mark
  };

  // apply a token via themed mark if available; otherwise fallback to hex
  const applyThemeToken = (token: ThemeColorToken) => {
    // Remove inline hex so the token clearly wins
    editor.chain().focus().unsetColor().run();
    if (typeof (editor.commands as any).setThemeColor === 'function') {
      (editor.commands as any).setThemeColor(token);
    } else {
      // fallback: burn current theme hex (works even without mark/CSS)
      const hex = resolveTokenColor(theme, token);
      editor.chain().focus().setColor(hex).run();
    }
  };

  // reads the active themed token (if extension exists)
  const activeThemedToken =
    (editor?.getAttributes?.('themedColor')?.token as string | undefined) || undefined;

  // ---- Image
  const handleAddImage: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const src = result.startsWith('data:')
        ? result
        : `data:image/${file.type.split('/')[1] || 'png'};base64,${result}`;
      editor.chain().focus().setImage({ src }).run();
    };
    reader.readAsDataURL(file);
    e.currentTarget.value = '';
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: 1,
        mb: 2,
        borderBottom: `1px solid ${theme.palette.divider}`,
        pb: 1,
        alignItems: 'center',
      }}
    >
      {/* Headings / paragraph */}
      <Select
        size="small"
        value={
          is('heading', { level: 1 })
            ? 'h1'
            : is('heading', { level: 2 })
              ? 'h2'
              : is('heading', { level: 3 })
                ? 'h3'
                : is('heading', { level: 4 })
                  ? 'h4'
                  : is('heading', { level: 5 })
                    ? 'h5'
                    : is('heading', { level: 6 })
                      ? 'h6'
                      : 'paragraph'
        }
        onChange={(e) => {
          const val = e.target.value as string;
          if (val === 'paragraph') {
            editor.chain().focus().setParagraph().run();
          } else {
            const level = parseInt(val.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6;
            editor.chain().focus().toggleHeading({ level }).run();
          }
        }}
        sx={{ minWidth: 140 }}
      >
        <MenuItem value="paragraph">Paragraph</MenuItem>
        <MenuItem value="h1">Heading 1</MenuItem>
        <MenuItem value="h2">Heading 2</MenuItem>
        <MenuItem value="h3">Heading 3</MenuItem>
        <MenuItem value="h4">Heading 4</MenuItem>
        <MenuItem value="h5">Heading 5</MenuItem>
        <MenuItem value="h6">Heading 6</MenuItem>
      </Select>

      {/* Marks */}
      <Button
        size="small"
        sx={buttonStyle(is('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        Bold
      </Button>
      <Button
        size="small"
        sx={buttonStyle(is('italic'))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        Italic
      </Button>

      {/* Alignment */}
      <Button
        size="small"
        sx={buttonStyle(is({ textAlign: 'left' } as any))}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        Left
      </Button>
      <Button
        size="small"
        sx={buttonStyle(is({ textAlign: 'center' } as any))}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        Center
      </Button>
      <Button
        size="small"
        sx={buttonStyle(is({ textAlign: 'right' } as any))}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        Right
      </Button>

      {/* Hidden native color input (for Custom...) */}
      <input
        ref={colorInputRef}
        type="color"
        hidden
        defaultValue={lastColor}
        onChange={onPickColor}
      />

      {/* Theme palette + color button (opens popover near the button) */}
      <Tooltip title="Text color (theme & custom)">
        <IconButton
          size="small"
          onClick={(e) => setPaletteAnchor(e.currentTarget)}
          sx={buttonStyle(false)}
        >
          <PaletteIcon />
        </IconButton>
      </Tooltip>

      <Popover
        open={paletteOpen}
        anchorEl={paletteAnchor}
        onClose={() => setPaletteAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { p: 1, borderRadius: 2 } }}
      >
        <Box sx={{ px: 1, py: 0.5, fontSize: 12, color: 'text.secondary' }}>Theme colors</Box>
        <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(5, 28px)', gap: 1, p: 1 }}>
          {THEME_COLOR_TOKENS.map((token) => {
            const color = resolveTokenColor(theme, token);
            const active = activeThemedToken === token;
            return (
              <Tooltip key={token} title={token}>
                <Box
                  role="button"
                  aria-label={`set ${token}`}
                  onClick={() => {
                    applyThemeToken(token);
                    // keep popover open so users can try different swatches; close if you prefer
                  }}
                  sx={{
                    width: 24,
                    height: 24,
                    borderRadius: 0.75,
                    bgcolor: color,
                    border: active
                      ? `2px solid ${theme.palette.primary.main}`
                      : `1px solid ${theme.palette.divider}`,
                    cursor: 'pointer',
                  }}
                />
              </Tooltip>
            );
          })}
        </Box>
        <Divider />
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, p: 1 }}>
          <Box sx={{ fontSize: 12, color: 'text.secondary', mr: 1, minWidth: 80 }}>Custom HEX</Box>
          <Box
            sx={{
              width: 24,
              height: 24,
              borderRadius: 0.75,
              border: `1px solid ${theme.palette.divider}`,
              bgcolor: lastColor,
              flex: '0 0 auto',
            }}
          />
          <Button
            size="small"
            variant="outlined"
            onClick={() => triggerColorPicker()}
            sx={{ textTransform: 'none' }}
          >
            Custom…
          </Button>
          <Tooltip title="Clear color">
            <IconButton
              size="small"
              onClick={() => {
                clearColor();
              }}
            >
              <FormatColorResetIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </Box>
      </Popover>

      {/* Quick clear button (also available inside popover) */}
      <Tooltip title="Clear color">
        <IconButton size="small" onClick={clearColor} sx={buttonStyle(false)}>
          <FormatColorResetIcon />
        </IconButton>
      </Tooltip>

      {/* Lists */}
      <Button
        size="small"
        sx={buttonStyle(is('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        Bullet
      </Button>
      <Button
        size="small"
        sx={buttonStyle(is('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        Numbered
      </Button>

      {/* Inline code */}
      <Tooltip title="Inline code">
        <IconButton
          size="small"
          sx={buttonStyle(is('code'))}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <CodeIcon />
        </IconButton>
      </Tooltip>

      {/* Code block */}
      <Tooltip title="Code block">
        <IconButton
          size="small"
          sx={buttonStyle(is('codeBlock'))}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <DataObjectIcon />
        </IconButton>
      </Tooltip>

      {/* Image */}
      <Button size="small" component="label" sx={buttonStyle2(false)}>
        Add Image
        <input type="file" hidden accept="image/*" onChange={handleAddImage} />
      </Button>
    </Box>
  );
}
