export function generateDID(seed: string): string {
  let hash = 0;
  for (let i = 0; i < seed.length; i++) { hash = ((hash << 5) - hash) + seed.charCodeAt(i); hash |= 0; }
  return "did:ub:0x" + Math.abs(hash).toString(16).padStart(8, "0").toUpperCase();
}
export function truncateHash(hash: string, chars = 4): string {
  if (hash.length <= chars * 2 + 3) return hash;
  return hash.slice(0, chars + 2) + "…" + hash.slice(-chars);
}
