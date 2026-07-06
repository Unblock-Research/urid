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
 *   ZKP-06  Public-signal ordering contract (root === publicSignals[1])
 */

import { describe, it, expect } from 'vitest';
import * as path from 'path';
import * as fs from 'fs';
import * as snarkjs from 'snarkjs';

import { buildMerkleTree, generateInclusionProof } from '../../crypto/merkle';
import { claimToFieldElement, buildClaimSet } from '../../crypto/claim-encoding';

// ── Artifact paths ─────────────────────────────────────────────────────────────
//   __dirname = packages/api/src/modules/zk-proofs
//   ../../../circuits  = packages/api/circuits

const CIRCUITS_DIR = path.resolve(__dirname, '../../../circuits');

const WASM_PATH  = path.join(CIRCUITS_DIR, 'merkle_inclusion_js', 'merkle_inclusion.wasm');
const ZKEY_PATH  = path.join(CIRCUITS_DIR, 'merkle_inclusion_final.zkey');
const VKEY_PATH  = path.join(CIRCUITS_DIR, 'verification_key.json');

// Public-signal index constants (matches Pattern 5 in 06-RESEARCH.md)
const IDX_PREDICATE_RESULT = 0;
const IDX_ROOT             = 1;
const IDX_THRESHOLD        = 2;
const IDX_PREDICATE_ENABLED = 3;

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

  it('verification_key.json has nPublic === 4', () => {
    const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
    expect(vkey.nPublic).toBe(4);
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
      // 1. Build some real claim leaf values
      const claims = buildClaimSet({
        credentialType: 'AcademicDegree',
        fieldOfStudy:   'Computer Science',
        holderDid:      'did:urid:holder123',
        issuedAt:       '2025-01-01T00:00:00.000Z',
        issuer:         'did:urid:issuer456',
        title:          'Bachelor of Science',
      });
      // encodes all 6 claims to leaf values
      const leafValues = claims.map(c => claimToFieldElement(c));

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

      // 5. Build the witness object (signal names must EXACTLY match .circom)
      //    Hex siblings and root converted to decimal strings per Pattern 6.
      const witness = {
        // Private signals
        leafValue:    paddedLeaves[0].toString(10),
        pathElements: inclusionProof.siblings.map(hexToDecStr),
        pathIndices:  inclusionProof.pathBits.map(b => b.toString()),
        // Public signals (also provided as inputs so fullProve can compute output)
        root:             hexToDecStr(tree.root),
        threshold:        '0',
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
      expect(publicSignals).toHaveLength(4);

      // 9. Assert public-signal ordering contract:
      //    publicSignals[IDX_ROOT] must equal the tree root.
      //    Both sides must be compared in the same representation — we convert
      //    the decimal publicSignals[1] back to hex and compare with tree.root.
      const rootFromSignals = BigInt(publicSignals[IDX_ROOT]).toString(16);
      expect(rootFromSignals).toBe(tree.root);

      // 10. predicateEnabled=0 -> predicateResult must be 1 (passthrough)
      expect(publicSignals[IDX_PREDICATE_RESULT]).toBe('1');

      // 11. threshold and predicateEnabled echoed back
      expect(publicSignals[IDX_THRESHOLD]).toBe('0');
      expect(publicSignals[IDX_PREDICATE_ENABLED]).toBe('0');
    },
    // Groth16 fullProve for ~1263 constraints takes 1-5 s on modern hardware
    30_000,
  );
});
