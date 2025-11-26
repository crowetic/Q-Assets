import { useEffect, useState } from 'react';
import { Box, Tooltip } from '@mui/material';
import { useNavigate } from 'react-router-dom';
import { getUserRoles, UserRoles, userHasPermission } from '../../utils/roles';
import PromotionDialog from './PromotionDialog';
import AnnouncementDialog from './AnnouncementDialog';
import SuccessButton from '../buttons/SuccessButton';
import InfoButton from '../buttons/InfoButton';
import PrimaryButton from '../buttons/PrimaryButton';

type Props = {
  treasuryAddress: string; // where promos pay to
  defaultPromoPriceQort?: number;
};

export default function NewsActionBar({ treasuryAddress, defaultPromoPriceQort = 5 }: Props) {
  const [roles, setRoles] = useState<UserRoles>({
    loggedIn: false,
    isManagement: false,
    isManagementAdmin: false,
    isAssetIssuer: false,
    permissions: [],
  });
  const [promoOpen, setPromoOpen] = useState(false);
  const [announceOpen, setAnnounceOpen] = useState(false);
  const navigate = useNavigate();

  useEffect(() => {
    (async () => setRoles(await getUserRoles()))();
  }, []);

  return (
    <Box
      sx={{
        display: 'flex',
        justifyContent: 'space-between',
        gap: 1,
        flexWrap: 'wrap',
        mb: 2,
        width: '100%',
        maxWidth: '95%',
        mx: 'auto',
        alignItems: 'stretch',
      }}
    >
      {/* Submit Promotion: visible to any logged-in user */}

      {/* Add Q-Assets Announcement: management only */}
      {userHasPermission(roles, 'announcements.publish') && (
        <InfoButton variant="outlined" onClick={() => setAnnounceOpen(true)}>
          Add Q-Assets Announcement
        </InfoButton>
      )}

      {/* Publish Asset News: issuers only (link to existing flow) */}
      {roles.isAssetIssuer && (
        <SuccessButton variant="outlined" onClick={() => navigate('/publish-asset-news')}>
          Publish Asset News
        </SuccessButton>
      )}

      <Tooltip
        title={
          roles.loggedIn
            ? `Submit a paid promotion (default ${defaultPromoPriceQort} QORT)`
            : 'Log in to submit promotions'
        }
      >
        <span>
          <PrimaryButton
            variant="outlined"
            onClick={() => setPromoOpen(true)}
            disabled={!roles.loggedIn}
          >
            Submit Promotion
          </PrimaryButton>
        </span>
      </Tooltip>

      <PromotionDialog
        open={promoOpen}
        onClose={() => setPromoOpen(false)}
        treasuryAddress={treasuryAddress}
        defaultAmountQort={defaultPromoPriceQort}
      />
      <AnnouncementDialog open={announceOpen} onClose={() => setAnnounceOpen(false)} />
    </Box>
  );
}
