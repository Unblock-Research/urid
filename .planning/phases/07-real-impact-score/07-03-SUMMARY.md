---
phase: 07-real-impact-score
plan: "03"
subsystem: impact
tags: [impact-score, orcid, crossref, renormalization, tdd, pillar-scoring]
dependency_graph:
  requires: ["07-01", "07-02"]
  provides: [real-impact-score-calculation, getScore-persisted-result, impact-module-wiring]
  affects: [ImpactModule, ImpactService, impact.service.spec.ts]
tech_stack:
  added: []
  patterns:
    - renormalized weighted average (scored pillars only)
    - insufficient_data marker for pillars lacking source data
    - in-memory Prisma fake + vi.fn client mocks (mocked-HTTP test pattern)
key_files:
  created:
    - packages/api/src/modules/impact/impact.service.spec.ts
  modified:
    - packages/api/src/modules/impact/impact.service.ts
    - packages/api/src/modules/impact/impact.module.ts
decisions:
  - "Weights 22/18/12/18/18/6/6 preserved as specified"
  - "knowledge/impact/leadership → insufficient_data when zero works (no source data)"
  - "review/recognition → always scored (0 count is valid data)"
  - "ethics/repro → always insufficient_data (no data source this milestone)"
  - "totalScore = renormalized weighted avg over scored pillars; coverage = scored weight / 100"
  - "no-orcidId path: all 7 pillars insufficient_data, totalScore 0, no HTTP calls"
  - "getScore() returns score ?? { status: 'not_calculated' } — never hardcoded fallback"
metrics:
  duration: "~6 minutes"
  completed: "2026-07-07"
  tasks_completed: 3
  files_modified: 3
status: complete
---

# Phase 7 Plan 03: Wire Clients + Rewrite calculate()/getScore() Summary

Real 7-pillar impact score from live ORCID + Crossref data via injected clients, with renormalized weighted total, insufficient_data markers, and mandatory mocked-HTTP test suite.

## What Was Built

### Task 1: ImpactModule wiring + calculate() rewrite (a5036ef)

- `ImpactModule` now provides `OrcidClient` and `CrossrefClient` alongside `ImpactService` and `PrismaService`.
- `ImpactService` constructor updated to inject both clients.
- `calculate(did)` fully rewritten:
  - Loads researcher; throws `NotFoundException` for unknown DID.
  - No-orcidId path: returns/persists all 7 pillars as `insufficient_data`, `totalScore: 0`, `coverage: 0`; zero HTTP calls.
  - ORCID-backed path: parallel-fetches works/peer-reviews/fundings; batch-fetches per-DOI citation counts from Crossref; derives `totalCitations`, `hIndex` (via `computeHIndex`), `collaborationSignal`, `distinctVenues`.
  - Pillar scoring via `metrics.ts` helpers: `scoreKnowledge`, `scoreImpact`, `scoreReview`, `scoreLeadership`, `scoreRecognition`.
  - knowledge / impact / leadership: `insufficient_data` when `works.length === 0`.
  - review / recognition: always scored (0 count is valid data).
  - ethics / repro: always `insufficient_data` (no data source this milestone).
  - Upstream client failures degrade affected pillars to `insufficient_data` (no crash).
  - Renormalized `totalScore` = `Σ(score × weight)` over scored pillars / `Σ(scoredWeight)`.
  - `coverage` = `Σ(scoredWeight) / 100`.
  - Persists real `ImpactScore` with pillars JSON and coverage.
  - Hardcoded `84.2` constant and fixed `[0.83, 0.72, ...]` pillar arrays deleted.
- `getScore()` fallback removed in same pass: returns `score ?? null` (refined in Task 2).

**Deviation (auto-fix):** `getScore()` was fully implemented with `{ status: 'not_calculated' }` in Task 1's rewrite rather than being left as a stub. This caused Task 2's RED tests to pass immediately. Documented below.

### Task 2: getScore() refinement (dbd5297)

- `getScore(did)` final behavior: `unknown DID → null`; `known DID, no score → { status: 'not_calculated' }`; `known DID, score exists → latest ImpactScore row`.
- No hardcoded fallback remains anywhere in `impact.service.ts` (grep verified: 0 occurrences of `84.2`).
- No fixed pillar sub-score arrays (0.83/0.72/0.78/0.69/0.81/0.74/0.82) remain (grep verified: 0 occurrences).

### Task 3: Mandatory impact.service spec — all mocked HTTP (1439c75)

24 tests covering every plan-required behavior:

| Group | Tests |
|-------|-------|
| Data-driven scores | Two datasets → different totalScores; neither is 84.2/76.94; clients called |
| h-index correctness | `computeHIndex([100,50,30,20,3])=4`; `[20,10,8,7,5,...]=5`; impact pillar metrics verified |
| No-orcidId path | All 7 pillars insufficient_data; totalScore=0; coverage=0; zero client calls; persisted correctly |
| Insufficient exclusion | Ethics/repro always insufficient; totalScore = renormalized algebraic sum; coverage = scored/100; zero-works path |
| getScore | Latest persisted after calculate; not_calculated when none; null for unknown DID; never 84.2 |
| Graceful degradation | OrcidClient failure → works-dependent pillars insufficient; CrossrefClient failure → impact scored with 0 citations |
| Static | Grep of `impact.service.ts`: 0 occurrences of `84.2`; 0 occurrences of fixed sub-scores |

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] TypeScript inferred `works: never[]` from `.catch((): never[] => [])`**
- **Found during:** Task 1 GREEN phase — `tsc --noEmit` produced 3 errors
- **Issue:** The `.catch((): never[] => [])` annotation caused TypeScript to infer `works: never[]`, making all downstream `w.coAuthorCount` and `computeHIndex(citationCounts)` calls fail with type errors
- **Fix:** Added `import type { NormalizedWork }` and changed to `.catch(() => [] as NormalizedWork[])`
- **Files modified:** `packages/api/src/modules/impact/impact.service.ts`
- **Commit:** a5036ef

**2. [Deviation - Co-implementation] getScore() fully implemented in Task 1 rewrite**
- **Found during:** Task 2 RED phase — all getScore tests passed immediately
- **Issue:** The entire service was rewritten in Task 1; `getScore()` received its final `score ?? { status: 'not_calculated' }` implementation at the same time as `calculate()`
- **Impact:** Task 2 RED/GREEN cycle had no failing RED step; the tests added in Task 2 confirmed behavior that was already correct
- **Assessment:** Correct outcome — the behavior satisfies all Task 2 requirements; documented as deviation

## Success Criteria Verification

| Criterion | Status |
|-----------|--------|
| calculate() performs real outbound HTTP via OrcidClient + CrossrefClient | PASS — client mocks verified called (test: "OrcidClient and CrossrefClient are called") |
| Two different datasets → different computed totalScores | PASS — datasets A and B produce distinct scores |
| Neither score is the old hardcoded constant | PASS — grep 0; test asserts ≠ 84.2/76.94 |
| Researcher with no publications → at least one pillar insufficient_data | PASS — ethics/repro always insufficient; zero-works path adds more |
| Researcher with no orcidId → all 7 pillars insufficient_data | PASS — dedicated test + zero-client-call assertion |
| getScore() returns latest persisted score, no hardcoded fallback | PASS — 4 tests cover all branches |
| Insufficient pillars excluded from renormalized total | PASS — algebraically verified in test |
| `tsc --noEmit` clean | PASS |
| `vitest run src/modules/impact/` — all pass | PASS — 99 tests, 4 test files |
| Static: 84.2 gone; fixed pillar arrays gone | PASS — grep + spec static tests |

## Threat Mitigations Applied

| Threat | Applied |
|--------|---------|
| T-07-07: Only scored pillars contribute to totalScore | `insufficient_data` pillars excluded from renormalized total; verified in tests |
| T-07-08: Bounded concurrency for DOI fan-out | Delegated to `CrossrefClient.getCitationCounts` (CONCURRENCY_CAP=5, plan 07-01) |
| T-07-09: Upstream failure during calculate() | `.catch()` fallbacks on all client calls; degrade to insufficient_data; no crash |
| T-07-10: id/DOI injection into outbound URLs | Service passes ids through typed client API; never builds URLs itself |

## Known Stubs

None — all 5 data-backed pillars are driven by real metrics from the injected clients. Ethics/repro are correctly marked `insufficient_data` (documented no-source-this-milestone intent, not stubs).

## Self-Check: PASSED

| Item | Status |
|------|--------|
| `packages/api/src/modules/impact/impact.service.ts` | FOUND |
| `packages/api/src/modules/impact/impact.module.ts` | FOUND |
| `packages/api/src/modules/impact/impact.service.spec.ts` | FOUND |
| `.planning/phases/07-real-impact-score/07-03-SUMMARY.md` | FOUND |
| Commit a5036ef (Task 1) | FOUND |
| Commit dbd5297 (Task 2) | FOUND |
| Commit 1439c75 (Task 3) | FOUND |
| `vitest run src/modules/impact/` — 99/99 pass | PASS |
| `tsc --noEmit` | CLEAN |
