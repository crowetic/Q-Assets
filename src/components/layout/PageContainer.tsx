import { Box } from '@mui/material';

export default function PageContainer({ children }: React.PropsWithChildren) {
  return (
    <Box
      p={2}
      display="flex"
      flexDirection="column"
      alignItems="stretch"
      sx={{ gap: 2, maxWidth: '100%', mx: 'auto' }}
    >
      {children}
    </Box>
  );
}
