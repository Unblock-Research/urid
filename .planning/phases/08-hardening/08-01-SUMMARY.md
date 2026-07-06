---
phase: 08-hardening
plan: "01"
subsystem: api/common
tags: [validation, zod, nestjs-pipe, unit-test]
status: complete

dependency_graph:
  requires: []
  provides: [ZodValidationPipe]
  affects: [packages/api/src/modules/*/controllers (wave 2 wiring)]

tech_stack:
  added: []
  patterns:
    - "NestJS PipeTransform instantiated per-route (not globally registered)"
    - "zod safeParse with flatten() for structured error exposure"

key_files:
  created:
    - packages/api/src/common/zod-validation.pipe.ts
    - packages/api/src/common/zod-validation.pipe.spec.ts
  modified: []

decisions:
  - "Per-route instantiation (new ZodValidationPipe(schema)) over global registry — matches HRD-01 locked decision"
  - "flatten() used for error payload — exposes fieldErrors/formErrors only, no internal Zod internals or stack"

metrics:
  duration: "~5 minutes"
  completed_date: "2026-07-07"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 2
---

# Phase 08 Plan 01: ZodValidationPipe Summary

## One-Liner

Custom NestJS `ZodValidationPipe` using `zod.safeParse` + `flatten()` for structured 400 errors, with 6-case unit test suite.

## What Was Built

`ZodValidationPipe` is a `PipeTransform` implementation placed in `src/common/`. It accepts any `ZodSchema` at construction time and is designed for per-route use (`@Body(new ZodValidationPipe(schema))` or `@Param('id', new ZodValidationPipe(z.string().uuid()))`).

- **Success path:** `safeParse` success → returns `result.data` (the parsed, typed value)
- **Failure path:** `safeParse` failure → throws `new BadRequestException({ message: "Validation failed", errors: result.error.flatten() })`; NestJS maps this to a structured JSON 400 response
- **No new dependencies:** uses the existing `zod` ^3.25.0 dep; only imports `@nestjs/common` and `zod`

## Tasks Completed

| # | Task | Commit |
|---|------|--------|
| 1 | Create ZodValidationPipe | 0dfaefe |
| 2 | Unit-test ZodValidationPipe | 0dfaefe |

## Verification Results

| Check | Result |
|-------|--------|
| `tsc --noEmit` (packages/api) | PASS — zero errors |
| `vitest run src/common/zod-validation.pipe.spec.ts` | PASS — 6/6 tests green |

### Test Coverage

1. Valid object body returns the parsed value
2. Missing required field throws `BadRequestException`
3. Wrong-typed field throws `BadRequestException`
4. Scalar `z.string().min(1)` rejects an empty string (`@Param` path)
5. Non-empty scalar string passes through
6. Error response shape: contains `{ message, errors: { fieldErrors, formErrors } }` with no stack trace (T-08-02)

## Deviations from Plan

None — plan executed exactly as written. Both tasks completed in a single atomic commit since the spec file is inseparable from the pipe file (vitest colocated convention).

## Threat Mitigations Applied

| Threat | Mitigation | Location |
|--------|-----------|----------|
| T-08-01 (DoS/Tampering) | Rejects malformed bodies/params with 400 before any DB/crypto work | `transform()` — fast-fail via `safeParse` |
| T-08-02 (Info Disclosure) | `error.flatten()` exposes only `fieldErrors`/`formErrors` — no stack, no Zod internals | `throw new BadRequestException(...)` |

## Known Stubs

None — pipe is fully functional. Controllers are wired in 08-02/08-03 (per plan).

## Self-Check: PASSED

- `packages/api/src/common/zod-validation.pipe.ts` — FOUND
- `packages/api/src/common/zod-validation.pipe.spec.ts` — FOUND
- commit 0dfaefe — verified via `git log --oneline`
