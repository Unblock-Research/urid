/**
 * claim-encoding.ts — Canonical claim-set builder + BN254 field-element encoder.
 *
 * This module is the shared Phase 5 / Phase 6 leaf-encoding contract.  The Phase 6
 * ZK witness generator must import (or replicate) this module to ensure that the
 * leaf values it feeds into the Poseidon Merkle tree are byte-identical to the
 * values stored on-chain at credential mint time.
 *
 * Leaf-encoding rule (CRYPTO-NOTES.md section 3) — v2, see BREAKING CHANGE below:
 *   nameHash  = BigInt(sha256("urid:claim-name:"  + name))  mod BN254_FIELD_PRIME
 *   valueHash = BigInt(sha256("urid:claim-value:" + value)) mod BN254_FIELD_PRIME
 *   leafValue = poseidon([nameHash, valueHash])
 *
 * The encoder returns raw leaf *values* (mod-p bigints).  buildMerkleTree
 * applies poseidon([leafValue]) internally — callers must NOT pre-hash.
 *
 * BREAKING CHANGE (critical finding #3):
 *   v1 encoded a claim as a single opaque digest of {name, value} together. That
 *   left the circuit with nothing it could expose about WHICH claim was proven:
 *   leafValue was private, and no public signal named the claim, so a proof only
 *   established "some leaf is in this tree" — satisfiable with a padding zero.
 *
 *   Splitting the claim into a name half and a value half lets the circuit take
 *   nameHash as a PUBLIC input and valueHash as a private one, recombining them
 *   in-circuit. A verifier then learns which claim was proven while the value
 *   stays hidden — the selective-disclosure property the system claims.
 *
 *   Roots computed under v1 do not match v2. Credentials minted before this
 *   change must be re-minted; there is no in-place migration.
 *
 * Design constraints:
 *  - No NestJS or Prisma imports — standalone so Phase 6 can import it directly.
 *  - Reuses ../ledger/canonical for stable-key-order JSON so serialization is
 *    byte-identical across Phase 5 mint path and Phase 6 witness generator.
 *  - Threat T-05-05: leaf rule is exactly sha256 mod p; reproducibility is
 *    asserted by claim-encoding.spec.ts.
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex } from '@noble/hashes/utils';
import { poseidonHash } from './merkle';

// ── BN254 field prime ─────────────────────────────────────────────────────────

/**
 * BN254 scalar field prime, as recorded in CRYPTO-NOTES.md section 1.
 * All leaf values must be reduced modulo this prime before being fed into
 * buildMerkleTree.
 */
export const BN254_FIELD_PRIME: bigint =
  BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001');

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single semantic claim.
 *
 * `kind` selects how the value half is committed:
 *   'string'  (default) — sha256 of the domain-tagged text, as before
 *   'numeric'           — poseidon([NUMERIC_VALUE_TAG, BigInt(value)])
 *
 * Numeric claims exist so the circuit's threshold predicate can mean something.
 * A SHA-256 digest cannot be compared numerically (it is ~2^254, and the
 * comparator accepts inputs below 2^64), and the circuit cannot recompute
 * SHA-256 cheaply enough to bind a separate numeric input to it. Poseidon can be
 * recomputed in-circuit for a few hundred constraints, so a numeric claim's
 * commitment can be re-derived from the private value and constrained against
 * the leaf — which is what stops a prover substituting a different number.
 *
 * `value` stays a string in both cases so the stored claim set is one uniform
 * JSON shape; numeric claims carry a decimal integer string.
 */
export interface Claim {
  name: string;
  value: string;
  kind?: 'string' | 'numeric';
}

/**
 * The set of semantic credential fields that make up the claim set.
 * All fields are optional so that callers can omit null/undefined values
 * naturally; buildClaimSet skips any key whose value is null or undefined.
 */
export interface ClaimSetInput {
  holderDid?: string | null;
  credentialType?: string | null;
  title?: string | null;
  issuer?: string | null;
  fieldOfStudy?: string | null;
  issuedAt?: string | null;
  /**
   * Optional numeric claims, e.g. { citationCount: 2841, publicationCount: 34 }.
   *
   * Emitted AFTER the fixed string fields, in sorted name order. Omitting this
   * (or passing an empty object) produces a claim set byte-identical to the
   * string-only encoding, so credentials that carry no numeric claims keep
   * exactly the roots they already had — asserted in claim-encoding.spec.ts.
   */
  numericClaims?: Record<string, number | bigint | string> | null;
}

// ── Claim field ordering ──────────────────────────────────────────────────────

/**
 * Fixed lexicographic field order for the canonical claim set.
 * Any new semantic fields added to ClaimSetInput must be inserted here in
 * their sorted position to preserve the locked Phase 6 leaf-encoding contract.
 */
const CLAIM_FIELD_ORDER: ReadonlyArray<keyof ClaimSetInput> = [
  'credentialType',
  'fieldOfStudy',
  'holderDid',
  'issuedAt',
  'issuer',
  'title',
];

// ── buildClaimSet ─────────────────────────────────────────────────────────────

/**
 * Build a canonical, key-ordered claim array from a credential's semantic fields.
 *
 * Fields are emitted in fixed lexicographic order (CLAIM_FIELD_ORDER).  Any
 * field whose value is null or undefined is silently omitted.  The result is
 * deterministic: identical input objects with different JS key-insertion order
 * produce the identical Claim[].
 *
 * @param input  Credential semantic fields.
 * @returns      Ordered array of { name, value } string pairs.
 */
export function buildClaimSet(input: ClaimSetInput): Claim[] {
  const claims: Claim[] = [];

  for (const field of CLAIM_FIELD_ORDER) {
    const val = input[field];
    if (val == null) continue; // skip null and undefined
    // No `kind` key is emitted for string claims. That keeps the serialised
    // claim set byte-identical to the previous encoding, so credentials without
    // numeric claims retain exactly the roots they already had.
    claims.push({ name: field, value: String(val) });
  }

  // Numeric claims follow the fixed string fields, sorted by name so the result
  // does not depend on JS key-insertion order.
  const numeric = input.numericClaims;
  if (numeric != null) {
    for (const name of Object.keys(numeric).sort()) {
      const raw = numeric[name];
      if (raw == null) continue;
      claims.push({
        name,
        value: assertNumericValue(name, raw).toString(10),
        kind: 'numeric',
      });
    }
  }

  return claims;
}

/**
 * Validate and normalise a numeric claim value.
 *
 * Numeric claims must be non-negative integers below 2^64. The upper bound is
 * not arbitrary: the circuit's comparator is GreaterEqThan(64), whose Num2Bits(65)
 * rejects anything larger. Enforcing it here means a credential cannot be minted
 * carrying a number the predicate could never operate on.
 */
function assertNumericValue(name: string, raw: number | bigint | string): bigint {
  let v: bigint;
  if (typeof raw === 'bigint') {
    v = raw;
  } else if (typeof raw === 'number') {
    if (!Number.isInteger(raw)) {
      throw new Error(
        `Numeric claim "${name}" must be an integer (got ${raw}) — the circuit compares whole numbers only`,
      );
    }
    v = BigInt(raw);
  } else {
    if (!/^\d+$/.test(raw.trim())) {
      throw new Error(
        `Numeric claim "${name}" must be a non-negative integer string`,
      );
    }
    v = BigInt(raw.trim());
  }

  if (v < 0n) {
    throw new Error(`Numeric claim "${name}" must be non-negative`);
  }
  if (v >= MAX_NUMERIC_CLAIM_VALUE) {
    throw new Error(
      `Numeric claim "${name}" must be < 2^64 — the circuit's GreaterEqThan(64) comparator cannot accept larger values`,
    );
  }
  return v;
}

// ── Domain-separated SHA-256 → field element ─────────────────────────────────

/**
 * Domain separation tags.
 *
 * Name and value halves are hashed under distinct prefixes so a claim whose
 * VALUE happens to equal another claim's NAME cannot produce a matching digest.
 * Poseidon's argument order already separates the two positions; these tags make
 * the separation hold at the digest level too, independent of that ordering.
 */
const NAME_DOMAIN = 'urid:claim-name:';
const VALUE_DOMAIN = 'urid:claim-value:';

/**
 * Domain tag for numeric claim values, as a field element.
 *
 * Mixed into the Poseidon commitment so a numeric claim's value half cannot
 * collide with any other Poseidon-derived element in the scheme (notably a leaf
 * value, which is also poseidon of two elements). Chosen as a fixed
 * hash-to-field of a descriptive string rather than a magic small integer.
 */
export const NUMERIC_VALUE_TAG: bigint = hashToField(
  'urid:domain:',
  'numeric-claim-value-v1',
);

/**
 * Exclusive upper bound for numeric claim values (2^64).
 *
 * Set by the circuit: GreaterEqThan(64) uses Num2Bits(65) internally and rejects
 * inputs at or above this bound.
 */
export const MAX_NUMERIC_CLAIM_VALUE: bigint = 1n << 64n;

/**
 * SHA-256 a domain-tagged string and reduce it into the BN254 scalar field.
 *
 *   1. UTF-8 encode `tag + input`.
 *   2. SHA-256.
 *   3. Interpret the 32-byte digest as a big-endian unsigned integer.
 *   4. Reduce mod BN254_FIELD_PRIME into [0, p).
 */
function hashToField(tag: string, input: string): bigint {
  const hashBytes = sha256(new TextEncoder().encode(tag + input));
  return BigInt('0x' + bytesToHex(hashBytes)) % BN254_FIELD_PRIME;
}

/**
 * Encode a claim NAME as a BN254 field element.
 *
 * This is the value the circuit exposes as a PUBLIC signal, so a verifier can
 * confirm which claim a proof is about. Callers verifying a proof recompute it
 * from the claim name they were told and compare against the proof's signal.
 *
 * @param name  Claim name, e.g. "fieldOfStudy".
 * @returns     BigInt in [0, BN254_FIELD_PRIME).
 */
export function claimNameHash(name: string): bigint {
  return hashToField(NAME_DOMAIN, name);
}

/**
 * Encode a claim VALUE as a BN254 field element.
 *
 * Stays a PRIVATE circuit signal — this is the half the holder does not disclose.
 *
 * @param value  Claim value, e.g. "Computer Science".
 * @returns      BigInt in [0, BN254_FIELD_PRIME).
 */
export function claimValueHash(value: string): bigint {
  return hashToField(VALUE_DOMAIN, value);
}

/**
 * Commit a numeric claim value with Poseidon.
 *
 *   numericValueHash(n) = poseidon([NUMERIC_VALUE_TAG, n])
 *
 * Poseidon rather than SHA-256 precisely because the circuit must be able to
 * recompute this from the private numeric value and constrain it against the
 * leaf. That constraint is what makes `value >= threshold` a statement about the
 * credential instead of about an unrelated number the prover chose.
 *
 * @param value  Non-negative integer below 2^64.
 */
export async function numericValueHash(value: bigint): Promise<bigint> {
  if (value < 0n || value >= MAX_NUMERIC_CLAIM_VALUE) {
    throw new Error('numericValueHash: value must be in [0, 2^64)');
  }
  return poseidonHash([NUMERIC_VALUE_TAG, value]);
}

/** Is this claim committed numerically? */
export function isNumericClaim(claim: Claim): boolean {
  return claim.kind === 'numeric';
}

/**
 * The value half of a claim's commitment, dispatching on its kind.
 *
 * String claims keep the SHA-256 rule unchanged; numeric claims use Poseidon.
 */
export async function claimValueCommitment(claim: Claim): Promise<bigint> {
  return isNumericClaim(claim)
    ? numericValueHash(BigInt(claim.value))
    : claimValueHash(claim.value);
}

// ── claimToLeafValue ──────────────────────────────────────────────────────────

/**
 * Encode a single { name, value } claim as its Merkle leaf VALUE.
 *
 *   leafValue = poseidon([claimNameHash(name), claimValueHash(value)])
 *
 * The circuit recomputes exactly this from its public nameHash and private
 * valueHash, so the leaf a proof commits to is provably the named claim.
 *
 * Uses the shared Poseidon instance from ./merkle so JS and circom cannot drift.
 *
 * @param claim  { name, value } string pair.
 * @returns      BigInt in the range [0, BN254_FIELD_PRIME).
 */
export async function claimToLeafValue(claim: Claim): Promise<bigint> {
  return poseidonHash([
    claimNameHash(claim.name),
    await claimValueCommitment(claim),
  ]);
}

// ── encodeClaimsToLeaves ──────────────────────────────────────────────────────

/**
 * Map an ordered claim array to the corresponding array of BN254 leaf values.
 *
 * The output can be passed directly to buildMerkleTree; each entry is a raw
 * leaf *value* (not a poseidon-hashed leaf) because buildMerkleTree applies
 * poseidon([leafValue]) internally. Keeping that split means merkle.ts and its
 * tests are untouched by the v2 encoding — the circuit absorbs the extra hash.
 *
 * Async since v2: Poseidon is only available once circomlibjs has initialised.
 *
 * @param claims  Ordered claim array (as returned by buildClaimSet).
 * @returns       Parallel array of bigint leaf values in [0, BN254_FIELD_PRIME).
 */
export async function encodeClaimsToLeaves(claims: Claim[]): Promise<bigint[]> {
  return Promise.all(claims.map((c) => claimToLeafValue(c)));
}

// ── rootMessageBytes ──────────────────────────────────────────────────────────

/**
 * Return the canonical byte representation of a Merkle root hex string for
 * issuer signing / verification.
 *
 * The issuer signs `rootMessageBytes(root)` and the verifier checks the
 * signature against the same bytes.  Using UTF-8 encoding of the hex root
 * string as the signed payload keeps the signing and verification paths
 * simple and consistent — both sides call this function.
 *
 * @param root  Merkle root as a hex string (as returned by buildMerkleTree).
 * @returns     UTF-8 encoded bytes of the root string.
 */
export function rootMessageBytes(root: string): Uint8Array {
  return new TextEncoder().encode(root);
}
