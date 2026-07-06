# Phase 6: zk-SNARK Selective Disclosure — Research

**Researched:** 2026-07-07
**Domain:** Groth16 zk-SNARK, circom 2.x, circomlib Poseidon/Merkle, snarkjs 0.7.x, NestJS TypeScript integration
**Confidence:** HIGH (circuit patterns from official iden3 repos; snarkjs API verified against source; Merkle contract verified against codebase)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- **Toolchain:** `circom` 2.x compiler (installed from source via cargo), `snarkjs` (npm dep, Groth16), `circomlib` (npm — provides `poseidon.circom`, comparators). Trusted setup: Groth16 with a Powers-of-Tau. Compile + setup at build time; COMMIT the resulting artifacts (`.wasm`, final `.zkey`, `verification_key.json`) so runtime prove/verify need no compiler.
- **Circuit boundary:** Merkle inclusion (fixed depth) + optional numeric predicate (e.g. value ≥ threshold via a circomlib comparator). NO signature verification inside the circuit.
- **Witness source:** `prove()` rebuilds the credential's Merkle tree from its stored `claims` (reusing `crypto/claim-encoding.ts` + `merkle.ts` so leaves/paths are byte-identical), extracts the inclusion path for the disclosed claim, and feeds `{root, leaf/path, predicate params}` to `groth16.fullProve` with the committed `.wasm` + `.zkey`.
- **Storage:** store the real `proof` (JSON) + `publicSignals` (JSON) + `circuitId` + `disclosedClaims` + `verified` on the `ZkProof` row. Keep `proofHash` as a lookup key derived from the proof, not from `sha256(JSON.stringify(data))`.
- **verify():** run `snarkjs.groth16.verify(verificationKey, publicSignals, proof)`; public signals must include the credential's Merkle `root`; then INDEPENDENTLY verify the issuer Ed25519 signature over that root. Both must pass. A tampered/forged proof or a non-member claim must fail. Delete the `sha256` proof generation.
- **Negative test is MANDATORY:** a proof for a claim NOT in the tree (or a mutated public signal) must fail verification.

### Claude's Discretion (inform with the researcher's findings)
- Exact circuit shape: single disclosed leaf per proof vs. fixed-arity multi-leaf; whether the disclosed value is a public signal (pure disclosure) or private with only a predicate boolean public (predicate proof). RECOMMENDED starting point: one circuit proving inclusion of one leaf at a fixed Merkle depth, with an optional `GreaterEqThan` predicate on the leaf's numeric value; `root` (and threshold/predicate result) public. Keep it the SIMPLEST design that satisfies ZKP-01/02/03; multiple disclosed claims can be multiple proofs.
- Fixed Merkle depth to support (e.g. depth 4 → up to 16 claims); pad the tree deterministically (matching CRYPTO-NOTES zero-sentinel padding).
- Powers-of-Tau strategy: generate a small `.ptau` at build time with a fixed contribution (repeatable-ish), OR vendor a small standard ptau. Prefer generating a small one in a build script so no large download is needed.
- Where circuit sources + build script live (e.g. `packages/api/circuits/` + a `build-circuit` npm script) and how artifacts are referenced at runtime.
- `pathIndices` orientation must match `merkle.ts`'s left/right convention exactly.

### Deferred Ideas (OUT OF SCOPE)
- On-chain (Solidity/Move) verifier contract from snarkjs `zkey export solidityverifier` — v2 (CHN-01/02).
- Multi-claim single-proof aggregation / range proofs beyond a simple threshold — future.
- Full Zod DTO hardening — Phase 8.
</user_constraints>

---

## Summary

Phase 6 replaces the `sha256(JSON.stringify(...))` stub in `zk-proofs.service.ts` with a real Groth16 zk-SNARK. The circuit proves that a prover knows a `leafValue` whose Poseidon hash lies on a Merkle path leading to a public `root`, using the exact same binary-tree / `poseidon([leafValue])` / `poseidon([left, right])` convention already implemented in `packages/api/src/crypto/merkle.ts`. An optional numeric predicate (`leafValue >= threshold`) is included as a passthrough (threshold=0 disables it). The Ed25519 issuer signature check on the root stays in plain TypeScript, outside the circuit.

The toolchain is entirely available: `circom 2.2.3` is installed, `snarkjs 0.7.6` is the current npm release, `circomlib 2.0.5` provides Poseidon and comparator templates, and `circomlibjs 0.1.7` is already in `packages/api/package.json`. The build script generates a small Powers-of-Tau (power 12, ~4096 constraints max), performs circuit compilation, Groth16 setup, a single deterministic contribution, and exports the verification key. All three artifacts (`.wasm`, `.zkey`, `verification_key.json`) are committed so the test suite and runtime require only `node` — no `circom` on the server.

**Primary recommendation:** Use a fixed-depth-4 binary Poseidon Merkle circuit (supports up to 16 claims). Public inputs: `root`, `threshold`, `predicateEnabled`. Public output: `predicateResult`. Private: `leafValue`, `pathElements[4]`, `pathIndices[4]`. Derive witnesses by reusing `claimToFieldElement` + `buildMerkleTree` + `generateInclusionProof` from the existing `crypto/` layer.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Circuit definition + trusted setup | Build script (`packages/api/circuits/`) | — | Compile-time artefact; must not run at request time |
| Witness generation (Merkle path) | API Service (`ZkProofsService`) | `crypto/merkle.ts` + `crypto/claim-encoding.ts` | Reconstructs tree from credential claims at prove time |
| Groth16 prove (`fullProve`) | API Service (`ZkProofsService`) | snarkjs library | CPU-intensive; must run in the Node.js process (no browser) |
| Groth16 verify (`groth16.verify`) | API Service (`ZkProofsService`) | snarkjs library | Called by `verify()` endpoint |
| Ed25519 signature check (root binding) | API Service (`ZkProofsService`) | `@noble/ed25519` | Outside the circuit; verifies issuer signed the root |
| Proof persistence | Database (`ZkProof` Prisma model) | — | Stores JSON proof + publicSignals + circuitId |
| Circuit artifact loading | API Service (startup singleton) | `fs.readFileSync` / JSON.parse | Load `verification_key.json` once at service init |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| `snarkjs` | 0.7.6 | Groth16 prove + verify JS API; CLI for trusted setup | Official iden3 library; canonical Groth16 implementation [VERIFIED: npm registry] |
| `circomlib` | 2.0.5 | `poseidon.circom`, `mux1.circom`, `comparators.circom` circuit templates | Official iden3 template library; same Poseidon params as `circomlibjs` [VERIFIED: npm registry] |
| `circom` | 2.2.3 (installed) | Circuit compiler (build-time only) | Compiles `.circom` → `.r1cs` + `.wasm` [VERIFIED: binary on PATH] |
| `circomlibjs` | 0.1.7 (already installed) | JS Poseidon for witness generation (JS-side hashing) | Already in package.json; guarantees param match with circomlib circuit [VERIFIED: npm registry] |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| `@noble/ed25519` | 2.3.0 (already installed) | Issuer signature verification (outside circuit) | In `verify()` to bind proof to genuinely-issued credential |
| `@noble/hashes` | 1.8.0 (already installed) | SHA-256 in `claimToFieldElement` | Already used in `claim-encoding.ts` — no new dep needed |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| snarkjs Groth16 | PLONK (snarkjs supports it) | Groth16 locked per CONTEXT.md; PLONK has no trusted setup but larger proofs |
| circomlib `Poseidon(n)` | Hand-rolled Poseidon | Never hand-roll — param mismatch breaks all proofs |
| Fixed-depth-4 circuit | Sparse Merkle Tree (SMT) | SMT is more complex; fixed depth is sufficient for ≤16 claims per credential |

**Installation (build-time deps only — runtime already has what it needs):**
```bash
# From packages/api/
npm install snarkjs circomlib
```

`circomlibjs` is already present. `circom` binary is already installed.

**Version verification (performed this session):**
```
snarkjs: 0.7.6  (published 2026-01-12)
circomlib: 2.0.5  (published 2022-06-17)
circomlibjs: 0.1.7  (published 2022-07-15)
circom: 2.2.3  (binary on PATH)
```

---

## Package Legitimacy Audit

| Package | Registry | Age | Downloads | Source Repo | Verdict | Disposition |
|---------|----------|-----|-----------|-------------|---------|-------------|
| `snarkjs` | npm | ~5 yrs | 70,157/wk | github.com/iden3/snarkjs | OK | Approved |
| `circomlib` | npm | ~4 yrs | 21,760/wk | github.com/iden3/circomlib | OK | Approved |

**Packages removed due to [SLOP] verdict:** none
**Packages flagged as suspicious [SUS]:** none

*Both packages are the official iden3 organization repositories; the same organization that authors the circom compiler.*

---

## Architecture Patterns

### System Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────┐
│  BUILD TIME  (npm run build-circuit)                             │
│                                                                  │
│  circuit.circom  ──circom──►  circuit.r1cs + circuit_js/*.wasm  │
│  pot12_final.ptau ──snarkjs groth16 setup──►  circuit_0000.zkey  │
│  circuit_0000.zkey ──snarkjs zkey contribute──► circuit_final.zkey│
│  circuit_final.zkey ──snarkjs zkey export vk──► verification_key.json│
│                                                                  │
│  Committed: *.wasm  circuit_final.zkey  verification_key.json   │
└──────────────────────────────────────────────────────────────────┘
                              │
                              │  loaded at service init
                              ▼
┌─────────────────────────────────────────────────────────────────────┐
│  RUNTIME — ZkProofsService.prove(credentialId, claimName, predicate)│
│                                                                      │
│  1. Load SoulboundToken (merkleRoot + claims) from Prisma            │
│  2. claimToFieldElement(claim) → leafValue  [claim-encoding.ts]      │
│  3. encodeClaimsToLeaves(allClaims) + pad to 2^4 → 16 leaves         │
│  4. buildMerkleTree(leaves) → tree  [merkle.ts]                      │
│  5. generateInclusionProof(tree, leafIndex) → {siblings, pathBits}   │
│  6. Format witness: { leafValue, pathElements, pathIndices,          │
│                       root, threshold, predicateEnabled }            │
│  7. snarkjs.groth16.fullProve(witness, *.wasm, circuit_final.zkey)   │
│        → { proof, publicSignals }                                    │
│  8. Persist to ZkProof row                                           │
└─────────────────────────────────────────────────────────────────────┘
                              │
                              │  verify()
                              ▼
┌──────────────────────────────────────────────────────────────┐
│  RUNTIME — ZkProofsService.verify(proofId)                   │
│                                                              │
│  1. Load ZkProof row → { proof, publicSignals }              │
│  2. Load verification_key.json (cached)                      │
│  3. snarkjs.groth16.verify(vKey, publicSignals, proof)       │
│        → true/false                                          │
│  4. Extract root = publicSignals[0]  (see signal order)      │
│  5. Load SoulboundToken.issuerSignature + issuerPublicKey    │
│  6. @noble/ed25519.verify(sig, rootMessageBytes(root), pubKey)│
│        → true/false                                          │
│  7. valid = step3 AND step6                                  │
└──────────────────────────────────────────────────────────────┘
```

### Recommended Project Structure

```
packages/api/
├── circuits/
│   ├── merkle_inclusion.circom          # Circuit source
│   ├── merkle_inclusion_js/
│   │   └── merkle_inclusion.wasm        # COMMITTED artifact
│   ├── merkle_inclusion.r1cs            # (can gitignore — only needed for setup)
│   ├── merkle_inclusion_final.zkey      # COMMITTED artifact
│   ├── verification_key.json            # COMMITTED artifact
│   └── pot12_final.ptau                 # (can gitignore — large, rebuild-able)
├── scripts/
│   └── build-circuit.sh                 # Idempotent build script
└── src/
    └── modules/
        └── zk-proofs/
            ├── zk-proofs.service.ts     # prove() + verify() rewrite
            ├── zk-proofs.module.ts
            └── zk-proofs.controller.ts
```

---

### Pattern 1: Circuit Source — Fixed-Depth-4 Poseidon Merkle + Optional Predicate

**What:** A circom 2.1.0 template for Merkle membership proof matching `merkle.ts` exactly.
**When to use:** Depth 4 supports up to 16 leaves (2^4). The tree must be pre-padded to exactly 16 leaves with the zero sentinel before calling `buildMerkleTree` — otherwise the root won't match.

**Signal ordering (determines `publicSignals` array indices):**
- circom places public outputs first, then public inputs (in declaration order)
- `predicateResult` is the output → `publicSignals[0]`
- `root`, `threshold`, `predicateEnabled` are public inputs (in that order) → `publicSignals[1]`, `publicSignals[2]`, `publicSignals[3]`

**File: `packages/api/circuits/merkle_inclusion.circom`**

```circom
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
 *   pathBits[i] = 0  →  current is left child
 *   pathBits[i] = 1  →  current is right child
 *
 * Public signals (accessible to verifier):
 *   predicateResult  (output) — 1 if predicate passes, 0 if fails
 *   root             (input)  — expected Merkle root
 *   threshold        (input)  — lower bound for optional predicate; 0 = disabled
 *   predicateEnabled (input)  — 1 to activate GreaterEqThan check; 0 = skip
 *
 * Private signals (zero-knowledge):
 *   leafValue            — raw claim field element (SHA-256 mod p from claim-encoding.ts)
 *   pathElements[depth]  — sibling hashes (merkle.ts: proof.siblings[])
 *   pathIndices[depth]   — direction bits (merkle.ts: proof.pathBits[])
 */
template MerkleInclusionProof(depth) {
    // ── private ──────────────────────────────────────────────────
    signal input leafValue;
    signal input pathElements[depth];
    signal input pathIndices[depth];    // 0=left, 1=right  (same as merkle.ts pathBits)

    // ── public inputs ─────────────────────────────────────────────
    signal input root;
    signal input threshold;
    signal input predicateEnabled;

    // ── public output ─────────────────────────────────────────────
    signal output predicateResult;

    // ── Constraint: predicateEnabled must be binary ───────────────
    predicateEnabled * (predicateEnabled - 1) === 0;

    // ── Step 1: Hash the leaf ─────────────────────────────────────
    component leafHasher = Poseidon(1);
    leafHasher.inputs[0] <== leafValue;

    // ── Step 2: Walk the Merkle path ──────────────────────────────
    signal currentHash[depth + 1];
    currentHash[0] <== leafHasher.out;

    component nodeHasher[depth];
    component nodeMux[depth];

    for (var i = 0; i < depth; i++) {
        //  pathIndices[i] == 0: current is LEFT  → poseidon([current, sibling])
        //  pathIndices[i] == 1: current is RIGHT → poseidon([sibling, current])
        nodeMux[i] = MultiMux1(2);

        // Slot 0 → left argument of poseidon
        nodeMux[i].c[0][0] <== currentHash[i];   // pathIdx=0 → current goes left
        nodeMux[i].c[0][1] <== pathElements[i];  // pathIdx=1 → sibling goes left

        // Slot 1 → right argument of poseidon
        nodeMux[i].c[1][0] <== pathElements[i];  // pathIdx=0 → sibling goes right
        nodeMux[i].c[1][1] <== currentHash[i];   // pathIdx=1 → current goes right

        nodeMux[i].s <== pathIndices[i];

        nodeHasher[i] = Poseidon(2);
        nodeHasher[i].inputs[0] <== nodeMux[i].out[0];
        nodeHasher[i].inputs[1] <== nodeMux[i].out[1];
        currentHash[i + 1] <== nodeHasher[i].out;
    }

    // ── Step 3: Root constraint ───────────────────────────────────
    currentHash[depth] === root;

    // ── Step 4: Optional predicate — leafValue >= threshold ───────
    // IMPORTANT: GreaterEqThan(64) requires leafValue < 2^64.
    // For sha256-encoded claims (leafValue up to ~2^254), always set
    // threshold=0 and predicateEnabled=0.  The predicate is meaningful
    // only when the claim was encoded as a small integer (< 2^64).
    component geq = GreaterEqThan(64);
    geq.in[0] <== leafValue;
    geq.in[1] <== threshold;

    // predicateResult = predicateEnabled * geq.out + (1 - predicateEnabled)
    // predicateEnabled=0 → predicateResult = 1 (always pass)
    // predicateEnabled=1 → predicateResult = geq.out
    predicateResult <== predicateEnabled * (geq.out - 1) + 1;
}

component main {public [root, threshold, predicateEnabled]} = MerkleInclusionProof(4);
```

**Constraint count estimate (depth=4):**
- Poseidon(1): ~220 constraints
- 4× Poseidon(2): ~4 × 240 = 960 constraints
- 4× MultiMux1(2): ~4 × 4 = 16 constraints
- GreaterEqThan(64) via LessThan(64): ~68 constraints (Num2Bits(65))
- Binary constraint: 1
- **Total: ~1265 constraints** → well within 2^12 = 4096

---

### Pattern 2: Build Script — Trusted Setup

**File: `packages/api/scripts/build-circuit.sh`**

```bash
#!/usr/bin/env bash
# Build script for merkle_inclusion circuit.
# Run once at development time or in CI. Commits all three runtime artifacts.
# Requires: circom 2.x on PATH, snarkjs installed (npx or local)
set -euo pipefail

CIRCUITS_DIR="$(cd "$(dirname "$0")/../circuits" && pwd)"
cd "$CIRCUITS_DIR"

SNARKJS="node_modules/.bin/snarkjs"
# Fall back to global if not in local node_modules
if ! command -v "$SNARKJS" >/dev/null 2>&1; then
  SNARKJS="snarkjs"
fi

echo "=== Step 1: Compile circuit ==="
circom merkle_inclusion.circom \
  --r1cs --wasm --sym \
  -l ../node_modules/circomlib/circuits \
  -o .

echo "=== Step 2: Powers-of-Tau (Phase 1) ==="
if [ ! -f pot12_final.ptau ]; then
  # power=12 → max 4096 constraints; our circuit needs ~1300
  $SNARKJS powersoftau new bn128 12 pot12_0000.ptau -v
  # Fixed entropy string makes the build deterministic for dev/CI.
  # A real ceremony would use random entropy and multiple contributors.
  $SNARKJS powersoftau contribute pot12_0000.ptau pot12_0001.ptau \
    --name="urid-phase6-dev" \
    -e "urid-zk-phase6-fixed-entropy-not-for-production"
  $SNARKJS powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v
  rm -f pot12_0000.ptau pot12_0001.ptau
else
  echo "  pot12_final.ptau already exists — skipping Powers-of-Tau"
fi

echo "=== Step 3: Groth16 circuit-specific setup (Phase 2) ==="
$SNARKJS groth16 setup merkle_inclusion.r1cs pot12_final.ptau circuit_0000.zkey

echo "=== Step 4: Contribute to zkey (deterministic for dev) ==="
$SNARKJS zkey contribute circuit_0000.zkey merkle_inclusion_final.zkey \
  --name="urid-phase6-zkey-contrib" \
  -e "urid-zkey-entropy-not-for-production"
rm -f circuit_0000.zkey

echo "=== Step 5: Export verification key ==="
$SNARKJS zkey export verificationkey \
  merkle_inclusion_final.zkey \
  verification_key.json

echo "=== Done ==="
echo "Commit these artifacts:"
echo "  merkle_inclusion_js/merkle_inclusion.wasm"
echo "  merkle_inclusion_final.zkey"
echo "  verification_key.json"
```

**Entropy caveat:** The `-e` flag provides fixed entropy so the script is reproducible in CI without interactive input. This is acceptable for a development/test environment. A production deployment should use a multi-party ceremony. The resulting `.zkey` is still a valid proving key — the security assumption is that at least one contributor is honest.

**What to commit:**
```
circuits/merkle_inclusion_js/merkle_inclusion.wasm   # ~500 KB
circuits/merkle_inclusion_final.zkey                 # ~3 MB for power 12
circuits/verification_key.json                       # ~3 KB (JSON)
```

**What to gitignore:**
```
circuits/*.ptau         # large (pot12_final.ptau ~48 MB)
circuits/*.r1cs         # rebuild-able
circuits/*.sym          # debug symbols
circuits/circuit_0000.zkey   # intermediate (before contribution)
```

---

### Pattern 3: snarkjs TypeScript API — prove()

**Key imports (NestJS CommonJS target):**

```typescript
// Source: snarkjs package.json exports → { node: { require: './build/main.cjs' } }
// Works in NestJS CommonJS build without any ESM wrapper.
import * as snarkjs from 'snarkjs';
import * as path from 'path';
import * as fs from 'fs';
```

`snarkjs` 0.7.6 ships dual ESM/CJS: `./build/main.cjs` is served for `require()`, so NestJS's CommonJS output loads it without a dynamic-import wrapper. [VERIFIED: npm registry, package.json exports field]

**Witness preparation and `fullProve` call:**

```typescript
import { buildMerkleTree, generateInclusionProof } from '../crypto/merkle';
import { claimToFieldElement, encodeClaimsToLeaves, buildClaimSet } from '../crypto/claim-encoding';

const CIRCUIT_DEPTH = 4;
const TREE_SIZE = Math.pow(2, CIRCUIT_DEPTH); // 16

async function buildWitness(
  allClaims: Array<{ name: string; value: string }>,
  disclosedClaimName: string,
  threshold: bigint,
  predicateEnabled: boolean,
): Promise<Record<string, string>> {
  // 1. Encode all claims to field elements
  const leafValues = encodeClaimsToLeaves(allClaims);

  // 2. Pad to exactly TREE_SIZE leaves (must match circuit depth=4)
  //    buildMerkleTree pads to next power-of-two internally, but we need
  //    to pass exactly 16 leaves so the tree depth is fixed at 4.
  const ZERO_SENTINEL = BigInt('0x2a09a9fd93c590c26b91effbb2499f07e8f7aa12e2b4940a3aed2411cb65e11c');
  while (leafValues.length < TREE_SIZE) {
    leafValues.push(0n); // buildMerkleTree will hash these as poseidon([0n]) = zero sentinel
  }

  // 3. Build tree (depth will be exactly 4 for 16 leaves)
  const tree = await buildMerkleTree(leafValues);

  // 4. Find the index of the disclosed claim
  const disclosedIndex = allClaims.findIndex(c => c.name === disclosedClaimName);
  if (disclosedIndex < 0) throw new Error(`Claim "${disclosedClaimName}" not found`);
  const inclusionProof = generateInclusionProof(tree, disclosedIndex);

  // 5. Format witness — keys must match circuit signal names EXACTLY
  //    All values must be decimal strings or BigInt (snarkjs calls unstringifyBigInts)
  return {
    // Private
    leafValue: leafValues[disclosedIndex].toString(),
    pathElements: inclusionProof.siblings.map(s => BigInt('0x' + s).toString()),
    pathIndices: inclusionProof.pathBits.map(b => b.toString()),
    // Public
    root: BigInt('0x' + tree.root).toString(),
    threshold: threshold.toString(),
    predicateEnabled: predicateEnabled ? '1' : '0',
  };
}

// groth16.fullProve usage:
const wasmPath = path.join(__dirname, '../../../circuits/merkle_inclusion_js/merkle_inclusion.wasm');
const zkeyPath = path.join(__dirname, '../../../circuits/merkle_inclusion_final.zkey');

const witness = await buildWitness(claims, 'fieldOfStudy', 0n, false);
const { proof, publicSignals } = await snarkjs.groth16.fullProve(witness, wasmPath, zkeyPath);
// proof: { pi_a, pi_b, pi_c, protocol: "groth16", curve: "bn128" }
// publicSignals: string[] of decimal-encoded field elements
// publicSignals[0] = predicateResult
// publicSignals[1] = root
// publicSignals[2] = threshold
// publicSignals[3] = predicateEnabled
```

---

### Pattern 4: snarkjs TypeScript API — verify() + Ed25519 binding

```typescript
import * as snarkjs from 'snarkjs';
import { verify as ed25519Verify } from '@noble/ed25519';
import { rootMessageBytes } from '../crypto/claim-encoding';

async function verifyProof(
  proof: object,
  publicSignals: string[],
  verificationKey: object,
  issuerSignatureHex: string,
  issuerPublicKeyHex: string,
): Promise<{ valid: boolean; reason?: string }> {
  // 1. Groth16 verification
  const snarkValid = await snarkjs.groth16.verify(verificationKey, publicSignals, proof);
  if (!snarkValid) return { valid: false, reason: 'SNARK proof invalid' };

  // 2. Extract root from public signals
  // publicSignals[1] is root (output predicateResult is [0], root is [1])
  const rootDecimal = publicSignals[1];
  const rootHex = BigInt(rootDecimal).toString(16); // variable-length hex, no 0x

  // 3. Ed25519 binding: check issuer signed this root
  const message = rootMessageBytes(rootHex);       // UTF-8 of the hex root string
  const sigBytes = Buffer.from(issuerSignatureHex, 'hex');
  const pubBytes = Buffer.from(issuerPublicKeyHex, 'hex');

  const sigValid = await ed25519Verify(sigBytes, message, pubBytes);
  if (!sigValid) return { valid: false, reason: 'Issuer signature over root invalid' };

  // 4. Check predicate result passes
  const predicateResult = publicSignals[0];
  if (predicateResult !== '1') return { valid: false, reason: 'Predicate condition not satisfied' };

  return { valid: true };
}
```

---

### Pattern 5: Public Signal Ordering

**Critical for correctness:** snarkjs extracts `publicSignals` from the witness buffer in this order:
1. Public outputs of `main` (in signal declaration order in the template)
2. Public inputs (in the order listed in `component main {public [...]}`)

For this circuit:
```
publicSignals[0] = predicateResult    (output — declared first in template)
publicSignals[1] = root               (first in {public [root, threshold, predicateEnabled]})
publicSignals[2] = threshold          (second)
publicSignals[3] = predicateEnabled   (third)
```

The verifier MUST use `publicSignals[1]` to extract the root and compare against the stored credential root. If the indices are wrong, a malicious prover could swap in a different root. [CITED: github.com/iden3/snarkjs groth16_prove.js — witness extraction loop starts at i=1 through nPublic]

---

### Pattern 6: Hex Field Element Conversion

BN254 field elements are stored in `merkle.ts` as variable-length hex strings (no `0x` prefix, produced by `F.toString(fe, 16)`). The circom witness requires decimal strings or BigInts. The conversion is:

```typescript
// Hex string → decimal string for circom witness input
function hexToDecimal(hex: string): string {
  return BigInt('0x' + hex).toString(10);
}

// Decimal string (from publicSignals) → hex string for DB comparison
function decimalToHex(dec: string): string {
  return BigInt(dec).toString(16);
}
```

`snarkjs` calls `unstringifyBigInts` on the witness input object, so both `"12345"` (decimal string) and `12345n` (BigInt) work as input values. Hex strings with `0x` prefix also work. Plain hex without `0x` does NOT parse as a number — always add the prefix or convert to BigInt first.

---

### Anti-Patterns to Avoid

- **Using `Number()` on field elements:** BN254 primes exceed JavaScript's `Number.MAX_SAFE_INTEGER`. Always use `BigInt()`. [VERIFIED: codebase — `merkle.ts` explicitly uses F.toString/F.e/F.eq]
- **Not pre-padding to `2^circuitDepth` leaves:** `buildMerkleTree` auto-pads to the next power of two based on input count. If you call it with 6 claims, the depth is 3 (not 4). The circuit expects depth=4. Pre-pad the leaf array to exactly 16 elements (TREE_SIZE) before calling `buildMerkleTree`.
- **Wrong path index interpretation:** `merkle.ts` `pathBits[i]=0` means current node IS the left child (sibling is right). The circuit `pathIndices[i]=0` means the same. The `MultiMux1` wiring above matches this. Do not flip.
- **Passing `0x`-prefixed hex as a circom signal string:** `snarkjs.groth16.fullProve` expects decimal strings or BigInts; hex strings with `0x` prefix work only if parsed by `unstringifyBigInts`. Safest: always `BigInt('0x' + hexStr).toString(10)` before passing.
- **Not constraining `predicateEnabled` to binary:** Without `predicateEnabled * (predicateEnabled - 1) === 0`, a malicious prover could pass `predicateEnabled = someField` to manipulate `predicateResult`. The circuit above includes this constraint.
- **Not verifying root in publicSignals matches stored credential root:** The SNARK only proves "I know a leaf in SOME tree with THIS root." The verifier MUST also check that `publicSignals[1]` (root) equals the credential's stored `merkleRoot`. This is the binding step.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Poseidon hash in circuits | Custom hash template | `circomlib/poseidon.circom` | Round constants must match circomlibjs exactly; any deviation breaks proof verification against real credential roots |
| Merkle path selector (left/right) | Custom if-else in circom | `circomlib/mux1.circom` `MultiMux1(2)` | Hand-rolled selectors introduce non-quadratic constraints that fail R1CS compilation |
| Numeric comparator | Custom bit-decomposition | `circomlib/comparators.circom` `GreaterEqThan(n)` | LessThan/GreaterEqThan handle proper BN254 range constraints with tested Num2Bits decomposition |
| Groth16 prove/verify | Custom SNARK implementation | `snarkjs.groth16.fullProve / verify` | Elliptic curve pairing math has catastrophic failure modes if implemented incorrectly |
| Trusted setup ceremony | Custom Powers-of-Tau | `snarkjs powersoftau` CLI | SRS generation must follow exact BN128 curve parameters |
| Witness formatting for large integers | `parseInt()` / `Number()` | `BigInt()` + `toString(10)` | Precision loss above 2^53 corrupts field elements silently |

**Key insight:** Every step in the ZK pipeline — hash function, comparator, Merkle selector, prove, verify — has subtle arithmetic constraints specific to the BN254 field. All of these have tested iden3 implementations. Custom solutions fail in ways that are hard to debug (invalid proofs that seem to verify, or valid proofs that fail).

---

## Common Pitfalls

### Pitfall 1: Tree Depth Mismatch Between JS and Circuit

**What goes wrong:** `buildMerkleTree` automatically infers depth from `Math.ceil(Math.log2(leaves.length))`. With 6 claims, the JS tree has depth=3. The circuit is compiled for depth=4. The root values differ because depth-3 root ≠ depth-4 root of the same leaves. All proofs fail at the root constraint `currentHash[4] === root`.

**Why it happens:** CRYPTO-NOTES.md §5 says "Depth is configurable in JS: buildMerkleTree derives depth automatically." The circuit does not — it's fixed at compile time.

**How to avoid:** Always pre-pad the leaf array to exactly `2^CIRCUIT_DEPTH` elements before calling `buildMerkleTree`. Insert `0n` values (not the zero sentinel directly — `buildMerkleTree` applies `poseidon([0n])` internally). Add an assertion: `assert(leafValues.length === TREE_SIZE)` before the call.

**Warning signs:** Root from JS `buildMerkleTree` is different from the stored `merkleRoot` on the `SoulboundToken`. The proof generates without error but fails at verification with "public signal mismatch."

---

### Pitfall 2: circom Include Path Not Set Correctly

**What goes wrong:** `circom merkle_inclusion.circom --r1cs --wasm` fails with `Cannot find file 'poseidon.circom'`. The `include "poseidon.circom"` in the circuit source cannot resolve without the `-l` flag.

**Why it happens:** circom does not add `node_modules` to the include search path automatically. The `-l` flag specifies a library root.

**How to avoid:**
```bash
circom merkle_inclusion.circom --r1cs --wasm --sym \
  -l ./node_modules/circomlib/circuits
```
Or use a relative path in the circuit: `include "../../node_modules/circomlib/circuits/poseidon.circom"`. The `-l` flag approach is cleaner.

**Warning signs:** Compilation fails with "file not found" for poseidon, mux1, or comparators.

---

### Pitfall 3: publicSignals Index Off-By-One

**What goes wrong:** `verify()` reads `publicSignals[0]` as the root, but it is actually `predicateResult`. The root binding check compares a 0/1 boolean against a 254-bit field element — always mismatches.

**Why it happens:** snarkjs places public OUTPUT signals BEFORE public INPUT signals in the `publicSignals` array. Developers expect the order to match the `{public [...]}` declaration in `component main`.

**How to avoid:** Use named constants:
```typescript
const IDX_PREDICATE_RESULT = 0;  // output
const IDX_ROOT              = 1;  // first public input
const IDX_THRESHOLD         = 2;
const IDX_PREDICATE_ENABLED = 3;
```
Add an assertion at startup: verify that `publicSignals.length === 4` after a known test proof. [CITED: github.com/iden3/snarkjs groth16_prove.js]

---

### Pitfall 4: Poseidon Parameter Mismatch

**What goes wrong:** JS-side `circomlibjs.buildPoseidon()` and the circom `Poseidon(n)` template produce different hash values for the same input.

**Why it happens:** There are multiple Poseidon variants with different round constants (different papers use different parameters). `circomlibjs` and `circomlib` use the same parameter set (the iden3 constants), but third-party libraries may not. Using a different Poseidon JS library for witness generation will produce a valid-looking witness that fails the circuit constraint.

**How to avoid:** Only use `circomlibjs.buildPoseidon()` (already in `merkle.ts`). Never substitute a different Poseidon library. CRYPTO-NOTES.md §1 explicitly records this invariant.

**Warning signs:** The JS `tree.root` does not match the circuit's computed root even with correct depth and leaf values.

---

### Pitfall 5: Ed25519 Signature Binding Skipped

**What goes wrong:** `verify()` calls `groth16.verify()` and returns `true` without checking the issuer Ed25519 signature. A prover can build ANY Merkle tree, generate a valid SNARK proof for it, and pass verification — the proof is no longer bound to a real credential.

**Why it happens:** SNARK verification only proves "this root was known to the prover." It does not prove the root was signed by a real issuer.

**How to avoid:** The two-step check is mandatory: `snark_valid AND ed25519_valid`. Use `rootMessageBytes(rootHex)` from `claim-encoding.ts` for the signed message bytes (UTF-8 of the hex root string), matching the Phase 5 signing path exactly.

**Warning signs:** Tests pass with a fabricated proof that was never minted as a credential.

---

### Pitfall 6: snarkjs ESM / NestJS CJS Incompatibility

**What goes wrong:** `import snarkjs from 'snarkjs'` triggers `Error [ERR_REQUIRE_ESM]` in a NestJS CommonJS build because the package declares `"type": "module"`.

**Why it doesn't actually happen:** snarkjs 0.7.6 ships a dual-export: the `node.require` export points to `./build/main.cjs` (CommonJS). Node.js selects this path automatically for `require('snarkjs')` in a CJS context. [VERIFIED: npm view snarkjs@0.7.6 exports]

**How to avoid:** Use `import * as snarkjs from 'snarkjs'` (TypeScript) or `const snarkjs = require('snarkjs')`. Do NOT add `"type": "module"` to `packages/api/package.json`. The NestJS `tsconfig.json` already targets CommonJS — no changes needed.

**Warning signs:** `Error [ERR_REQUIRE_ESM]` at import. Fix: check `packages/api/tsconfig.json` → `"module": "commonjs"` must be set.

---

## Code Examples

### Complete witness object structure

```typescript
// Source: snarkjs README + groth16_fullprove.js source
const witness = {
  // Private signals — names must match EXACTLY the circom template signal names
  leafValue:    "12345678901234567890",  // decimal string
  pathElements: ["111...", "222...", "333...", "444..."],  // 4 decimal strings
  pathIndices:  ["0", "1", "0", "0"],  // 4 binary strings

  // Public signals (also pass as input — fullProve computes the output)
  root:             "9999...big number...9999",  // decimal string
  threshold:        "0",    // "0" = predicate disabled
  predicateEnabled: "0",
};

const { proof, publicSignals } = await snarkjs.groth16.fullProve(
  witness,
  "/abs/path/to/merkle_inclusion_js/merkle_inclusion.wasm",
  "/abs/path/to/merkle_inclusion_final.zkey",
);
// proof.protocol === "groth16"
// proof.curve    === "bn128"
// publicSignals  === ["1", "<root decimal>", "0", "0"]
```

### Verification key loading (singleton pattern)

```typescript
import * as fs from 'fs';
import * as path from 'path';

// Load once at service construction — not on every verify() call
const verificationKey = JSON.parse(
  fs.readFileSync(
    path.join(__dirname, '../../../circuits/verification_key.json'),
    'utf8',
  ),
);
```

### Checking the CLI quickly

```bash
# After running build-circuit.sh, smoke-test the full workflow:
cd packages/api/circuits

# Generate a test witness (input.json must have all circuit signals)
node merkle_inclusion_js/generate_witness.js \
  merkle_inclusion_js/merkle_inclusion.wasm \
  test_input.json \
  witness.wtns

# Generate proof
snarkjs groth16 prove merkle_inclusion_final.zkey witness.wtns proof.json public.json

# Verify
snarkjs groth16 verify verification_key.json public.json proof.json
# Should print: OK!
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| Groth16 requires per-circuit trusted setup | Universal trusted setup (Plonk, Marlin) available | 2019–2021 | Locked to Groth16 per CONTEXT.md; no action needed |
| circom 1.x (old Poseidon params) | circom 2.x (same params, improved R1CS) | 2021 | `pragma circom 2.1.0` required; circom 2.2.3 is installed |
| snarkjs witness generation required a separate Node script | `groth16.fullProve` generates witness + proof in one call | snarkjs 0.7.x | Use `fullProve`; no need for separate `wtns_calculate` |

**Deprecated/outdated:**
- `snarkjs powersoftau beacon`: replaces manual `contribute` in production ceremonies; for dev use, fixed `-e` entropy is simpler.
- `circom 1.x` `pragma circom 1.0.0`: produces different constraint encoding; incompatible with circomlib 2.x includes.

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `publicSignals[0]` = predicateResult (output), `[1]` = root (first public input) — ordering derived from snarkjs source code analysis | Pattern 3 / Pattern 5 | Wrong index used for root binding → security bypass |
| A2 | GreaterEqThan(64) is safe for BN254 inputs when both `leafValue` and `threshold` are < 2^64; sha256-encoded claims must use threshold=0 | Pattern 1 / Pitfall list | Soundness hole if leafValue > 2^64 and predicate is enabled |
| A3 | `pot12_final.ptau` (power=12) is sufficient for the depth-4 circuit (~1265 constraints < 2^12=4096) | Standard Stack / Build Script | Build fails with "not enough constraints in ptau" — fix: re-run with power=13 |
| A4 | `snarkjs.groth16.fullProve` is synchronous-async (returns a Promise); NestJS can `await` it in a service method without blocking the event loop in a way that kills the server — it is CPU-heavy though (~seconds) | Pattern 3 | Proof generation blocks the event loop for other requests; mitigation: use a worker thread or queue for production |

**A1 verification note:** The snarkjs `groth16_prove.js` source loop `for (let i=1; i<= zkey.nPublic; i++)` extracts signals from the witness buffer. Circom's witness layout places public outputs at positions 1..nOutputs and public inputs at nOutputs+1..nPublic. For this circuit: 1 output (`predicateResult`), 3 public inputs (`root`, `threshold`, `predicateEnabled`) → `publicSignals = [predicateResult, root, threshold, predicateEnabled]`. Add a test that asserts `publicSignals[1] === expectedRoot` to catch any misorder at runtime. [CITED: github.com/iden3/snarkjs]

---

## Open Questions

1. **Proof generation latency**
   - What we know: `groth16.fullProve` for a ~1300-constraint circuit takes 1–5 seconds on a modern CPU (benchmark from community reports).
   - What's unclear: Acceptable latency for the URID API endpoint; whether a worker thread is needed for Phase 6.
   - Recommendation: Run a single benchmark call in the test suite and record the time. If > 2s, wrap in `worker_threads.Worker` in a follow-on task. Phase 6 itself can block the event loop for the test suite.

2. **Credential root format mismatch**
   - What we know: `merkle.ts` stores roots as variable-length hex strings (no `0x`, no padding). `publicSignals` from snarkjs contains decimal strings.
   - What's unclear: The stored `SoulboundToken.merkleRoot` field format (need to check Prisma schema).
   - Recommendation: In `verify()`, convert `publicSignals[1]` → hex via `BigInt(dec).toString(16)` and compare to `soulboundToken.merkleRoot`. Add a test that explicitly verifies this comparison path.

3. **Depth-4 limit (16 claims max)**
   - What we know: Current `ClaimSetInput` has 6 fields; depth=4 supports 16.
   - What's unclear: Whether future credential schemas will exceed 16 claims.
   - Recommendation: Compile with depth=4 for Phase 6. Document that depth is a compile-time constant. Adding a depth=5 circuit (32 claims) later requires a new trusted setup.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| `circom` | Build script (compile circuit) | Yes | 2.2.3 | — (binary on PATH) |
| `snarkjs` CLI | Build script (ptau + zkey) | After `npm install` | 0.7.6 | `npx snarkjs` |
| `node` | Runtime prove/verify | Yes | v24.13.0 | — |
| `snarkjs` npm | Runtime `fullProve`/`verify` | After `npm install` | 0.7.6 | — |
| `circomlib` npm | Build (circuit compilation) | After `npm install` | 2.0.5 | — |
| `circomlibjs` npm | Runtime witness generation | Already installed | 0.1.7 | — |

**Missing dependencies with no fallback:** none — all tools are present or installable.
**Missing dependencies with fallback:** none.

---

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | Vitest 4.1.10 |
| Config file | `packages/api/vitest.config.ts` (or `package.json` scripts) |
| Quick run command | `cd packages/api && npx vitest run zk-proofs` |
| Full suite command | `cd packages/api && npx vitest run` |

### Phase Requirements → Test Map

| ID | Behavior | Test Type | Automated Command | File Exists? |
|----|----------|-----------|-------------------|-------------|
| ZKP-01 | `prove()` generates a real Groth16 proof that `groth16.verify` accepts | Integration | `npx vitest run zk-proofs` | No — Wave 0 |
| ZKP-02 | `publicSignals[1]` matches the credential's stored `merkleRoot` | Integration | `npx vitest run zk-proofs` | No — Wave 0 |
| ZKP-03 | `verify()` returns `false` for a tampered proof or non-member claim | Integration | `npx vitest run zk-proofs` | No — Wave 0 |
| ZKP-04 | `verify()` fails if Ed25519 signature on root is invalid (even if SNARK verifies) | Integration | `npx vitest run zk-proofs` | No — Wave 0 |
| ZKP-05 | SHA-256 stub proof generation is gone (grep check) | Static | `grep -r 'sha256.*JSON.stringify' packages/api/src/modules/zk-proofs/` exits 1 | No — Wave 0 |
| ZKP-06 | Build artifacts exist and are loadable | Smoke | `npx vitest run circuit-artifacts` | No — Wave 0 |

### Wave 0 Gaps
- [ ] `packages/api/src/modules/zk-proofs/zk-proofs.service.spec.ts` — covers ZKP-01–05
- [ ] `packages/api/src/modules/zk-proofs/circuit-artifacts.spec.ts` — covers ZKP-06 (file existence + JSON.parse)
- [ ] `packages/api/circuits/` directory with `merkle_inclusion.circom`
- [ ] `packages/api/scripts/build-circuit.sh`
- [ ] `npm install snarkjs circomlib` in `packages/api/`

*(Existing `crypto/` unit tests are not modified; they cover the Merkle and claim-encoding primitives independently.)*

---

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | — |
| V3 Session Management | no | — |
| V4 Access Control | yes | AuthGuard on prove/verify endpoints |
| V5 Input Validation | yes | Validate `credentialId`, `claimName`, `threshold` types; reject out-of-range integers before proof generation |
| V6 Cryptography | yes | snarkjs groth16 (do not hand-roll); Ed25519 via `@noble/ed25519`; never expose `.zkey` private proving key over HTTP |

### Known Threat Patterns

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Fabricated proof (arbitrary root) | Spoofing | Ed25519 signature check outside circuit: `snarkValid AND issuerSigValid` |
| Tampered publicSignals (swapped root) | Tampering | `groth16.verify` fails on any modification to proof or publicSignals |
| Non-member leaf accepted | Elevation of Privilege | Circuit constraint `currentHash[depth] === root` enforces membership; tested by ZKP-03 negative test |
| JS/circuit Poseidon mismatch | Tampering | Only use `circomlibjs.buildPoseidon()` on JS side; documented in CRYPTO-NOTES.md |
| `.zkey` exposure | Information Disclosure | Never serve `.zkey` over HTTP; store in `circuits/` dir outside `public`/`dist`; `.gitignore` intermediate zkeys |
| Proof re-use across credentials | Spoofing | `publicSignals[1]` (root) must be checked against the specific credential's stored root in DB |

---

## Project Constraints (from CLAUDE.md)

| Directive | Impact on Phase 6 |
|-----------|------------------|
| Stay on NestJS 11 / Prisma 6.11 / TypeScript — extend, don't rewrite | Add `ZkProofsService` methods; keep `@Injectable()` pattern |
| Real cryptography required — "looks real in a demo" not acceptable | SNARK must be real Groth16 from a real circuit + real trusted setup |
| New deps: `snarkjs` (runtime), `circom` (build-time) | Pre-approved in CLAUDE.md constraints section |
| `strict: false` in `packages/api/tsconfig.json` | TypeScript permissive mode; still add typed interfaces for proof/publicSignals |
| PascalCase for services; kebab-case for feature dirs | Maintain `ZkProofsService`, `zk-proofs/` |
| `private readonly logger = new Logger(ZkProofsService.name)` | Keep existing logger pattern in the rewritten service |

---

## Sources

### Primary (MEDIUM confidence — codebase verification)
- `packages/api/src/crypto/merkle.ts` — authoritative JS Merkle contract; pathBits orientation verified [VERIFIED: codebase grep]
- `packages/api/src/crypto/claim-encoding.ts` — leaf encoding contract (`sha256 mod p`); `rootMessageBytes` signing convention [VERIFIED: codebase grep]
- `packages/api/src/crypto/CRYPTO-NOTES.md` — BN254 field prime, zero sentinel value, circomlib/circomlibjs param equivalence [VERIFIED: codebase grep]

### Primary (MEDIUM confidence — official source fetch)
- `github.com/iden3/snarkjs` README — CLI commands, `fullProve`/`verify` API signatures [CITED: github.com/iden3/snarkjs]
- `github.com/iden3/snarkjs` `src/groth16_prove.js` — `publicSignals` extraction loop, witness layout [CITED: github.com/iden3/snarkjs/blob/master/src/groth16_prove.js]
- `github.com/iden3/circomlib` `circuits/poseidon.circom` — `Poseidon(nInputs)` template wraps `PoseidonEx` [CITED: github.com/iden3/circomlib]
- `github.com/iden3/circomlib` `circuits/mux1.circom` — `MultiMux1(n)` template; selector formula verified [CITED: github.com/iden3/circomlib]
- `github.com/iden3/circomlib` `circuits/comparators.circom` — `GreaterEqThan(n)` template; n=64 bit width [CITED: github.com/iden3/circomlib]

### Secondary (MEDIUM confidence — npm registry + package.json)
- `npm view snarkjs@0.7.6 exports` — confirms `node.require: './build/main.cjs'` for CJS compat [VERIFIED: npm registry]
- `npm view snarkjs@0.7.6`, `npm view circomlib@2.0.5` — package legitimacy (OK verdict, iden3 org) [VERIFIED: npm registry]
- `circom --version` — 2.2.3 confirmed installed [VERIFIED: binary on PATH]

---

## Metadata

**Confidence breakdown:**
- Circuit source code: HIGH — derived directly from official circomlib templates and matching against codebase Merkle/hash contracts
- Standard stack: HIGH — all packages verified via npm registry + iden3 org confirmation
- Trusted setup commands: MEDIUM — from snarkjs README (official); exact flag behavior cross-checked against CLI source
- publicSignals ordering: MEDIUM — derived from snarkjs source code; should be confirmed empirically with a test assertion
- Predicate design: MEDIUM — architectural decision documented; numeric predicate limitation clearly flagged

**Research date:** 2026-07-07
**Valid until:** 2026-09-07 (snarkjs moves slowly; circom 2.x is stable; reassess if snarkjs hits 0.8.x)
