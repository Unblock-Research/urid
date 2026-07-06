---
phase: 05-verifiable-credentials
plan: "02"
subsystem: credentials
tags: [verifiable-credentials, poseidon-merkle, ed25519, tamper-evidence, tdd]
status: complete

dependency_graph:
  requires: [05-01]
  provides: [CRD-01, CRD-02, CRD-03]
  affects: [credentials.service.ts, credentials.controller.ts, credentials.service.spec.ts]

tech_stack:
  added: []
  patterns:
    - Poseidon-Merkle commitment (buildClaimSet → encodeClaimsToLeaves → buildMerkleTree)
    - Ed25519 issuer signature over rootMessageBytes(merkleRoot)
    - In-memory Prisma fake for mint→verify round-trip without DB
    - TDD RED/GREEN gate sequence (test commit then feat commit)

key_files:
  created: []
  modified:
    - packages/api/src/modules/credentials/credentials.service.ts
    - packages/api/src/modules/credentials/credentials.controller.ts
    - packages/api/src/modules/credentials/credentials.service.spec.ts

decisions:
  - "Build claim set AFTER Prisma create so the stored issuedAt timestamp (server-assigned) is the canonical source of truth used in both the claim JSON and the Merkle root. Recomputing at verify time from STORED claims is therefore always consistent."
  - "Single soulboundToken.update call persists claims + merkleRoot + issuerSignature + issuerPublicKey + onChainTxHash together, keeping the ledger anchor (CRD-03) and crypto commitment atomic."
  - "verifyCredential returns { valid: boolean } shape; controller wraps it as { id, valid } for client convenience."
  - "Prisma Json fields cast via (claims as any) for write and (sbt.claims as unknown as Claim[]) for read to satisfy strict Prisma InputJsonValue / JsonValue types without weakening the Claim[] contract."
  - "GET credentials/:id/verify placed BEFORE @Get(':did') in the controller; two-segment path avoids routing shadow."

metrics:
  duration: "~6 minutes"
  completed: "2026-07-07"
  tasks_completed: 2
  tests_added: 9
  files_modified: 3

requirements_satisfied: [CRD-01, CRD-02, CRD-03]
---

# Phase 05 Plan 02: Credential Commitment and Verification Summary

**One-liner:** Poseidon-Merkle root over canonical claim set, Ed25519 issuer signature stored on every SBT, with independent tamper-evident verifyCredential() recomputing the root from stored claims.

## What Was Built

### Task 1 — Extend mint() with Poseidon-Merkle commitment + Ed25519 signature (CRD-01, CRD-03)

`credentials.service.ts` was extended to:

1. Inject `CryptoService` and `IssuerKeyService` alongside the existing `PrismaService` and `LedgerService`.
2. After `soulboundToken.create` (which captures the server-side `issuedAt`), build the canonical claim set with `buildClaimSet({ holderDid, credentialType, title, issuer, fieldOfStudy, issuedAt })` using the SBT's Prisma-assigned `issuedAt.toISOString()`.
3. Compute `encodeClaimsToLeaves(claims)` → `crypto.buildMerkleTree(leaves)` → `merkleRoot` hex.
4. Sign `rootMessageBytes(merkleRoot)` via `issuerKey.sign()` → hex-encode via `bytesToHex`.
5. Call `ledger.mintSbt(...)` for the CRD-03 ledger anchor (unchanged).
6. Persist `claims`, `merkleRoot`, `issuerSignature`, `issuerPublicKey`, `onChainTxHash` in a single `soulboundToken.update`.
7. Return the updated SBT row including `merkleRoot` and `issuerPublicKey`.

### Task 2 — verifyCredential() + GET credentials/:id/verify route (CRD-02)

`verifyCredential(id)` added to `credentials.service.ts`:

1. Load SBT via `prisma.soulboundToken.findUnique`; return `{ valid: false }` if missing or any crypto field is null.
2. Recompute Merkle root from STORED `claims` using the same `encodeClaimsToLeaves` + `buildMerkleTree` path — any tampered claim yields a different root → false.
3. `Ed25519.verify(hexToBytes(issuerSignature), rootMessageBytes(storedMerkleRoot), hexToBytes(issuerPublicKey))` — a signature not produced by the matching issuer private key → false.

`GET credentials/:id/verify` added to `credentials.controller.ts` (two-segment path, placed before the single-segment `@Get(':did')` to avoid routing conflict), returning `{ id, valid }`.

## Test Results

All 13 mandatory Phase 5 tests pass (101/101 full suite):

| Test | Result |
|------|--------|
| creates SBT and anchors via ledger.mintSbt (CRD-03) | PASS |
| stores ledger-returned txHash into onChainTxHash | PASS |
| throws "Researcher not found" without calling ledger | PASS |
| propagates ledger failure (T-02-05) | PASS |
| stores non-null merkleRoot, issuerSignature, issuerPublicKey (CRD-01) | PASS |
| stored issuerPublicKey matches IssuerKeyService.getPublicKeyHex() | PASS |
| stored merkleRoot is a genuine Poseidon-Merkle commitment to stored claims | PASS |
| stored claims contain stable issuedAt string claim | PASS |
| verifyCredential returns true for untampered credential (CRD-02) | PASS |
| verifyCredential returns false when stored claim is mutated (CRD-02) | PASS |
| verifyCredential returns false with wrong issuerPublicKey (CRD-02) | PASS |
| verifyCredential returns false for missing crypto fields (CRD-02) | PASS |
| verifyCredential returns false for unknown credential id (CRD-02) | PASS |

TypeScript: `tsc --noEmit` clean (fixed Prisma `InputJsonValue` / `JsonValue` cast).

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Prisma JSON type incompatibility with Claim[]**
- **Found during:** Task 1 GREEN (TypeScript typecheck)
- **Issue:** Prisma's `InputJsonValue` type does not accept a typed `Claim[]` directly; `sbt.claims` (returned as `Prisma.JsonValue`) cannot be cast directly to `Claim[]`.
- **Fix:** Write path uses `claims as any`; read path uses `sbt.claims as unknown as Claim[]`.
- **Files modified:** `credentials.service.ts` lines 101, 142
- **Commit:** 14f5b63

No other deviations. Plan executed as written.

## TDD Gate Compliance

| Gate | Commit | Message |
|------|--------|---------|
| RED (test) | cba983e | `test(05-02): add failing RED tests for mint() crypto commitment and verifyCredential()` |
| GREEN (feat) | 14f5b63 | `feat(05-02): extend mint() with Poseidon-Merkle commitment + add verifyCredential() and verify route` |

Both RED and GREEN gates present in git history.

## Known Stubs

None — all crypto fields are real Poseidon-Merkle and Ed25519 values computed at mint time.

## Threat Flags

No new security-relevant surface beyond the plan's threat model. The existing threat register (T-05-01 through T-05-SC) is fully mitigated as planned.

## Self-Check: PASSED

- `credentials.service.ts` exists and contains `IssuerKeyService`, `buildClaimSet`, `mintSbt`, `verifyCredential` — FOUND
- `credentials.controller.ts` exists and contains `verify` route — FOUND
- `credentials.service.spec.ts` exists — FOUND
- Commits `cba983e` (RED) and `14f5b63` (GREEN) present in git log — VERIFIED
- 101/101 tests pass, `tsc --noEmit` clean — VERIFIED
