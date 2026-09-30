const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyz';

/** Readable, collision-resistant ids like `wall-k3f9x2qa`. */
export function newId(prefix: string): string {
  const bytes = new Uint8Array(8);
  crypto.getRandomValues(bytes);
  let s = '';
  for (const b of bytes) s += ALPHABET[b % 36];
  return `${prefix}-${s}`;
}
