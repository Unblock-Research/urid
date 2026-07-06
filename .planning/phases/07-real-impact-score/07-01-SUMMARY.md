---
phase: 07-real-impact-score
plan: "01"
subsystem: impact/sources
tags: [orcid, crossref, http-clients, injectable, tdd, axos, graceful-failure]
status: complete

dependency_graph:
  requires: []
  provides:
    - packages/api/src/modules/impact/sources/types.ts
    - packages/api/src/modules/impact/sources/orcid.client.ts
    - packages/api/src/modules/impact/sources/crossref.client.ts
  affects:
    - packages/api/src/modules/impact/impact.module.ts   # must register these as providers (07-03)
    - packages/api/src/modules/impact/impact.service.ts  # consumes clients in 07-03

tech_stack:
  added:
    - axios (already in package.json; no new install)
  patterns:
    - Injectable constructor-injection of axios instance for testability
    - Optional http parameter pattern (avoids vi.mock module-level mocking)
    - Chunked Promise.all concurrency cap (CONCURRENCY_CAP=5) for batch fan-out
    - Optional-chain on all external JSON fields (T-07-01)
    - encodeURIComponent on all URL path segment values (T-07-02)

key_files:
  created:
    - packages/api/src/modules/impact/sources/types.ts
    - packages/api/src/modules/impact/sources/orcid.client.ts
    - packages/api/src/modules/impact/sources/crossref.client.ts
    - packages/api/src/modules/impact/sources/orcid.client.spec.ts
    - packages/api/src/modules/impact/sources/crossref.client.spec.ts
  modified: []

decisions:
  - "Injectable axios pattern via optional constructor param instead of vi.mock — cleaner test isolation, no module-level mocking"
  - "OrcidClient graceful degradation: empty/undefined return on failure (not SourceError throw) — simpler caller contract"
  - "coAuthorCount=0 from /works summary — ORCID summary endpoint lacks contributor detail; enrichment deferred to future plan"
  - "CrossrefClient CONCURRENCY_CAP=5 with chunked Promise.all — simple, readable, avoids hand-rolled rate limiter"
  - "Separate mailto field on CrossrefClient — read from CROSSREF_MAILTO at construction, passed as axios params per request"

metrics:
  duration: "~6 minutes"
  completed: "2026-07-07"
  tasks_completed: 2
  tests_added: 30
  files_created: 5
---

# Phase 7 Plan 1: OrcidClient + CrossrefClient Summary

Injectable, axios-based ORCID and Crossref source clients with percent-encoded IDs, graceful HTTP failure, and mocked-axios test suites.

## What Was Built

Two `@Injectable()` HTTP source clients under `packages/api/src/modules/impact/sources/`:

### types.ts
Shared normalized shapes for the scoring layer:
- `NormalizedWork` — title, doi (nullable), venue (nullable), coAuthorCount
- `OrcidRecordSummary` — name, worksGroupCount
- `PeerReviewSummary` — count
- `FundingSummary` — count
- `SourceError` class — typed error with source, status, cause

### OrcidClient (`orcid.client.ts`)
- `@Injectable()` with optional `http: AxiosInstance` constructor parameter for test injection
- `ORCID_API_BASE` env var; default `https://pub.orcid.org/v3.0`
- `Accept: application/json` header, 10 s request timeout (T-07-04)
- `getRecord(orcidId)` — parses name + worksGroupCount from `/record`; returns `undefined` on failure
- `getWorks(orcidId)` — normalizes `/works` groups → `NormalizedWork[]`; returns `[]` on failure
- `getPeerReviews(orcidId)` — counts `/peer-reviews` groups; returns `{ count: 0 }` on failure
- `getFundings(orcidId)` — counts `/fundings` groups; returns `{ count: 0 }` on failure
- `encodeURIComponent(orcidId)` applied in every method before path interpolation (T-07-02)
- Optional-chain on every external JSON field access (T-07-01)

### CrossrefClient (`crossref.client.ts`)
- `@Injectable()` with optional `http: AxiosInstance` constructor parameter
- `CROSSREF_API_BASE` + `CROSSREF_MAILTO` env vars; defaults `https://api.crossref.org` / `contact@urid.app`
- 10 s request timeout (T-07-04)
- `getCitationCount(doi)` — GET `/works/{encoded}?mailto={mailto}`; parses `message['is-referenced-by-count']`; returns `undefined` on failure or missing field
- `getCitationCounts(dois)` — chunked `Promise.all` with `CONCURRENCY_CAP=5` (T-07-03); returns `Map<string, number|undefined>`; per-DOI failure → `undefined`, batch never crashes

## Test Results

| Spec file | Tests | Result |
|-----------|-------|--------|
| orcid.client.spec.ts | 16 | PASS |
| crossref.client.spec.ts | 14 | PASS |
| **Total** | **30** | **All pass** |

Zero live network calls — all HTTP mocked via injected `{ get: vi.fn() }`.

## TDD Gate Compliance

Both tasks followed RED → GREEN:

| Gate | Commit | Tests |
|------|--------|-------|
| RED (OrcidClient) | `03e8f52` | 10/16 failing |
| GREEN (OrcidClient) | `e8cfbd3` | 16/16 passing |
| RED (CrossrefClient) | `53940fd` | 8/14 failing |
| GREEN (CrossrefClient) | `feb3099` | 14/14 passing |

## Verification

- `npx vitest run src/modules/impact/sources/` → 30/30 passed
- `grep -rn encodeURIComponent ...orcid.client.ts ...crossref.client.ts` → 7 matches (all 4 OrcidClient methods + CrossrefClient)
- `grep -rn "pub.orcid.org\|api.crossref.org" *.spec.ts` → only constant-value assertions, no live calls
- `npx tsc --noEmit` → clean (no type errors)

## Deviations from Plan

### Auto-added enhancements (Rule 2)

**1. [Rule 2 - Security] Optional-chain on all external JSON fields**
- Applied consistently in both clients per T-07-01 threat mitigation
- Every field access on ORCID/Crossref responses uses `?.` to guard against untrusted/missing keys

**2. [Rule 2 - Security] Per-request timeout on default axios instances**
- Both clients set `timeout: 10_000` on the default `axios.create()` per T-07-04

No architectural deviations. Plan executed exactly as designed.

## Known Stubs

**coAuthorCount = 0 in OrcidClient.getWorks()**
- File: `packages/api/src/modules/impact/sources/orcid.client.ts`, line ~112
- Reason: The ORCID `/works` summary endpoint does not include contributor/co-author data. Fetching full work detail per work (`/work/{put-code}`) would require N+1 API calls — impractical for production use.
- Impact on scoring: The leadership pillar (collaboration signal) will see coAuthorCount=0 for all works from this plan. Plan 07-03 can enrich this if needed via a separate `/work/{put-code}` call per work.
- This is an intentional, documented limitation, not a broken feature.

## Threat Surface Scan

No new network endpoints, auth paths, or schema changes introduced. All new surface is outbound HTTP to pre-approved external APIs (ORCID, Crossref). Threat mitigations T-07-01 through T-07-04 are implemented as required by the plan's threat register.

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| `sources/types.ts` exists | FOUND |
| `sources/orcid.client.ts` exists | FOUND |
| `sources/crossref.client.ts` exists | FOUND |
| `sources/orcid.client.spec.ts` exists | FOUND |
| `sources/crossref.client.spec.ts` exists | FOUND |
| RED commit `03e8f52` exists | FOUND |
| GREEN commit `e8cfbd3` exists | FOUND |
| RED commit `53940fd` exists | FOUND |
| GREEN commit `feb3099` exists | FOUND |
| All 30 tests pass | PASS |
| tsc --noEmit | CLEAN |
