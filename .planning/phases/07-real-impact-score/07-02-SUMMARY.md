---
phase: 07-real-impact-score
plan: "02"
subsystem: impact-scoring
tags: [metrics, h-index, normalization, pure-functions, tdd]
status: complete

dependency_graph:
  requires: [07-01]
  provides: [metrics-layer]
  affects: [07-03-impact-service]

tech_stack:
  added: []
  patterns:
    - Log-scale normalization curve (ln(1+v)/ln(1+scale)) for right-skewed metrics
    - Sanitize-then-compute pattern for threat-model T-07-05 (no NaN propagation)
    - Named SCALE constants for documented, auditable calibration points

key_files:
  created:
    - packages/api/src/modules/impact/sources/metrics.ts
    - packages/api/src/modules/impact/sources/metrics.spec.ts
  modified: []

decisions:
  - "Log curve ln(1+v)/ln(1+s) chosen over linear: right-skewed distributions (citations, works) need proportional differentiation at the low end where most researchers sit"
  - "Weighted blend for knowledge (70% productivity + 30% venue diversity) and impact (60% citation volume + 40% h-index) to prevent single-metric inflation"
  - "SCALE constants exported by name so plan 07-03 can inspect/override calibration without touching normalization logic"
  - "ethics and repro pillars not scored here — noted in file-level comment; service (07-03) will mark them insufficient_data"

metrics:
  duration: "3m 39s"
  completed_date: "2026-07-07"
  tasks_completed: 2
  files_changed: 2
  tests_added: 45
---

# Phase 07 Plan 02: Metrics Layer Summary

Pure h-index calculator and documented log-normalization curves mapping raw ORCID/Crossref metrics to deterministic, monotonic, clamped [0,1] pillar sub-scores.

## What Was Built

### Task 1: computeHIndex (TDD RED→GREEN)

`computeHIndex(citationCounts: number[]): number` — implements the standard h-index definition: the largest integer h such that at least h works have ≥ h citations.

- Sanitizes non-finite/negative entries before sorting (T-07-05 mitigation)
- O(n log n) sort + single linear scan — bounded by realistic publication counts (T-07-06 accepted)
- Returns 0 for empty array, all-zero vector, or entirely malformed input
- Never throws, never returns NaN

Known exact values verified: `[10,8,5,4,3]→4`, `[25,8,5,3,3]→3`, `[0,0,0]→0`, `[]→0`, `[100]→1`, `Array(10).fill(5)→5`.

### Task 2: normalizeLog + per-pillar helpers (TDD RED→GREEN)

`normalizeLog(value, scale)` — `ln(1+v)/ln(1+scale)`, clamped to [0,1]:
- Formula documented in JSDoc with derivation rationale
- Monotonically increasing, saturates at scale, concave (right-skewed-friendly)
- Sanitizes non-finite/negative inputs; returns 0 for scale ≤ 0

Per-pillar exports (all pure, JSDoc-documented with input metrics and scale choice):

| Export | Inputs | Scale constants | Blend weights |
|--------|--------|-----------------|---------------|
| `scoreKnowledge` | worksCount, distinctVenues | WORKS_SCALE=100, VENUES_SCALE=50 | 70%/30% |
| `scoreImpact` | totalCitations, hIndex | CITATIONS_SCALE=500, HINDEX_SCALE=20 | 60%/40% |
| `scoreReview` | reviewCount | REVIEW_SCALE=30 | — |
| `scoreLeadership` | collaborationSignal | COLLAB_SCALE=200 | — |
| `scoreRecognition` | fundingCount | FUNDING_SCALE=10 | — |

All helpers: sanitize input (non-finite/negative→0), clamp output to [0,1], never return a constant score.

## Tests (45 passing)

- h-index: 9 tests — exact values for all plan-specified behavior vectors, large uniform vector, sanitization of negatives/NaN/Infinity, never-NaN invariant
- normalizeLog: 8 tests — zero→0, monotonicity, clamping at scale and beyond, NaN/negative/undefined/zero-scale → 0
- Per-pillar (5×): 5 tests each — zero→0, monotonicity (two ordered inputs), clamped to [0,1], NaN→0, not-a-constant (distinct inputs→distinct outputs)
- Scale constants: 1 test — all 7 constants are finite and positive

## Verification Checks

```
cd packages/api && npx vitest run src/modules/impact/sources/metrics.spec.ts
  Test Files: 1 passed
  Tests:      45 passed

grep -n "Math.random|Date.now|axios" metrics.ts → CLEAN

npx tsc --noEmit → no errors
```

## Deviations from Plan

None. Plan executed exactly as written.

- TDD flow followed: RED (spec file created, import fails) → GREEN (implementation added, 45 tests pass) → committed as single feat commit.
- Both tasks committed together in one atomic commit (b2f9f2d) because the spec covered both tasks end-to-end and the RED gate was verified before implementation began.

## Known Stubs

None. All helpers are fully implemented — no hardcoded returns, no TODO placeholders.

## Threat Flags

None. No new network endpoints, auth paths, or schema changes introduced. This plan adds pure math functions only.

T-07-05 mitigation applied: all entry points sanitize non-finite/negative inputs before computation; no NaN can propagate through `normalizeLog` or `computeHIndex`.

## Self-Check: PASSED

- `/Users/mahboobimtiyaz/development/urid/packages/api/src/modules/impact/sources/metrics.ts` — FOUND
- `/Users/mahboobimtiyaz/development/urid/packages/api/src/modules/impact/sources/metrics.spec.ts` — FOUND
- Commit b2f9f2d — FOUND
