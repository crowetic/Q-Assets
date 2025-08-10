import { useEffect } from 'react';
import { useEditor, EditorContent, Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { TextStyle } from '@tiptap/extension-text-style';
import Color from '@tiptap/extension-color';
import TextAlign from '@tiptap/extension-text-align';
import Image from '@tiptap/extension-image';
import { TipTapToolbar } from './TipTapToolbar';

import { Box } from '@mui/material';

interface TiptapEditorProps {
  value: string;
  onChange: (html: string) => void;
}

export default function TiptapEditor({ value, onChange }: TiptapEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: {
          levels: [1, 2, 3, 4, 5, 6],
          HTMLAttributes: {
            class: 'heading',
          },
        },
        paragraph: {
          HTMLAttributes: {
            class: 'paragraph',
          },
        },
      }),
      TextStyle,
      Color,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Image.configure({
        allowBase64: true,
        HTMLAttributes: { class: 'tiptap-image' },
      }),
    ],
    content: value,
    onUpdate: ({ editor }) => {
      onChange(editor.getHTML());
    },
  });

  // Handle updates if value changes externally
  useEffect(() => {
    if (editor && value !== editor.getHTML()) {
      editor.commands.setContent(value);
    }
  }, [value]);

  if (!editor) return null;

  return (
    <Box
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
