---
phase: 08-hardening
plan: "04"
subsystem: integration
tags: [integration-test, zk-proof, merkle, groth16, ed25519, correctness-fix]
dependency_graph:
  requires: [08-02, 08-03]
  provides: [HRD-03, HRD-02-confirmation]
  affects:
    - packages/api/src/integration/full-flow.integration.spec.ts
    - packages/api/src/modules/credentials/credentials.service.ts
    - packages/api/src/modules/credentials/credentials.service.spec.ts
tech_stack:
  added: []
  patterns:
    - NestJS TestingModule with flat real provider graph (no module imports)
    - Pre-padded Poseidon Merkle tree at circuit-fixed depth (16 leaves)
    - Groth16 snarkjs fullProve against committed .wasm/.zkey artifacts
    - Sequential integration test steps sharing module-level state
    - afterAll FK-ordered cleanup with prisma.$disconnect() in finally
key_files:
  created:
    - packages/api/src/integration/full-flow.integration.spec.ts
  modified:
    - packages/api/src/modules/credentials/credentials.service.ts
    - packages/api/src/modules/credentials/credentials.service.spec.ts
decisions:
  - "Pre-pad claim leaves to CIRCUIT_TREE_SIZE=16 in both mint() and verifyCredential(), not in the test, to fix the root at the service layer where it belongs"
  - "CIRCUIT_DEPTH / CIRCUIT_TREE_SIZE constants added to credentials.service.ts with comments linking to the committed circuit and ZkProofsService"
  - "Integration test cleanup strategy: delete in FK order (zkProof, auditLog, soulboundToken, researcher) inside try/finally afterAll; ledger transactions are append-only so best-effort cleanup via onChainTxHash"
  - "Sequential it() blocks with shared module-level state — simpler than beforeEach wiring for a linear flow test"
metrics:
  duration: "~8 minutes"
  completed: "2026-07-07"
  tasks_completed: 3
  files_changed: 3
status: complete
---

# Phase 08 Plan 04: Full Real-Crypto Integration Test + Mint Depth Fix Summary

Real Groth16 end-to-end flow (register → mint → verifyCredential → prove → verify → tamper rejection) passes with committed circuit artifacts; Merkle depth aligned between mint() (depth-4/16-leaf) and prove() so the stored root is provable.

## What Was Built

### Task 1 — Full-flow real-crypto integration test (HRD-03)

`packages/api/src/integration/full-flow.integration.spec.ts` wires a flat NestJS
TestingModule using ALL REAL providers (no mocks):

- IdentityService, CredentialsService, ZkProofsService
- CryptoService, IssuerKeyService
- LedgerService → LocalLedgerService (real hash-chain DB writes)
- PrismaService (real PostgreSQL via DATABASE_URL)

Six sequential steps drive the complete onboarding flow:

| Step | Action | Assertion |
|------|--------|-----------|
| 1 | `identityService.register()` | DID matches `did:ub:z6Mk` shape; privateKey truthy |
| 2 | `credentialsService.mint()` | merkleRoot, issuerSignature, issuerPublicKey non-null |
| 3 | `credentialsService.verifyCredential()` | `{ valid: true }` |
| 4 | `zkProofsService.prove()` | `proof.protocol === "groth16"`, proofHash non-null (60s timeout) |
| 5 | `zkProofsService.verify(proofHash)` | `{ valid: true }` — Groth16 + Ed25519 both pass |
| 6 | Tamper: bogus publicSignals[1] | `verify()` returns `{ valid: false }` (T-08-07) |

**First run (before Task 2 fix):** Steps 1–3 passed, Step 4 threw:
```
Error: Merkle root mismatch — stored credential root does not match recomputed tree root
```
This confirmed the expected integration defect — mint() built the root at depth ~3 (8 leaves), prove() pre-padded to 16 leaves (depth 4).

### Task 2 — Align mint() Merkle depth to circuit (correctness fix)

`packages/api/src/modules/credentials/credentials.service.ts`:

- Added `CIRCUIT_DEPTH = 4` and `CIRCUIT_TREE_SIZE = 16` constants with comments tying them to `MerkleInclusionProof(4)` and ZkProofsService's matching constants.
- In `mint()`: pre-pad encoded claim leaves to `CIRCUIT_TREE_SIZE` with `0n` sentinels before `buildMerkleTree`, so the stored `merkleRoot` is always the depth-4 root.
- In `verifyCredential()`: apply identical padding so the root recomputed from stored claims matches the stored root for untampered credentials. Tamper-evidence is preserved: a mutated claim still produces a different padded root.
- No claim values, signing path, ledger anchor, or return shape changed.

`packages/api/src/modules/credentials/credentials.service.spec.ts`:
- Updated the CRD-01 root-recompute assertion to apply the same 16-leaf padding. **Intent unchanged** — it still asserts the stored root IS a genuine Poseidon-Merkle commitment to the stored claims; only the expected-root fixture was updated to match the service's new depth.

### Task 3 — Full-suite + tsc green gate (HRD-02 confirmation)

After the fix:
- `npx tsc --noEmit` — clean (no type errors)
- `npx vitest run` — **246 tests across 21 test files, all passed**

Previously ~215 tests + zod pipe test + integration test. The suite is fully green.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 2 - Missing critical functionality] Credential spec test coupled to old depth**
- **Found during:** Task 2
- **Issue:** `credentials.service.spec.ts` CRD-01 test independently computed `buildMerkleTree(leaves)` without padding; would fail after the mint() fix since stored root uses 16-leaf padding.
- **Fix:** Added `CIRCUIT_TREE_SIZE = 16` constant and pre-pad loop to the test's root-recompute assertion. Test intent preserved.
- **Files modified:** `packages/api/src/modules/credentials/credentials.service.spec.ts`
- **Commit:** d7244f5

None of the other ~232 existing tests required changes.

## Threat Mitigations Applied

| Threat ID | Status |
|-----------|--------|
| T-08-07: Spoofing / Tampering via end-to-end proof | Mitigated — Step 6 asserts tampered publicSignals root → verify() returns valid:false |
| T-08-08: Information Disclosure (test data + private key) | Mitigated — namespaced itest-* handles; afterAll FK-order cleanup; privateKey never logged |
| T-08-09: Tampering via mint/prove Merkle-depth mismatch | Mitigated — mint() now builds at CIRCUIT_TREE_SIZE=16; proves stores root matches prove() root |

## HRD-02 / HRD-03 Requirements

| Requirement | Status |
|-------------|--------|
| HRD-02: Full suite green + tsc clean | CONFIRMED: 246 tests, 0 failures; tsc exits 0 |
| HRD-03: Real end-to-end register→mint→prove→verify passes | CONFIRMED: all 6 steps pass with real crypto |

## Known Stubs

None. All assertions use real crypto operations and real database rows.

## Threat Flags

None — no new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

Files verified:
- `packages/api/src/integration/full-flow.integration.spec.ts` — exists
- `packages/api/src/modules/credentials/credentials.service.ts` — modified (CIRCUIT_DEPTH constants + padding)
- `packages/api/src/modules/credentials/credentials.service.spec.ts` — modified (updated root fixture)

Commits verified:
- `4f61ead` — test(08-04): add HRD-03 full real-crypto end-to-end integration test
- `d7244f5` — fix(08-04): align mint() Merkle depth to circuit's fixed depth-4 (16-leaf) tree
