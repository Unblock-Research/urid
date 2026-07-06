/**
 * claim-encoding.ts — Canonical claim-set builder + BN254 field-element encoder.
 *
 * This module is the shared Phase 5 / Phase 6 leaf-encoding contract.  The Phase 6
 * ZK witness generator must import (or replicate) this module to ensure that the
 * leaf values it feeds into the Poseidon Merkle tree are byte-identical to the
 * values stored on-chain at credential mint time.
 *
 * Leaf-encoding rule (CRYPTO-NOTES.md section 3):
 *   leafValue = BigInt( sha256( canonicalJSON({ name, value }) ) ) mod BN254_FIELD_PRIME
 *
 * The encoder returns raw leaf *values* (mod-p bigints).  buildMerkleTree
 * applies poseidon([leafValue]) internally — callers must NOT pre-hash.
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
import { canonicalize } from '../ledger/canonical';

// ── BN254 field prime ─────────────────────────────────────────────────────────

/**
 * BN254 scalar field prime, as recorded in CRYPTO-NOTES.md section 1.
 * All leaf values must be reduced modulo this prime before being fed into
 * buildMerkleTree.
 */
export const BN254_FIELD_PRIME: bigint =
  BigInt('0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001');

// ── Types ─────────────────────────────────────────────────────────────────────

/** A single semantic claim: a name–value string pair. */
export interface Claim {
  name: string;
  value: string;
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
    claims.push({ name: field, value: String(val) });
  }

  return claims;
}

// ── claimToFieldElement ───────────────────────────────────────────────────────

/**
 * Encode a single { name, value } claim as a BN254 field element.
 *
 * Algorithm (CRYPTO-NOTES.md section 3):
 *   1. Canonicalize the claim object with stable-key-order JSON.
 *   2. Compute the SHA-256 hash of the UTF-8 encoded canonical string.
 *   3. Interpret the 32-byte hash as a big-endian unsigned integer.
 *   4. Reduce modulo BN254_FIELD_PRIME to bring the value into [0, p).
 *
 * @param claim  { name, value } string pair.
 * @returns      BigInt in the range [0, BN254_FIELD_PRIME).
 */
export function claimToFieldElement(claim: Claim): bigint {
  // Canonicalize with stable key order (reuses ledger/canonical so Phase 6
  // is byte-identical — do NOT inline a different serializer here).
  const json = canonicalize({ name: claim.name, value: claim.value });

  // SHA-256 hash of the UTF-8 canonical JSON bytes
  const hashBytes = sha256(new TextEncoder().encode(json));

  // Convert 32-byte hash to a hex string, then to a BigInt (big-endian)
  const hashHex = bytesToHex(hashBytes);
  const hashBigInt = BigInt('0x' + hashHex);

  // Reduce mod p to guarantee the result is a valid BN254 field element
  return hashBigInt % BN254_FIELD_PRIME;
}

// ── encodeClaimsToLeaves ──────────────────────────────────────────────────────

/**
 * Map an ordered claim array to the corresponding array of BN254 leaf values.
 *
 * The output can be passed directly to buildMerkleTree; each entry is a raw
 * leaf *value* (not a poseidon-hashed leaf) because buildMerkleTree applies
 * poseidon([leafValue]) internally.
 *
 * @param claims  Ordered claim array (as returned by buildClaimSet).
 * @returns       Parallel array of bigint leaf values in [0, BN254_FIELD_PRIME).
 */
export function encodeClaimsToLeaves(claims: Claim[]): bigint[] {
  return claims.map(claimToFieldElement);
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
