// // src/components/asset/PaidUpvotesSection.tsx
// /* eslint-disable @typescript-eslint/no-explicit-any */
// import { useEffect, useMemo, useState } from 'react';
// import { Card, CardContent, Typography, Stack, Paper, Chip, Box } from '@mui/material';
// import { assetUpvotesPrefix } from '../../constants/qdnConstants';
// import { searchByIdentifierPrefixInGroup } from '../../utils/qdn';
// import { getAssetInfo } from '../../utils/qortalAssetRequests';
// import { findPaymentsFromNameToAddress } from '../../utils/payments';
// import { MIN_UPVOTE_QORT, PAYMENT_WINDOW_MIN } from '../../constants/qarsConstants';
// import { Q_ASSETS_OWNER_ADDRESS } from '../../constants/qdnConstants';

// type VerifiedUpvote = {
//   ts: number;
//   fromName: string;
//   amountQort: number; // sum of both legs (issuer + Q-Assets owner), or the min of the two; up to you
//   txIds: string[]; // both tx ids if found
//   identifier: string; // the QDN resource identifier used as the "claim"
//   verified: boolean;
//   reason?: string; // why not verified
// };

// export default function PaidUpvotesSection({
//   assetId,
//   primaryGroupId,
// }: {
//   assetId: number;
//   primaryGroupId?: number | string;
// }) {
//   const [rows, setRows] = useState<VerifiedUpvote[]>([]);
//   const [loading, setLoading] = useState(false);

//   const groupIdNum = useMemo(() => {
//     if (typeof primaryGroupId === 'string') {
//       const n = parseInt(primaryGroupId, 10);
//       return Number.isFinite(n) ? n : undefined;
//     }
//     return typeof primaryGroupId === 'number' ? primaryGroupId : undefined;
//   }, [primaryGroupId]);

//   useEffect(() => {
//     (async () => {
//       try {
//         setLoading(true);
//         // We require group id to scope discovery
//         if (!groupIdNum) {
//           setRows([]);
//           return;
//         }

//         // 1) issuer address
//         const assetInfo = await getAssetInfo(assetId).catch(() => null);
//         const issuerAddress: string | null = assetInfo?.owner || null;
//         if (!issuerAddress) {
//           setRows([]);
//           return;
//         }

//         // 2) discover QDN "upvote claims" under primary group
//         const prefix = assetUpvotesPrefix(assetId);
//         const hits = await searchByIdentifierPrefixInGroup(prefix, groupIdNum);
//         // hits contain { name, identifier, created/updated, role }

//         // 3) verify each hit by requiring TWO payments:
//         //    (a) to issuerAddress, (b) to QASSETS_OWNER_ADDRESS,
//         //    within ±PAYMENT_WINDOW_MIN of hit.updated|created
//         const checks = await Promise.all(
//           hits.map(async (h) => {
//             const tMs = (h.updated || h.created || 0) * 1000; // if your search returns seconds; adjust if already ms
//             // If your values are already ms, drop the *1000
//             const winStart = tMs - PAYMENT_WINDOW_MIN * 60_000;
//             const winEnd = tMs + PAYMENT_WINDOW_MIN * 60_000;

//             const [toIssuer, toOwner] = await Promise.all([
//               findPaymentsFromNameToAddress(h.name, issuerAddress, winStart, winEnd),
//               findPaymentsFromNameToAddress(h.name, Q_ASSETS_OWNER_ADDRESS, winStart, winEnd),
//             ]);

//             const bestIssuer = toIssuer.sort(
//               (a, b) => Math.abs(a.ts - tMs) - Math.abs(b.ts - tMs)
//             )[0];
//             const bestOwner = toOwner.sort(
//               (a, b) => Math.abs(a.ts - tMs) - Math.abs(b.ts - tMs)
//             )[0];

//             if (!bestIssuer || !bestOwner) {
//               return {
//                 ts: tMs,
//                 fromName: h.name,
//                 amountQort: 0,
//                 txIds: [bestIssuer?.txId, bestOwner?.txId].filter(Boolean) as string[],
//                 identifier: h.identifier,
//                 verified: false,
//                 reason: !bestIssuer ? 'missing payment to issuer' : 'missing payment to Q-Assets',
//               } as VerifiedUpvote;
//             }

//             if (bestIssuer.amountQort < MIN_UPVOTE_QORT || bestOwner.amountQort < MIN_UPVOTE_QORT) {
//               return {
//                 ts: tMs,
//                 fromName: h.name,
//                 amountQort: Math.min(bestIssuer.amountQort, bestOwner.amountQort),
//                 txIds: [bestIssuer.txId, bestOwner.txId],
//                 identifier: h.identifier,
//                 verified: false,
//                 reason: 'below minimum amount',
//               } as VerifiedUpvote;
//             }

//             // Choose how to display amount — min of the two legs is conservative
//             const shown = Math.min(bestIssuer.amountQort, bestOwner.amountQort);

//             return {
//               ts: tMs,
//               fromName: h.name,
//               amountQort: shown,
//               txIds: [bestIssuer.txId, bestOwner.txId],
//               identifier: h.identifier,
//               verified: true,
//             } as VerifiedUpvote;
//           })
//         );

//         // Sort: verified first by time desc, then unverified
//         const verified = checks.filter((c) => c.verified).sort((a, b) => b.ts - a.ts);
//         const unverified = checks.filter((c) => !c.verified).sort((a, b) => b.ts - a.ts);
//         setRows([...verified, ...unverified]);
//       } finally {
//         setLoading(false);
//       }
//     })();
//   }, [assetId, groupIdNum]);

//   return (
//     <>
//       <Typography variant="h4" textAlign="center" sx={{ mt: 3 }}>
//         Paid Upvotes
//       </Typography>
//       <Card id="paid-upvotes-section" sx={{ mt: 1 }}>
//         <CardContent>
//           {loading ? (
//             <Typography textAlign="center">Loading…</Typography>
//           ) : rows.length === 0 ? (
//             <Typography color="text.secondary" textAlign="center">
//               No paid upvotes yet.
//             </Typography>
//           ) : (
//             <Stack spacing={1}>
//               {rows.map((u, i) => (
//                 <Paper
//                   key={i}
//                   variant="outlined"
//                   sx={{
//                     p: 1.5,
//                     display: 'grid',
//                     gridTemplateColumns: '1fr auto',
//                     gap: 1,
//                     opacity: u.verified ? 1 : 0.6,
//                   }}
//                 >
//                   <Box>
//                     <Typography variant="caption" color="text.secondary">
//                       {new Date(u.ts).toLocaleString()} — {u.fromName}
//                     </Typography>
//                     <Typography variant="caption" sx={{ display: 'block' }}>
//                       id: {u.identifier}
//                     </Typography>
//                     {u.txIds.length ? (
//                       <Typography variant="caption" sx={{ display: 'block' }}>
//                         tx: {u.txIds.join(', ')}
//                       </Typography>
//                     ) : null}
//                     {!u.verified && u.reason && (
//                       <Typography variant="caption" color="error" sx={{ display: 'block' }}>
//                         not verified: {u.reason}
//                       </Typography>
//                     )}
//                   </Box>
//                   <Chip
//                     label={u.verified ? `${u.amountQort} QORT` : 'unverified'}
//                     color={u.verified ? 'secondary' : 'default'}
//                   />
//                 </Paper>
//               ))}
//             </Stack>
//           )}
//         </CardContent>
//       </Card>
//     </>
//   );
// }
