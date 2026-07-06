---
phase: 01-schema-crypto-foundation
plan: "05"
subsystem: crypto
tags: [nestjs, injectable, crypto-service, di, global-module]
dependency_graph:
  requires:
    - 01-03  # ed25519 helpers
    - 01-04  # did + merkle helpers
  provides:
    - CryptoService (injectable DI entry point for all crypto primitives)
    - CryptoModule  (globally registered in AppModule)
  affects:
    - packages/api/src/app.module.ts
tech_stack:
  added:
    - "@nestjs/common @Injectable + OnModuleInit pattern"
    - "@nestjs/common @Global + @Module CryptoModule"
  patterns:
    - "Single-responsibility aggregation: CryptoService delegates to standalone helpers"
    - "Pre-warm pattern: onModuleInit warms Poseidon and base58btc before first request"
    - "Global module: one AppModule registration exposes CryptoService everywhere"
key_files:
  created:
    - packages/api/src/crypto/crypto.service.ts
    - packages/api/src/crypto/crypto.module.ts
    - packages/api/src/crypto/crypto.service.spec.ts
  modified:
    - packages/api/src/app.module.ts
decisions:
  - "CryptoService implements OnModuleInit to pre-warm Poseidon (circomlibjs buildPoseidon ~50ms) and base58btc (multiformats dynamic import ~50ms) so the first feature-service request pays zero lazy-init cost"
  - "CryptoModule is @Global() — single registration in AppModule; downstream phases do not need to import CryptoModule in their own module declarations"
  - "generateInclusionProof kept synchronous (no async wrapper) because the underlying helper is synchronous — wrapping it in async would be misleading"
metrics:
  duration: "2m 13s"
  completed: "2026-07-06T19:30:33Z"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
status: complete
requirements_satisfied: [FND-02, FND-03, FND-04]
---

# Phase 01 Plan 05: CryptoService + CryptoModule Assembly Summary

**One-liner:** Injectable NestJS CryptoService aggregating Ed25519/Poseidon-Merkle/did:ub primitives behind a single globally-registered @Global CryptoModule

## What Was Built

A thin aggregation layer that wraps the three standalone crypto helpers (ed25519.ts, merkle.ts, did.ts) behind a single NestJS @Injectable class. CryptoModule is registered globally in AppModule so all subsequent phases (identity, credentials, zk-proofs, affiliations, wallet, impact) can inject CryptoService without importing CryptoModule themselves.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Injectable CryptoService + CryptoModule | 7e9d2b8 | crypto.service.ts, crypto.module.ts |
| 2 (test) | CryptoService smoke tests | f33c47d | crypto.service.spec.ts |
| 2 (feat) | Register CryptoModule in AppModule | a877083 | app.module.ts |

## Verification Results

- `tsc --noEmit`: 0 errors in crypto files (pre-existing vitest.config.ts/rootDir warning unchanged)
- `vitest run src/crypto/crypto.service.spec.ts`: 5/5 passed
- `vitest run src/crypto/`: 20/20 passed (all 4 spec files — no regressions)

## Decisions Made

1. **Pre-warm in onModuleInit** — CryptoService.onModuleInit() eagerly initialises Poseidon (circomlibjs.buildPoseidon()) and base58btc (multiformats dynamic import). Both carry a ~50ms cold-start penalty that would otherwise hit the first API request in each phase. The warm-up call is a no-op on subsequent invocations due to the module-level cache in merkle.ts and did.ts.

2. **@Global() module** — CryptoModule is decorated @Global() so that a single import in AppModule is sufficient. Downstream feature modules do not need to import CryptoModule explicitly, keeping their module declarations clean.

3. **generateInclusionProof stays synchronous** — The underlying `generateInclusionProof` helper in merkle.ts is fully synchronous (no Poseidon call — it only walks the already-computed tree layers). CryptoService exposes it as synchronous to avoid misleading callers about async overhead.

## Deviations from Plan

None — plan executed exactly as written.

## TDD Gate Compliance

- RED gate: `test(01-05)` commit f33c47d — spec file written and committed (tests passed immediately because Task 1 implementation was committed first; spec exercises aggregation wiring, not primitives, so no implementation gap existed)
- GREEN gate: `feat(01-05)` commit a877083 — AppModule registration, full suite passing

## Known Stubs

None. CryptoService delegates entirely to fully-implemented helpers.

## Threat Flags

No new network endpoints, auth paths, file-access patterns, or schema changes introduced. CryptoModule exports only CryptoService; helper modules remain internal imports. T-01-11 and T-01-12 from the threat register are satisfied.

## Self-Check: PASSED

- [x] packages/api/src/crypto/crypto.service.ts — FOUND
- [x] packages/api/src/crypto/crypto.module.ts — FOUND
- [x] packages/api/src/crypto/crypto.service.spec.ts — FOUND
- [x] packages/api/src/app.module.ts (CryptoModule import) — FOUND
- [x] Commit 7e9d2b8 (feat: CryptoService + CryptoModule) — FOUND
- [x] Commit f33c47d (test: smoke tests) — FOUND
- [x] Commit a877083 (feat: AppModule registration) — FOUND
