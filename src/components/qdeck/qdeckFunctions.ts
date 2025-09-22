import { QDeckBoard } from '../../types/qdeck';
import { sendUpvoteSplit } from '../../utils/qdeckApi';
import { appendPaymentLine } from '../../utils/qdeckApi';

export async function upvoteCard({
  issuerName, board, cardId, currency, amount,
  from, ownerAddr, revenueAddr
}: {
  issuerName: string; board: QDeckBoard; cardId: string;
  currency: 'QORT' | 'QASSET'; amount: number;
  from: string; ownerAddr: string; revenueAddr: string;
}) {
  await sendUpvoteSplit({
    currency, amount, projectOwnerAddress: ownerAddr, isEscrow: false, percentSplit: 50,
  });
  await appendPaymentLine(issuerName, board, {
    ts: Date.now(),
    type: 'UPVOTE',
    cardId, currency, amount,
    from, to: `${ownerAddr}+${revenueAddr}`,
    note: '50/50 split'
  });
}


export async function contributeBounty({
  issuerName, board, cardId, currency, amount, from, projectOwnerAddress
}: {
  issuerName: string; board: QDeckBoard; cardId: string;
  currency: 'QORT' | 'QASSET'; amount: number;
  from: string; projectOwnerAddress: string; // hold in project wallet/treasury for now
}) {
  if (currency === 'QORT') {
    await sendUpvoteSplit({ currency:'QORT', amount, projectOwnerAddress, isEscrow: true, percentSplit: 90 });
  } else {
    const qAssetId = 6; // inject
    await sendUpvoteSplit({ currency:'QASSET', amount, projectOwnerAddress, isEscrow: true, qAssetId, percentSplit: 75 });
  }
  await appendPaymentLine(issuerName, board, {
    ts: Date.now(), type: 'BOUNTY_CONTRIB', cardId, currency, amount, from, to: projectOwnerAddress
  });
}
