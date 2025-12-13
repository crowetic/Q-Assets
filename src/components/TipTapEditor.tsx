import { useEffect, useRef, useState } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { TipTapToolbar } from './TipTapToolbar';
import { ThemedColor } from '../tiptap/marks/ThemedColor';
import { THEME_COLOR_TOKENS, themedColorCSSFromTheme } from '../tiptap/themeColorTokens';
import { Box, IconButton, Tooltip, useMediaQuery, useTheme } from '@mui/material';
import { QortalAutoLink } from '../tiptap/extensions/QortalAutoLink';
import { Link } from '@tiptap/extension-link';
import { alpha } from '@mui/material';
import ExpandLessIcon from '@mui/icons-material/ExpandLess';
import ExpandMoreIcon from '@mui/icons-material/ExpandMore';

interface TiptapEditorProps {
  value: string; // initial content only
  onChange: (html: string) => void; // fires on blur or manual commit
  onReady?: (api: {
    editor: Editor;
    getHTML: () => string;
    setHTML: (h: string) => void;
    commit: () => void;
  }) => void;
  full?: boolean;
  compact?: boolean;
}

const QORTAL_RE = /^qortal:\/\/\S+$/i;

const QortalLink = Link.configure({
  openOnClick: false,
  autolink: false,
  linkOnPaste: false,
  HTMLAttributes: {
    target: '_self',
    rel: 'noopener',
  },
  protocols: ['http', 'https', 'mailto', 'tel', { scheme: 'qortal', optionalSlashes: false }],
  validate: (href) => QORTAL_RE.test(href) || /^(https?|mailto|tel):/i.test(href),
});

export default function TiptapEditor({
  value,
  onChange,
  onReady,
  full = true,
  compact: compactProp,
}: TiptapEditorProps) {
  const theme = useTheme();
  const isXs = useMediaQuery(theme.breakpoints.down('sm')); // phones
  const compact = Boolean(compactProp ?? isXs); // auto-compact on xs
  const didSetInitial = useRef(false);
  const [toolbarCollapsed, setToolbarCollapsed] = useState(compact);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
        link: false,
      }),
      TextStyle,
      Color,
      ThemedColor,
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ allowBase64: true, HTMLAttributes: { class: 'tiptap-image' } }),
      QortalLink,
      QortalAutoLink,
    ],
    editorProps: {
      attributes: {
        class: 'q-editor-content', // <— target this, not generic .ProseMirror
        spellCheck: 'true',
        'aria-label': 'Rich text editor',
      },
    },
  });
  // const linkExt = editor?.extensionManager.extensions.find((e) => e.name === 'link');
  // console.log('link ext options:', linkExt?.options);
  // console.log('schema link attrs:', editor?.schema.marks.link?.spec.attrs);

  // Inject theme color CSS once (or when theme changes)
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-tiptap-themed-colors', '');
    style.textContent = themedColorCSSFromTheme(THEME_COLOR_TOKENS, theme.palette);
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [theme.palette]);

  // Set initial content once
  useEffect(() => {
    if (!editor) return;
    if (didSetInitial.current) return;
    editor.commands.setContent(value ?? '', { emitUpdate: false });
    didSetInitial.current = true;
  }, [editor, value]);

  // Commit on blur
  useEffect(() => {
    if (!editor) return;
    const handleBlur = () => onChange(editor.getHTML());
    editor.on('blur', handleBlur);
    return () => {
      editor.off('blur', handleBlur);
    }; // <-- fixed
  }, [editor, onChange]);

  // Expose API for manual commit on Publish
  useEffect(() => {
    if (!editor || !onReady) return;
    onReady({
      editor,
      getHTML: () => editor.getHTML(),
      setHTML: () => {
        editor.commands.setContent(value ?? '', { emitUpdate: false });
      },
      commit: () => {
        onChange(editor.getHTML());
      },
    });
  }, [editor, onReady, onChange]);

  if (!editor) return null;

  // Theme-aware surface colors (TextField-like)
  const surfaceBg =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.primary.light, 0.08)
      : alpha(theme.palette.primary.light, 0.12);

  const surfaceBgFocus =
    theme.palette.mode === 'dark'
      ? alpha(theme.palette.primary.light, 0.16)
      : alpha(theme.palette.primary.light, 0.2);

  const ring = alpha(theme.palette.primary.main, 0.28);
  const hoverBorder = alpha(theme.palette.text.primary, 0.25);

  return (
    <Box
      className="tiptap-root"
      sx={{
        // FULL WIDTH + HEIGHT in parent
        ...(full && {
          display: 'flex',
          flexDirection: 'column',
          flex: 1,
          minHeight: 0,
          width: '100%',
          alignSelf: 'stretch',
        }),
        // Typography/media defaults
        '& ul': { pl: '1.5rem', listStyleType: 'disc', my: 1.5 },
        '& ol': { pl: '1.5rem', listStyleType: 'decimal', my: 1.5 },
        '& li': { mb: 0.25 },
        '& img': { maxWidth: '100%', height: 'auto', display: 'block', my: 2 },
        WebkitTapHighlightColor: 'transparent',
        position: 'relative',
        zindex: 0,
      }}
    >
      {/* Toolbar: sticky & above editor content */}
      {/* <Box
        className="tiptap-toolbar"
        sx={{
          flex: '0 0 auto',
          position: 'sticky',
          top: 0,
          zIndex: 2,
          // solid background so text doesn't show "under" it while typing
          bgcolor: theme.palette.background.paper,
          // small shadow so it's obviously floating
          boxShadow: 1,
        }}
      >
        <TipTapToolbar editor={editor} />
      </Box> */}

      <Box
        className="tiptap-toolbar"
        sx={{
          flex: '0 0 auto',
          position: 'sticky',
          top: 0,
          zIndex: 2,
          bgcolor: theme.palette.background.paper,
          boxShadow: 1,
          borderBottom: `1px solid ${theme.palette.divider}`,
          px: 1,
          py: compact ? 0.5 : 1,
          display: 'flex',
          alignItems: 'center',
          gap: 0.5,
        }}
      >
        {/* collapse/expand on mobile */}
        <Tooltip title={toolbarCollapsed ? 'Show formatting' : 'Hide formatting'}>
          <IconButton size="small" onClick={() => setToolbarCollapsed((v) => !v)} sx={{ mr: 0.5 }}>
            {toolbarCollapsed ? (
              <ExpandMoreIcon fontSize="small" />
            ) : (
              <ExpandLessIcon fontSize="small" />
            )}
          </IconButton>
        </Tooltip>

        {!toolbarCollapsed && <TipTapToolbar editor={editor} compact={compact} />}
      </Box>
      {/* Scrollable editor pane */}
      <Box
        className="q-editor-surface"
        // onClick={() => editor?.commands.focus('end')}
        sx={{
          flex: 1,
          minHeight: 0,
          display: 'flex',
          zIndex: 1,
          overflow: 'auto',
          position: 'relative',
          bgcolor: surfaceBg,
          border: `1px solid ${theme.palette.divider}`,
          borderRadius: 1.5,
          transition: 'background-color 120ms ease, border-color 120ms ease, box-shadow 120ms ease',
          cursor: 'text',
          '&:hover': {
            borderColor: hoverBorder,
          },
          '&:focus-within': {
            borderColor: theme.palette.primary.main,
            boxShadow: `0 0 0 3px ${ring}`,
            bgcolor: surfaceBgFocus,
          },
        }}
      >
        <EditorContent
          editor={editor}
          // Give the content area full height + padding
          className="q-editor-content"
          style={{ pointerEvents: 'auto' }}
          // (class duplicated via editorProps to guarantee specificity)
        />
      </Box>
      <style>{`
        .q-editor-surface .q-editor-content {
          /* FILL + SCROLL, but NOT flex */
          flex: 1 1 auto;
          min-height: 0;
          width: 100%;
          height: 100%;
          box-sizing: border-box;
          padding: 12px;
          outline: none;
          overflow: auto;
          display: block;           
          white-space: normal;     
        }
        .q-editor-surface .q-editor-content p { margin: 0 0 0.75rem 0; }
        .q-editor-surface .q-editor-content:focus { outline: none; }
      `}</style>
    </Box>
  );
}
