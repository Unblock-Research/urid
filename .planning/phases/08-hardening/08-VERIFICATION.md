---
phase: 08-hardening
verified: 2026-07-06T23:24:28Z
status: passed
score: 3/3 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 8: Hardening Verification Report

**Phase Goal:** All controllers reject malformed input via Zod DTOs; the full crypto stack (keygen, ledger, Shamir, credentials, ZK proofs, impact) is covered by unit tests; an end-to-end integration test passes the complete onboarding flow
**Verified:** 2026-07-06T23:24:28Z
**Status:** passed
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | SC1 (HRD-01): A request with a missing required field to any controller returns HTTP 400, not 500 | VERIFIED | All 6 controllers wire `ZodValidationPipe` on every write path (confirmed by reading each controller and running 246/246 tests including 19 controller validation tests) |
| 2 | SC2 (HRD-02): Unit tests pass for Ed25519, ledger hash-chain, Shamir, credentials sign/verify, Groth16 prove→verify (negative non-member case included), and impact with mocked HTTP; ZodValidationPipe unit test exists | VERIFIED | `pnpm --filter @urid/api exec vitest run` → 246 tests, 21 files, 0 failures; 21 spec files cover all required subsystems |
| 3 | SC3 (HRD-03): Integration test register→mint→prove→verify completes end-to-end without errors, all assertions pass | VERIFIED | All 6 integration steps passed: Step 1 (99ms), Step 2 (175ms), Step 3 (21ms), Step 4 Groth16 fullProve (592ms — real snarkjs), Step 5 (16ms), Step 6 tamper rejection (14ms) |

**Score:** 3/3 truths verified

---

## Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/api/src/common/zod-validation.pipe.ts` | ZodValidationPipe implementing PipeTransform | VERIFIED | Exists, substantive (safeParse + BadRequestException), used in all 6 controllers |
| `packages/api/src/common/zod-validation.pipe.spec.ts` | 6-case unit test | VERIFIED | Exists, 6 tests pass (object valid, missing field, wrong type, scalar rejection, scalar pass, error shape no-stack) |
| `packages/api/src/modules/identity/identity.dto.ts` | Zod schemas for 4 write endpoints | VERIFIED | registerBodySchema, updateBodySchema, setupRecoveryBodySchema, reconstructBodySchema |
| `packages/api/src/modules/credentials/credentials.dto.ts` | mintBodySchema | VERIFIED | mintBodySchema with all required fields + fieldOfStudy optional |
| `packages/api/src/modules/zk-proofs/zk-proofs.dto.ts` | proveBodySchema, verifyBodySchema | VERIFIED | Both schemas present and wired |
| `packages/api/src/modules/affiliations/affiliations.dto.ts` | requestBodySchema | VERIFIED | researcherDid, organizationName, role required |
| `packages/api/src/modules/wallet/wallet.dto.ts` | linkBodySchema | VERIFIED | researcherDid, address, chain required; label optional |
| `packages/api/src/modules/impact/impact.dto.ts` | didParamSchema | VERIFIED | z.string().min(1) for @Param validation |
| `packages/api/src/integration/full-flow.integration.spec.ts` | 6-step real-crypto integration test | VERIFIED | Exists, uses real providers (no mocks), all 6 steps pass |
| `packages/api/src/modules/credentials/credentials.service.ts` | depth-alignment fix (CIRCUIT_TREE_SIZE=16) | VERIFIED | mint() and verifyCredential() both pre-pad to 16 leaves; tamper-detection preserved |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| identity.controller.ts | identity.dto.ts | `@Body(new ZodValidationPipe(registerBodySchema))` | WIRED | 4 write endpoints all validated |
| credentials.controller.ts | credentials.dto.ts | `@Body(new ZodValidationPipe(mintBodySchema))` | WIRED | POST /credentials/mint |
| zk-proofs.controller.ts | zk-proofs.dto.ts | `@Body(new ZodValidationPipe(...))` | WIRED | POST /zk/prove and POST /zk/verify |
| affiliations.controller.ts | affiliations.dto.ts | `@Body(new ZodValidationPipe(requestBodySchema))` | WIRED | POST /affiliations/request |
| wallet.controller.ts | wallet.dto.ts | `@Body(new ZodValidationPipe(linkBodySchema))` | WIRED | POST /wallet/link |
| impact.controller.ts | impact.dto.ts | `@Param("did", new ZodValidationPipe(didParamSchema))` | WIRED | POST /impact/:did/calculate |
| full-flow.integration.spec.ts | real CredentialsService | mint() uses CIRCUIT_TREE_SIZE=16 depth | WIRED | depth fix ensures stored root matches prove() root; Step 4 confirms this |
| credentials.service.ts verifyCredential() | tamper detection | recomputes root from stored claims with same 16-leaf padding | WIRED | mutation of stored claim produces different padded root → valid:false confirmed in spec |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| Full test suite green (246 tests) | `pnpm --filter @urid/api exec vitest run` | 246 passed, 0 failed, 21 files | PASS |
| Integration Step 1: real Ed25519 DID registration | test output `Step 1` | PASSED 99ms — DID matches `did:ub:z6Mk` | PASS |
| Integration Step 4: real Groth16 prove | test output `Step 4` | PASSED 592ms — `proof.protocol === "groth16"` | PASS |
| Integration Step 5: Groth16 + Ed25519 verify | test output `Step 5` | PASSED 16ms — `valid: true` | PASS |
| Integration Step 6: tampered publicSignals rejected | test output `Step 6` | PASSED 14ms — `valid: false` | PASS |
| ZodValidationPipe unit test (6 cases) | `vitest run src/common/zod-validation.pipe.spec.ts` | 6/6 passed | PASS |

---

## HRD-01: Controller Validation Coverage (6/6)

| Controller | Write Endpoints Validated | Pipe Wired |
|------------|--------------------------|------------|
| identity | POST /register, PUT /did/:did, POST /did/:did/recovery, POST /did/:did/recovery/reconstruct | ZodValidationPipe on @Body for all 4 |
| credentials | POST /mint | ZodValidationPipe on @Body |
| zk-proofs | POST /prove, POST /verify | ZodValidationPipe on @Body for both |
| affiliations | POST /request | ZodValidationPipe on @Body |
| wallet | POST /link | ZodValidationPipe on @Body |
| impact | POST /:did/calculate | ZodValidationPipe on @Param("did") |

All 6 controllers covered. GET/param-only routes correctly left unvalidated.

---

## HRD-02: Unit Test Coverage

| Subsystem | Spec File | Tests |
|-----------|-----------|-------|
| Ed25519 keygen/sign/verify | `crypto/ed25519.spec.ts`, `crypto/crypto.service.spec.ts` | Multiple |
| Ledger hash-chain integrity | `ledger/hash-chain.spec.ts` | Multiple |
| Shamir round-trip | `modules/identity/identity.recovery.spec.ts` | Multiple |
| Credential sign/verify + tamper | `modules/credentials/credentials.service.spec.ts` | Multiple (tamper test: `valid:false` when claim mutated) |
| Groth16 prove→verify (non-member case) | `modules/zk-proofs/zk-proofs.service.spec.ts` | ZKP-03: `prove() with claimName not in credential throws` |
| Impact with mocked HTTP | `modules/impact/impact.service.spec.ts`, `sources/*.spec.ts` | Multiple |
| ZodValidationPipe | `common/zod-validation.pipe.spec.ts` | 6 |

---

## HRD-03: Depth-Alignment Fix — Correctness and Security Assessment

The `CIRCUIT_TREE_SIZE=16` (depth-4) pre-padding fix in `credentials.service.ts` is a genuine correctness fix:

1. **Root cause confirmed:** mint() previously built the Merkle tree at the natural depth (~3 for a typical claim set of 5-8 claims). prove() always pads to 16 leaves to match `MerkleInclusionProof(4)`. The two roots diverged, causing "Merkle root mismatch" at Step 4 of the integration test. The SUMMARY documents this was observed on the first test run before the fix.

2. **Fix is consistent:** Both mint() and verifyCredential() apply identical padding (`while (paddedLeaves.length < CIRCUIT_TREE_SIZE) paddedLeaves.push(0n)`), ensuring the stored root, the recomputed-at-verify root, and the prove()-computed root are all the same depth-4 tree.

3. **Phase 5 tamper-detection preserved:** The CRD-02 tamper test in `credentials.service.spec.ts` (line 306) mutates a stored claim field and asserts `verifyCredential()` returns `{ valid: false }`. This test passes in the full suite (246/246). The fix does not weaken the tamper-detection property — a mutated claim produces a different padded Merkle root, which mismatches the stored root.

4. **Crypto boundary not violated:** Ed25519 signature verification remains OUTSIDE the SNARK circuit. The circuit still proves Poseidon-Merkle membership only. The depth change only affects which root is built (depth-4 vs depth-3) — the architecture is unchanged.

---

## Requirements Coverage

| Requirement | Description | Status | Evidence |
|-------------|-------------|--------|----------|
| HRD-01 | All controllers reject malformed input via Zod DTOs | SATISFIED | 6/6 controllers wired; controller spec tests confirm 400 on bad input |
| HRD-02 | Full unit test suite passes across all crypto subsystems | SATISFIED | 246/246 tests pass; all required subsystems have specs |
| HRD-03 | E2E integration test passes complete real-crypto onboarding flow | SATISFIED | All 6 integration steps pass with real services |

---

## Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `credentials.service.ts` | 195 | `return []` in listByDid() | Info | Legitimate defensive guard — returns empty list when researcher not found; not a stub |

No blockers (TBD/FIXME/XXX), no stubs, no placeholder values found in any phase-modified file.

---

## Human Verification Required

None — all success criteria are fully verified programmatically. The test suite passes, controllers are wired, and the integration test demonstrates end-to-end real-crypto correctness including tamper rejection.

---

_Verified: 2026-07-06T23:24:28Z_
_Verifier: Claude (gsd-verifier)_
