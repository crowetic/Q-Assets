import type { ThreadComment } from "../types/ThreadedComment";

export type ThreadNode = ThreadComment & { children: ThreadNode[] };

/** Build a forest (array of root nodes) from a flat list. */
// export function buildCommentForest(items: ThreadComment[]): ThreadNode[] {
//   const byId = new Map<string, ThreadNode>();
//   const roots: ThreadNode[] = [];

//   // init nodes
//   for (const c of items) byId.set(c.id, { ...c, children: [] });

//   // link children → parents
//   for (const c of items) {
//     const node = byId.get(c.id)!;
//     if (c.parentId && byId.has(c.parentId)) {
//       byId.get(c.parentId)!.children.push(node);
//     } else {
//       roots.push(node);
//     }
//   }

//   // sort each level by timestamp asc (oldest first) for conversation flow
//   const sortDfs = (n: ThreadNode) => {
//     n.children.sort((a, b) => a.ts - b.ts);
//     n.children.forEach(sortDfs);
//   };
//   roots.sort((a, b) => a.ts - b.ts);
//   roots.forEach(sortDfs);

//   return roots;
// }

/** Extract the compact id (“A1B2C3…”) from an identifier like `${prefix}${id}` */
export function stripPrefixId(fullIdentifier: string, prefix: string): string {
  return fullIdentifier.startsWith(prefix)
    ? fullIdentifier.slice(prefix.length)
    : fullIdentifier;
}


export function buildCommentForest(input: ThreadComment[]): ThreadNode[] {
  const byId = new Map<string, ThreadNode>();
  const roots: ThreadNode[] = [];

  // make nodes
  for (const c of input) {
    if (!c || typeof c.id !== 'string') continue;
    const node: ThreadNode = { ...c, children: [] };
    byId.set(c.id, node);
  }

  // link children → parents
  for (const node of byId.values()) {
    if (node.parentId && byId.has(node.parentId)) {
      byId.get(node.parentId)!.children.push(node);
    } else {
      // either no parent or missing parent: treat as root
      roots.push(node);
    }
  }

  // option: stabilize child order (oldest→newest)
  const sortTree = (n: ThreadNode) => {
    n.children.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
    for (const ch of n.children) sortTree(ch);
  };
  roots.sort((a, b) => a.ts - b.ts || a.id.localeCompare(b.id));
  for (const r of roots) sortTree(r);

  // backfill depth if missing/incorrect
  const fixDepth = (n: ThreadNode, d: number) => {
    n.depth = Number.isFinite(n.depth) ? Math.max(0, Math.min(n.depth!, 128)) : d;
    for (const ch of n.children) fixDepth(ch, n.depth! + 1);
  };
  for (const r of roots) fixDepth(r, 0);

  return roots;
}