import { useTheme, Box, Button, Select, MenuItem } from '@mui/material';
import type { Editor } from '@tiptap/react';

export function TipTapToolbar({ editor }: { editor: Editor }) {
  const theme = useTheme();

  const applyColor = () => {
    const color = prompt('Enter hex color code (e.g., #ff0000)');
    if (color) {
      editor.chain().focus().setColor(color).run();
    }
  };

  const buttonStyle = (active: boolean) => ({
    borderRadius: '6px',
    backgroundColor: active ? theme.palette.primary.main : theme.palette.background.paper,
    color: active ? theme.palette.primary.contrastText : theme.palette.text.primary,
    textTransform: 'none',
    fontWeight: 600,
    boxShadow: 'none',
    '&:hover': {
      backgroundColor: theme.palette.primary.dark,
      color: theme.palette.primary.contrastText,
    },
  });

  const buttonStyle2 = (active: boolean) => ({
    borderRadius: '6px',
    backgroundColor: active ? theme.palette.info.light : theme.palette.primary.dark,
    color: active ? theme.palette.text.primary : theme.palette.text.primary,
    borderSize: '1rem',
    borderColor: active ? theme.palette.secondary.light : theme.palette.secondary.dark,
    textTransform: 'none',
    fontWeight: 600,
    boxShadow: 'none',
    '&:hover': {
      backgroundColor: theme.palette.secondary.dark,
      color: theme.palette.primary.contrastText,
    },
  });

  const handleAddImage = (e: React.ChangeEvent<HTMLInputElement>) => {
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
      }}
    >
      <Select
        size="small"
        value={
          editor.isActive('heading', { level: 1 })
            ? 'h1'
            : editor.isActive('heading', { level: 2 })
              ? 'h2'
              : editor.isActive('heading', { level: 3 })
                ? 'h3'
                : 'paragraph'
        }
        onChange={(e) => {
          const val = e.target.value;
          if (val === 'paragraph') {
            editor.chain().focus().setParagraph().run();
          } else {
            const level = parseInt(val.slice(1), 10) as 1 | 2 | 3;
            editor.chain().focus().toggleHeading({ level }).run();
          }
        }}
      >
        <MenuItem value="paragraph">Paragraph</MenuItem>
        <MenuItem value="h1">Heading 1</MenuItem>
        <MenuItem value="h2">Heading 2</MenuItem>
        <MenuItem value="h3">Heading 3</MenuItem>
      </Select>

      {/* Buttons */}
      <Button
        size="small"
        sx={buttonStyle(editor.isActive('bold'))}
        onClick={() => editor.chain().focus().toggleBold().run()}
      >
        Bold
      </Button>
      <Button
        size="small"
        sx={buttonStyle(editor.isActive('italic'))}
        onClick={() => editor.chain().focus().toggleItalic().run()}
      >
        Italic
      </Button>
      <Button size="small" sx={buttonStyle(false)} disabled>
        Underline
      </Button>

      <Button
        size="small"
        sx={buttonStyle(false)}
        onClick={() => editor.chain().focus().setTextAlign('left').run()}
      >
        Left
      </Button>
      <Button
        size="small"
        sx={buttonStyle(false)}
        onClick={() => editor.chain().focus().setTextAlign('center').run()}
      >
        Center
      </Button>
      <Button
        size="small"
        sx={buttonStyle(false)}
        onClick={() => editor.chain().focus().setTextAlign('right').run()}
      >
        Right
      </Button>

      <Button size="small" sx={buttonStyle(false)} onClick={applyColor}>
        Text Color
      </Button>

      <Button
        size="small"
        sx={buttonStyle(editor.isActive('bulletList'))}
        onClick={() => editor.chain().focus().toggleBulletList().run()}
      >
        Bullet
      </Button>
      <Button
        size="small"
        sx={buttonStyle(editor.isActive('orderedList'))}
        onClick={() => editor.chain().focus().toggleOrderedList().run()}
      >
        Numbered
      </Button>
      <Button size="small" component="label" sx={buttonStyle2(false)}>
        Add Image
        <input type="file" hidden accept="image/*" onChange={handleAddImage} />
      </Button>
    </Box>
  );
}
