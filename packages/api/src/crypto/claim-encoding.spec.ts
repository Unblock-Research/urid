/**
 * claim-encoding — unit tests.
 *
 * Verifies the canonical claim-set builder and BN254 field-element leaf encoder
 * per CRYPTO-NOTES.md section 3.  All leaf-encoding behaviour must match the
 * circom witness generator exactly.
 *
 * v2 (critical finding #3): a claim is encoded as two halves —
 *   leafValue = poseidon([claimNameHash(name), claimValueHash(value)])
 * so the circuit can publish the name half while keeping the value half private.
 *
 * Threat register coverage:
 *   - T-05-05: both halves are sha256(domain-tagged input) mod BN254 p;
 *              reproducibility asserted via two independent Merkle-root runs.
 */

import { describe, it, expect } from 'vitest';
import * as fs from 'fs';
import * as path from 'path';

import {
  BN254_FIELD_PRIME,
  MAX_NUMERIC_CLAIM_VALUE,
  NUMERIC_VALUE_TAG,
  buildClaimSet,
  claimNameHash,
  claimToLeafValue,
  claimValueCommitment,
  claimValueHash,
  encodeClaimsToLeaves,
  isNumericClaim,
  numericValueHash,
  rootMessageBytes,
  type Claim,
  type ClaimSetInput,
} from './claim-encoding';
import { poseidonHash } from './merkle';
import { buildMerkleTree } from './merkle';

// ── Fixtures ─────────────────────────────────────────────────────────────────

/**
 * Merkle root of FULL_INPUT under the string-only encoding, captured by running
 * the encoder from the commit BEFORE numeric claims existed (1777cd9).
 *
 * This is the regression guard for "existing credentials need no re-mint": if
 * adding numeric-claim support perturbs the string path at all, this value moves
 * and every already-minted credential stops verifying.
 */
const PINNED_STRING_ONLY_ROOT =
  '278597314367360c9888a76836b90aa1898fd37ede57db583bd99f145f38d08e';

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

// ── claimNameHash / claimValueHash ───────────────────────────────────────────

describe('claimNameHash / claimValueHash', () => {
  it('both return bigints in [0, BN254_FIELD_PRIME)', () => {
    for (const c of buildClaimSet(FULL_INPUT)) {
      const n = claimNameHash(c.name);
      const v = claimValueHash(c.value);
      expect(typeof n).toBe('bigint');
      expect(typeof v).toBe('bigint');
      expect(n).toBeGreaterThanOrEqual(BigInt(0));
      expect(n).toBeLessThan(BN254_FIELD_PRIME);
      expect(v).toBeGreaterThanOrEqual(BigInt(0));
      expect(v).toBeLessThan(BN254_FIELD_PRIME);
    }
  });

  it('are deterministic', () => {
    expect(claimNameHash('title')).toBe(claimNameHash('title'));
    expect(claimValueHash('BSc')).toBe(claimValueHash('BSc'));
  });

  it('are collision-distinct across different inputs', () => {
    expect(claimNameHash('title')).not.toBe(claimNameHash('fieldOfStudy'));
    expect(claimValueHash('Bachelor of Science')).not.toBe(
      claimValueHash('Master of Science'),
    );
  });

  it('are domain-separated: the same string hashes differently as a name vs a value', () => {
    // Without domain separation a claim whose VALUE equals another claim's NAME
    // would produce the same digest in both roles.
    expect(claimNameHash('title')).not.toBe(claimValueHash('title'));
  });
});

// ── claimToLeafValue ─────────────────────────────────────────────────────────

describe('claimToLeafValue', () => {
  it('returns a bigint in [0, BN254_FIELD_PRIME)', async () => {
    const claim: Claim = { name: 'title', value: 'BSc Computer Science' };
    const fe = await claimToLeafValue(claim);
    expect(typeof fe).toBe('bigint');
    expect(fe).toBeGreaterThanOrEqual(BigInt(0));
    expect(fe).toBeLessThan(BN254_FIELD_PRIME);
  });

  it('is deterministic: same claim always produces the same leaf value', async () => {
    const claim: Claim = { name: 'issuer', value: 'University of Test' };
    expect(await claimToLeafValue(claim)).toBe(await claimToLeafValue(claim));
  });

  it('is collision-distinct: two different values produce different leaf values', async () => {
    const c1: Claim = { name: 'title', value: 'Bachelor of Science' };
    const c2: Claim = { name: 'title', value: 'Master of Science' };
    expect(await claimToLeafValue(c1)).not.toBe(await claimToLeafValue(c2));
  });

  it('is sensitive to name: same value but different name yields a different leaf value', async () => {
    const c1: Claim = { name: 'title', value: 'Computer Science' };
    const c2: Claim = { name: 'fieldOfStudy', value: 'Computer Science' };
    expect(await claimToLeafValue(c1)).not.toBe(await claimToLeafValue(c2));
  });

  it('equals poseidon over the two halves — the rule the circuit reimplements', async () => {
    const { poseidonHash } = await import('./merkle');
    const claim: Claim = { name: 'fieldOfStudy', value: 'Computer Science' };
    const expected = await poseidonHash([
      claimNameHash(claim.name),
      claimValueHash(claim.value),
    ]);
    expect(await claimToLeafValue(claim)).toBe(expected);
  });
});

// ── encodeClaimsToLeaves ─────────────────────────────────────────────────────

describe('encodeClaimsToLeaves', () => {
  it('returns an array of bigints with the same length as the input claims', async () => {
    const claims = buildClaimSet(FULL_INPUT);
    const leaves = await encodeClaimsToLeaves(claims);
    expect(leaves).toHaveLength(claims.length);
    for (const v of leaves) {
      expect(typeof v).toBe('bigint');
    }
  });

  it('each leaf value is < BN254_FIELD_PRIME', async () => {
    const leaves = await encodeClaimsToLeaves(buildClaimSet(FULL_INPUT));
    for (const v of leaves) {
      expect(v).toBeLessThan(BN254_FIELD_PRIME);
    }
  });

  it('preserves the ordering of the input claims array', async () => {
    const claims = buildClaimSet(FULL_INPUT);
    const leaves = await encodeClaimsToLeaves(claims);
    for (let i = 0; i < claims.length; i++) {
      expect(leaves[i]).toBe(await claimToLeafValue(claims[i]));
    }
  });
});

// ── Merkle root reproducibility ───────────────────────────────────────────────

describe('Merkle root reproducibility (T-05-05)', () => {
  it('two independent runs on identical claims produce the same Merkle root', async () => {
    const claims = buildClaimSet(FULL_INPUT);
    const leaves = await encodeClaimsToLeaves(claims);

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

// ── Numeric claims (high finding #1) ─────────────────────────────────────────

describe('numeric claims', () => {
  it('omitting numericClaims yields a claim set identical to the string-only encoding', () => {
    // The property that means existing credentials need no re-mint.
    const without = buildClaimSet(FULL_INPUT);
    const withEmpty = buildClaimSet({ ...FULL_INPUT, numericClaims: {} });
    const withNull = buildClaimSet({ ...FULL_INPUT, numericClaims: null });

    expect(withEmpty).toEqual(without);
    expect(withNull).toEqual(without);
    // Serialised shape matters, not just deep equality: a stray `kind` key would
    // change the stored JSON even where the leaf value did not.
    expect(JSON.stringify(withEmpty)).toBe(JSON.stringify(without));
    for (const c of without) {
      expect(Object.keys(c).sort()).toEqual(['name', 'value']);
    }
  });

  it('string-only Merkle roots are unchanged by the numeric-claim feature', async () => {
    const claims = buildClaimSet(FULL_INPUT);
    const leaves = await encodeClaimsToLeaves(claims);
    const padded = [...leaves];
    while (padded.length < 16) padded.push(0n);
    const { root } = await buildMerkleTree(padded);

    // Pinned value captured from the encoding before numeric claims existed.
    // If this changes, every already-minted credential silently stops verifying.
    expect(root).toBe(PINNED_STRING_ONLY_ROOT);
  });

  it('appends numeric claims after the string fields, sorted by name', () => {
    const claims = buildClaimSet({
      ...FULL_INPUT,
      numericClaims: { publicationCount: 34, citationCount: 2841 },
    });
    const names = claims.map((c) => c.name);
    expect(names.slice(-2)).toEqual(['citationCount', 'publicationCount']);
    expect(claims.filter((c) => c.kind === 'numeric')).toHaveLength(2);
  });

  it('is insensitive to numericClaims key-insertion order', () => {
    const a = buildClaimSet({ ...FULL_INPUT, numericClaims: { b: 2, a: 1 } });
    const b = buildClaimSet({ ...FULL_INPUT, numericClaims: { a: 1, b: 2 } });
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
  });

  it('accepts numbers, bigints, and decimal strings identically', () => {
    const asNum = buildClaimSet({ ...FULL_INPUT, numericClaims: { n: 42 } });
    const asBig = buildClaimSet({ ...FULL_INPUT, numericClaims: { n: 42n } });
    const asStr = buildClaimSet({ ...FULL_INPUT, numericClaims: { n: '42' } });
    expect(JSON.stringify(asNum)).toBe(JSON.stringify(asBig));
    expect(JSON.stringify(asNum)).toBe(JSON.stringify(asStr));
  });

  describe('bounds', () => {
    it('rejects values at or above 2^64 — the comparator cannot accept them', () => {
      expect(() =>
        buildClaimSet({ ...FULL_INPUT, numericClaims: { n: MAX_NUMERIC_CLAIM_VALUE } }),
      ).toThrow(/2\^64/);
    });

    it('accepts the largest in-range value', () => {
      const claims = buildClaimSet({
        ...FULL_INPUT,
        numericClaims: { n: MAX_NUMERIC_CLAIM_VALUE - 1n },
      });
      expect(claims[claims.length - 1].value).toBe((MAX_NUMERIC_CLAIM_VALUE - 1n).toString(10));
    });

    it('rejects negatives and non-integers', () => {
      expect(() => buildClaimSet({ ...FULL_INPUT, numericClaims: { n: -1 } })).toThrow();
      expect(() => buildClaimSet({ ...FULL_INPUT, numericClaims: { n: 1.5 } })).toThrow(/integer/i);
      expect(() => buildClaimSet({ ...FULL_INPUT, numericClaims: { n: 'abc' } })).toThrow();
    });
  });

  describe('commitment', () => {
    it('commits a numeric value with Poseidon, not SHA-256', async () => {
      const claim: Claim = { name: 'citationCount', value: '2841', kind: 'numeric' };
      expect(await claimValueCommitment(claim)).toBe(
        await poseidonHash([NUMERIC_VALUE_TAG, 2841n]),
      );
      // Distinct from the string rule, so the two kinds cannot be conflated.
      expect(await claimValueCommitment(claim)).not.toBe(claimValueHash('2841'));
    });

    it('still uses SHA-256 for string claims', async () => {
      const claim: Claim = { name: 'title', value: 'BSc' };
      expect(await claimValueCommitment(claim)).toBe(claimValueHash('BSc'));
      expect(isNumericClaim(claim)).toBe(false);
    });

    it('is collision-distinct across numeric values', async () => {
      expect(await numericValueHash(1n)).not.toBe(await numericValueHash(2n));
    });
  });

  it('the circuit bakes in the same NUMERIC_VALUE_TAG this module uses', () => {
    // The tag is a compile-time literal in the .circom source. If the two drift,
    // every numeric predicate proof fails at witness generation with no obvious
    // cause — so pin them against each other here.
    const circuitSrc = fs.readFileSync(
      path.resolve(__dirname, '../../circuits/merkle_inclusion.circom'),
      'utf8',
    );
    expect(circuitSrc).toContain(NUMERIC_VALUE_TAG.toString(10));
  });
});
