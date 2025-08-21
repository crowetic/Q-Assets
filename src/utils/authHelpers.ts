export function getAuthAddress(auth: any): string | undefined {
  return (
    auth?.address ??
    auth?.qortalAddress ??
    auth?.user?.address ??
    auth?.user?.qortalAddress ??
    undefined
  );
}

export function getAuthPublicKey(auth: any): string | undefined {
  return (
    auth?.publicKey ??
    auth?.qortalPublicKey ??
    auth?.user?.publicKey ??
    auth?.user?.qortalPublicKey ??
    undefined
  );
}
