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
  let percentSplit = currency === 'QORT' ? 80 : 66 //TODO - later make this into a tiered system based on account rating and/or asset rating. 
  await sendUpvoteSplit({
    currency, amount, projectOwnerAddress: ownerAddr, isEscrow: false, percentSplit,
  });
  await appendPaymentLine(issuerName, board, {
    ts: Date.now(),
    type: 'UPVOTE',
    cardId, currency, amount,
    from, to: `${ownerAddr}+${revenueAddr}`,
    note: currency === 'QORT' ? `${percentSplit} based upon payment in ${currency} and (in future) board owner rating. QORT upvotes 20% goes to project owner. Pay in Q-Asset for Discount.`
      : `${percentSplit} based upon payment in ${currency}, Q-Asset payments give 33% to project owner (Discount). In future, QARS rating will be applied to change percentages further.`
  });
}


export async function contributeBounty({
  issuerName, board, cardId, currency, amount, from, projectOwnerAddress
}: {
  issuerName: string; board: QDeckBoard; cardId: string;
  currency: 'QORT' | 'QASSET'; amount: number;
  from: string; projectOwnerAddress: string; // hold in project wallet/treasury for now
  }) {
  let percentSplit = currency === 'QORT' ? 90 : 80    // SET PERCENTAGES HERE. //TODO - Maybe we change this into a setting we set elsewhere and import here. 
  
  if (currency === 'QORT') {
    await sendUpvoteSplit({ currency: 'QORT', amount, projectOwnerAddress, isEscrow: true, percentSplit });
  
  } else {
    const qAssetId = 6; // inject
    await sendUpvoteSplit({ currency:'QASSET', amount, projectOwnerAddress, isEscrow: true, qAssetId, percentSplit });
  }
  await appendPaymentLine(issuerName, board, {
    ts: Date.now(), type: 'BOUNTY_CONTRIB', cardId, currency, amount, from, to: projectOwnerAddress, note: `${percentSplit}% based on ${currency} sent to Q-Assets Escrow, 
    with remaining direct to project owner. Upon bounty completion and verification, all but 10% paid to project owner.`
  });
}
