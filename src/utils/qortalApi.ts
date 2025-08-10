

export async function signAndBroadcast(rawTx: string): Promise<object> {
  const signedBytes  = await qortalRequest({
    action: "SIGN_TRANSACTION",
    unsignedBytes: rawTx
  });

  console.log('signedBytes from signAndBroadcast',signedBytes)
  const res = await fetch("/transactions/process", {
    method: "POST",
    headers: {
      "Content-Type": "text/plain",
      "X-API-VERSION": "2"
    },
    body: signedBytes
  });

  console.log('finalResponse',res)
  if (!res.ok) throw new Error();

  return res;
}



export const getPrimaryAccountName = async (address: string): Promise<string> => {
  try {
    const name = await qortalRequest({
      action: 'GET_PRIMARY_NAME',
      address,
    });
    return name ?? '';
  } catch (err) {
    console.error(`Failed to get primary name for ${address}:`, err);
    return '';
  }
};

export async function getAccount(address: string): Promise<any> {
  return await qortalRequest({ action: 'GET_ACCOUNT_DATA', address });
}



async function isValidQortalTx(base58Tx: string, txType: string): Promise<boolean> {
  const res = await fetch(`/transactions/decode?ignoreValidityChecks=false`, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain' },
    body: base58Tx
  });

  if (!res.ok) return false;

  const tx = await res.json();
  return tx?.type === txType;
}



export async function createIssueAssetTransaction(
  issuerAddress: string,
  issuerPublicKey: string,
  assetName: string,
  description: string,
  quantity: number,
  data?: string,
  divisible: boolean = true,
  unspendable: boolean = false,
  
): Promise<string> {
  const account = await getAccount(issuerAddress);
  const txBody = {
    timestamp: Date.now(),
    reference: account.reference,
    fee: 0.01,
    txGroupId: 0,
    recipient: null,
    issuerPublicKey,
    assetName,
    description,
    quantity,
    data: data ? data : "none",
    isDivisible: divisible,
    isUnspendable: unspendable,
  };
  const result = await fetch('/assets/issue', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(txBody),
  });
  console.log('txBody', txBody)

  if (!result.ok) {
    throw new Error(`Issue asset failed: ${result.status} ${result.statusText}`);
  }

  const sig = await result.text();
  if (!await isValidQortalTx(sig, "ISSUE_ASSET")) throw new Error(`response from issueAssetTransaction doesn't seem to be a signature: ${sig}`);

  return sig;
}



export async function issueAsset(
  issuerAddress: string,
  issuerPublicKey: string,
  assetName: string,
  description: string,
  quantity: number,
  data?: string,
  divisible: boolean = true,
  unspendable: boolean = false,
  
): Promise<object> {
  const unsigned = await createIssueAssetTransaction(
    issuerAddress,
    issuerPublicKey,
    assetName,
    description,
    quantity,
    data,
    divisible,
    unspendable,
  );

  console.log('unsignedTx', unsigned)
  return await signAndBroadcast(unsigned);
}