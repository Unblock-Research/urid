---
phase: 07-real-impact-score
verified: 2026-07-07T04:18:30Z
status: passed
score: 6/6 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 7: Real Impact Score Verification Report

**Phase Goal:** The 7-pillar impact score is computed from live ORCID and Crossref API data; hardcoded constants are removed; pillars with insufficient data report `insufficient_data` instead of fabricated numbers
**Verified:** 2026-07-07T04:18:30Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #  | Truth                                                                                                               | Status     | Evidence                                                                                                                                                      |
|----|---------------------------------------------------------------------------------------------------------------------|------------|---------------------------------------------------------------------------------------------------------------------------------------------------------------|
| 1  | GET /api/impact/:did performs real outbound HTTP via OrcidClient + CrossrefClient (SC1)                            | ✓ VERIFIED | OrcidClient uses axios with env-configurable `ORCID_API_BASE`; CrossrefClient uses axios with env-configurable `CROSSREF_API_BASE`; both injected into ImpactService via NestJS DI; test "OrcidClient and CrossrefClient are called during calculate()" asserts all 4 methods called via vi.fn mocks |
| 2  | Two researchers with different datasets receive different computed totalScores — no constant returned for all (SC2) | ✓ VERIFIED | calculate() derives scores via `normalizeLog` + `computeHIndex`; dataset A (10 works, h=5, 55 citations) vs dataset B (5 works, h=4, 203 citations) produce distinct totalScores confirmed by test "two researchers with different datasets receive DIFFERENT totalScores" |
| 3  | A researcher with no publications has at least one pillar insufficient_data; no-orcidId → all insufficient (SC3)  | ✓ VERIFIED | Zero-works path: knowledge/impact/leadership → `insufficient_data`; ethics/repro always `insufficient_data`. No-orcidId path: all 7 pillars `insufficient_data`, totalScore 0, no HTTP. Tests pass for both paths. |
| 4  | A researcher with no orcidId yields all pillars insufficient_data, no fabricated numbers, no crash                 | ✓ VERIFIED | Code: `if (!r.orcidId)` → `PILLAR_DEFS.map(buildInsufficientPillar)`, totalScore: 0, coverage: 0, persisted — zero HTTP calls. 4 dedicated tests verify all branches. |
| 5  | getScore() returns latest persisted ImpactScore or `{ status: 'not_calculated' }` — never hardcoded fallback      | ✓ VERIFIED | Code: `prisma.impactScore.findFirst` ordered by `calculatedAt desc` → `score ?? { status: 'not_calculated' as const }`. Zero occurrences of `84.2` in `impact.service.ts` (grep exit 1, count 0). 4 tests cover all branches. |
| 6  | insufficient_data pillars excluded from renormalized weighted total; coverage reported                              | ✓ VERIFIED | `computeTotal()` filters `status === 'scored'`, renormalizes by `scoredWeightSum`. Test "totalScore equals the renormalized weighted sum over scored pillars only" algebraically verifies the formula. |

**Score:** 6/6 truths verified

### Required Artifacts

| Artifact                                                          | Expected                                    | Status     | Details                                                                        |
|-------------------------------------------------------------------|---------------------------------------------|------------|--------------------------------------------------------------------------------|
| `packages/api/src/modules/impact/impact.service.ts`              | Real 7-pillar score computation             | ✓ VERIFIED | 293 lines; real calculate() and getScore(); imported by impact.module.ts       |
| `packages/api/src/modules/impact/impact.service.spec.ts`         | Mocked-HTTP test suite                      | ✓ VERIFIED | 659 lines; 24 test cases; all 99 impact module tests pass                      |
| `packages/api/src/modules/impact/impact.module.ts`               | Module wiring with both clients             | ✓ VERIFIED | 14 lines; OrcidClient + CrossrefClient in providers array                      |
| `packages/api/src/modules/impact/sources/orcid.client.ts`        | Real axios ORCID client                     | ✓ VERIFIED | 155 lines; env-configurable baseURL; 4 methods; graceful degradation           |
| `packages/api/src/modules/impact/sources/crossref.client.ts`     | Real axios Crossref client                  | ✓ VERIFIED | 129 lines; env-configurable baseURL; CONCURRENCY_CAP=5; graceful degradation   |
| `packages/api/src/modules/impact/sources/metrics.ts`             | Pure metric helpers + computeHIndex         | ✓ VERIFIED | 299 lines; normalizeLog, computeHIndex, 5 pillar scorers; all deterministic    |

### Key Link Verification

| From                         | To                                       | Via                                                                  | Status   | Details                                                                              |
|------------------------------|------------------------------------------|----------------------------------------------------------------------|----------|--------------------------------------------------------------------------------------|
| `ImpactModule` providers     | `OrcidClient` + `CrossrefClient`         | `providers: [ImpactService, PrismaService, OrcidClient, CrossrefClient]` | WIRED | grep confirms both in `impact.module.ts:10`                                          |
| `ImpactService` constructor  | `OrcidClient` + `CrossrefClient`         | `private orcid: OrcidClient, private crossref: CrossrefClient`       | WIRED    | Lines 116-117 of `impact.service.ts`; imported at lines 26-27                        |
| `calculate()` ORCID path     | `OrcidClient.getWorks/getPeerReviews/getFundings` → `CrossrefClient.getCitationCounts` | `Promise.all([this.orcid.getWorks, ...]) + this.crossref.getCitationCounts` | WIRED | Code verified lines 168-180; test asserts all 4 methods called once |
| `calculate()` → metrics      | `scoreKnowledge/scoreImpact/scoreReview/scoreLeadership/scoreRecognition/computeHIndex` | imported from `./sources/metrics`                                    | WIRED    | Lines 29-35 of `impact.service.ts`; used in pillar-building block lines 210-265      |
| `calculate()` → persistence  | `prisma.impactScore.create`              | data: `{ researcherId, totalScore, pillars, bonuses, penalty }`      | WIRED    | Lines 272-280 of `impact.service.ts`                                                  |
| `getScore()` → DB query      | `prisma.impactScore.findFirst`           | `orderBy: { calculatedAt: 'desc' }` → `score ?? { status: 'not_calculated' }` | WIRED | Lines 130-134 of `impact.service.ts`                                      |

### Behavioral Spot-Checks

| Behavior                                                                          | Command                                             | Result             | Status  |
|-----------------------------------------------------------------------------------|-----------------------------------------------------|--------------------|---------|
| Full impact module test suite passes                                              | `npx vitest run src/modules/impact/`                | 99/99 pass (4 files) | ✓ PASS |
| Full API test suite passes                                                        | `pnpm --filter @urid/api exec vitest run`           | 215/215 pass (16 files) | ✓ PASS |
| TypeScript type-check clean                                                       | `npx tsc --noEmit -p tsconfig.json`                 | Exit 0, no errors  | ✓ PASS  |
| 84.2 constant absent from impact.service.ts                                       | `grep -c "84\.2" impact.service.ts`                 | 0                  | ✓ PASS  |
| Fixed pillar sub-score arrays absent from impact.service.ts                       | `grep -n "0\.83\|0\.72\|0\.78\|..." impact.service.ts` | 0 matches       | ✓ PASS  |
| Commits a5036ef / dbd5297 / 1439c75 exist                                        | `git log --oneline a5036ef dbd5297 1439c75`         | All 3 found        | ✓ PASS  |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| (none) | — | — | — | No debt markers (TBD/FIXME/XXX), no placeholder returns, no hardcoded constants found in any impact module file |

## Detailed Findings

### SC1: Real outbound HTTP via OrcidClient + CrossrefClient

`OrcidClient` (155 lines, `sources/orcid.client.ts`) uses `axios.create({ baseURL: process.env.ORCID_API_BASE ?? 'https://pub.orcid.org/v3.0' })` with a 10s timeout, percent-encoding of orcidId, and four methods: `getRecord`, `getWorks`, `getPeerReviews`, `getFundings`. `CrossrefClient` (129 lines) uses `axios.create({ baseURL: process.env.CROSSREF_API_BASE ?? 'https://api.crossref.org' })` with a CONCURRENCY_CAP=5 chunked batch and polite-pool mailto parameter.

Both are registered in `ImpactModule.providers` and injected into `ImpactService` via `private orcid: OrcidClient, private crossref: CrossrefClient`. The test "OrcidClient and CrossrefClient are called during calculate()" uses `vi.fn()` mocks and asserts `toHaveBeenCalledOnce()` for all four methods — this is the "verifiable via test mocks" path specified in SC1.

### SC2: Two different datasets produce different totalScores

`calculate()` feeds real metrics into `normalizeLog(value, scale)` (logarithmic normalization, never returns a constant), then into `computeHIndex` (O(n log n) sort-and-walk). `computeTotal()` renormalizes over scored pillars only. Dataset A (10 works, h=5, 55 citations, 3 reviews, 2 fundings) and dataset B (5 works, h=4, 203 citations, 0 reviews, 0 fundings) produce demonstrably different totalScores — asserted to not be within 3 decimal places of each other. Both are also asserted not to equal the old 84.2 or 76.94 constants, and to lie in [0, 1].

### SC3: insufficient_data for no-publications and no-orcidId cases

`calculate()` has two distinct paths:
1. No orcidId: `PILLAR_DEFS.map(buildInsufficientPillar)` — all 7 pillars `score: null, status: 'insufficient_data'`, no HTTP calls made. Verified by 4 tests.
2. Has orcidId, zero works: knowledge, impact, leadership → `buildInsufficientPillar` because `hasWorks === false`. ethics and repro are always insufficient. At minimum 5 of 7 pillars are insufficient_data. Verified by dedicated tests.

### getScore() hardcoded fallback removed

The old mock returned a hardcoded `84.2` total score. The rewritten `getScore()` is:
```
const score = await prisma.impactScore.findFirst({ where: { researcherId: r.id }, orderBy: { calculatedAt: 'desc' } });
return score ?? { status: 'not_calculated' as const };
```
Static grep of `impact.service.ts` confirms 0 occurrences of `84.2`. Test "getScore never returns the old hardcoded 84.2 fallback" asserts `(result as any).totalScore` is not close to 84.2.

### Renormalized weighted total

`computeTotal()` explicitly filters `pillars.filter(p => p.status === 'scored')`, sums weights of scored pillars only, and divides by that sum. For dataset A (ethics+repro always insufficient, leadership insufficient when 0 coAuthorCount due to ORCID /works not carrying contributor detail), the scored weight sum is 22+18+12+18 = 70 when all works-based pillars score (knowledge, impact, review, recognition, leadership when collaboration > 0). The test "totalScore equals the renormalized weighted sum over scored pillars only" algebraically recomputes the expected total from the pillar array and asserts `toBeCloseTo(expectedTotal, 10)`.

---

_Verified: 2026-07-07T04:18:30Z_
_Verifier: Claude (gsd-verifier)_
