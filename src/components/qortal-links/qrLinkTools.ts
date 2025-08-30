import { Service } from "qapp-core";

/** Get base '/arbitrary/SERVICE/Name[/identifier]' via Hub */
export async function getBaseArbitraryUrl(
  service: Service,
  name: string,
  identifier?: string
): Promise<string> {
  const url = await qortalRequest({
    action: 'GET_QDN_RESOURCE_URL',
    service,
    name,
    identifier: identifier ?? '',
  });
  if (typeof url !== 'string' || !url.startsWith('/arbitrary/')) {
    throw new Error(`Unexpected GET_QDN_RESOURCE_URL result: ${url}`);
  }
  return url;
}

/** Fallback: ask Hub to open link natively (will navigate current view). */
export async function hubOpenLink(
  service: Service,
  name: string,
  identifier?: string,
  path?: string
): Promise<void> {
  await qortalRequest({
    action: 'LINK_TO_QDN_RESOURCE',
    service,
    name,
    identifier: identifier ?? '',
    path: path ?? '',
  });
}
