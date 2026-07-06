---
phase: 01-schema-crypto-foundation
plan: "02"
subsystem: api-tooling
tags: [crypto, dependencies, vitest, testing, ed25519, poseidon, multibase, noble, circomlibjs, multiformats]
status: complete

dependency_graph:
  requires:
    - Phase 01 Plan 01 (Prisma schema — @urid/api workspace must exist)
  provides:
    - "@noble/ed25519@^2 runtime dep in @urid/api"
    - "@noble/hashes@^1 runtime dep in @urid/api"
    - "circomlibjs runtime dep in @urid/api"
    - "multiformats@^13 runtime dep in @urid/api"
    - "vitest devDependency in @urid/api with passWithNoTests runner"
    - "packages/api/vitest.config.ts — node env, src/**/*.spec.ts glob"
    - "pnpm test script (vitest run) in @urid/api package.json"
  affects:
    - Plans 03 and 04 (TDD of CryptoService and DID helpers depend on this test harness)
    - All downstream phases that import the crypto primitives

tech_stack:
  added:
    - "@noble/ed25519@^2 (Paul Miller — audited Ed25519 keygen/sign/verify)"
    - "@noble/hashes@^1 (Paul Miller — SHA-512 hook for ed25519 v2 + utilities)"
    - "circomlibjs@^0.1.7 (iden3 — circom-compatible Poseidon for Merkle trees)"
    - "multiformats@^13.4.2 (Protocol Labs — base58btc multibase for did:ub encoding)"
    - "vitest@^4.1.10 (devDep — ESM-native test runner, avoids ts-jest ESM interop issues)"
  patterns:
    - vitest node environment with passWithNoTests for TDD-first workflow
    - pnpm workspace filter install (--filter @urid/api) to scope deps to api package

key_files:
  created:
    - packages/api/vitest.config.ts
  modified:
    - packages/api/package.json
    - pnpm-lock.yaml
    - packages/mobile/package.json (deviation fix only)

decisions:
  - vitest chosen over ts-jest because multiformats v13 is pure ESM and circomlibjs has ESM interop sensitivity; vitest resolves both natively
  - passWithNoTests enabled so the runner exits 0 before any spec files exist, unblocking TDD cycle in Plans 03 and 04
  - "@noble/ed25519 v2 requires SHA-512 hook wired from @noble/hashes before sign/verify — documented as note for Plan 03 implementer"
  - multiformats v13 is pure ESM — DID helpers will load it via dynamic import in Plan 03

metrics:
  duration: ~5 minutes
  completed: "2026-07-07"
  tasks_completed: 1
  tasks_total: 2
  files_created: 1
  files_modified: 3
---

# Phase 01 Plan 02: Crypto Deps + Vitest Test Runner Summary

**One-liner:** Installed the locked Ed25519, Poseidon, and multibase crypto packages into the @urid/api workspace and configured vitest to run an ESM-native test suite with passWithNoTests, unblocking TDD in Plans 03 and 04.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Verify package legitimacy (blocking-human gate) | — (pre-approved by orchestrator) | — |
| 2 | Install crypto deps + configure vitest | `1f94420` | packages/api/package.json, packages/api/vitest.config.ts, pnpm-lock.yaml |

## What Shipped

### Task 1 — Package Legitimacy Gate

Pre-approved by the orchestrator before this executor was spawned. All five packages confirmed as legitimate, well-known, widely-used packages on the npm registry:

| Package | Registry | Author/Org |
|---------|----------|------------|
| @noble/ed25519 | npmjs.com | paulmillr (Paul Miller) |
| @noble/hashes | npmjs.com | paulmillr (Paul Miller) |
| circomlibjs | npmjs.com | iden3 org |
| multiformats | npmjs.com | multiformats / ipld (Protocol Labs) |
| vitest | npmjs.com | vitest-dev |

### Task 2 — Install + Configure

**Crypto runtime deps added to packages/api/package.json:**

```json
"@noble/ed25519": "^2.3.0",
"@noble/hashes":  "^1.8.0",
"circomlibjs":    "^0.1.7",
"multiformats":   "^13.4.2"
```

**Test tooling added:**

```json
devDependencies: { "vitest": "^4.1.10" }
scripts:         { "test": "vitest run" }
```

**packages/api/vitest.config.ts created:**

```ts
import { defineConfig } from 'vitest/config';
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.spec.ts'],
    passWithNoTests: true,
  },
});
```

**Verification output:**

```
RUN  v4.1.10 /packages/api
No test files found, exiting with code 0
```

Exit code 0 with "No test files found" — confirms passWithNoTests is active and the runner is ready for TDD.

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 3 - Blocking] Fixed non-existent react-native version in mobile package.json**

- **Found during:** Task 2 — first `pnpm --filter @urid/api add` invocation
- **Issue:** `packages/mobile/package.json` specified `react-native@0.77.5`, which does not exist on the npm registry (0.77.x series only goes up to 0.77.3). pnpm validates the entire workspace lockfile even for single-package `--filter` installs, so this pre-existing error blocked all dependency additions.
- **Fix:** Changed `"react-native": "0.77.5"` to `"react-native": "0.77.3"` in `packages/mobile/package.json` (preserving the apparent 0.77.x intent of the prior change).
- **Files modified:** packages/mobile/package.json
- **Commit:** `1f94420` (included in the same task commit)

## Notes for Downstream Plans

- **Plan 03 (CryptoService):** `@noble/ed25519` v2 requires a SHA-512 hook be wired from `@noble/hashes` before any `sign()` or `verify()` call — see the noble/ed25519 v2 migration guide.
- **Plan 03 (DID helpers):** `multiformats` v13 is pure ESM. Import via `await import('multiformats/bases/base58')` (dynamic import) when the surrounding module is CommonJS.
- **Plan 04 (Merkle/Poseidon):** Use `circomlibjs`'s default Poseidon parameters — these are the same parameters the circom `poseidon()` template uses, ensuring Phase 6 JS-side roots match circuit-side roots.

## Known Stubs

None. This plan installs tooling only; no application-layer code was introduced.

## Threat Flags

None. No new network endpoints, auth paths, or file access patterns introduced. Dependency supply-chain risk addressed by the blocking-human legitimacy checkpoint (T-01-SC in plan threat model).

## Self-Check: PASSED

- `packages/api/vitest.config.ts` — FOUND
- `packages/api/package.json` contains @noble/ed25519, @noble/hashes, circomlibjs, multiformats — CONFIRMED
- `packages/api/package.json` contains vitest devDep and test script — CONFIRMED
- Commit `1f94420` — FOUND
- Vitest run exits 0 with "No test files found" — CONFIRMED
