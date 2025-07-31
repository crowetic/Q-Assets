import { Paper, Typography, Box } from '@mui/material';
import { useTheme } from '@mui/material/styles';
import { useState } from 'react';

interface HoverPanelProps {
  title: string;
  onClick: () => void;
  icon?: string; // URL to image or emoji
  isEmoji?: boolean; // Whether to treat icon as emoji or image
}

const HoverPanel = ({ title, onClick, icon, isEmoji = true }: HoverPanelProps) => {
  const theme = useTheme();
  const [hovered, setHovered] = useState(false);

  return (
    <Paper
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onClick={onClick}
      elevation={hovered ? 6 : 3}
      sx={{
        height: '100%',
        padding: '1.75rem',
        backgroundColor: hovered ? theme.palette.action.hover : theme.palette.background.paper,
        color: theme.palette.text.primary,
        cursor: 'pointer',
        transition: 'all 0.3s ease',
        display: 'flex',
        minWidth: '15vh',
        maxWidth: '22vw',
        width: '100%',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        textAlign: 'center',
        borderRadius: theme.shape.borderRadius,
        borderColor: theme.palette.text.secondary,

        '&:hover': {
          boxShadow: `0 0 10px ${theme.palette.primary.main}`,
        },
      }}
    >
      <Box sx={{ mb: 1, fontSize: '3.5rem' }}>
        {icon &&
          (isEmoji ? (
            <span role="img" aria-label="icon">
              {icon}
            </span>
          ) : (
            <img src={icon} alt="icon" style={{ width: '2.5rem', height: '2.5rem' }} />
          ))}
      </Box>
      <Typography variant="h5" fontWeight={600} fontSize="1.25rem">
        {title}
      </Typography>
    </Paper>
  );
};

export default HoverPanel;
