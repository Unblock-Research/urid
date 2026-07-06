/**
 * Poseidon Merkle tree primitives — circom-compatible.
 *
 * Uses circomlibjs buildPoseidon over the BN254 scalar field, which is the
 * same Poseidon hash that circom's `poseidon()` template uses.  The Phase 6
 * circuit and this JS code therefore agree on every Merkle root.
 *
 * Design choices (see CRYPTO-NOTES.md for the full spec):
 *  - Arity 2 (binary tree)
 *  - Leaf hash   = poseidon([leafValue])
 *  - Node hash   = poseidon([leftChild, rightChild])   (ordered pair)
 *  - Padding     = poseidon([0n]) sentinel, padded to the next power of two
 *  - Root stored as a variable-length hex string (F.toString(fe, 16))
 *  - All internal field-element comparisons use Poseidon's F helper (F.eq /
 *    F.toString), never raw JS numbers, to avoid cross-platform bigint issues
 */

// circomlibjs has no bundled TS declarations; use require to stay within the
// CommonJS target and avoid a dynamic-import wrapping issue.
/* eslint-disable @typescript-eslint/no-var-requires */
const circomlibjs = require('circomlibjs');
/* eslint-enable @typescript-eslint/no-var-requires */

// ── Types ──────────────────────────────────────────────────────────────────

/** A field element in Montgomery representation (Uint8Array, 32 bytes). */
type FieldElement = Uint8Array;

/**
 * A built Merkle tree.
 *
 * `layers[0]`        — padded leaf hashes (length = 2^depth), as hex strings
 * `layers[depth]`    — `[root]`
 * `root`             — the root field element as a hex string
 * `depth`            — number of levels above the leaf layer
 */
export interface MerkleTree {
  /** Merkle root as a hex string (variable length, no 0x prefix). */
  root: string;
  /**
   * All layers of the tree.
   * layers[0] = leaf-hash strings (padded to 2^depth).
   * layers[depth] = [root string].
   */
  layers: string[][];
  /** Number of hash steps from a leaf to the root. */
  depth: number;
}

/**
 * Inclusion proof for a single leaf.
 *
 * Compatible with circomlib's MerkleProof template conventions:
 *   pathBits[i] = 0  →  current node is the LEFT child  (sibling is right)
 *   pathBits[i] = 1  →  current node is the RIGHT child (sibling is left)
 */
export interface InclusionProof {
  /** Hex-string hash of the leaf (poseidon([leafValue])). */
  leaf: string;
  /** Position of the leaf in the padded layer. */
  leafIndex: number;
  /** Sibling hashes at each level, from leaf level up to just below the root. */
  siblings: string[];
  /**
   * Position flags at each level (0 = current is left, 1 = current is right).
   * Used to reconstruct the node hash order during verification.
   */
  pathBits: number[];
}

// ── Poseidon singleton ─────────────────────────────────────────────────────

let _poseidon: ((inputs: (FieldElement | bigint)[]) => FieldElement) | null = null;
let _F: {
  e: (value: bigint | number) => FieldElement;
  toObject: (fe: FieldElement) => bigint;
  toString: (fe: FieldElement, radix?: number) => string;
  eq: (a: FieldElement, b: FieldElement) => boolean;
} | null = null;

/**
 * Lazily initialise the Poseidon instance (async, paid once).
 * Safe to call concurrently — the promise resolves to the same instance.
 */
async function getPoseidon() {
  if (!_poseidon) {
    const instance = await circomlibjs.buildPoseidon();
    _poseidon = instance;
    _F = instance.F;
  }
  return { poseidon: _poseidon!, F: _F! };
}

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Convert a hex string (as stored in MerkleTree / InclusionProof) back to a
 * field element Uint8Array so it can be passed to poseidon().
 *
 * F.e() accepts a BigInt and returns the element in Montgomery form.
 * We prepend '0x' so JS's BigInt() constructor parses the hex correctly.
 */
function hexToFe(hex: string, F: typeof _F): FieldElement {
  return F!.e(BigInt('0x' + hex));
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Build a binary Poseidon Merkle tree from an array of leaf values.
 *
 * Each leaf is hashed as poseidon([value]).
 * Internal nodes are hashed as poseidon([left, right]).
 * The leaf array is padded to the next power of two using the zero sentinel
 * poseidon([0n]) so the depth is always well-defined.
 *
 * @param leaves  Array of BN254 field-range BigInt claim values (≥ 1 element).
 * @returns       MerkleTree with root, all layers as hex strings, and depth.
 */
export async function buildMerkleTree(leaves: bigint[]): Promise<MerkleTree> {
  const { poseidon, F } = await getPoseidon();

  if (leaves.length === 0) {
    throw new Error('buildMerkleTree: leaves must be non-empty');
  }

  // Zero sentinel (padding leaf) = poseidon([0])
  const zeroSentinel: FieldElement = poseidon([BigInt(0)]);

  // Hash each leaf
  const leafFeArray: FieldElement[] = leaves.map((v) => poseidon([v]));

  // Determine depth and pad to the next power of two
  const depth = Math.max(1, Math.ceil(Math.log2(leafFeArray.length)));
  const targetLength = Math.pow(2, depth);
  while (leafFeArray.length < targetLength) {
    leafFeArray.push(zeroSentinel);
  }

  // Build layers: layers[0] = leaf hashes, layers[depth] = [root]
  const feLayers: FieldElement[][] = [leafFeArray];
  while (feLayers[feLayers.length - 1].length > 1) {
    const prev = feLayers[feLayers.length - 1];
    const next: FieldElement[] = [];
    for (let i = 0; i < prev.length; i += 2) {
      next.push(poseidon([prev[i], prev[i + 1]]));
    }
    feLayers.push(next);
  }

  // Convert every field element to a hex string for stable serialisation
  const hexLayers = feLayers.map((layer) =>
    layer.map((fe) => F.toString(fe, 16)),
  );

  const root = hexLayers[hexLayers.length - 1][0];

  return { root, layers: hexLayers, depth };
}

/**
 * Generate an inclusion proof for the leaf at `leafIndex`.
 *
 * The proof contains the sibling hashes and path-direction bits required to
 * reconstruct the root from the leaf hash.  Compatible with circomlib's
 * MerkleProof template: pathBits[i] = 0 means current node is the left child.
 *
 * @param tree       A tree built by buildMerkleTree.
 * @param leafIndex  Index of the leaf in the padded layer (0-based).
 */
export function generateInclusionProof(
  tree: MerkleTree,
  leafIndex: number,
): InclusionProof {
  if (leafIndex < 0 || leafIndex >= tree.layers[0].length) {
    throw new Error(
      `generateInclusionProof: leafIndex ${leafIndex} out of range [0, ${tree.layers[0].length - 1}]`,
    );
  }

  const siblings: string[] = [];
  const pathBits: number[] = [];
  let currentIndex = leafIndex;

  for (let level = 0; level < tree.depth; level++) {
    const isLeftChild = currentIndex % 2 === 0;
    const siblingIndex = isLeftChild ? currentIndex + 1 : currentIndex - 1;

    siblings.push(tree.layers[level][siblingIndex]);
    // 0 = current is left child, sibling is on the right
    // 1 = current is right child, sibling is on the left
    pathBits.push(isLeftChild ? 0 : 1);

    currentIndex = Math.floor(currentIndex / 2);
  }

  return {
    leaf: tree.layers[0][leafIndex],
    leafIndex,
    siblings,
    pathBits,
  };
}

/**
 * Verify an inclusion proof against the given Merkle root.
 *
 * Reconstructs the root by hashing the leaf up the sibling path using the
 * poseidon([left, right]) node-hash rule and comparing the result to `root`.
 * Field-element equality uses F.toString for a canonical comparison, avoiding
 * any raw-number comparison pitfall (T-01-10).
 *
 * @param leaf   Hex-string leaf hash (poseidon([leafValue])) as returned by
 *               generateInclusionProof or tree.layers[0][idx].
 * @param proof  InclusionProof containing siblings and pathBits.
 * @param root   Expected Merkle root as a hex string.
 * @returns      true if the leaf is a member of the tree whose root is `root`.
 */
export async function verifyInclusionProof(
  leaf: string,
  proof: InclusionProof,
  root: string,
): Promise<boolean> {
  const { poseidon, F } = await getPoseidon();

  // Convert hex strings to field elements
  let current: FieldElement = hexToFe(leaf, F);

  for (let i = 0; i < proof.siblings.length; i++) {
    const sibling: FieldElement = hexToFe(proof.siblings[i], F);
    if (proof.pathBits[i] === 0) {
      // current is left child
      current = poseidon([current, sibling]);
    } else {
      // current is right child
      current = poseidon([sibling, current]);
    }
  }

  // Compare the reconstructed root to the expected root using canonical hex
  // strings (F.toString), NOT raw BigInt or Uint8Array equality, to satisfy
  // the T-01-10 mitigation.
  const computedRoot = F.toString(current, 16);
  return computedRoot === root;
}
