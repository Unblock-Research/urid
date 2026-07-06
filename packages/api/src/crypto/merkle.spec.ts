/**
 * Poseidon Merkle tree — inclusion-proof tests (circom-compatible).
 *
 * Tests exercise buildMerkleTree, generateInclusionProof, and
 * verifyInclusionProof against the threat register criteria:
 *  - T-01-08: non-member leaf must not verify
 *  - T-01-09: roots are deterministic (same Poseidon params every time)
 *  - T-01-10: field-element equality via Poseidon helpers, not raw numbers
 */

import { describe, it, expect } from 'vitest';
import { buildMerkleTree, generateInclusionProof, verifyInclusionProof } from './merkle';

/** Convenience: a fixed 4-leaf set whose indices span both left and right children. */
const LEAVES = [BigInt(1), BigInt(2), BigInt(3), BigInt(4)];

describe('Poseidon Merkle tree (circom-compatible)', () => {

  // ── 1. Deterministic root ────────────────────────────────────────────────
  it('buildMerkleTree: same leaves in same order yield identical roots (deterministic)', async () => {
    const tree1 = await buildMerkleTree(LEAVES);
    const tree2 = await buildMerkleTree(LEAVES);

    expect(typeof tree1.root).toBe('string');
    expect(tree1.root.length).toBeGreaterThan(0);
    expect(tree1.root).toEqual(tree2.root);
  });

  // ── 2. Different leaf order → different root ─────────────────────────────
  it('buildMerkleTree: different leaf orderings produce different roots', async () => {
    const treeAB = await buildMerkleTree([BigInt(1), BigInt(2)]);
    const treeBA = await buildMerkleTree([BigInt(2), BigInt(1)]);
    expect(treeAB.root).not.toEqual(treeBA.root);
  });

  // ── 3. Member proof — all indices in a 4-leaf tree ───────────────────────
  it('member proof: verifyInclusionProof returns true for every leaf in the tree', async () => {
    const tree = await buildMerkleTree(LEAVES);

    for (let idx = 0; idx < LEAVES.length; idx++) {
      const proof = generateInclusionProof(tree, idx);
      const valid = await verifyInclusionProof(proof.leaf, proof, tree.root);
      expect(valid).toBe(true);
    }
  });

  // ── 4. Non-member negative ───────────────────────────────────────────────
  it('non-member negative: verifyInclusionProof returns false for a leaf NOT in the tree', async () => {
    const tree = await buildMerkleTree(LEAVES);
    const proof = generateInclusionProof(tree, 0); // valid siblings for index 0

    // The leaf hash of 999 is not present in the tree; reusing the proof
    // siblings with the wrong starting leaf will produce a wrong root.
    const nonMemberTree = await buildMerkleTree([BigInt(999)]);
    const nonMemberLeafHash = nonMemberTree.layers[0][0]; // poseidon([999n])

    const valid = await verifyInclusionProof(nonMemberLeafHash, proof, tree.root);
    expect(valid).toBe(false);
  });

  // ── 5. Tamper negative — mutated root ────────────────────────────────────
  it('tamper negative: verifyInclusionProof returns false when the root is mutated', async () => {
    const tree = await buildMerkleTree(LEAVES);
    const proof = generateInclusionProof(tree, 0);

    // Use a completely different tree's root as the "mutated" root.
    const otherTree = await buildMerkleTree([BigInt(999), BigInt(1000), BigInt(1001)]);
    const mutatedRoot = otherTree.root;

    expect(mutatedRoot).not.toEqual(tree.root); // sanity
    const valid = await verifyInclusionProof(proof.leaf, proof, mutatedRoot);
    expect(valid).toBe(false);
  });

  // ── 6. Proof format contains the right number of siblings ────────────────
  it('generateInclusionProof: proof has depth siblings matching tree depth', async () => {
    const tree = await buildMerkleTree(LEAVES);
    const proof = generateInclusionProof(tree, 0);

    expect(proof.siblings).toHaveLength(tree.depth);
    expect(proof.pathBits).toHaveLength(tree.depth);
    // Each pathBit must be 0 (left) or 1 (right)
    for (const bit of proof.pathBits) {
      expect([0, 1]).toContain(bit);
    }
  });

  // ── 7. Single-leaf tree ──────────────────────────────────────────────────
  it('single-leaf tree: buildMerkleTree and inclusion proof work for one leaf', async () => {
    const tree = await buildMerkleTree([BigInt(42)]);
    expect(tree.depth).toBe(1); // padded to 2 leaves → depth 1
    const proof = generateInclusionProof(tree, 0);
    const valid = await verifyInclusionProof(proof.leaf, proof, tree.root);
    expect(valid).toBe(true);
  });

});
