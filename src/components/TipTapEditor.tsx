import { useEffect, useRef } from 'react';
import { useEditor, EditorContent, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { TipTapToolbar } from './TipTapToolbar';
import { ThemedColor } from '../tiptap/marks/ThemedColor';
import { THEME_COLOR_TOKENS, themedColorCSSFromTheme } from '../tiptap/themeColorTokens';
import { Box, useTheme } from '@mui/material';
// import QortalLink from '../tiptap/extensions/QortalLink';
import { QortalAutoLink } from '../tiptap/extensions/QortalAutoLink';
import { Link } from '@tiptap/extension-link';

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

export default function TiptapEditor({ value, onChange, onReady, full = true }: TiptapEditorProps) {
  const theme = useTheme();
  const didSetInitial = useRef(false);

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
    // no onUpdate -> no per-keystroke state updates
  });
  const linkExt = editor?.extensionManager.extensions.find((e) => e.name === 'link');
  console.log('link ext options:', linkExt?.options);
  console.log('schema link attrs:', editor?.schema.marks.link?.spec.attrs);

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

  return (
    <>
      <Box
        className="tiptap"
        sx={{
          // --- FULL WIDTH + HEIGHT BEHAVIOR ---
          ...(full
            ? {
                display: 'flex',
                flexDirection: 'column',
                // flex: 1,
                minHeight: 0, // allow shrinking inside overflow containers
                width: '100%', // fill width
                // alignSelf: 'stretch',
              }
            : {}),
          // Typography and media defaults
          '& ul': { pl: '1.5rem', listStyleType: 'disc', my: 1.5 },
          '& ol': { pl: '1.5rem', listStyleType: 'decimal', my: 1.5 },
          '& li': { mb: 0.25 },
          '& img': { maxWidth: '100%', height: 'auto', display: 'block', my: 2 },
        }}
      >
        <TipTapToolbar editor={editor} />
      </Box>
      <EditorContent editor={editor} />
    </>
  );
}
