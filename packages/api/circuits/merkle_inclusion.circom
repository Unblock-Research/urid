pragma circom 2.1.0;

// -l node_modules/circomlib/circuits resolves these includes
include "poseidon.circom";
include "mux1.circom";
include "comparators.circom";

/*
 * MerkleInclusionProof(depth)
 *
 * Proves Poseidon-Merkle membership matching merkle.ts:
 *   leafHash  = poseidon([leafValue])
 *   nodeHash  = poseidon([leftChild, rightChild])
 *   pathBits[i] = 0  ->  current is left child
 *   pathBits[i] = 1  ->  current is right child
 *
 * Public signals (accessible to verifier):
 *   predicateResult  (output) -- 1 if predicate passes, 0 if fails
 *   root             (input)  -- expected Merkle root
 *   threshold        (input)  -- lower bound for optional predicate; 0 = disabled
 *   predicateEnabled (input)  -- 1 to activate GreaterEqThan check; 0 = skip
 *
 * Private signals (zero-knowledge):
 *   leafValue            -- raw claim field element (SHA-256 mod p from claim-encoding.ts)
 *   pathElements[depth]  -- sibling hashes (merkle.ts: proof.siblings[])
 *   pathIndices[depth]   -- direction bits (merkle.ts: proof.pathBits[])
 */
template MerkleInclusionProof(depth) {
    // -- private ----------------------------------------------------------
    signal input leafValue;
    signal input pathElements[depth];
    signal input pathIndices[depth];    // 0=left, 1=right  (same as merkle.ts pathBits)

    // -- public inputs -----------------------------------------------------
    signal input root;
    signal input threshold;
    signal input predicateEnabled;

    // -- public output -----------------------------------------------------
    signal output predicateResult;

    // -- Constraint: predicateEnabled must be binary ----------------------
    predicateEnabled * (predicateEnabled - 1) === 0;

    // -- Step 1: Hash the leaf ---------------------------------------------
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== leafValue;

    // -- Step 2: Walk the Merkle path -------------------------------------
    signal currentHash[depth + 1];
    currentHash[0] <== leafHasher.out;

    component nodeHasher[depth];
    component nodeMux[depth];

    for (var i = 0; i < depth; i++) {
        //  pathIndices[i] == 0: current is LEFT  -> poseidon([current, sibling])
        //  pathIndices[i] == 1: current is RIGHT -> poseidon([sibling, current])
        nodeMux[i] = MultiMux1(2);

        // Slot 0 -> left argument of poseidon
        nodeMux[i].c[0][0] <== currentHash[i];   // pathIdx=0 -> current goes left
        nodeMux[i].c[0][1] <== pathElements[i];  // pathIdx=1 -> sibling goes left

        // Slot 1 -> right argument of poseidon
        nodeMux[i].c[1][0] <== pathElements[i];  // pathIdx=0 -> sibling goes right
        nodeMux[i].c[1][1] <== currentHash[i];   // pathIdx=1 -> current goes right

        nodeMux[i].s <== pathIndices[i];

        nodeHasher[i] = Poseidon(2);
        nodeHasher[i].inputs[0] <== nodeMux[i].out[0];
        nodeHasher[i].inputs[1] <== nodeMux[i].out[1];
        currentHash[i + 1] <== nodeHasher[i].out;
    }

    // -- Step 3: Root constraint ------------------------------------------
    currentHash[depth] === root;

    // -- Step 4: Optional predicate -- leafValue >= threshold -------------
    //
    // GreaterEqThan(64) internally calls Num2Bits(65), which requires BOTH
    // inputs to be < 2^64.  SHA-256-encoded leaf values (up to ~2^254) would
    // cause Num2Bits(65) to fail even when predicateEnabled=0, because circom
    // evaluates ALL constraints unconditionally.
    //
    // Fix: clamp both comparator inputs to 0 when predicateEnabled=0 by
    // multiplying by predicateEnabled.  predicateEnabled is binary (enforced
    // above), so this product is a valid quadratic constraint.
    //   predicateEnabled=0 -> geq inputs are (0, 0) -> geq.out=1 (0>=0) -> result=1
    //   predicateEnabled=1 -> geq inputs are (leafValue, threshold)
    //     leafValue < 2^64:  works correctly as a numeric predicate
    //     leafValue >= 2^64: Num2Bits rejects (soundness -- large SHA-256
    //       claims must not enable the numeric predicate)
    signal clampedLeaf;
    signal clampedThreshold;
    clampedLeaf      <== predicateEnabled * leafValue;
    clampedThreshold <== predicateEnabled * threshold;

    component geq = GreaterEqThan(64);
    geq.in[0] <== clampedLeaf;
    geq.in[1] <== clampedThreshold;

    // predicateResult = predicateEnabled * geq.out + (1 - predicateEnabled)
    // predicateEnabled=0 -> predicateResult = 1 (always pass)
    // predicateEnabled=1 -> predicateResult = geq.out
    predicateResult <== predicateEnabled * (geq.out - 1) + 1;
}

component main {public [root, threshold, predicateEnabled]} = MerkleInclusionProof(4);
