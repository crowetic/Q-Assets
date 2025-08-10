export async function resolveToAddress(input: string): Promise<string | null> {
  const v = input.trim();

  // Heuristic: looks like a Qortal address already
  if (/^Q[0-9A-Za-z]{25,}$/.test(v)) return v;
  
  try {
    const data = await qortalRequest({
      action: 'GET_NAME_DATA',
      name: v,
    });
    if (data?.owner && typeof data.owner === 'string') return data.owner;
  } catch {}

  return null;
}