// Stable keys for definitions: the same recipe always gives the same key, so a derived artifact
// — a solid in memory today, a mesh or a STEP file in object storage tomorrow — invalidates
// itself when a parameter moves, with no manual cache busting.

/** JSON with object keys sorted, so that key order never changes the result. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value) ?? 'null';
  }
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`).join(',')}}`;
}

/** A short FNV-1a digest of a stable key, for display and logs. Not a content address. */
export function shortHash(value: unknown): string {
  const text = typeof value === 'string' ? value : stableStringify(value);
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}
