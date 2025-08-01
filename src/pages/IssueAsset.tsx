import React, { useState, useEffect } from 'react';
import {
  Box,
  Button,
  TextField,
  Typography,
  Paper,
  Divider,
  FormControlLabel,
  Checkbox,
  MenuItem,
  Select,
} from '@mui/material';
import { useTheme } from '@mui/material';
import { useAuth } from 'qapp-core';
import { AssetPublication } from '../types/AssetPublicationMetadata';
import { signAndBroadcast, issueAsset } from '../utils/qortalApi';
import { objectToBase64 } from 'qapp-core';
import { getAssetIdentifiers } from '../constants/qdnConstants';
import { EditorContent, flattenExtensions, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
// import Bold from '@tiptap/extension-bold';
// import Italic from '@tiptap/extension-italic';
// import Underline from '@tiptap/extension-underline';
import TextAlign from '@tiptap/extension-text-align';
import Color from '@tiptap/extension-color';
import { FontSize, TextStyle } from '@tiptap/extension-text-style';
// import Paragraph from '@tiptap/extension-paragraph';
import type { Level } from '@tiptap/extension-heading';

// import Text from '@tiptap/extension-text';
// import Code from '@tiptap/extension-code';
import Image from '@tiptap/extension-image';
import { fileToBase64 } from '../utils/data';

export default function IssueAsset() {
  const {
    address: userAddress,
    publicKey: userPublicKey,
    name: userName,
    authenticateUser,
  } = useAuth();

  const [assetName, setAssetName] = useState('');
  const [description, setDescription] = useState('');
  const [quantity, setQuantity] = useState<number>(0);
  const [divisible, setDivisible] = useState<boolean>(true);
  const [unspendable, setUnspendable] = useState<boolean>(false);
  const [assetData, setAssetData] = useState<string>();

  // Metadata (QDN JSON)
  const [html, setHtml] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groupLink, setGroupLink] = useState('');
  const [groupIsPrivate, setGroupIsPrivate] = useState(false);
  const [avatarBase64, setAvatarBase64] = useState<string>('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  // const [isTestMode, setIsTestMode] = useState(false);
  const [editorHasInit, setEditorHasInit] = useState(false);

  const theme = useTheme();

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3, 4, 5, 6] },
      }),
      TextStyle,
      Color,
      TextAlign.configure({
        types: ['heading', 'paragraph'],
      }),
      Image,
      // Bold,
      // Italic,
      // Underline,
      // Code,
    ],
    content: html,
    onUpdate: ({ editor }) => {
      setHtml(editor.getHTML());
      // const md = editor.storage.markdown.getMarkdown(); // Optional: capture markdown too
      // console.log('markdown:', md);
    },
  });

  useEffect(() => {
    if (editor && assetName) {
      const today = new Date().toISOString().split('T')[0];
      const title = `<center><h2><span style="color: ${theme.palette.info.dark}">ANNouncement</span> - <span style="color: ${theme.palette.primary.light}">${assetName}</span> - Genesis Announcement -  <span style="color: ${theme.palette.primary.main}">${today}</span></h2></center>`;
      const body = `<p>Describe your asset here...</p>`;
      editor.commands.setContent(`${title}${body}`);
      setEditorHasInit(true);
    }
  }, [editor, assetName]);

  useEffect(() => {
    // If no address at all, auto-trigger authentication
    if (!userName) {
      authenticateUser();
    }
  }, [userName, authenticateUser]);

  const handleIssueAsset = async () => {
    if (!userName || !userAddress || !userPublicKey || !quantity || !assetName) {
      alert('Missing Required Asset data, please check all data and try again. !');
      return;
    }
    setAttemptedSubmit(true);
    setLoading(true);
    setError(null);
    setSuccess(null);

    try {
      const publication: AssetPublication = {
        description: description,
        html: html,
        primaryGroup: {
          name: groupName,
          id: groupId,
          joinLink: groupLink,
          isPrivate: false, // or dynamic
        },
      };

      const pub64 = await objectToBase64(publication);
      const [assetIdent] = (await getAssetIdentifiers(assetName)).identifiers.genesisPost;
      const [assetAvatarIdent] = (await getAssetIdentifiers(assetName)).identifiers.avatar;

      await issueAsset(
        userAddress,
        userPublicKey,
        assetName,
        description,
        quantity,
        divisible,
        assetData,
        unspendable
      );

      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        service: 'BLOG_POST',
        identifier: assetIdent,
        base64: pub64,
      });

      if (avatarBase64) {
        await qortalRequest({
          action: 'PUBLISH_QDN_RESOURCE',
          service: 'IMAGE',
          name: userName,
          identifier: assetAvatarIdent,
          base64: avatarBase64,
        });
      }

      setSuccess('Asset issued and Genesis publication saved successfully!');
      setAssetName('');
      setDescription('');
      setQuantity(0);
      setDivisible(true);
      setUnspendable(false);
      setGroupName('');
      setGroupId('');
      setGroupLink('');
      setGroupIsPrivate(false);
      setAttemptedSubmit(false);
      setAvatarBase64('');
      editor?.commands.clearContent();
    } catch (err: any) {
      console.error(err);
      setError(`Issue failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    // <Box p={4} maxWidth="md" mx="auto">
    <Box
      sx={{
        width: '100%',
        // maxWidth: { xs: '100%', sm: '700px', md: '900px', lg: '1100px' },
        maxWidth: 'calc(90vw - 10rem)',
        minHeight: 'calc(75vh)',
        display: 'flex',
        flexDirection: 'column',
        mx: 'auto',
        px: { xs: 2, sm: 3 },
      }}
    >
      <Typography
        variant="h4"
        gutterBottom
        color="primary.contrastText"
        textAlign={'center'}
        padding={'1.75vh'}
      >
        Issue New Asset
      </Typography>
      <Paper sx={{ p: 3 }}>
        <TextField
          required
          fullWidth
          label="Asset Name"
          value={assetName}
          error={!assetName && attemptedSubmit}
          onChange={(e) => setAssetName(e.target.value)}
          helperText={!assetName && attemptedSubmit ? 'Asset name is required' : ''}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          required
          fullWidth
          type="number"
          label="Quantity"
          value={quantity}
          error={!quantity && attemptedSubmit}
          onChange={(e) => setQuantity(parseInt(e.target.value))}
          helperText={!quantity && attemptedSubmit ? 'Quantity is required' : ''}
          sx={{ mb: 2 }}
        />
        {!avatarBase64 && (
          <>
            <Typography variant="h5" color="text.secondary">
              Include Asset Avatar?
            </Typography>
            <Button size="small" component="label" variant="outlined">
              Select Avatar Image
              <input
                type="file"
                hidden
                onChange={async (e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    setAvatarBase64(await fileToBase64(file));
                  }
                }}
              />
            </Button>
          </>
        )}
        <Divider sx={{ my: 3 }} />
        <Typography variant="body2" color="text.secondary">
          Make Asset Divisible (Allow asset to have decimals)?{' '}
          {/* <Typography variant="body2" color="primary.contrastText">
            default=TRUE
          </Typography> */}
        </Typography>
        <FormControlLabel
          control={
            <Checkbox checked={divisible} onChange={(e) => setDivisible(e.target.checked)} />
          }
          label="Divisible"
        />
        <Typography variant="body2" color="text.secondary">
          Make Asset Un-Spendable (Do NOT allow asset to be sent/traded by others)?{' '}
        </Typography>
        <FormControlLabel
          control={
            <Checkbox checked={unspendable} onChange={(e) => setUnspendable(e.target.checked)} />
          }
          label="Unspendable"
        />
        <Divider sx={{ my: 3 }} />
        <Typography variant="h5" color="primary.contrastText">
          Asset-Related Group Data{' '}
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Input group information for your primary asset group. This is where communications/furter
          data/announcements will be published regarding your asset.
        </Typography>
        <TextField
          fullWidth
          label="Primary Group Name"
          value={groupName}
          onChange={(e) => setGroupName(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Primary Group ID"
          value={groupId}
          onChange={(e) => setGroupId(e.target.value)}
          sx={{ mb: 2 }}
        />
        <TextField
          fullWidth
          label="Group Join Link"
          value={groupLink}
          onChange={(e) => setGroupLink(e.target.value)}
          sx={{ mb: 2 }}
        />

        <FormControlLabel
          color="primary.dark"
          control={
            <Checkbox
              checked={false} //set the 'false' to 'groupIsPrivate' to activate in the future.
              onChange={(e) => setGroupIsPrivate(e.target.checked)}
              // onChange={(e) => setGroupIsPrivate(e.target.checked)}
            />
          }
          label="Make Private? (not active yet...)"
        />

        <Divider sx={{ my: 3 }} />
        <Typography variant="h5" color="primary.contrastText" gutterBottom>
          Genesis Publication
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Input your Genesis announcement publication information below. Format it nicely — this is
          a public announcement of your asset!
        </Typography>
        <Paper
          sx={{
            border: '1px solid #ccc',
            p: 2,
            mb: 2,
            minHeight: '25vh',
            '& .ProseMirror': {
              minHeight: '20vh',
              outline: 'none',
            },
          }}
        >
          {editor ? (
            <>
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
                  const value = e.target.value;
                  if (value === 'paragraph') editor.chain().focus().setParagraph().run();
                  else
                    editor
                      .chain()
                      .focus()
                      .toggleHeading({
                        level: parseInt(value.replace('h', '')) as Level,
                      })
                      .run();
                }}
              >
                <MenuItem value="paragraph">Paragraph</MenuItem>
                <MenuItem value="h1">Heading 1</MenuItem>
                <MenuItem value="h2">Heading 2</MenuItem>
                <MenuItem value="h3">Heading 3</MenuItem>
                <MenuItem value="h4">Heading 4</MenuItem>
              </Select>
              <Box display="flex" gap={1} flexWrap="wrap" mb={2}>
                <Button
                  size="small"
                  onClick={() => editor.chain().focus().setTextAlign('left').run()}
                >
                  Left
                </Button>
                <Button
                  size="small"
                  onClick={() => editor.chain().focus().setTextAlign('center').run()}
                >
                  Center
                </Button>
                <Button
                  size="small"
                  onClick={() => editor.chain().focus().setTextAlign('right').run()}
                >
                  Right
                </Button>
                <Button
                  size="small"
                  onClick={() => {
                    const color = prompt('Enter a hex color (e.g. #ff0000)');
                    if (color) {
                      editor.chain().focus().setColor(color).run();
                    }
                  }}
                >
                  Text Color
                </Button>
                <Button
                  size="small"
                  onClick={() => editor.chain().focus().toggleBold().run()}
                  variant={editor.isActive('bold') ? 'contained' : 'outlined'}
                >
                  Bold
                </Button>
                <Button
                  size="small"
                  onClick={() => editor.chain().focus().toggleItalic().run()}
                  variant={editor.isActive('italic') ? 'contained' : 'outlined'}
                >
                  Italic
                </Button>
                <Button
                  size="small"
                  onClick={() => editor.chain().focus().toggleUnderline().run()}
                  variant={editor.isActive('underline') ? 'contained' : 'outlined'}
                >
                  Underline
                </Button>
                <Button
                  size="small"
                  onClick={() => editor.chain().focus().toggleBulletList().run()}
                  variant={editor.isActive('bulletList') ? 'contained' : 'outlined'}
                >
                  Bullet List
                </Button>
                <Button
                  size="small"
                  onClick={() => editor.chain().focus().toggleOrderedList().run()}
                  variant={editor.isActive('orderedList') ? 'contained' : 'outlined'}
                >
                  Numbered List
                </Button>
                <Button size="small" component="label" variant="outlined">
                  Upload Image
                  <input
                    type="file"
                    hidden
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        const reader = new FileReader();
                        reader.onload = () => {
                          editor
                            .chain()
                            .focus()
                            .setImage({ src: reader.result as string })
                            .run();
                        };
                        reader.readAsDataURL(file); // this will base64 encode for now
                      }
                    }}
                  />
                </Button>
              </Box>

              <EditorContent editor={editor} />
            </>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Loading editor...
            </Typography>
          )}
        </Paper>

        <Button variant="contained" sx={{ mt: 3 }} onClick={handleIssueAsset} disabled={loading}>
          {loading ? 'Issuing...' : 'Issue Asset'}
        </Button>

        {error && (
          <Typography color="error" mt={2}>
            {error}
          </Typography>
        )}
        {success && (
          <Typography color="success.main" mt={2}>
            {success}
          </Typography>
        )}
      </Paper>
    </Box>
  );
}
