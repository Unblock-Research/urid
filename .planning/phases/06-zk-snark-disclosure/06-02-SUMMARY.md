---
phase: 06-zk-snark-disclosure
plan: "02"
subsystem: zk-proofs
tags: [groth16, circom, snarkjs, poseidon, merkle, trusted-setup, circuits]
dependency_graph:
  requires: [06-01]
  provides: [merkle_inclusion.wasm, merkle_inclusion_final.zkey, verification_key.json]
  affects: [06-03-zk-proofs-service-rewrite]
tech_stack:
  added: [circom 2.2.3 (build-time), snarkjs 0.7.6, circomlib 2.0.5]
  patterns: [Groth16 zk-SNARK, Poseidon Merkle inclusion, Powers-of-Tau trusted setup]
key_files:
  created:
    - packages/api/circuits/merkle_inclusion.circom
    - packages/api/circuits/.gitignore
    - packages/api/scripts/build-circuit.sh
    - packages/api/circuits/merkle_inclusion_js/merkle_inclusion.wasm
    - packages/api/circuits/merkle_inclusion_js/generate_witness.js
    - packages/api/circuits/merkle_inclusion_js/witness_calculator.js
    - packages/api/circuits/merkle_inclusion_final.zkey
    - packages/api/circuits/verification_key.json
    - packages/api/src/modules/zk-proofs/circuit-artifacts.spec.ts
  modified: []
decisions:
  - "Used clamped geq inputs (predicateEnabled*leafValue) to guard GreaterEqThan(64) against SHA-256-encoded field elements that exceed 2^64"
  - "Committed generate_witness.js + witness_calculator.js alongside wasm as they are circom-generated JS helpers for the witness module"
  - "Fixed snarkjs CLI entropy flag syntax: -e=<value> not -e <value> (the CLI parser requires key=value format for options with arguments)"
metrics:
  duration_minutes: 3
  completed_date: "2026-07-07"
  tasks_completed: 3
  tasks_total: 3
  files_created: 9
  files_modified: 0
status: complete
---

# Phase 06 Plan 02: Circom Merkle Inclusion Circuit + Groth16 Trusted Setup Summary

**One-liner:** Depth-4 Poseidon Merkle inclusion Groth16 circuit with clamped predicate guard; locally-generated power-12 trusted setup producing committed WASM + zkey + vkey artifacts verified by an end-to-end smoke test.

## What Was Built

A real Groth16 zk-SNARK circuit and its build pipeline, delivering the three committed runtime artifacts that Plan 03 (service rewrite) will use for `prove()` and `verify()`.

### Task 1: depth-4 Poseidon Merkle + predicate circuit

`packages/api/circuits/merkle_inclusion.circom` implements `MerkleInclusionProof(4)` matching `merkle.ts` exactly:

- Leaf hash: `Poseidon(1)` on `leafValue`
- Node hash: `Poseidon(2)` with `MultiMux1(2)` selecting left/right based on `pathIndices[i]` (0=current is left, 1=current is right) — identical to `pathBits` convention in `merkle.ts`
- Root constraint: `currentHash[4] === root`
- Optional predicate: `GreaterEqThan(64)` with clamped inputs (see Deviations)
- `component main {public [root, threshold, predicateEnabled]} = MerkleInclusionProof(4)`
- Compiled constraint count: **1265** (well within 2^12 = 4096 limit)

Public signal ordering (locked contract for Plan 03):

| Index | Signal | Type |
|-------|--------|------|
| 0 | predicateResult | public output |
| 1 | root | public input |
| 2 | threshold | public input |
| 3 | predicateEnabled | public input |

`circuits/.gitignore` excludes `*.ptau`, `*.r1cs`, `*.sym`, `circuit_0000.zkey` while leaving the three runtime artifacts committed.

### Task 2: Build script + committed artifacts

`packages/api/scripts/build-circuit.sh` (idempotent, executable):

- Step 1: `circom --r1cs --wasm --sym -l ../node_modules/circomlib/circuits`
- Step 2: Power-12 ptau locally (`powersoftau new bn128 12` → `contribute` → `prepare phase2`) with `if [ ! -f pot12_final.ptau ]` guard
- Step 3: `groth16 setup`
- Step 4: `zkey contribute` with fixed dev entropy
- Step 5: `zkey export verificationkey`

Artifact sizes:

| Artifact | Size | nPublic / protocol |
|----------|------|--------------------|
| `merkle_inclusion.wasm` | 1.9 MB | — |
| `merkle_inclusion_final.zkey` | 1.2 MB | — |
| `verification_key.json` | 3.4 KB | nPublic=4, groth16 |

### Task 3: ZKP-06 smoke test

`packages/api/src/modules/zk-proofs/circuit-artifacts.spec.ts` (Vitest):

- Asserts all three committed artifact files exist on disk
- Parses `verification_key.json` and checks `nPublic===4` and `protocol==="groth16"`
- End-to-end round-trip: builds a real 16-leaf depth-4 tree from 6 `buildClaimSet` claims padded to `TREE_SIZE`, calls `groth16.fullProve`, then `groth16.verify === true`
- **Locks the signal-ordering contract**: asserts `BigInt(publicSignals[1]).toString(16) === tree.root`
- All 6 tests pass; circom compiler is NOT invoked at test time

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Fixed GreaterEqThan(64) overflow for SHA-256 leaf values**

- **Found during:** Task 3 (smoke test execution)
- **Issue:** `GreaterEqThan(64)` uses `Num2Bits(65)` internally, which asserts both inputs are < 2^64. SHA-256-encoded leaf values are ~254-bit numbers. Circom evaluates ALL constraints unconditionally regardless of `predicateEnabled` value, so even `predicateEnabled=0` caused `Assert Failed` in `Num2Bits_141`.
- **Fix:** Added two intermediate signals: `clampedLeaf <== predicateEnabled * leafValue` and `clampedThreshold <== predicateEnabled * threshold`. When `predicateEnabled=0`, both clamp to 0 (valid for `Num2Bits(65)`); when `predicateEnabled=1`, the predicate evaluates normally (and soundly rejects `leafValue >= 2^64`).
- **R1CS validity:** Both products are degree-2 (quadratic) constraints — fully valid in R1CS. Constraint count increased from 1263 to 1265 (+2 for the clamping assignments).
- **Artifacts rebuilt:** `build-circuit.sh` re-run after the fix; ptau reused (no change to trusted setup parameters).
- **Files modified:** `packages/api/circuits/merkle_inclusion.circom`, `circuits/merkle_inclusion.wasm`, `circuits/merkle_inclusion_final.zkey`, `circuits/verification_key.json`
- **Commit:** `f3573f0`

**2. [Rule 3 - Blocking] Fixed snarkjs CLI entropy flag syntax**

- **Found during:** Task 2 (first build run attempt)
- **Issue:** The research script used `-e "entropy string"` (space-separated), but the snarkjs CLI argument parser requires `key=value` format: `-e=...`. A space-separated value is pushed as a positional argument, causing "Invalid number of parameters".
- **Fix:** Changed `-e "..."` to `-e="..."` and `--name="..."` to `-n="..."` in both `powersoftau contribute` and `zkey contribute` calls.
- **Files modified:** `packages/api/scripts/build-circuit.sh`
- **Commit:** `d40ba5a`

## Self-Check

Artifacts present:

```
WASM:  packages/api/circuits/merkle_inclusion_js/merkle_inclusion.wasm  FOUND
ZKEY:  packages/api/circuits/merkle_inclusion_final.zkey                 FOUND
VKEY:  packages/api/circuits/verification_key.json                       FOUND (nPublic=4, groth16)
SPEC:  packages/api/src/modules/zk-proofs/circuit-artifacts.spec.ts      FOUND
```

Commits:

| Commit | Description |
|--------|-------------|
| `2e9c3d0` | feat(06-02): depth-4 Poseidon Merkle inclusion circuit + .gitignore |
| `d40ba5a` | feat(06-02): build-circuit.sh + committed Groth16 runtime artifacts |
| `f3573f0` | feat(06-02): smoke test + circuit predicate guard fix |

Smoke test:

```
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

## Self-Check: PASSED

All artifacts exist, all commits verified, all 6 smoke tests pass. The public-signal ordering contract (root at `publicSignals[1]`) is empirically confirmed.

## Known Stubs

None. All three runtime artifacts are real compiled output from a real circuit with a real Groth16 trusted setup.

## Threat Flags

No new network endpoints, auth paths, or DB schema changes introduced. The `.zkey` proving key is stored in `circuits/` (not `src/`, not `dist/`) and is not served over HTTP. The intermediate `circuit_0000.zkey` is gitignored. This plan delivers only build artifacts.
