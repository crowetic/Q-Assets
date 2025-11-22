import type { ThreadComment } from '../types/ThreadedComment';

export type ThreadNode = ThreadComment & { children: ThreadNode[] };
export type WithFlags = ThreadNode & { deleted?: boolean };

/** Extract the compact id (“A1B2C3…”) from an identifier like `${prefix}${id}` */
export function stripPrefixId(fullIdentifier: string, prefix: string): string {
  return fullIdentifier.startsWith(prefix) ? fullIdentifier.slice(prefix.length) : fullIdentifier;
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

function adjustDepth<T extends WithFlags>(node: T, delta: number): T {
  const nextDepth = Math.max(
    0,
    Number.isFinite(node.depth as any) ? (node.depth as number) + delta : 0
  );
  const kids = Array.isArray(node.children) ? node.children : [];
  const adjustedKids = kids.map((c) => adjustDepth(c as WithFlags, delta));
  return { ...(node as any), depth: nextDepth, children: adjustedKids };
}

export function pruneDeletedForest(roots: WithFlags[]): WithFlags[] {
  const out: WithFlags[] = [];

  function processNode(node: WithFlags, isRoot: boolean): WithFlags[] {
    const kids = Array.isArray(node.children) ? node.children : [];
    const processedKidsArrays = kids.map((k) => processNode(k as WithFlags, false));
    const processedKids = ([] as WithFlags[]).concat(...processedKidsArrays);

    const isDeleted = Boolean(node.deleted);
    const hasKids = processedKids.length > 0;

    if (isDeleted) {
      if (!hasKids) {
        // deleted leaf → drop it regardless of root/non-root
        return [];
      }
      if (isRoot) {
        // deleted root with children → promote children to roots, depth - 1
        return processedKids.map((k) => adjustDepth(k, -1));
      }
      // deleted non-root with children → keep placeholder, attach kids
      const kept: WithFlags = { ...node, children: processedKids };
      return [kept];
    }

    // not deleted → keep with filtered kids
    const kept: WithFlags = { ...node, children: processedKids };
    return [kept];
  }

  for (const r of roots) {
    const res = processNode(r as WithFlags, true);
    out.push(...res);
  }
  return out;
}
