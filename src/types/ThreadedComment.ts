export type ThreadComment = {
  id: string; // 6+ char unique id (e.g., "A1B2C3")
  rootId: string; // id of the top-level comment in this thread
  parentId: string | null; // null for top level, else parent’s id
  depth: number; // 0 for top level, 1..N for replies
  ts: number; // epoch ms
  createdTs: number;
  updatedTs?: number;
  author: string; // qortal name
  html: string; // sanitized html
  roleTags?: string[];
  identifier?: string;
};
