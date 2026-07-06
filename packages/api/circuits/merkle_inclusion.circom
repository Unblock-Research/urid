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
    // IMPORTANT: GreaterEqThan(64) requires leafValue < 2^64.
    // For sha256-encoded claims (leafValue up to ~2^254), always set
    // threshold=0 and predicateEnabled=0.  The predicate is meaningful
    // only when the claim was encoded as a small integer (< 2^64).
    component geq = GreaterEqThan(64);
    geq.in[0] <== leafValue;
    geq.in[1] <== threshold;

    // predicateResult = predicateEnabled * geq.out + (1 - predicateEnabled)
    // predicateEnabled=0 -> predicateResult = 1 (always pass)
    // predicateEnabled=1 -> predicateResult = geq.out
    predicateResult <== predicateEnabled * (geq.out - 1) + 1;
}

component main {public [root, threshold, predicateEnabled]} = MerkleInclusionProof(4);
