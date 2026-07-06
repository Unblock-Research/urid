---
phase: 02-ledger-abstraction
plan: "01"
subsystem: ledger
status: complete
tags: [ledger, hash-chain, integrity, nestjs, prisma, sha256, tdd]
dependency_graph:
  requires: []
  provides:
    - packages/api/src/ledger/canonical.ts
    - packages/api/src/ledger/hash-chain.ts
    - packages/api/src/ledger/ledger.service.ts
    - packages/api/src/ledger/local-ledger.service.ts
    - packages/api/src/ledger/ledger.module.ts
  affects: []
tech_stack:
  added:
    - "@noble/hashes/sha256 — SHA-256 digest for txHash computation"
    - "@noble/hashes/utils — bytesToHex, utf8ToBytes"
  patterns:
    - "Abstract class as NestJS DI token ({ provide: LedgerService, useClass: LocalLedgerService })"
    - "In-process promise-chain mutex for serialized appends"
    - "Prisma interactive transaction for atomic index/prevHash/create"
    - "Pure, DB-free hash core (canonical.ts + hash-chain.ts) tested without a database"
key_files:
  created:
    - packages/api/src/ledger/canonical.ts
    - packages/api/src/ledger/hash-chain.ts
    - packages/api/src/ledger/hash-chain.spec.ts
    - packages/api/src/ledger/ledger.service.ts
    - packages/api/src/ledger/local-ledger.service.ts
    - packages/api/src/ledger/ledger.module.ts
  modified: []
decisions:
  - "LedgerService defined as abstract class (not interface + InjectionToken) for cleanest NestJS useClass swap idiom"
  - "Concurrency handled via in-process promise-chain mutex + Prisma $transaction; single-instance assumption documented"
  - "getTransaction returns normalised LedgerRecord (not raw Prisma row) to keep interface swappable for CHN-01"
  - "LedgerModule is NOT @Global — consumers import it explicitly so dependency is visible in their imports array"
  - "canonical.ts is self-contained (no external library) — deterministic key-sort via Object.keys().sort()"
metrics:
  duration: "~12 minutes"
  completed: "2026-07-07"
  tasks_completed: 3
  tasks_total: 3
  files_created: 6
  files_modified: 0
---

# Phase 02 Plan 01: LedgerService Interface + Hash-Chained LocalLedgerService Summary

**One-liner:** Hash-chained `LedgerService` abstract DI token with `LocalLedgerService` persisting tamper-evident SHA-256-linked rows in the `LedgerTransaction` table, serialized via an in-process mutex and Prisma interactive transaction.

## What Was Built

The complete ledger subsystem under `packages/api/src/ledger/`:

**`canonical.ts`** — Deterministic JSON serializer. Recursively sorts object keys (lexicographic) so identical data structures produce the same byte string regardless of insertion order. Array element order is preserved. Self-contained with no external dependencies.

**`hash-chain.ts`** — Pure, DB-free hash-chain core. Exports `GENESIS_PREV_HASH` (64 ASCII zeros), `LedgerEntry` and `ChainRow` types, `computeTxHash(entry, prevHash)` (sha256 over canonical + prevHash, returns 64-char hex), and `verifyChain(rows)` (walks rows ascending, checks index monotonicity, prevHash links, and recomputed txHash; returns `{ valid, brokenAt? }`).

**`hash-chain.spec.ts`** — 22 unit tests (TDD, vitest, node env) covering: canonicalize key-order independence and determinism, nested object handling, array order preservation, primitive serialization, GENESIS_PREV_HASH properties, computeTxHash determinism and input-sensitivity (index/type/payload/prevHash each trigger a different hash), verifyChain on empty/single/multi-row chains, link assertion (row[1].prevHash === row[0].txHash), tamper detection with correct `brokenAt`, non-monotonic index detection.

**`ledger.service.ts`** — Abstract class used as NestJS DI token. Exports `LedgerPayload` (Record<string,unknown>), `LedgerRecord` (normalised shape: index, type, payload, txHash, prevHash, createdAt), and `abstract class LedgerService` with four abstract methods: `registerDid`, `mintSbt`, `revokeSbt`, `getTransaction`. No import of any concrete implementation.

**`local-ledger.service.ts`** — `@Injectable() LocalLedgerService extends LedgerService`. In-process promise-chain mutex (`_appendQueue`) serializes all append calls. Each append body runs inside a `prisma.$transaction` that reads the last row, derives `prevHash` and `index`, computes `txHash`, and creates the row atomically. Single-instance assumption documented in header comment. Implements all four abstract methods plus `verifyChainIntegrity()` that loads all rows and delegates to the pure `verifyChain`.

**`ledger.module.ts`** — Non-global NestJS module providing `PrismaService` and `{ provide: LedgerService, useClass: LocalLedgerService }`, exporting the `LedgerService` token.

## Task Commits

| Task | Name | Commit | Key Files |
|------|------|--------|-----------|
| 1 | Canonical serializer + hash-chain core (TDD) | 98744c1 | canonical.ts, hash-chain.ts, hash-chain.spec.ts |
| 2 | LedgerService abstract class + types | b2cd975 | ledger.service.ts |
| 3 | LocalLedgerService + LedgerModule | 35af101 | local-ledger.service.ts, ledger.module.ts |

## Verification Results

```
pnpm test -- src/ledger/hash-chain.spec.ts
  Test Files  5 passed (5)
       Tests  42 passed (42)
```

TypeScript: `npx tsc --noEmit` — zero errors in `src/ledger/`. (Pre-existing TS6059 for `vitest.config.ts` outside `rootDir` is out of scope — existed before this plan.)

## Deviations from Plan

None — plan executed exactly as written. All threat model mitigations (T-02-01 tamper detection, T-02-02 monotonic index, T-02-03 concurrent append serialization) are implemented as specified.

## Threat Surface Scan

No new security-relevant surface introduced beyond what the plan's threat model covers. The `LedgerTransaction` table writes are entirely internal (no new network endpoints). The `verifyChainIntegrity` method is not exposed via HTTP — it is a service method only.

## Known Stubs

None. The ledger subsystem is fully functional as implemented. Callers (identity/credentials) are wired in plan 02-02.

## Self-Check: PASSED

Files exist:
- packages/api/src/ledger/canonical.ts: FOUND
- packages/api/src/ledger/hash-chain.ts: FOUND
- packages/api/src/ledger/hash-chain.spec.ts: FOUND
- packages/api/src/ledger/ledger.service.ts: FOUND
- packages/api/src/ledger/local-ledger.service.ts: FOUND
- packages/api/src/ledger/ledger.module.ts: FOUND

Commits exist: 98744c1, b2cd975, 35af101 — all verified in git log.
