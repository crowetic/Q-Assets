// src/types/qdn-env.d.ts
export {}; // ensure this file is a module so global augmentation works

declare global {
  interface Window {
    _qdnContext?: 'render' | 'preview' | string;
    _qdnBase?: string;   // e.g., "/render/APP/Q-Assets"
    _qdnPath?: string;   // e.g., "/info#ann2"
    _qdnTheme?: string;
  }
}
