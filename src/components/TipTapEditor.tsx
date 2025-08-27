import { useEffect } from 'react';
import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { TipTapToolbar } from './TipTapToolbar';
import { ThemedColor } from '../tiptap/marks/ThemedColor';
import {
  THEME_COLOR_TOKENS,
  // themedColorCSS,
  themedColorCSSFromTheme,
} from '../tiptap/themeColorTokens';
import { Box, useTheme } from '@mui/material';

interface TiptapEditorProps {
  value: string;
  onChange: (html: string) => void;
}

export default function TiptapEditor({ value, onChange }: TiptapEditorProps) {
  const theme = useTheme();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TextStyle,
      Color, // keep for “Custom…” hex colors
      ThemedColor, // our semantic token mark
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Image.configure({ allowBase64: true, HTMLAttributes: { class: 'tiptap-image' } }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
  });

  // Inject CSS mapping once (or on theme change if you use the fallback)
  useEffect(() => {
    const style = document.createElement('style');
    style.setAttribute('data-tiptap-themed-colors', ''); // marker for cleanup
    // If you use CssVarsProvider, prefer this:
    // style.textContent = themedColorCSS(THEME_COLOR_TOKENS);
    // Otherwise, fallback:
    style.textContent = themedColorCSSFromTheme(THEME_COLOR_TOKENS, theme.palette);
    document.head.appendChild(style);
    return () => {
      style.remove();
    };
  }, [theme.palette]); // keep if using fallback; safe either way

  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value, editor]);

  if (!editor) return null;

  return (
    <Box
      className="tiptap" // IMPORTANT: scope for CSS mapping
      sx={{
        '& ul': { pl: '1.5rem', listStyleType: 'disc', my: 1.5 },
        '& ol': { pl: '1.5rem', listStyleType: 'decimal', my: 1.5 },
        '& li': { mb: 0.25 },
        '& img': { maxWidth: '100%', height: 'auto', display: 'block', my: 2 },
      }}
    >
      <TipTapToolbar editor={editor} />
      <EditorContent editor={editor} />
    </Box>
  );
}
