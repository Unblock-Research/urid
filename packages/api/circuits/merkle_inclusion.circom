pragma circom 2.1.0;

// -l node_modules/circomlib/circuits resolves these includes
include "poseidon.circom";
include "mux1.circom";
include "comparators.circom";

/*
 * MerkleInclusionProof(depth, numericTag)
 *
 * Proves Poseidon-Merkle membership of a NAMED claim, matching claim-encoding.ts
 * and merkle.ts:
 *   leafValue = poseidon([claimNameHash, claimValueHash])   <- claim-encoding.ts v2
 *   leafHash  = poseidon([leafValue])                       <- merkle.ts buildMerkleTree
 *   nodeHash  = poseidon([leftChild, rightChild])
 *   pathBits[i] = 0  ->  current is left child
 *   pathBits[i] = 1  ->  current is right child
 *
 * WHY claimNameHash IS PUBLIC (critical finding #3):
 *   The previous version took the whole claim as one private `leafValue` signal
 *   and published only [root, threshold, predicateEnabled]. Nothing in the public
 *   output identified WHICH claim had been proven, so a valid proof established
 *   no more than "the prover knows some leaf under this root" — a bar any holder
 *   clears, including with one of the padding zeros. The claim name recorded
 *   alongside the proof was database metadata, not something the proof attested.
 *
 *   Publishing claimNameHash and reconstructing the leaf inside the circuit binds
 *   the proof to a specific claim: a verifier recomputes the hash of the claim
 *   name it was told and checks it against the public signal. The value half stays
 *   private, so disclosure remains selective.
 *
 * Public signals (accessible to verifier), in witness order:
 *   [0] predicateResult  (output) -- 1 if predicate passes, 0 if fails
 *   [1] claimNameHash    (input)  -- identifies WHICH claim this proof is about
 *   [2] root             (input)  -- expected Merkle root
 *   [3] threshold        (input)  -- lower bound for optional predicate; 0 = disabled
 *   [4] predicateEnabled (input)  -- 1 to activate GreaterEqThan check; 0 = skip
 *
 * Template parameter:
 *   numericTag -- the NUMERIC_VALUE_TAG constant from claim-encoding.ts, baked in
 *                 as a compile-time literal so JS and circom cannot disagree on
 *                 the numeric-commitment domain. Regenerate both together.
 *
 * Private signals (zero-knowledge):
 *   claimValueHash       -- commitment to the claim's value (claim-encoding.ts)
 *   numericValue         -- the claim's numeric value, when the predicate is used
 *   pathElements[depth]  -- sibling hashes (merkle.ts: proof.siblings[])
 *   pathIndices[depth]   -- direction bits (merkle.ts: proof.pathBits[])
 */
template MerkleInclusionProof(depth, numericTag) {
    // -- private ----------------------------------------------------------
    signal input claimValueHash;
    signal input numericValue;          // meaningful only when predicateEnabled=1
    signal input pathElements[depth];
    signal input pathIndices[depth];    // 0=left, 1=right  (same as merkle.ts pathBits)

    // -- public inputs -----------------------------------------------------
    // Declaration order here determines publicSignals order after the outputs.
    signal input claimNameHash;
    signal input root;
    signal input threshold;
    signal input predicateEnabled;

    // -- public output -----------------------------------------------------
    signal output predicateResult;

    // -- Constraint: predicateEnabled must be binary ----------------------
    predicateEnabled * (predicateEnabled - 1) === 0;

    // -- Step 1: Rebuild the claim's leaf value from its two halves --------
    // This is the constraint that binds the public claim name to the private
    // value: the prover cannot pair a published name with some other claim's
    // value and still land on a leaf that is in the tree.
    component claimHasher = Poseidon(2);
    claimHasher.inputs[0] <== claimNameHash;
    claimHasher.inputs[1] <== claimValueHash;

    // -- Step 2: Hash the leaf --------------------------------------------
    // merkle.ts applies poseidon([leafValue]) when building the tree, so the
    // circuit must apply it too.
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== claimHasher.out;

    // -- Step 3: Walk the Merkle path -------------------------------------
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

    // -- Step 4: Root constraint ------------------------------------------
    currentHash[depth] === root;

    // -- Step 5: Optional predicate -- numericValue >= threshold -----------
    //
    // WHAT CHANGED AND WHY:
    //   This previously compared claimValueHash (a SHA-256-derived element of
    //   size ~2^254) against the threshold. That was never a usable statement:
    //   GreaterEqThan(64) requires both inputs below 2^64, so enabling the
    //   predicate on any real claim failed witness generation, and had it
    //   succeeded it would have compared a hash, not a value.
    //
    //   A numeric claim commits its value as
    //       claimValueHash = poseidon([numericTag, numericValue])
    //   which the circuit CAN recompute (Poseidon is cheap here; SHA-256 is not).
    //   Constraining that recomputation to equal the claimValueHash that feeds
    //   the leaf is what binds the comparison to the credential: a prover cannot
    //   supply some other numericValue without breaking Merkle membership.
    //
    // The binding is enforced only when the predicate is switched on. String
    // claims commit their value with SHA-256, so for them this equality cannot
    // hold and multiplying by predicateEnabled is what lets them prove
    // membership without engaging the numeric path at all.
    component numericHasher = Poseidon(2);
    numericHasher.inputs[0] <== numericTag;
    numericHasher.inputs[1] <== numericValue;

    // predicateEnabled=1 -> numericHasher.out must equal claimValueHash
    // predicateEnabled=0 -> constraint is vacuous
    (numericHasher.out - claimValueHash) * predicateEnabled === 0;

    // Clamp both comparator inputs to 0 when the predicate is disabled, so
    // Num2Bits(65) never sees an out-of-range value. circom evaluates every
    // constraint unconditionally, so without this a disabled predicate would
    // still be constrained by the comparator.
    //   predicateEnabled=0 -> geq inputs are (0, 0) -> geq.out=1 -> result=1
    //   predicateEnabled=1 -> geq inputs are (numericValue, threshold), both of
    //     which must be < 2^64; claim-encoding.ts enforces that bound at mint.
    signal clampedValue;
    signal clampedThreshold;
    clampedValue     <== predicateEnabled * numericValue;
    clampedThreshold <== predicateEnabled * threshold;

    component geq = GreaterEqThan(64);
    geq.in[0] <== clampedValue;
    geq.in[1] <== clampedThreshold;

    // predicateResult = predicateEnabled * geq.out + (1 - predicateEnabled)
    // predicateEnabled=0 -> predicateResult = 1 (always pass)
    // predicateEnabled=1 -> predicateResult = geq.out
    predicateResult <== predicateEnabled * (geq.out - 1) + 1;
}

// numericTag must equal NUMERIC_VALUE_TAG in src/crypto/claim-encoding.ts.
// claim-encoding.spec.ts asserts the two match, so a change on either side that
// is not mirrored fails the suite rather than silently breaking every proof.
component main {public [claimNameHash, root, threshold, predicateEnabled]} =
    MerkleInclusionProof(4, 9875350050016818564111178388263033158520350153331699653473683684489562362709);
