import { useState, useEffect } from 'react';
import {
  Box,
  TextField,
  Typography,
  Paper,
  Divider,
  FormControlLabel,
  Checkbox,
} from '@mui/material';
import { useTheme } from '@mui/material';
import { useAuth } from 'qapp-core';
import { AssetPublication } from '../types/AssetPublicationMetadata';
import { issueAsset } from '../utils/qortalApi';
import { objectToBase64 } from 'qapp-core';
import { getAssetIdentifiers } from '../constants/qdnConstants';
import { fileToBase64 } from '../utils/data';
import { getAllAssets } from '../utils/qortalAssetRequests';
import TiptapEditor from '../components/TipTapEditor';
import SuccessButton from '../components/buttons/SuccessButton';
import InfoOutlineButton from '../components/buttons/InfoOutlineButton';

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
  const [isDivisible, setIsDivisible] = useState<boolean>(true);
  const [isUnspendable, setIsUnspendable] = useState<boolean>(false);
  const [assetData, setAssetData] = useState<string>('None');

  // Metadata (QDN JSON)
  const [html, setHtml] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupId, setGroupId] = useState('');
  const [groupLink, setGroupLink] = useState('');
  // const [groupIsPrivate, setGroupIsPrivate] = useState(false);
  const [avatarBase64, setAvatarBase64] = useState<string>('');
  // const [newAssetID, setNewAssetID] = useState<number>(0);

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [attemptedSubmit, setAttemptedSubmit] = useState(false);
  // const [isTestMode, setIsTestMode] = useState(false);
  const [editorHasInit, setEditorHasInit] = useState(false);

  const theme = useTheme();

  useEffect(() => {
    // If no address at all, auto-trigger authentication
    if (!userName) {
      authenticateUser();
    }
  }, [userName, authenticateUser]);

  async function predictAssetID(): Promise<number> {
    const allAssets = await getAllAssets(false); // no need to load metadata
    const ids = allAssets.map((a: any) => a.assetId).filter((id: number) => typeof id === 'number');

    const maxId = ids.length > 0 ? Math.max(...ids) : 0;
    return maxId + 1; // the “probably safe” new asset ID
  }

  const resetForm = () => {
    setSuccess('Asset issued and Genesis publication saved successfully!');
    setAssetName('');
    setDescription('');
    setQuantity(0);
    setIsDivisible(true);
    setIsUnspendable(false);
    setGroupName('');
    setGroupId('');
    setGroupLink('');
    // setGroupIsPrivate(false);
    setAttemptedSubmit(false);
    setAvatarBase64('');
    setHtml('');
  };

  const handleIssueAsset = async () => {
    if (!userName || !userAddress || !userPublicKey || !quantity || !assetName) {
      alert('Missing Required Asset data, please check all data and try again.');
      return;
    }

    setAttemptedSubmit(true);
    setLoading(true);
    setError(null);
    setSuccess(null);
    if (!assetData) setAssetData('None');

    // Snapshot state so later resetForm() won't overwrite values during async work
    const currentAssetName = assetName;
    const currentDescription = description;
    const currentQuantity = quantity;
    const currentDivisible = isDivisible;
    const currentUnspendable = isUnspendable;
    const currentAssetData = assetData;
    const currentAvatarBase64 = avatarBase64;

    try {
      const predictedAssetID = await predictAssetID();

      const publication: AssetPublication = {
        description: currentDescription,
        html,
        primaryGroup: {
          name: groupName,
          id: groupId,
          joinLink: groupLink,
          isPrivate: false,
        },
      };

      const pub64 = await objectToBase64(publication);

      // No array destructuring — these are just strings
      const publishInfo = await getAssetIdentifiers(currentAssetName, predictedAssetID);
      const pubID = publishInfo.identifiers.genesisPost;
      const assetAvatarID = publishInfo.identifiers.avatar;
      const pubService = publishInfo.services.genesisPost;
      const assetAvatarService = publishInfo.services.avatar;

      // Issue the asset with the snapshotted flags
      await issueAsset(
        userAddress,
        userPublicKey,
        currentAssetName,
        currentDescription,
        currentQuantity,
        currentAssetData,
        currentDivisible,
        currentUnspendable
      );

      // Publish genesis announcement
      await qortalRequest({
        action: 'PUBLISH_QDN_RESOURCE',
        service: pubService,
        identifier: pubID,
        base64: pub64,
      });

      // Publish avatar if present
      if (currentAvatarBase64) {
        await qortalRequest({
          action: 'PUBLISH_QDN_RESOURCE',
          service: assetAvatarService,
          name: userName,
          identifier: assetAvatarID,
          base64: currentAvatarBase64,
        });
      }

      // Reset form only AFTER all async work is done
      resetForm();
    } catch (err: any) {
      console.error(err);
      setError(`Issue failed: ${err.message || err}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Box
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        width: '100%',
        // A comfortable content max-width; scales well on tablets/desktops, not restrictive on phones.
        maxWidth: { xs: '100%', sm: '90%', md: '90%', lg: '80%' },
        // Center horizontally on wide screens, fill on phones.
        mx: 'auto',
        // Responsive horizontal padding in rem (no pixel coupling)
        px: { xs: '1rem', sm: '1.5rem', md: '2rem' },
        // Breathing room top/bottom without forcing huge vh on small screens
        py: { xs: '1rem', sm: '1.5rem' },
      }}
    >
      <Paper
        sx={{
          // Paper should stretch the container width
          width: '100%',
          // Use rem for padding; keep it modest on phones
          p: { xs: '1rem', sm: '1.25rem', md: '1.5rem' },
          display: 'flex',
          flexDirection: 'column',
          gap: '1rem', // global vertical rhythm
        }}
      >
        <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
          <Typography variant="h5" sx={{ fontWeight: 600 }} color="primary.contrastText">
            Asset Information
          </Typography>

          <TextField
            required
            fullWidth
            label="Asset Name"
            value={assetName}
            error={!assetName && attemptedSubmit}
            onChange={(e) => setAssetName(e.target.value)}
            onBlur={() => {
              if (!editorHasInit && assetName.trim()) {
                const today = new Date().toISOString().split('T')[0];
                const title = `<center><h2>
                              <span style="color:${theme.palette.info.dark}">Announcement</span> - 
                              <span style="color:${theme.palette.primary.light}">${assetName}</span> - 
                              Genesis Announcement - 
                              <span style="color:${theme.palette.primary.main}">${today}</span>
                              </h2></center>`;
                const body = `<p>Describe your asset here...</p>`;

                setHtml(`${title}${body}`);
                setEditorHasInit(true);
              }
            }}
            helperText={!assetName && attemptedSubmit ? 'Asset name is required' : ''}
          />

          <TextField
            fullWidth
            multiline
            minRows={2}
            label="Description"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <TextField
            required
            fullWidth
            type="number"
            inputProps={{ min: 0 }}
            label="Quantity"
            value={quantity}
            error={!quantity && attemptedSubmit}
            onChange={(e) => setQuantity(Number(e.target.value))}
            helperText={!quantity && attemptedSubmit ? 'Quantity is required' : ''}
          />
        </Box>

        {/* Avatar */}
        {!avatarBase64 && (
          <Box component="section" sx={{ display: 'flex', flexDirection: 'column', gap: '0.5rem' }}>
            <>
              <Typography variant="h5" fontWeight={550} color="primary.contrastText">
                Include Asset Avatar?
              </Typography>
              <InfoOutlineButton size="small" variant="outlined" sx={{ mb: 2 }}>
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
              </InfoOutlineButton>
            </>
          </Box>
        )}

        <Divider sx={{ my: 3 }} />

        {/* Divisible / Unspendable */}
        <Typography variant="body2" color="text.secondary">
          Make Asset Divisible (Allow asset to have decimals)?
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={isDivisible}
              sx={{
                color: theme.palette.primary.dark,
                '&.Mui-checked': {
                  color: theme.palette.info.main,
                },
              }}
              onChange={(e) => setIsDivisible(e.target.checked)}
            />
          }
          label="Divisible"
        />
        <Typography variant="body2" color="text.secondary">
          Make Asset Un-Spendable (Do NOT allow asset to be sent/traded by others)?
        </Typography>
        <FormControlLabel
          control={
            <Checkbox
              checked={isUnspendable}
              sx={{
                color: theme.palette.primary.dark,
                '&.Mui-checked': {
                  color: theme.palette.info.main,
                },
              }}
              onChange={(e) => setIsUnspendable(e.target.checked)}
            />
          }
          label="Unspendable"
        />

        <Divider sx={{ my: 3 }} />

        {/* Group Info */}
        <Typography variant="h5" fontWeight={600} color="primary.contrastText">
          Asset-Related Group Data
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Input group information for your primary asset group. This is where communications/further
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
          control={
            <Checkbox
              checked={false} // set to groupIsPrivate later
              // onChange={(e) => setGroupIsPrivate(e.target.checked)}
              disabled={true}
            />
          }
          label="Make Private? (Private Asset Issuance Feature Coming Soon)"
        />

        <Divider sx={{ my: 3 }} />

        {/* Genesis Publication */}
        <Typography variant="h5" fontWeight={700} color="primary.contrastText" gutterBottom>
          Genesis Publication
        </Typography>
        <Typography variant="body2" color="text.secondary" sx={{ mb: 2 }}>
          Input your Genesis announcement publication information below. Format it nicely — this is
          a public announcement of your asset!
        </Typography>

        <Box
          sx={{
            border: '1px solid #ccc',
            p: 2,
            mb: 2,
            minHeight: '25vh',
            '& .ProseMirror': {
              minHeight: '20vh',
              outline: 'none',
            },
            '& .ProseMirror ul': { pl: '1.5rem', listStyleType: 'disc', my: 1.5 },
            '& .ProseMirror ol': { pl: '1.5rem', listStyleType: 'decimal', my: 1.5 },
            '& .ProseMirror li': { mb: 0.25 },
            '& .ProseMirror img': { maxWidth: '100%', height: 'auto', display: 'block', my: 2 },
          }}
        >
          <Typography textAlign="center" variant="h5">
            Edit Genesis Publication
          </Typography>
          <TiptapEditor value={html} onChange={setHtml} />
        </Box>

        {/* Action Row */}
        <Box display="flex" justifyContent="flex-end" gap={1}>
          <SuccessButton
            variant="outlined"
            size="large"
            onClick={handleIssueAsset}
            disabled={loading}
          >
            {loading ? 'Issuing...' : 'Issue Asset'}
          </SuccessButton>
          {/* Uncomment if you want cancel */}
          {/* <CancelButton variant="outlined" onClick={() => setEditing(false)}>Cancel</CancelButton> */}
        </Box>

        {/* Messages */}
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
