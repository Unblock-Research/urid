---
phase: 08-hardening
plan: "03"
subsystem: api-validation
tags: [validation, zod, nestjs, dto, security, hrd-01]
dependency_graph:
  requires: [08-01, 08-02]
  provides: [affiliations-validation, wallet-validation, impact-validation, hrd-01-complete]
  affects: [affiliations-controller, wallet-controller, impact-controller]
tech_stack:
  added: []
  patterns: [ZodValidationPipe-param-decorator, explicit-ts-types-over-z-infer]
key_files:
  created:
    - packages/api/src/modules/affiliations/affiliations.dto.ts
    - packages/api/src/modules/wallet/wallet.dto.ts
    - packages/api/src/modules/impact/impact.dto.ts
    - packages/api/src/modules/affiliations/affiliations.controller.spec.ts
    - packages/api/src/modules/wallet/wallet.controller.spec.ts
    - packages/api/src/modules/impact/impact.controller.spec.ts
  modified:
    - packages/api/src/modules/affiliations/affiliations.controller.ts
    - packages/api/src/modules/wallet/wallet.controller.ts
    - packages/api/src/modules/impact/impact.controller.ts
decisions:
  - "Explicit TypeScript types (not z.infer) used in all DTOs to work around TS5.x + Zod 3.25 addQuestionMarks regression (same pattern as 08-02)"
  - "Impact controller has no request body; :did param validation on POST :did/calculate is what completes HRD-01 6-of-6 coverage"
  - "didParamSchema uses z.string().min(1) — rejects empty/blank, no prefix constraint required by plan"
metrics:
  duration: "~4 minutes"
  completed: "2026-07-06T23:13:20Z"
  tasks_completed: 3
  files_changed: 9
status: complete
---

# Phase 08 Plan 03: Affiliations, Wallet, Impact DTO Schemas — Summary

Completed HRD-01 controller coverage (6-of-6) by wiring `ZodValidationPipe` into the three remaining controllers — affiliations, wallet, and impact — with colocated `*.dto.ts` schemas.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Affiliations DTO schema + wiring | a4fe9f8 | affiliations.dto.ts, affiliations.controller.ts |
| 2 | Wallet DTO schema + wiring | 6a9f856 | wallet.dto.ts, wallet.controller.ts |
| 3 | Impact param DTO + wiring (6-of-6) | f6504db | impact.dto.ts, impact.controller.ts |
| — | Controller validation tests (Rule 2) | e76ff59 | *.controller.spec.ts ×3 |

## What Was Built

**affiliations.dto.ts** — `requestBodySchema`: `researcherDid`, `organizationName`, `role` all `z.string().min(1)`. Wired to `POST /affiliations/request` via `@Body(new ZodValidationPipe(requestBodySchema))`.

**wallet.dto.ts** — `linkBodySchema`: `researcherDid`, `address`, `chain` required; `label` optional. Wired to `POST /wallet/link` via `@Body(new ZodValidationPipe(linkBodySchema))`.

**impact.dto.ts** — `didParamSchema`: `z.string().min(1)`. Wired to `POST /impact/:did/calculate` via `@Param("did", new ZodValidationPipe(didParamSchema))`. Impact has no request body; the `:did` param on the write endpoint is what provides coverage for HRD-01.

**HRD-01 coverage complete**: all 6 controllers now enforce Zod validation on their write path:
- identity (08-01): POST /identity/register, PUT /identity/did/:did, POST /identity/did/:did/recovery, POST /identity/.../reconstruct
- credentials (08-01): POST /credentials/mint
- zk-proofs (08-02): POST /zk-proofs/generate, POST /zk-proofs/verify
- affiliations (08-03): POST /affiliations/request
- wallet (08-03): POST /wallet/link
- impact (08-03): POST /impact/:did/calculate

## Verification Results

- `npx tsc --noEmit`: clean (0 errors)
- `npx vitest run`: 240 tests pass across 20 test files (19 new tests added)

## Deviations from Plan

### Auto-added Missing Critical Functionality (Rule 2)

**1. [Rule 2 - Tests] Added controller-level validation spec files**
- **Found during:** Post-task review — plan required "malformed rejected (400), valid passes" tests but no spec files existed for affiliations, wallet, or impact controllers
- **Fix:** Created 3 colocated `*.controller.spec.ts` files (affiliations: 7 cases, wallet: 7 cases, impact: 5 cases = 19 total new tests)
- **Files modified:** affiliations.controller.spec.ts, wallet.controller.spec.ts, impact.controller.spec.ts
- **Commit:** e76ff59

**2. [Rule 1 - Bug] Used explicit TypeScript types instead of z.infer**
- **Found during:** Task 1 — `z.infer<typeof requestBodySchema>` produced optional fields due to TS5.x + Zod 3.25 `addQuestionMarks` regression
- **Fix:** Explicit `type RequestBodyDto = { researcherDid: string; ... }` (same pattern as 08-02's identity.dto.ts and credentials.dto.ts)
- **Files modified:** affiliations.dto.ts, wallet.dto.ts (impact.dto.ts uses a scalar schema — unaffected)
- **Commit:** a4fe9f8

## Decisions Made

1. Explicit TypeScript types (not `z.infer`) used for affiliations and wallet DTOs — workaround for TS5.x + Zod 3.25 `addQuestionMarks` inference regression (same decision as 08-02).
2. `didParamSchema` = `z.string().min(1)` with no `did:` prefix requirement — plan specifies "at minimum reject empty/blank", optional prefix constraint.

## Known Stubs

None — all schemas map to real service inputs.

## Threat Flags

None — no new network endpoints or auth paths introduced. Existing endpoints now have input validation closing T-08-05 and T-08-06.

## Self-Check: PASSED

Files exist:
- packages/api/src/modules/affiliations/affiliations.dto.ts ✓
- packages/api/src/modules/wallet/wallet.dto.ts ✓
- packages/api/src/modules/impact/impact.dto.ts ✓
- packages/api/src/modules/affiliations/affiliations.controller.spec.ts ✓
- packages/api/src/modules/wallet/wallet.controller.spec.ts ✓
- packages/api/src/modules/impact/impact.controller.spec.ts ✓

Commits exist:
- a4fe9f8 ✓ (affiliations DTO + wiring)
- 6a9f856 ✓ (wallet DTO + wiring)
- f6504db ✓ (impact param DTO + wiring)
- e76ff59 ✓ (controller validation tests)
