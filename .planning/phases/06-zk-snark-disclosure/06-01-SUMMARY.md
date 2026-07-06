---
phase: 06-zk-snark-disclosure
plan: "01"
subsystem: api
tags: [zk-snark, groth16, circom, snarkjs, circomlib, dependencies]
status: complete

dependency_graph:
  requires: []
  provides: [snarkjs-runtime, circomlib-circuits]
  affects: [packages/api/package.json, pnpm-lock.yaml]

tech_stack:
  added:
    - snarkjs@0.7.6 (iden3 Groth16 prove/verify + trusted-setup CLI, CJS build)
    - circomlib@2.0.5 (iden3 circom circuit templates: Poseidon, MiMC, comparators, mux)
  patterns:
    - pnpm workspace filter install (pnpm --filter @urid/api add)

key_files:
  modified:
    - packages/api/package.json (added snarkjs ^0.7.6, circomlib ^2.0.5, build:circuit script)
    - pnpm-lock.yaml (resolved +25 packages)

decisions:
  - "Installed snarkjs and circomlib as runtime dependencies (not devDependencies) because snarkjs.groth16.fullProve/verify runs at request time in Plan 03"
  - "Did NOT add type:module to packages/api — NestJS targets CommonJS; snarkjs 0.7.x provides a CJS build via its node.require export condition"
  - "Added build:circuit script pointing to bash scripts/build-circuit.sh so Plan 02 can invoke circuit compilation via pnpm --filter @urid/api build:circuit"

metrics:
  duration: "68 seconds"
  completed: "2026-07-07"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 06 Plan 01: Install snarkjs + circomlib Summary

snarkjs 0.7.6 and circomlib 2.0.5 installed into @urid/api as runtime dependencies, with CJS resolution confirmed and circomlib circuit templates on disk for the Plan 02 build step.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Package-legitimacy checkpoint (pre-approved by orchestrator) | — | no code changes |
| 2 | Install snarkjs + circomlib, add build:circuit script | 3a32980 | packages/api/package.json, pnpm-lock.yaml |

## What Was Built

Two iden3 ZK toolchain packages are now resolved under `packages/api/node_modules`:

- **snarkjs 0.7.6** — Groth16 full-prove, verify, and trusted-setup CLI. Resolved CJS build (`require('snarkjs')` succeeds from `packages/api/`).
- **circomlib 2.0.5** — Circom circuit templates. `circuits/poseidon.circom` is present at the path Plan 02 will pass to the `-l` include flag.

A `build:circuit` npm script was added to `packages/api/package.json` so Plan 02 can invoke `pnpm --filter @urid/api build:circuit` to compile the circuit.

## Verification Results

All five acceptance criteria passed:

```
snarkjs: ok
poseidon.circom: ok
snarkjs in package.json: ok
circomlib in package.json: ok
build:circuit script: ok
```

All 101 existing API tests continued to pass after the install (`vitest run`, 10 test files).

## Deviations from Plan

None — plan executed exactly as written. Task 1 (package-legitimacy checkpoint) was pre-approved by the orchestrator; both packages confirmed as official iden3 org packages with the stated download volumes.

## Threat Surface Scan

No new network endpoints, auth paths, file access patterns, or schema changes introduced. The install adds supply-chain surface only, which was explicitly reviewed in Task 1 (T-06-SC, mitigated by blocking-human checkpoint and 06-RESEARCH.md audit).

## Self-Check: PASSED

- packages/api/package.json — FOUND, contains snarkjs and circomlib entries
- pnpm-lock.yaml — FOUND, updated (+203 lines)
- packages/api/node_modules/snarkjs/package.json — FOUND (v0.7.6)
- packages/api/node_modules/circomlib/circuits/poseidon.circom — FOUND
- commit 3a32980 — FOUND in git log
