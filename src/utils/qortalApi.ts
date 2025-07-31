export async function signAndBroadcast(rawTx: string): Promise<string> {
  const { signedBytes } = await qortalRequest({
    action: "SIGN_TRANSACTION",
    unsignedBytes: rawTx
  });

  const res = await fetch("/transactions/process", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: signedBytes
  });

  if (!res.ok) throw new Error(await res.text());

  return await res.text();
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

export async function createIssueAssetTransaction(
  issuerPublicKey: string,
  issuerAddress: string,
  assetName: string,
  description: string,
  quantity: number,
  divisible: boolean,
  data?: string,
  unspendable = false
): Promise<string> {

  const account = await getAccount(issuerAddress);

  const txBody = {
    timestamp: Date.now(),
    reference: account.reference,
    fee: 0,
    txGroupId: 0,
    issuerPublicKey,
    assetName,
    description,
    quantity,
    divisible,
    unspendable,
    data: data ? data : undefined,
  };

  const result = await fetch('/assets/issue', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(txBody),
  });

  if (!result.ok) throw new Error(`Failed to create issue asset tx: ${result.statusText}`);

  return await result.text(); // raw unsigned base58 tx
}

export async function issueAsset(
  issuerAddress: string,
  issuerPublicKey: string,
  assetName: string,
  description: string,
  quantity: number,
  divisible: boolean,
  data?: string,
  unspendable = true
): Promise<string> {
  const unsigned = await createIssueAssetTransaction(
    issuerAddress,
    issuerPublicKey,
    assetName,
    description,
    quantity,
    divisible,
    data,
    unspendable
  );

  return await signAndBroadcast(unsigned);
}