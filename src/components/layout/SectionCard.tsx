import { Card, CardContent } from '@mui/material';

export default function SectionCard({ children, ...props }: React.PropsWithChildren<any>) {
  return (
    <Card
      sx={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'stretch',
        textAlign: 'center',
        alignContent: 'space-around',
        justifyContent: 'center',
        width: '100%',
        minHeight: '7rem',
        flexWrap: 'wrap',
        borderRadius: '1rem',
      }}
      {...props}
    >
      <CardContent sx={{ width: '100%' }}>{children}</CardContent>
    </Card>
  );
}
