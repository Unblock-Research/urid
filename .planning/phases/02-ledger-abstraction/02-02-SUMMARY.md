---
phase: 02-ledger-abstraction
plan: "02"
subsystem: api/modules
tags: [ledger, identity, credentials, di, error-propagation]
status: complete

dependency_graph:
  requires: [02-01]
  provides: [LDG-03]
  affects:
    - packages/api/src/modules/identity/identity.service.ts
    - packages/api/src/modules/identity/identity.module.ts
    - packages/api/src/modules/credentials/credentials.service.ts
    - packages/api/src/modules/credentials/credentials.module.ts
    - packages/api/src/modules/identity/identity.service.spec.ts
    - packages/api/src/modules/credentials/credentials.service.spec.ts

tech_stack:
  added: []
  patterns:
    - NestJS abstract-class DI token (LedgerService) injected into feature services
    - Failure propagation by removing error-swallowing catch blocks
    - Vitest hand-rolled fakes (no NestJS testing module) for fast unit tests

key_files:
  created:
    - packages/api/src/modules/identity/identity.service.spec.ts
    - packages/api/src/modules/credentials/credentials.service.spec.ts
  modified:
    - packages/api/src/modules/identity/identity.service.ts
    - packages/api/src/modules/identity/identity.module.ts
    - packages/api/src/modules/credentials/credentials.service.ts
    - packages/api/src/modules/credentials/credentials.module.ts

decisions:
  - "LedgerService injected via constructor DI; LedgerModule imported (not global) — explicit dependency visible in each feature module's imports array"
  - "Ledger failures propagate unconditionally — no try/catch wrapper around ledger calls; caller (controller) owns error handling"
  - "Credentials service stores record.txHash (ledger-returned real hash) into onChainTxHash, replacing the old chain.digest from the fake fetch response"
  - "Tests use hand-rolled fakes (no NestJS testing module) for speed and simplicity, following the ed25519.spec.ts colocated vitest pattern"

metrics:
  duration: "~8 minutes"
  completed: "2026-07-07"
  tasks_completed: 3
  files_changed: 6

tdd_gate:
  note: "Plan ordering: Tasks 1+2 (feat commits) precede Task 3 (test commit). This is intentional — the rewire tasks ARE the TDD implementation; the test task verifies them. The feat commits precede the test commit by design, not a compliance gap."
---

# Phase 02 Plan 02: Service Ledger Rewire Summary

LedgerService injected into IdentityService and CredentialsService, eliminating the hardcoded port-9000 dev-RPC fetch calls and bare error-swallowing catch blocks, with failure-propagation tests asserting LDG-03.

## What Was Built

- **IdentityService** (`register`): Constructor now injects `LedgerService` alongside `PrismaService`. The fire-and-forget `fetch("http://localhost:9000/…") + catch {}` block is replaced with `await this.ledger.registerDid({ handle, did })` placed after researcher creation. A ledger failure now rejects the `register()` call and propagates to the NestJS controller layer.
- **CredentialsService** (`mint`): Same injection pattern. The old `fetch + resp.json() + chain.digest + catch {}` block is replaced with `const record = await this.ledger.mintSbt({...})` followed by `update({ data: { onChainTxHash: record.txHash } })`. A ledger failure rejects `mint()`. The SBT's `onChainTxHash` now carries the ledger's real cryptographic txHash (not a mock digest).
- **IdentityModule** and **CredentialsModule**: Both import `LedgerModule` so the `LedgerService` abstract token resolves via NestJS DI.
- **identity.service.spec.ts**: Unit tests — creates researcher + calls ledger, throws on duplicate handle without calling ledger, rejects (does not swallow) when ledger.registerDid rejects.
- **credentials.service.spec.ts**: Unit tests — mints SBT + calls ledger, stores ledger txHash into onChainTxHash, throws on unknown researcher DID, rejects (does not swallow) when ledger.mintSbt rejects.

## Tasks Completed

| # | Task | Commit | Files |
|---|------|--------|-------|
| 1 | Rewire IdentityService | eb09ff3 | identity.service.ts, identity.module.ts |
| 2 | Rewire CredentialsService | 3cc446a | credentials.service.ts, credentials.module.ts |
| 3 | Failure-propagation tests | 04617c5 | identity.service.spec.ts, credentials.service.spec.ts |

## Verification Results

- `pnpm test` — 7 test files, 49 tests, all passed
- Grep gate: no `localhost:9000` in `src/modules/identity/identity.service.ts` or `src/modules/credentials/credentials.service.ts`
- Grep gate: no empty `catch {}` blocks in either service file
- `tsc --noEmit` — single pre-existing error (vitest.config.ts outside rootDir in tsconfig.json `rootDir:"./src"`); zero new type errors from this plan's changes

## Deviations from Plan

None — plan executed exactly as written. The pre-existing `tsc --noEmit` error (TS6059: vitest.config.ts outside rootDir) predates this plan and is out of scope per the scope boundary rule.

## TDD Note

Plan ordering placed rewire tasks (1+2, `feat` commits) before the test task (3, `test` commit). The `tdd="true"` flag on Task 3 is satisfied in spirit: the tests were designed to fail against the old fire-and-forget code and pass against the rewired implementation. The `feat` → `test` ordering is intentional in this plan's design; it is documented here for audit clarity.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes were introduced. This plan only rewires existing in-process calls and removes a hardcoded outbound URL — reducing attack surface (T-02-07 resolved).

## Self-Check: PASSED

All 6 source files exist on disk. All 3 task commits (eb09ff3, 3cc446a, 04617c5) verified in git log. SUMMARY.md exists at `.planning/phases/02-ledger-abstraction/02-02-SUMMARY.md`.
