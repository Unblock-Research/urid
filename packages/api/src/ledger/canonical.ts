/**
 * canonical.ts — Deterministic stable-key-order JSON serializer.
 *
 * Recursively sorts object keys (lexicographic order) so that identical
 * data structures produce the same byte string regardless of insertion order.
 * Array element order is preserved. Primitives serialize as standard JSON.
 *
 * Used as the single stable-serialization primitive for ledger hashing;
 * no external library required — this is a self-contained implementation.
 */

/**
 * Serialize `value` to a deterministic JSON string.
 *
 * - Objects: keys sorted ascending (lexicographic), values recursively canonicalized.
 * - Arrays: element order preserved, each element recursively canonicalized.
 * - Primitives (string, number, boolean, null): standard JSON serialization.
 */
export function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    const items = value.map((item) => canonicalize(item));
    return `[${items.join(',')}]`;
  }

  if (value !== null && typeof value === 'object') {
    const keys = Object.keys(value as Record<string, unknown>).sort();
    const pairs = keys.map((k) => {
      const v = canonicalize((value as Record<string, unknown>)[k]);
      return `${JSON.stringify(k)}:${v}`;
    });
    return `{${pairs.join(',')}}`;
  }

  return JSON.stringify(value);
}
