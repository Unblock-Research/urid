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
    claimValueHash(claim.value),
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
