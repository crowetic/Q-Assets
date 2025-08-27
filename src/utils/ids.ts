export function uniqueId6(): string {
  // Math.random + time entropy, then base36 slice
  const n = Math.floor((Date.now() + Math.random() * 1e6)) >>> 0;
  return n.toString(36).slice(-6).padStart(6, '0');
}