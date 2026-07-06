---
phase: 03-real-dids-keys
plan: "01"
subsystem: identity
status: complete
tags: [identity, crypto, did, ed25519, tdd]
dependency_graph:
  requires: [CryptoService (Phase 1), LedgerService (Phase 2)]
  provides: [real-DID registration, self-certifying identity, private-key-once response]
  affects: [identity.service.ts, identity.controller.ts, identity.service.spec.ts]
tech_stack:
  added: []
  patterns: [TDD RED/GREEN, real CryptoService in unit tests, fake-prisma echo pattern]
key_files:
  created: []
  modified:
    - packages/api/src/modules/identity/identity.service.ts
    - packages/api/src/modules/identity/identity.controller.ts
    - packages/api/src/modules/identity/identity.service.spec.ts
    - packages/api/tsconfig.json
decisions:
  - "Used real CryptoService (not mocked) in unit tests to assert genuine DID-format and round-trip behavior"
  - "Return shape { researcher, did, publicKey, privateKey, keyCustody } keeps privateKey exactly once at a named field"
  - "encryptedPrivateKey left null (client custody this milestone, per D-IDN-02)"
  - "tsconfig include:[src] added to fix pre-existing rootDir conflict blocking tsc --noEmit"
metrics:
  duration_minutes: 3
  completed: "2026-07-07"
  tasks_completed: 2
  files_changed: 4
---

# Phase 3 Plan 01: Real DID Registration Summary

**One-liner:** Ed25519 keypair + `did:ub:z6Mk…` DID derivation via `CryptoService.encodeDid`, with public key persisted, private key returned once, and real identity anchored via `ledger.registerDid`.

## Objective

Replace the fake character-code-sum DID (`did:ub:0x000001FE`) with a genuine cryptographic identity. `identity.register()` now generates a real Ed25519 keypair, derives a self-certifying DID from the public key, stores the public key on the `Researcher`, returns the private key to the caller exactly once (never persisted), and anchors the DID on the ledger.

## Tasks Executed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | RED — failing tests encoding real-DID contract | 9dacfeb | identity.service.spec.ts |
| 2 | GREEN — rewrite register() + drop did override | f695a7c | identity.service.ts, identity.controller.ts, tsconfig.json |

## Verification Results

- **vitest run identity.service.spec.ts:** 8/8 tests pass (GREEN)
- **vitest run (full suite):** 54/54 tests pass across 7 files
- **tsc --noEmit:** clean (0 errors)

## Success Criteria Verification

- [x] `register` returns a DID matching `did:ub:z6Mk…`; the legacy `0x` char-code path is deleted
- [x] Response contains the generated private key exactly once, flagged as shown-once (`keyCustody` field)
- [x] `prisma.researcher.create` receives non-null `publicKey` (hex) + `keyType: 'Ed25519'`; `encryptedPrivateKey` never written
- [x] `ledger.registerDid` called once with `{ handle, did, publicKey }` carrying the real DID + key
- [x] `decodeDid(result.did) === stored publicKey bytes` (self-certifying round-trip passes in test 5)
- [x] Duplicate handle still throws `'Handle already taken'` without anchoring; external `did` input removed from signature
- [x] All spec tests pass; `tsc --noEmit` clean

## TDD Gate Compliance

RED commit: `9dacfeb` — `test(03-01): add failing RED tests encoding real-DID register contract`
GREEN commit: `f695a7c` — `feat(03-01): rewrite register() with real Ed25519 keypair and did:ub DID`

RED/GREEN gate sequence is present and in correct order.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed pre-existing tsconfig rootDir conflict blocking `tsc --noEmit`**
- **Found during:** Task 2 verify step
- **Issue:** `tsconfig.json` had `rootDir: "./src"` but no `include` directive — the default `**/*` pattern picked up `vitest.config.ts` at the package root, causing TS6059 error
- **Fix:** Added `"include": ["src"]` to tsconfig.json to scope compilation to `src/` only
- **Files modified:** `packages/api/tsconfig.json`
- **Commit:** f695a7c

## Known Stubs

None. The register endpoint wires real cryptographic values end-to-end. `encryptedPrivateKey` is intentionally null (client custody), documented in the response's `keyCustody` field and in `03-CONTEXT.md`.

## Threat Surface Scan

No new endpoints, auth paths, or schema changes introduced beyond what the plan's threat model covers. The plan's threat register addresses all four surfaces:

| Threat | Status |
|--------|--------|
| T-03-01 Spoofing (external DID input) | Mitigated — `did?` removed from signature |
| T-03-02 Info Disclosure (private key) | Mitigated — returned once, never logged, never stored |
| T-03-03 Tampering (publicKey vs DID) | Mitigated — same keypair call; test 5 asserts consistency |
| T-03-04 Repudiation (DID registration event) | Accepted — ledger anchor present |

## Self-Check: PASSED

Files exist:
- `/Users/mahboobimtiyaz/development/urid/packages/api/src/modules/identity/identity.service.ts` — FOUND
- `/Users/mahboobimtiyaz/development/urid/packages/api/src/modules/identity/identity.controller.ts` — FOUND
- `/Users/mahboobimtiyaz/development/urid/packages/api/src/modules/identity/identity.service.spec.ts` — FOUND

Commits exist:
- `9dacfeb` — FOUND (test RED)
- `f695a7c` — FOUND (feat GREEN)
