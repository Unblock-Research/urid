import { describe, it, expect } from 'vitest';
import { canonicalize } from './canonical';
import {
  GENESIS_PREV_HASH,
  computeTxHash,
  verifyChain,
  type LedgerEntry,
  type ChainRow,
} from './hash-chain';

// ── canonicalize ─────────────────────────────────────────────────────────────

describe('canonicalize', () => {
  it('produces identical output regardless of key insertion order', () => {
    const a = canonicalize({ z: 1, a: 2, m: 3 });
    const b = canonicalize({ m: 3, z: 1, a: 2 });
    expect(a).toBe(b);
  });

  it('is deterministic: same input → same output', () => {
    const obj = { foo: 'bar', num: 42, nested: { b: true, a: false } };
    expect(canonicalize(obj)).toBe(canonicalize(obj));
  });

  it('handles nested objects with stable key order', () => {
    const result = canonicalize({ b: { d: 4, c: 3 }, a: 1 });
    expect(result).toBe('{"a":1,"b":{"c":3,"d":4}}');
  });

  it('preserves array element order', () => {
    expect(canonicalize([3, 1, 2])).toBe('[3,1,2]');
  });

  it('serializes primitives as standard JSON', () => {
    expect(canonicalize(42)).toBe('42');
    expect(canonicalize('hello')).toBe('"hello"');
    expect(canonicalize(true)).toBe('true');
    expect(canonicalize(null)).toBe('null');
  });
});

// ── GENESIS_PREV_HASH ─────────────────────────────────────────────────────────

describe('GENESIS_PREV_HASH', () => {
  it('is exactly 64 characters long', () => {
    expect(GENESIS_PREV_HASH).toHaveLength(64);
  });

  it('consists entirely of ASCII zero characters', () => {
    expect(GENESIS_PREV_HASH).toMatch(/^0+$/);
  });
});

// ── computeTxHash ─────────────────────────────────────────────────────────────

describe('computeTxHash', () => {
  const entry: LedgerEntry = { index: 0, type: 'register_did', payload: { did: 'did:ub:abc' } };

  it('returns a 64-character lowercase hex string', () => {
    const hash = computeTxHash(entry, GENESIS_PREV_HASH);
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[0-9a-f]+$/);
  });

  it('is deterministic: identical inputs produce identical output', () => {
    const h1 = computeTxHash(entry, GENESIS_PREV_HASH);
    const h2 = computeTxHash(entry, GENESIS_PREV_HASH);
    expect(h1).toBe(h2);
  });

  it('changes when index changes', () => {
    const h1 = computeTxHash({ ...entry, index: 0 }, GENESIS_PREV_HASH);
    const h2 = computeTxHash({ ...entry, index: 1 }, GENESIS_PREV_HASH);
    expect(h1).not.toBe(h2);
  });

  it('changes when type changes', () => {
    const h1 = computeTxHash({ ...entry, type: 'register_did' }, GENESIS_PREV_HASH);
    const h2 = computeTxHash({ ...entry, type: 'mint_sbt' }, GENESIS_PREV_HASH);
    expect(h1).not.toBe(h2);
  });

  it('changes when payload changes', () => {
    const h1 = computeTxHash({ ...entry, payload: { did: 'did:ub:aaa' } }, GENESIS_PREV_HASH);
    const h2 = computeTxHash({ ...entry, payload: { did: 'did:ub:bbb' } }, GENESIS_PREV_HASH);
    expect(h1).not.toBe(h2);
  });

  it('changes when prevHash changes', () => {
    const h1 = computeTxHash(entry, GENESIS_PREV_HASH);
    const h2 = computeTxHash(entry, 'a'.repeat(64));
    expect(h1).not.toBe(h2);
  });
});

// ── verifyChain ───────────────────────────────────────────────────────────────

function buildValidChain(length: number): ChainRow[] {
  const rows: ChainRow[] = [];
  let prevHash = GENESIS_PREV_HASH;
  for (let i = 0; i < length; i++) {
    const entry: LedgerEntry = { index: i, type: 'register_did', payload: { seq: i } };
    const txHash = computeTxHash(entry, prevHash);
    rows.push({ index: i, type: entry.type, payload: entry.payload, txHash, prevHash });
    prevHash = txHash;
  }
  return rows;
}

describe('verifyChain', () => {
  it('returns valid=true for an empty chain', () => {
    expect(verifyChain([])).toEqual({ valid: true });
  });

  it('returns valid=true for a single genesis row', () => {
    const rows = buildValidChain(1);
    expect(verifyChain(rows)).toEqual({ valid: true });
  });

  it('returns valid=true for a correctly linked multi-row chain', () => {
    const rows = buildValidChain(3);
    expect(verifyChain(rows)).toEqual({ valid: true });
  });

  it('row[1].prevHash equals row[0].txHash (sequential link)', () => {
    const rows = buildValidChain(2);
    expect(rows[1].prevHash).toBe(rows[0].txHash);
  });

  it('genesis row (index 0) prevHash must equal GENESIS_PREV_HASH', () => {
    const rows = buildValidChain(1);
    expect(rows[0].prevHash).toBe(GENESIS_PREV_HASH);
  });

  it('returns valid=false with brokenAt when a payload is tampered', () => {
    const rows = buildValidChain(3);
    // Tamper row 1's payload without recomputing its txHash
    rows[1] = { ...rows[1], payload: { tampered: true } };
    const result = verifyChain(rows);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('returns valid=false with brokenAt when a txHash link is broken', () => {
    const rows = buildValidChain(3);
    // Overwrite row 1's txHash so row 2's prevHash no longer matches
    rows[1] = { ...rows[1], txHash: 'b'.repeat(64) };
    const result = verifyChain(rows);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('returns valid=false with brokenAt when index is non-monotonic', () => {
    const rows = buildValidChain(3);
    rows[1] = { ...rows[1], index: 99 };
    const result = verifyChain(rows);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(1);
  });

  it('tamper case: mutating one row makes brokenAt equal that row index', () => {
    const rows = buildValidChain(3);
    rows[2] = { ...rows[2], payload: { evil: 'tampered' } };
    const result = verifyChain(rows);
    expect(result.valid).toBe(false);
    expect(result.brokenAt).toBe(2);
  });
});
