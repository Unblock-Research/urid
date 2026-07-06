---
phase: 08-hardening
plan: "02"
subsystem: api/validation
tags: [zod, validation, dto, identity, credentials, zk-proofs, security]
dependency_graph:
  requires: [08-01]
  provides: [08-03]
  affects: [api/identity, api/credentials, api/zk-proofs]
tech_stack:
  added: []
  patterns: [ZodValidationPipe per-endpoint wiring, colocated *.dto.ts schema files, explicit TS types alongside Zod schemas]
key_files:
  created:
    - packages/api/src/modules/identity/identity.dto.ts
    - packages/api/src/modules/credentials/credentials.dto.ts
    - packages/api/src/modules/zk-proofs/zk-proofs.dto.ts
  modified:
    - packages/api/src/modules/identity/identity.controller.ts
    - packages/api/src/modules/credentials/credentials.controller.ts
    - packages/api/src/modules/zk-proofs/zk-proofs.controller.ts
decisions:
  - "Explicit TypeScript types instead of z.infer — TypeScript 5.9 + Zod 3.25 addQuestionMarks makes required fields optional in the flattened object output type; explicit types avoid this regression while keeping Zod for runtime validation"
  - "fieldOfStudy added to mintBodySchema and MintBody — the service's mint() already accepts this field; the controller body type was previously missing it; including it closes the contract gap"
  - "All GET/param-only routes left completely untouched — only write endpoints (POST/PUT with a body) receive ZodValidationPipe"
metrics:
  duration: "~8 minutes"
  completed: "2026-07-07"
  tasks_completed: 3
  tasks_total: 3
status: complete
---

# Phase 08 Plan 02: Zod DTO Schemas + Wiring for Core-Flow Controllers Summary

Zod validation wired onto all write endpoints of the three crypto-core controllers (identity, credentials, zk-proofs) using per-endpoint Zod schemas colocated in `*.dto.ts` files, delivered as `@Body(new ZodValidationPipe(schema))` per-param pipes from the `ZodValidationPipe` built in plan 08-01.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Identity DTO schemas + wiring | 2724145 | identity.dto.ts, identity.controller.ts |
| 2 | Credentials DTO schema + wiring | e298190 | credentials.dto.ts, credentials.controller.ts |
| 3 | ZK-proofs DTO schemas + wiring | cdd6a1a | zk-proofs.dto.ts, zk-proofs.controller.ts |

## What Was Delivered

**identity.dto.ts** — four Zod schemas for identity write endpoints:
- `registerBodySchema`: handle + displayName, both non-empty strings (required)
- `updateBodySchema`: all optional — displayName, bio, orcidId, fieldOfStudy, careerStage (strings), affiliations (string array). Wrong-typed affiliations rejected.
- `setupRecoveryBodySchema`: guardians array (min 2, each `{name, kind}` non-empty), secret optional, threshold optional int
- `reconstructBodySchema`: submissions array (min 1, each `{shardIndex: int, key: non-empty string}`)

**credentials.dto.ts** — one schema:
- `mintBodySchema`: researcherDid, credentialType, title, issuer (required non-empty); tone, fieldOfStudy (optional)

**zk-proofs.dto.ts** — two schemas:
- `proveBodySchema`: credentialId, disclosedClaimName, appName, consentWindow (required); threshold (optional string), predicateEnabled (optional boolean)
- `verifyBodySchema`: proofHash (required non-empty string)

All write endpoints now reject a malformed or missing field with HTTP 400 (via `BadRequestException` from `ZodValidationPipe`). All GET/param-only routes are untouched. Service call arguments are identical to before.

## Threat Register Coverage

| Threat ID | Mitigation Status |
|-----------|-------------------|
| T-08-03 | Mitigated — registerBodySchema, updateBodySchema, setupRecoveryBodySchema, proveBodySchema, verifyBodySchema, mintBodySchema all reject malformed input before service execution |
| T-08-04 | Mitigated — reconstructBodySchema enforces `shardIndex: int` + `key: non-empty string` so malformed guardian payloads cannot reach the Shamir reconstruct path |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript 5.9 + Zod 3.25 `z.infer` produces optional required fields**

- **Found during:** Task 1 (first tsc --noEmit run)
- **Issue:** Zod v3's `objectUtil.addQuestionMarks` type utility appends `& { [k in keyof T]?: unknown }` to every object's output type. In TypeScript 5.9, when flattened via a mapped type, required fields become optional in the inferred type. `z.infer<typeof registerBodySchema>` expanded to `{ handle?: string; displayName?: string }` instead of `{ handle: string; displayName: string }`, causing type errors when those types were passed to service methods that expect required fields.
- **Fix:** Replaced `z.infer<...>` exported types with explicit TypeScript types that match the schemas exactly. Runtime validation is still performed by the Zod schema; the explicit types are only used for TypeScript's static checker within the controller/service layer.
- **Files modified:** identity.dto.ts, credentials.dto.ts, zk-proofs.dto.ts
- **Commits:** 2724145, e298190, cdd6a1a

**2. [Rule 2 - Missing functionality] `fieldOfStudy` absent from credentials controller body type**

- **Found during:** Task 2 (reading credentials.controller.ts vs credentials.service.ts)
- **Issue:** The service's `mint()` method accepts `fieldOfStudy?: string` as part of its data input, but the controller's inline body type omitted this field. A client sending `fieldOfStudy` would have it silently dropped.
- **Fix:** Added `fieldOfStudy: z.string().optional()` to `mintBodySchema` and `fieldOfStudy?: string` to `MintBody`. The controller now passes the full `MintBody` to `this.svc.mint(body)`, correctly forwarding the field.
- **Files modified:** credentials.dto.ts, credentials.controller.ts
- **Commit:** e298190

## Verification

- `npx tsc --noEmit` — clean (zero errors, zero warnings) after all three tasks
- `npx vitest run` — **221 tests passed, 0 failed, 17 test files** (full suite unchanged)
- All six Zod schemas colocated in their module's `*.dto.ts`
- All write endpoints wrapped; GET/param-only routes untouched

## Known Stubs

None — no stub values, placeholders, or TODO markers introduced.

## Threat Flags

None — no new network endpoints, auth paths, file access patterns, or schema changes beyond what the threat model covers.

## Self-Check: PASSED

- packages/api/src/modules/identity/identity.dto.ts — FOUND
- packages/api/src/modules/credentials/credentials.dto.ts — FOUND
- packages/api/src/modules/zk-proofs/zk-proofs.dto.ts — FOUND
- Commit 2724145 (identity) — FOUND
- Commit e298190 (credentials) — FOUND
- Commit cdd6a1a (zk-proofs) — FOUND
