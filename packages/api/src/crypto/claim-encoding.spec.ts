/**
 * claim-encoding — unit tests.
 *
 * Verifies the canonical claim-set builder and BN254 field-element leaf encoder
 * per CRYPTO-NOTES.md section 3.  All leaf-encoding behaviour must match the
 * Phase 6 witness generator exactly.
 *
 * Threat register coverage:
 *   - T-05-05: leaf value is sha256(canonicalJSON) mod BN254 p; reproducibility
 *              asserted via two independent Merkle-root runs.
 */

import { describe, it, expect } from 'vitest';
import {
  BN254_FIELD_PRIME,
  buildClaimSet,
  claimToFieldElement,
  encodeClaimsToLeaves,
  rootMessageBytes,
  type Claim,
  type ClaimSetInput,
} from './claim-encoding';
import { buildMerkleTree } from './merkle';

// ── Fixtures ─────────────────────────────────────────────────────────────────

const FULL_INPUT: ClaimSetInput = {
  holderDid: 'did:ub:z6Mkabcdef',
  credentialType: 'AcademicDegree',
  title: 'Bachelor of Science',
  issuer: 'University of Test',
  fieldOfStudy: 'Computer Science',
  issuedAt: '2024-01-15T00:00:00.000Z',
};

// ── BN254 field prime ─────────────────────────────────────────────────────────

describe('BN254_FIELD_PRIME', () => {
  it('matches the hex value recorded in CRYPTO-NOTES section 1', () => {
    expect(BN254_FIELD_PRIME).toBe(
      BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001'),
    );
  });
});

// ── buildClaimSet ─────────────────────────────────────────────────────────────

describe('buildClaimSet', () => {
  it('returns an array of { name, value } pairs', () => {
    const claims = buildClaimSet(FULL_INPUT);
    expect(Array.isArray(claims)).toBe(true);
    for (const c of claims) {
      expect(typeof c.name).toBe('string');
      expect(typeof c.value).toBe('string');
    }
  });

  it('includes all non-null semantic fields from FULL_INPUT', () => {
    const claims = buildClaimSet(FULL_INPUT);
    const names = claims.map((c) => c.name);
    expect(names).toContain('holderDid');
    expect(names).toContain('credentialType');
    expect(names).toContain('title');
    expect(names).toContain('issuer');
    expect(names).toContain('fieldOfStudy');
    expect(names).toContain('issuedAt');
    expect(claims).toHaveLength(6);
  });

  it('omits fields whose value is null or undefined', () => {
    const partial: ClaimSetInput = {
      holderDid: 'did:ub:z6Mk',
      credentialType: 'Cert',
      title: 'Some Title',
      issuer: 'Issuer Corp',
      // fieldOfStudy omitted
      issuedAt: '2024-01-01T00:00:00.000Z',
    };
    const claims = buildClaimSet(partial);
    const names = claims.map((c) => c.name);
    expect(names).not.toContain('fieldOfStudy');
    expect(claims).toHaveLength(5);
  });

  it('uses fixed lexicographic field order (deterministic key ordering)', () => {
    const claims = buildClaimSet(FULL_INPUT);
    const names = claims.map((c) => c.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('is deterministic: same input with different JS key insertion order yields identical array', () => {
    // Build object with keys in a different insertion order
    const shuffled: ClaimSetInput = {
      issuedAt: FULL_INPUT.issuedAt,
      fieldOfStudy: FULL_INPUT.fieldOfStudy,
      title: FULL_INPUT.title,
      holderDid: FULL_INPUT.holderDid,
      issuer: FULL_INPUT.issuer,
      credentialType: FULL_INPUT.credentialType,
    };
    const c1 = buildClaimSet(FULL_INPUT);
    const c2 = buildClaimSet(shuffled);
    expect(c1).toEqual(c2);
  });
});

// ── claimToFieldElement ──────────────────────────────────────────────────────

describe('claimToFieldElement', () => {
  it('returns a bigint', () => {
    const claim: Claim = { name: 'title', value: 'BSc Computer Science' };
    const fe = claimToFieldElement(claim);
    expect(typeof fe).toBe('bigint');
  });

  it('returns a value strictly less than BN254_FIELD_PRIME (mod p reduction)', () => {
    const claims = buildClaimSet(FULL_INPUT);
    for (const c of claims) {
      const fe = claimToFieldElement(c);
      expect(fe).toBeGreaterThanOrEqual(BigInt(0));
      expect(fe).toBeLessThan(BN254_FIELD_PRIME);
    }
  });

  it('is deterministic: same claim always produces the same field element', () => {
    const claim: Claim = { name: 'issuer', value: 'University of Test' };
    const fe1 = claimToFieldElement(claim);
    const fe2 = claimToFieldElement(claim);
    expect(fe1).toBe(fe2);
  });

  it('is collision-distinct: two different claims produce different field elements', () => {
    const c1: Claim = { name: 'title', value: 'Bachelor of Science' };
    const c2: Claim = { name: 'title', value: 'Master of Science' };
    const fe1 = claimToFieldElement(c1);
    const fe2 = claimToFieldElement(c2);
    expect(fe1).not.toBe(fe2);
  });

  it('is sensitive to name: same value but different name yields different field element', () => {
    const c1: Claim = { name: 'title', value: 'Computer Science' };
    const c2: Claim = { name: 'fieldOfStudy', value: 'Computer Science' };
    expect(claimToFieldElement(c1)).not.toBe(claimToFieldElement(c2));
  });
});

// ── encodeClaimsToLeaves ─────────────────────────────────────────────────────

describe('encodeClaimsToLeaves', () => {
  it('returns an array of bigints with the same length as the input claims', () => {
    const claims = buildClaimSet(FULL_INPUT);
    const leaves = encodeClaimsToLeaves(claims);
    expect(leaves).toHaveLength(claims.length);
    for (const v of leaves) {
      expect(typeof v).toBe('bigint');
    }
  });

  it('each leaf value is < BN254_FIELD_PRIME', () => {
    const leaves = encodeClaimsToLeaves(buildClaimSet(FULL_INPUT));
    for (const v of leaves) {
      expect(v).toBeLessThan(BN254_FIELD_PRIME);
    }
  });

  it('preserves the ordering of the input claims array', () => {
    const claims = buildClaimSet(FULL_INPUT);
    const leaves = encodeClaimsToLeaves(claims);
    for (let i = 0; i < claims.length; i++) {
      expect(leaves[i]).toBe(claimToFieldElement(claims[i]));
    }
  });
});

// ── Merkle root reproducibility ───────────────────────────────────────────────

describe('Merkle root reproducibility (T-05-05)', () => {
  it('two independent runs on identical claims produce the same Merkle root', async () => {
    const claims = buildClaimSet(FULL_INPUT);
    const leaves = encodeClaimsToLeaves(claims);

    const tree1 = await buildMerkleTree(leaves);
    const tree2 = await buildMerkleTree(leaves);

    expect(tree1.root).toBe(tree2.root);
    expect(typeof tree1.root).toBe('string');
    expect(tree1.root.length).toBeGreaterThan(0);
  });
});

// ── rootMessageBytes ─────────────────────────────────────────────────────────

describe('rootMessageBytes', () => {
  it('returns a Uint8Array', () => {
    const bytes = rootMessageBytes('deadbeef');
    expect(bytes).toBeInstanceOf(Uint8Array);
  });

  it('is deterministic: same root string always yields identical bytes', () => {
    const root = 'abcdef1234567890';
    const b1 = rootMessageBytes(root);
    const b2 = rootMessageBytes(root);
    expect(b1).toEqual(b2);
  });

  it('encodes the root string as UTF-8 bytes (TextEncoder semantics)', () => {
    const root = 'hello';
    const bytes = rootMessageBytes(root);
    // 'hello' in ASCII/UTF-8 = [104, 101, 108, 108, 111]
    expect(Array.from(bytes)).toEqual([104, 101, 108, 108, 111]);
  });

  it('different root strings yield different byte arrays', () => {
    const b1 = rootMessageBytes('root1');
    const b2 = rootMessageBytes('root2');
    expect(b1).not.toEqual(b2);
  });
});
