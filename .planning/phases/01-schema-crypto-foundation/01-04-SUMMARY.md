---
phase: 01-schema-crypto-foundation
plan: "04"
subsystem: crypto
status: complete
tags: [merkle, poseidon, zk, circom, bn254, crypto]
completed_date: "2026-07-06"
duration_minutes: 7

dependency_graph:
  requires: [01-02]
  provides: [merkle-primitives, crypto-notes]
  affects: [phase-05-credentials, phase-06-zk-snark]

tech_stack:
  added: []
  patterns:
    - Poseidon hash via circomlibjs (BN254 scalar field, circom-compatible)
    - Binary (arity-2) Merkle tree with zero-sentinel padding
    - TDD: spec written before implementation (RED then GREEN)

key_files:
  created:
    - packages/api/src/crypto/merkle.ts
    - packages/api/src/crypto/merkle.spec.ts
    - packages/api/src/crypto/CRYPTO-NOTES.md
  modified: []

decisions:
  - Arity 2 (binary tree): keeps circom witness simplest; matches circomlib's MerkleProof component
  - Leaf hash = poseidon([leafValue]): single Poseidon input, standard circom leaf encoding
  - Padding to next power of 2 with poseidon([0n]) sentinel: deterministic depth, circuit-friendly
  - Root stored as hex string via F.toString(fe, 16): canonical, no 0x prefix, variable length
  - Field equality via F.toString string comparison, not raw Uint8Array or Number

metrics:
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 0
  tests_added: 7
  tests_passing: 15
---

# Phase 1 Plan 04: Poseidon Merkle Build + Inclusion Proof Summary

**One-liner:** circomlibjs Poseidon BN254 binary Merkle tree with deterministic root, inclusion-proof generate/verify, and documented circom-compatible parameters locked for Phase 6.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Poseidon Merkle build + inclusion proof (TDD) | 69cafc7 | merkle.ts, merkle.spec.ts |
| 2 | Document circom-compatible tree parameters | b039575 | CRYPTO-NOTES.md |

## What Was Built

### Task 1 — merkle.ts + merkle.spec.ts

`packages/api/src/crypto/merkle.ts` exports three async-capable functions:

- **`buildMerkleTree(leaves: bigint[]): Promise<MerkleTree>`** — hashes each leaf as `poseidon([value])`, pads to the next power of two with the zero sentinel `poseidon([0n])`, builds layers bottom-up with `poseidon([left, right])` node hashes, returns root as a hex string plus all layers.
- **`generateInclusionProof(tree, leafIndex): InclusionProof`** — walks up the layer array collecting sibling hashes and `pathBits` (0 = current left, 1 = current right), compatible with circomlib's `MerkleProof` template conventions.
- **`verifyInclusionProof(leaf, proof, root): Promise<boolean>`** — reconstructs the root from the leaf hash by applying the sibling hashes in the correct order, compares via `F.toString` hex strings (never raw Uint8Array equality).

**TDD flow:** spec was written first and confirmed RED (import error), then implementation turned it GREEN (7 tests, 543 ms).

**Tests (7):**
1. Deterministic root — same leaves produce the same root twice
2. Different ordering produces a different root
3. Member proof — all 4 indices in a 4-leaf tree verify true
4. Non-member negative — non-member leaf hash + correct proof structure → false
5. Tamper negative — valid proof against a different tree's root → false
6. Proof depth — siblings and pathBits arrays have length equal to tree depth
7. Single-leaf tree — padded to depth 1, inclusion proof still verifies true

### Task 2 — CRYPTO-NOTES.md

`packages/api/src/crypto/CRYPTO-NOTES.md` records the full Merkle construction:
- Hash function: Poseidon over BN254 (`circomlibjs@0.1.x` + circom's `poseidon()` template — identical parameters)
- Arity: 2 (binary)
- Leaf hash: `poseidon([leafValue])`
- Node hash: `poseidon([leftChild, rightChild])` (order significant)
- Zero sentinel: `poseidon([0n])` = `0x2a09a9fd93c590c26b91effbb2499f07e8f7aa12e2b4940a3aed2411cb65e11c`
- Padding: right-pad to next power of two
- Proof format: `siblings[]` + `pathBits[]` with circom signal mapping
- Root serialisation: `F.toString(fe, 16)`, variable-length hex, no `0x` prefix
- **Phase 6 circuit boundary (locked constraint):** Ed25519 issuer-signature verification stays OUTSIDE the circuit; only Merkle membership + numeric predicates are proven inside the SNARK

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Verified

| Threat | Status |
|--------|--------|
| T-01-08: Tamper — non-member leaf accepted | MITIGATED — spec test 4 (non-member) and test 5 (mutated root) both assert false |
| T-01-09: Repudiation — JS/circuit Poseidon param mismatch | MITIGATED — circomlibjs default params match circom's poseidon() template; documented in CRYPTO-NOTES.md |
| T-01-10: Tampering — field elements as raw numbers | MITIGATED — all equality via `F.toString(fe, 16)` string comparison; documented and enforced in implementation comments |

## Known Stubs

None — the module is fully functional and does not depend on any unconnected data sources.

## Self-Check

- [x] `packages/api/src/crypto/merkle.ts` exists
- [x] `packages/api/src/crypto/merkle.spec.ts` exists
- [x] `packages/api/src/crypto/CRYPTO-NOTES.md` exists
- [x] Commit 69cafc7 exists (Task 1)
- [x] Commit b039575 exists (Task 2)
- [x] 15/15 tests pass in full suite

## Self-Check: PASSED
