// src/constants/wiki.ts
export const WIKI_GROUP_NAME = 'Q-Assets-Management'; // authoritative group
export const WIKI_GROUP_ID = 854;
export const WIKI_IDENTIFIER_PREFIX = 'qa_info__';

// Declare the sections we support and their order in the TOC
export type WikiSectionMeta = { id: string; title: string; tags?: string[] };

export const WIKI_SECTIONS: WikiSectionMeta[] = [
  { id: 'about',            title: 'What is Q-Assets?',           tags: ['overview', 'qortal', 'qdn'] },
  { id: 'trading-basics',   title: 'Trading Basics',              tags: ['trading', 'orders', 'dex'] },
  { id: 'orders',           title: 'My Orders & Status',          tags: ['orders', 'status', 'manage'] },
  { id: 'avatars',          title: 'Asset Avatars & Publications',tags: ['avatars', 'qdn'] },
  { id: 'api',              title: 'Useful API Endpoints',        tags: ['api', 'dev'] },
  { id: 'security',         title: 'Security Model',              tags: ['security'] },
  { id: 'faq',              title: 'FAQ',                         tags: ['faq'] },
];
