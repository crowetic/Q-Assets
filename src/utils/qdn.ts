// src/utils/qdnSearch.ts

import pLimit from 'p-limit';
import { listManagementGroupNames } from './access';

const limit = pLimit(10);
export type Role = 'admin' | 'member';

type Hit = {
  name: string;
  identifier: string;
  role: Role; // admin | member (from the group list)
  created?: number;
  updated?: number;
};

/**
 * Search QDN DOCUMENTs for resources whose identifier starts with `identifierPrefix`.
 * Only within the Q-Assets-Management group (admins first).
 */
export async function searchByIdentifierPrefixInGroup(
  identifierPrefix: string,
  groupId: number
): Promise<Hit[]> {
  const publishers = await listManagementGroupNames(groupId); // [{ name, role }]
  if (!publishers.length) return [];

  const results = await Promise.all(
    publishers.map((p) =>
      limit(async () => {
        try {
          const res = await qortalRequest({
            action: 'SEARCH_QDN_RESOURCES',
            service: 'DOCUMENT',
            name: p.name,
            identifier: identifierPrefix,
            prefixOnly: true,
          } as any).catch(() => null);

          const rows: any[] = Array.isArray(res) ? res : res ? [res] : [];

          return rows.map(
            (r) =>
              ({
                name: p.name,
                identifier: r.identifier,
                role: p.role,
                created: Number(r.created ?? 0) || 0,
                updated: Number(r.updated ?? 0) || 0,
              }) as Hit
          );
        } catch {
          return [] as Hit[];
        }
      })
    )
  );

  // Flatten and sort: admins first by recency, then members by recency
  const hits = results.flat();
  const admins = hits
    .filter((h) => h.role === 'admin')
    .sort((a, b) => (b.updated ?? b.created ?? 0) - (a.updated ?? a.created ?? 0));
  const members = hits
    .filter((h) => h.role === 'member')
    .sort((a, b) => (b.updated ?? b.created ?? 0) - (a.updated ?? a.created ?? 0));
  return admins.concat(members);
}

// export async function searchByIdentifierPrefixInGroupId(identifierPrefix: string, name: string, groupId: string): Promise<Hit[]> {
//   const publishers = await getGroupMembershipForName(name, groupId); // [{ name, role }]
//   if (!publishers.length) return [];

//   const results = await Promise.all(
//     publishers.map((p) =>
//       limit(async () => {
//         try {
//           // NB: your runtime may support 'identifierPrefix' directly. If not,
//           // fall back to SEARCH_QDN_RESOURCES with 'identifier' and then filter client-side.
//           const res = await qortalRequest({
//             action: 'SEARCH_QDN_RESOURCES',
//             service: 'DOCUMENT',
//             name: p.name,
//             identifier: identifierPrefix,        // many cores return *prefix* matches when identifier is not exact
//             // If your node supports explicit prefix param, prefer:
//             // identifierPrefix,
//           } as any).catch(() => null);

//           const rows: any[] = Array.isArray(res) ? res :
//                               res ? [res] : [];

//           return rows
//             .filter(r => typeof r?.identifier === 'string' && r.identifier.startsWith(identifierPrefix))
//             .map(r => ({
//               name: p.name,
//               identifier: r.identifier,
//               role: p.role,
//               created: Number(r.created ?? 0) || 0,
//               updated: Number(r.updated ?? 0) || 0,
//             }) as Hit);
//         } catch {
//           return [] as Hit[];
//         }
//       })
//     )
//   );

//   // Flatten and sort: admins first by recency, then members by recency
//   const hits = results.flat();
//   const admins  = hits.filter(h => h.role === 'admin')
//                       .sort((a,b) => (b.updated ?? b.created ?? 0) - (a.updated ?? a.created ?? 0));
//   const members = hits.filter(h => h.role === 'member')
//                       .sort((a,b) => (b.updated ?? b.created ?? 0) - (a.updated ?? a.created ?? 0));
//   return admins.concat(members);
// }
