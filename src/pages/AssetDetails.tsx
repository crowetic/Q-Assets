import React, { useEffect, useState } from 'react';
import { useParams } from 'react-router-dom';
import {
  Typography,
  Box,
  Paper,
  Divider,
  Link as MuiLink,
  Button,
  TextField,
  Alert,
} from '@mui/material';
import { fetchAssetAvatar } from '../utils/fetchAssetAvatar';
import { fetchAssetPublication } from '../utils/fetchAssetPublication';
import { fetchAssetGroupMetadata } from '../utils/fetchAssetGroups';
import { publishAssetPublication } from '../utils/publishAssetPublication';
import { useAuth } from 'qapp-core';
import { fileToBase64 } from '../utils/data';
import { getPrimaryAccountName } from '../utils/qortalApi';
import { getAssetIdentifiers } from '../constants/qdnConstants';
import type { AssetPublication } from '../types/AssetPublicationMetadata';

export default function AssetDetail() {
  const { assetId } = useParams<{ assetId: string }>();
  const [asset, setAsset] = useState<any>(null);
  const [avatar, setAvatar] = useState<string | null>(null);
  const [assetPub, setAssetPub] = useState<AssetPublication | null>(null);
  const [groupMeta, setGroupMeta] = useState<any>(null);
  const [html, setHtml] = useState('');
  const { address: userAddress, name: userName } = useAuth();
  const [issuerName, setIssuerName] = useState<string | null>(null);

  const isIssuer = asset && userAddress && asset.owner === userAddress;
  const canPublish = isIssuer && issuerName && issuerName === userName;

  useEffect(() => {
    async function loadData() {
      const assetList = JSON.parse(localStorage.getItem('allAssets') || '[]');
      const a = assetList.find((a: any) => `${a.assetId}` === `${assetId}`);
      if (!a) return;

      setAsset(a);

      const name = await getPrimaryAccountName(a.owner);
      setIssuerName(name);

      if (!name) return;

      const [avatar, pub, groups] = await Promise.all([
        fetchAssetAvatar(name, a.name),
        fetchAssetPublication(name, a.name),
        fetchAssetGroupMetadata(name, a.name),
      ]);

      setAvatar(avatar);
      setAssetPub(pub);
      setGroupMeta(groups);
      setHtml(pub?.html || '');
    }

    loadData();
  }, [assetId]);

  if (!asset) return <Typography>Loading asset...</Typography>;

  return (
    <Box p={4}>
      <Typography variant="h3" gutterBottom>
        {asset.name}
      </Typography>

      <Box display="flex" gap={3} flexDirection={{ xs: 'column', md: 'row' }}>
        <Box flex={1}>
          <Paper sx={{ p: 2 }}>
            <Typography variant="body1">
              <strong>Asset ID:</strong> {asset.assetId}
            </Typography>
            <Typography variant="body1">
              <strong>Total Supply:</strong> {asset.totalSupply.toLocaleString()}
            </Typography>
            <Typography variant="body1">
              <strong>Circulating:</strong> {asset.circulating.toLocaleString()}
            </Typography>
            <Typography variant="body1" sx={{ mt: 2 }}>
              {asset.description}
            </Typography>
          </Paper>

          <Divider sx={{ my: 3 }} />
          <Typography variant="h5">Genesis Publication</Typography>
          {assetPub?.html ? (
            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
              {assetPub.html}
            </Typography>
          ) : (
            <Typography color="text.secondary">None published</Typography>
          )}

          <Divider sx={{ my: 3 }} />
          <Typography variant="h5">Primary Group</Typography>
          {assetPub?.primaryGroup ? (
            <>
              <Typography variant="body1">
                <strong>Name:</strong> {assetPub.primaryGroup.name}
              </Typography>
              <Typography variant="body1">
                <strong>Group ID:</strong> {assetPub.primaryGroup.id}
              </Typography>
              <MuiLink href={assetPub.primaryGroup.joinLink} target="_blank">
                Join Group
              </MuiLink>
            </>
          ) : (
            <Typography color="text.secondary">No group metadata published</Typography>
          )}

          {isIssuer && issuerName !== userName && (
            <Alert severity="warning" sx={{ mt: 2 }}>
              You're the asset owner, but your current name <strong>{userName}</strong> does not
              match the publishing name <strong>{issuerName}</strong>. Switch names to manage this
              asset.
            </Alert>
          )}

          {canPublish && (
            <>
              <Divider sx={{ my: 3 }} />
              <Typography variant="h5" gutterBottom>
                Manage Your Asset
              </Typography>

              {/* Upload avatar */}
              <Box mt={2}>
                <Typography variant="subtitle1">Update Asset Avatar</Typography>
                <input
                  type="file"
                  accept="image/*"
                  onChange={async (e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      const base64 = await fileToBase64(file);
                      const { identifiers, services } = await getAssetIdentifiers(asset.name);
                      await qortalRequest({
                        action: 'PUBLISH_QDN_RESOURCE',
                        name: userName,
                        service: services.avatar,
                        identifier: identifiers.avatar,
                        data64: base64,
                      });
                      alert('Avatar published!');
                      setAvatar(`data:image/*;base64,${base64}`);
                    }
                  }}
                />
              </Box>

              {/* Genesis publication */}
              <Box mt={4}>
                <Typography variant="subtitle1">Update Genesis Publication</Typography>
                <TextField
                  fullWidth
                  multiline
                  minRows={4}
                  placeholder="Write or update the genesis post..."
                  value={html}
                  onChange={(e) => setHtml(e.target.value)}
                />
              </Box>

              {/* Save publication */}
              <Button
                variant="contained"
                sx={{ mt: 2 }}
                onClick={async () => {
                  const pub: AssetPublication = {
                    description: asset.description,
                    html,
                    primaryGroup: assetPub?.primaryGroup ?? undefined,
                    extraGroups: assetPub?.extraGroups ?? [],
                    news: assetPub?.news ?? [],
                    customFields: assetPub?.customFields ?? {},
                  };

                  await publishAssetPublication(userName, asset.name, pub);
                  alert('Publication updated!');
                  setAssetPub(pub);
                }}
              >
                Save Publication
              </Button>
            </>
          )}
        </Box>

        {/* Avatar Display */}
        {avatar && (
          <Box width={128} height={128}>
            <img
              src={avatar}
              alt="Asset Avatar"
              style={{ width: '100%', height: '100%', objectFit: 'contain', borderRadius: 8 }}
            />
          </Box>
        )}
      </Box>
    </Box>
  );
}
