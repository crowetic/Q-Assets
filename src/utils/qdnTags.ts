const SYSTEM_TAGS = new Set(['qassets-fs', 'qassets-fs-folder']);
const SYSTEM_TAG_PREFIXES = ['fs-path:', 'fs-name:', 'fs-folder:', 'fs-source-created:'];

export const coerceTags = (value: any): string[] =>
  Array.isArray(value)
    ? value.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0)
    : [];

export const isSystemTag = (tag: string) =>
  SYSTEM_TAGS.has(tag) || SYSTEM_TAG_PREFIXES.some((prefix) => tag.startsWith(prefix));

export const filterUserTags = (tags?: string[]) =>
  coerceTags(tags).filter((tag) => !isSystemTag(tag));
