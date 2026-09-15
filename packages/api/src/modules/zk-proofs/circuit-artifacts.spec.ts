/**
 * circuit-artifacts.spec.ts  — ZKP-06 smoke test
 *
 * Verifies that the three committed Groth16 artifacts are loadable and
 * functional using only Node + committed files — the circom compiler is NOT
 * invoked at any point.
 *
 * Covers:
 *   ZKP-06  Artifact existence + JSON parse + nPublic/protocol assertions
 *   ZKP-06  End-to-end fullProve → groth16.verify round-trip
 *   ZKP-06  Public-signal ordering contract, asserted with distinct probe values
 *           so each index is pinned to a specific signal rather than assumed
 *
 * v2 (critical finding #3): the circuit now takes claimNameHash as a PUBLIC input
 * and claimValueHash as a private one, rebuilding the leaf in-circuit. nPublic
 * went 4 -> 5 and every index after [0] shifted by one.
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as snarkjs from 'snarkjs';

import { buildMerkleTree, generateInclusionProof } from '../../crypto/merkle';
import {
  buildClaimSet,
  claimNameHash,
  claimValueHash,
  encodeClaimsToLeaves,
} from '../../crypto/claim-encoding';

// ── Artifact paths ─────────────────────────────────────────────────────────────
//   __dirname = packages/api/src/modules/zk-proofs
//   ../../../circuits  = packages/api/circuits

const CIRCUITS_DIR = path.resolve(__dirname, '../../../circuits');

const WASM_PATH  = path.join(CIRCUITS_DIR, 'merkle_inclusion_js', 'merkle_inclusion.wasm');
const ZKEY_PATH  = path.join(CIRCUITS_DIR, 'merkle_inclusion_final.zkey');
const VKEY_PATH  = path.join(CIRCUITS_DIR, 'verification_key.json');

// Public-signal index constants — v2 ordering: outputs first, then public inputs
// in template declaration order (claimNameHash, root, threshold, predicateEnabled).
const IDX_PREDICATE_RESULT  = 0;
const IDX_CLAIM_NAME_HASH   = 1;
const IDX_ROOT              = 2;
const IDX_THRESHOLD         = 3;
const IDX_PREDICATE_ENABLED = 4;

// ── Circuit depth constant (must match MerkleInclusionProof(4)) ───────────────
const CIRCUIT_DEPTH = 4;
const TREE_SIZE = Math.pow(2, CIRCUIT_DEPTH); // 16

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Convert a variable-length hex string (no 0x prefix) to a decimal string. */
function hexToDecStr(hex: string): string {
  return BigInt('0x' + hex).toString(10);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite 1: Artifact existence + metadata assertions
// ─────────────────────────────────────────────────────────────────────────────

describe('ZKP-06: committed artifact existence and metadata', () => {
  it('WASM artifact exists on disk', () => {
    expect(fs.existsSync(WASM_PATH)).toBe(true);
  });

  it('Proving key (.zkey) exists on disk', () => {
    expect(fs.existsSync(ZKEY_PATH)).toBe(true);
  });

  it('verification_key.json parses as valid JSON', () => {
    const raw = fs.readFileSync(VKEY_PATH, 'utf8');
    expect(() => JSON.parse(raw)).not.toThrow();
  });

  it('verification_key.json has nPublic === 5 (v2 adds claimNameHash)', () => {
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
    expect(vkey.nPublic).toBe(5);
  });

  it('verification_key.json has protocol === "groth16"', () => {
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
    expect(vkey.protocol).toBe('groth16');
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite 2: End-to-end fullProve → verify round-trip
// ─────────────────────────────────────────────────────────────────────────────

describe('ZKP-06: end-to-end Groth16 fullProve → verify round-trip', () => {
  /**
   * Build a minimal but real depth-4 Merkle tree with a mix of real claim
   * field elements and zero padding.  Then prove inclusion of the first claim
   * with predicateEnabled=0 (disabled) so leafValue can exceed 2^64.
   */
  it(
    'produces a valid Groth16 proof that groth16.verify accepts',
    async () => {
      // 1. Build real claim leaf values under the v2 encoding
      const claims = buildClaimSet({
        credentialType: 'AcademicDegree',
        fieldOfStudy:   'Computer Science',
        holderDid:      'did:urid:holder123',
        issuedAt:       '2025-01-01T00:00:00.000Z',
        issuer:         'did:urid:issuer456',
        title:          'Bachelor of Science',
      });
      // leafValue = poseidon([nameHash, valueHash]) for each claim
      const leafValues = await encodeClaimsToLeaves(claims);

      // 2. Pre-pad to exactly 2^4 = 16 leaves so the JS tree depth is fixed at 4
      //    (matches the circuit's MerkleInclusionProof(4))
      //    Insert 0n pad values — buildMerkleTree will hash them as poseidon([0n])
      const paddedLeaves: bigint[] = [...leafValues];
      while (paddedLeaves.length < TREE_SIZE) {
        paddedLeaves.push(0n);
      }
      expect(paddedLeaves).toHaveLength(TREE_SIZE); // sanity

      // 3. Build depth-4 tree
      const tree = await buildMerkleTree(paddedLeaves);
      expect(tree.depth).toBe(CIRCUIT_DEPTH);

      // 4. Generate inclusion proof for index 0 (first claim: credentialType)
      const inclusionProof = generateInclusionProof(tree, 0);
      expect(inclusionProof.siblings).toHaveLength(CIRCUIT_DEPTH);
      expect(inclusionProof.pathBits).toHaveLength(CIRCUIT_DEPTH);

      // 5. Build the witness object (signal names must EXACTLY match .circom).
      //    A distinctive threshold makes the index-mapping assertions below
      //    unambiguous — no two public signals share a value.
      const PROBE_THRESHOLD = '777777';
      const expectedNameHash = claimNameHash(claims[0].name).toString(10);
      const witness = {
        // Private signals
        claimValueHash: claimValueHash(claims[0].value).toString(10),
        // Required since the predicate became numeric. claims[0] is a string
        // claim proven with predicateEnabled=0, so the circuit multiplies the
        // numeric binding constraint out and this filler is never consulted.
        numericValue:   '0',
        pathElements:   inclusionProof.siblings.map(hexToDecStr),
        pathIndices:    inclusionProof.pathBits.map(b => b.toString()),
        // Public signals (also provided as inputs so fullProve can compute output)
        claimNameHash:    expectedNameHash,
        root:             hexToDecStr(tree.root),
        threshold:        PROBE_THRESHOLD,
        predicateEnabled: '0',
      };

      // 6. Generate Groth16 proof (CPU-heavy: ~1-5 s)
      const { proof, publicSignals } = await snarkjs.groth16.fullProve(
        witness,
        WASM_PATH,
        ZKEY_PATH,
      );

      // 7. Load verification key and verify
      const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
      const verified = await snarkjs.groth16.verify(vkey, publicSignals, proof);

      expect(verified).toBe(true);

      // 8. Assert public-signal count
      expect(publicSignals).toHaveLength(5);

      // 9. Assert the full public-signal ordering contract. Every value here is
      //    distinct, so these assertions pin each index to one specific signal.
      expect(publicSignals[IDX_PREDICATE_RESULT]).toBe('1'); // predicate disabled -> passthrough
      expect(publicSignals[IDX_CLAIM_NAME_HASH]).toBe(expectedNameHash);
      expect(BigInt(publicSignals[IDX_ROOT]).toString(16)).toBe(tree.root);
      expect(publicSignals[IDX_THRESHOLD]).toBe(PROBE_THRESHOLD);
      expect(publicSignals[IDX_PREDICATE_ENABLED]).toBe('0');

      // 10. The claim name is now recoverable from the proof alone — this is the
      //     property finding #3 was about. A verifier that is told "this proves
      //     fieldOfStudy" can refute the claim by recomputing the hash.
      expect(publicSignals[IDX_CLAIM_NAME_HASH]).not.toBe(
        claimNameHash('someOtherClaim').toString(10),
      );
    },
    // Groth16 fullProve for ~1500 constraints takes 1-5 s on modern hardware
    30_000,
  );
});
