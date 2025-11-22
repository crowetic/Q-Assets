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
  TextField,
  SxProps,
  Theme,
} from '@mui/material';
import PaletteIcon from '@mui/icons-material/Palette';
import FormatColorResetIcon from '@mui/icons-material/FormatColorReset';
import CodeIcon from '@mui/icons-material/Code';
import DataObjectIcon from '@mui/icons-material/DataObject';
import LinkIcon from '@mui/icons-material/Link';
import LinkOffIcon from '@mui/icons-material/LinkOff';
import TitleIcon from '@mui/icons-material/Title';
import ImageIcon from '@mui/icons-material/Image';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import FormatListBulletedIcon from '@mui/icons-material/FormatListBulleted';
import FormatListNumberedIcon from '@mui/icons-material/FormatListNumbered';
import FormatBoldIcon from '@mui/icons-material/FormatBold';
import FormatItalicIcon from '@mui/icons-material/FormatItalic';
import FormatAlignLeftIcon from '@mui/icons-material/FormatAlignLeft';
import FormatAlignCenterIcon from '@mui/icons-material/FormatAlignCenter';
import FormatAlignRightIcon from '@mui/icons-material/FormatAlignRight';
import { type Editor } from '@tiptap/react';
import { ThemeColorToken, THEME_COLOR_TOKENS } from '../tiptap/themeColorTokens';
import { TextSelection, EditorState, Transaction } from 'prosemirror-state';

type Props = { editor: Editor; compact?: boolean };

const LINK_MARK = 'link';
const QORTAL_HREF_RE = /^qortal:\/\/\S+$/i;

function normalizeQortalHref(raw: string): string | null {
  if (!raw) return null;
  let s = raw.trim().replace(/\s+$/u, '');
  if (!QORTAL_HREF_RE.test(s)) return null;
  s = s.replace(/ /g, '%20');
  return s;
}

function resolveTokenColor(theme: any, token: ThemeColorToken): string {
  const [cat, shade] = token.split('.') as [keyof typeof theme.palette, string];
  const v = theme.palette?.[cat]?.[shade as any];
  return typeof v === 'string' ? v : theme.palette.text.primary;
}

const baseBtnSxObj = (theme: Theme, active: boolean) =>
  ({
    borderRadius: 8,
    backgroundColor: active ? theme.palette.primary.main : 'transparent',
    color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
    textTransform: 'none',
    fontWeight: 600,
    boxShadow: 'none',
    '&:hover': {
      backgroundColor: active ? theme.palette.primary.dark : theme.palette.action.hover,
    },
  }) as const;

// For IconButton (no minWidth here)
export const iconButtonSx =
  (active: boolean, compact: boolean): SxProps<Theme> =>
  (theme) => ({
    ...baseBtnSxObj(theme, active),
    // tighter padding when compact
    p: compact ? 0.5 : 1,
  });

// For Button (conditionally add minWidth ONLY when compact)
export const textButtonSx =
  (active: boolean, compact: boolean): SxProps<Theme> =>
  (theme) => ({
    ...baseBtnSxObj(theme, active),
    px: compact ? 0.5 : 1,
    ...(compact ? { minWidth: 0 } : {}), // no undefined in sx
  });

function addLinkMarkOverTextNodes(
  state: EditorState,
  from: number,
  to: number,
  href: string
): Transaction {
  const { schema, doc } = state;
  const link = schema.marks.link.create({ href });
  let tr = state.tr;
  doc.nodesBetween(from, to, (node, pos) => {
    if (!node.isText) return;
    const start = Math.max(pos, from);
    const end = Math.min(pos + node.nodeSize, to);
    tr = tr.addMark(start, end, link);
  });
  return tr.setSelection(TextSelection.create(tr.doc, to, to));
}

export function TipTapToolbar({ editor, compact = false }: Props) {
  const theme = useTheme();

  const colorInputRef = useRef<HTMLInputElement | null>(null);
  const [lastColor, setLastColor] = useState<string>('#26a69a');

  const savedSelRef = useRef<{ from: number; to: number } | null>(null);

  // palette popover
  const [paletteAnchor, setPaletteAnchor] = useState<HTMLElement | null>(null);
  const paletteOpen = Boolean(paletteAnchor);

  // link popover
  const [linkAnchor, setLinkAnchor] = useState<HTMLElement | null>(null);
  const [hrefInput, setHrefInput] = useState<string>('qortal://');
  const [textInput, setTextInput] = useState<string>('');

  // “More” popover (only used in compact mode)
  const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
  const moreOpen = Boolean(moreAnchor);

  const is = (name: string, attrs?: any) => editor.isActive(name as any, attrs);

  // const buttonStyle = (active: boolean) => ({
  //   borderRadius: '8px',
  //   backgroundColor: active ? theme.palette.primary.main : 'transparent',
  //   color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
  //   textTransform: 'none',
  //   fontWeight: 600,
  //   boxShadow: 'none',
  //   px: compact ? 0.5 : 1,
  //   minWidth: compact ? 0 : undefined,
  //   '&:hover': {
  //     backgroundColor: active ? theme.palette.primary.dark : theme.palette.action.hover,
  //   },
  // });

  const triggerColorPicker = () => colorInputRef.current?.click();
  const onPickColor: React.ChangeEventHandler<HTMLInputElement> = (e) => {
    const color = e.target.value;
    if (!color) return;
    setLastColor(color);
    editor.chain().focus().setColor(color).run();
  };
  const clearColor = () => {
    editor.chain().focus().unsetColor().run();
    (editor.commands as any).unsetThemeColor?.();
  };
  const activeThemedToken =
    (editor?.getAttributes?.('themedColor')?.token as string | undefined) || undefined;
  const applyThemeToken = (token: ThemeColorToken) => {
    editor.chain().focus().unsetColor().run();
    if (typeof (editor.commands as any).setThemeColor === 'function') {
      const hex = resolveTokenColor(theme, token);
      (editor.commands as any).setThemeColor(token, hex);
    } else {
      const hex = resolveTokenColor(theme, token);
      editor.chain().focus().setColor(hex).run();
    }
  };

  const getSelectionText = () => {
    const { from, to } = editor.state.selection;
    return editor.state.doc.textBetween(from, to, '\n') || '';
  };

  const openLinkPopover = (btn: HTMLElement) => {
    const current = editor.getAttributes(LINK_MARK) as { href?: string };
    const sel = editor.state.selection;
    savedSelRef.current = { from: sel.from, to: sel.to };
    const selText = getSelectionText();
    setHrefInput(current?.href || 'qortal://');
    setTextInput(selText || (current?.href ?? ''));
    setLinkAnchor(btn);
  };

  const applyLink = () => {
    const href = normalizeQortalHref(hrefInput);
    if (!href) return;
    const saved = savedSelRef.current;
    if (saved) editor.chain().focus().setTextSelection(saved).run();
    else editor.chain().focus().run();
    if (editor.isActive('codeBlock')) return;

    const { view } = editor;
    const s1 = view.state;
    const sel1 = s1.selection;

    if (sel1.empty) {
      const text = textInput && textInput.trim() ? textInput.trim() : href;
      let tr = s1.tr.insertText(text, sel1.from, sel1.to);
      view.dispatch(tr);
      const s2 = view.state;
      const end = s2.selection.to;
      const start = end - text.length;
      view.dispatch(addLinkMarkOverTextNodes(s2, start, end, href));
    } else {
      const { from, to } = sel1;
      view.dispatch(addLinkMarkOverTextNodes(s1, from, to, href));
    }
    savedSelRef.current = null;
    setLinkAnchor(null);
  };

  const removeLink = () => {
    editor.chain().focus().extendMarkRange(LINK_MARK).unsetLink().run();
    setLinkAnchor(null);
  };

  // Hidden native color input
  const colorInput = (
    <input ref={colorInputRef} type="color" defaultValue={lastColor} onChange={onPickColor} />
  );

  // ——— TOOLBAR LAYOUT ———
  // In compact mode: single-row, icon-only, horizontal scroll; a “More” button opens a popover that contains
  // Headings selector, Theme palette, Link dialog, and Add Image.
  return (
    <Box
      sx={{
        display: 'flex',
        alignItems: 'center',
        gap: compact ? 0.25 : 1,
        width: '100%',
        overflowX: compact ? 'auto' : 'visible',
        whiteSpace: compact ? 'nowrap' : 'normal',
        '&::-webkit-scrollbar': { height: 6 },
      }}
    >
      {colorInput}

      {/* Bold / Italic */}
      {compact ? (
        <>
          <Tooltip title="Bold">
            <IconButton
              size="small"
              sx={iconButtonSx(editor.isActive('bold'), compact)}
              onClick={() => editor.chain().focus().toggleBold().run()}
            >
              <FormatBoldIcon fontSize="small" />
            </IconButton>
          </Tooltip>
          <Tooltip title="Italic">
            <IconButton
              size="small"
              sx={iconButtonSx(editor.isActive('italic'), compact)}
              onClick={() => editor.chain().focus().toggleItalic().run()}
            >
              <FormatItalicIcon fontSize="small" />
            </IconButton>
          </Tooltip>
        </>
      ) : (
        <>
          <Button
            size="small"
            sx={textButtonSx(editor.isActive('bold'), compact)}
            onClick={() => editor.chain().focus().toggleBold().run()}
          >
            Bold
          </Button>
          <Button
            size="small"
            sx={textButtonSx(editor.isActive('italic'), compact)}
            onClick={() => editor.chain().focus().toggleItalic().run()}
          >
            Italic
          </Button>
        </>
      )}

      {/* Align */}
      <Tooltip title="Align left">
        <IconButton
          size="small"
          sx={iconButtonSx(editor.isActive({ textAlign: 'left' } as any), compact)}
          onClick={() => editor.chain().focus().setTextAlign('left').run()}
        >
          <FormatAlignLeftIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Align center">
        <IconButton
          size="small"
          sx={iconButtonSx(editor.isActive({ textAlign: 'center' } as any), compact)}
          onClick={() => editor.chain().focus().setTextAlign('center').run()}
        >
          <FormatAlignCenterIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Align right">
        <IconButton
          size="small"
          sx={iconButtonSx(editor.isActive({ textAlign: 'right' } as any), compact)}
          onClick={() => editor.chain().focus().setTextAlign('right').run()}
        >
          <FormatAlignRightIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {/* Lists */}
      <Tooltip title="Bullet list">
        <IconButton
          size="small"
          sx={iconButtonSx(editor.isActive('bulletList'), compact)}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          <FormatListBulletedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Numbered list">
        <IconButton
          size="small"
          sx={iconButtonSx(editor.isActive('orderedList'), compact)}
          onClick={() => editor.chain().focus().toggleOrderedList().run()}
        >
          <FormatListNumberedIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {/* Inline code / block code */}
      <Tooltip title="Inline code">
        <IconButton
          size="small"
          sx={iconButtonSx(editor.isActive('code'), compact)}
          onClick={() => editor.chain().focus().toggleCode().run()}
        >
          <CodeIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      <Tooltip title="Code block">
        <IconButton
          size="small"
          sx={iconButtonSx(editor.isActive('codeBlock'), compact)}
          onClick={() => editor.chain().focus().toggleCodeBlock().run()}
        >
          <DataObjectIcon fontSize="small" />
        </IconButton>
      </Tooltip>

      {/* Unlink (quick) */}
      <Tooltip title="Remove link">
        <span>
          <IconButton
            size="small"
            sx={iconButtonSx(false, compact)}
            onClick={() => removeLink()}
            disabled={!editor.isActive(LINK_MARK)}
          >
            <LinkOffIcon fontSize="small" />
          </IconButton>
        </span>
      </Tooltip>

      {/* —— More (compact) OR Rich controls (full) —— */}
      {compact ? (
        <>
          <Tooltip title="More">
            <IconButton
              size="small"
              sx={iconButtonSx(false, compact)}
              onClick={(e) => setMoreAnchor(e.currentTarget)}
            >
              <MoreHorizIcon fontSize="small" />
            </IconButton>
          </Tooltip>

          <Popover
            open={moreOpen}
            anchorEl={moreAnchor}
            onClose={() => setMoreAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            PaperProps={{ sx: { p: 1.25, borderRadius: 2, width: 320 } }}
          >
            {/* Headings */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <TitleIcon fontSize="small" />
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
                  if (val === 'paragraph') editor.chain().focus().setParagraph().run();
                  else
                    editor
                      .chain()
                      .focus()
                      .toggleHeading({ level: parseInt(val.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6 })
                      .run();
                }}
                sx={{ minWidth: 160 }}
              >
                <MenuItem value="paragraph">Paragraph</MenuItem>
                <MenuItem value="h1">Heading 1</MenuItem>
                <MenuItem value="h2">Heading 2</MenuItem>
                <MenuItem value="h3">Heading 3</MenuItem>
                <MenuItem value="h4">Heading 4</MenuItem>
                <MenuItem value="h5">Heading 5</MenuItem>
                <MenuItem value="h6">Heading 6</MenuItem>
              </Select>
            </Box>

            <Divider sx={{ my: 1 }} />

            {/* Theme colors + custom hex + clear (same as before) */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <PaletteIcon fontSize="small" />
              <Box sx={{ fontSize: 12, color: 'text.secondary' }}>Text color</Box>
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(6, 28px)', gap: 1, mb: 1 }}>
              {THEME_COLOR_TOKENS.map((token) => {
                const color = resolveTokenColor(theme, token);
                const active = activeThemedToken === token;
                return (
                  <Tooltip key={token} title={token}>
                    <Box
                      role="button"
                      aria-label={`set ${token}`}
                      onClick={() => applyThemeToken(token)}
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
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
              <Button
                size="small"
                variant="outlined"
                onClick={() => triggerColorPicker()}
                sx={{ textTransform: 'none' }}
              >
                Custom…
              </Button>
              <Tooltip title="Clear color">
                <span>
                  <IconButton size="small" onClick={clearColor}>
                    <FormatColorResetIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>

            <Divider sx={{ my: 1 }} />

            {/* Link */}
            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
              <IconButton size="small" onClick={(e) => setLinkAnchor(e.currentTarget)}>
                <LinkIcon fontSize="small" />
              </IconButton>
              <Box sx={{ fontSize: 12, color: 'text.secondary' }}>Insert/edit qortal:// link</Box>
            </Box>

            {/* Image */}
            <Button size="small" component="label" startIcon={<ImageIcon />} variant="contained">
              Add Image
              <input
                type="file"
                hidden
                accept="image/*"
                onChange={(e) => {
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
                }}
              />
            </Button>
          </Popover>
        </>
      ) : (
        <>
          {/* FULL mode controls (unchanged from your version, trimmed for brevity) */}
          {/* Heading select */}
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
              if (val === 'paragraph') editor.chain().focus().setParagraph().run();
              else
                editor
                  .chain()
                  .focus()
                  .toggleHeading({ level: parseInt(val.slice(1), 10) as 1 | 2 | 3 | 4 | 5 | 6 })
                  .run();
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

          {/* Palette trigger (same as before) */}
          <Tooltip title="Text color (theme & custom)">
            <span>
              <IconButton
                size="small"
                onClick={(e) => setPaletteAnchor(e.currentTarget)}
                sx={iconButtonSx(false, compact)}
              >
                <PaletteIcon />
              </IconButton>
            </span>
          </Tooltip>

          <Popover
            open={paletteOpen}
            anchorEl={paletteAnchor}
            onClose={() => setPaletteAnchor(null)}
            anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
            transformOrigin={{ vertical: 'top', horizontal: 'left' }}
            PaperProps={{ sx: { p: 1, borderRadius: 2 } }}
          >
            {/* (same palette UI as your original) */}
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
                      onClick={() => applyThemeToken(token)}
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
              <Button
                size="small"
                variant="outlined"
                onClick={() => triggerColorPicker()}
                sx={{ textTransform: 'none' }}
              >
                Custom…
              </Button>
              <Tooltip title="Clear color">
                <span>
                  <IconButton size="small" onClick={clearColor}>
                    <FormatColorResetIcon fontSize="small" />
                  </IconButton>
                </span>
              </Tooltip>
            </Box>
          </Popover>

          {/* Link (same behavior) */}
          <Tooltip title="Insert/edit link (qortal:// only)">
            <span>
              <IconButton
                size="small"
                sx={iconButtonSx(!!editor.isActive(LINK_MARK), compact)}
                onClick={(e) => openLinkPopover(e.currentTarget)}
              >
                <LinkIcon />
              </IconButton>
            </span>
          </Tooltip>

          {/* Image (same behavior) */}
          <Button size="small" component="label" sx={textButtonSx(false, compact)}>
            Add Image
            <input
              type="file"
              hidden
              accept="image/*"
              onChange={(e) => {
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
              }}
            />
          </Button>
        </>
      )}

      {/* Link popover (shared) */}
      <Popover
        open={Boolean(linkAnchor)}
        anchorEl={linkAnchor}
        onClose={() => setLinkAnchor(null)}
        anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
        transformOrigin={{ vertical: 'top', horizontal: 'left' }}
        PaperProps={{ sx: { p: 1.5, borderRadius: 2, width: 320 } }}
      >
        <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
          <TextField
            label="Link (qortal://...)"
            size="small"
            value={hrefInput}
            onChange={(e) => setHrefInput(e.target.value)}
            error={!!hrefInput && !normalizeQortalHref(hrefInput)}
            helperText={
              !hrefInput
                ? 'Required'
                : normalizeQortalHref(hrefInput)
                  ? ' '
                  : 'Must start with qortal://'
            }
            autoFocus
          />
          <TextField
            label="Text to display"
            size="small"
            value={textInput}
            onChange={(e) => setTextInput(e.target.value)}
            placeholder={getSelectionText() || 'Use selection'}
          />
          <Box sx={{ display: 'flex', gap: 1, justifyContent: 'flex-end', mt: 0.5 }}>
            <Button size="small" onClick={() => setLinkAnchor(null)}>
              Cancel
            </Button>
            <Button
              size="small"
              variant="contained"
              disabled={!normalizeQortalHref(hrefInput)}
              onClick={applyLink}
            >
              Apply
            </Button>
          </Box>
        </Box>
      </Popover>
    </Box>
  );
}
