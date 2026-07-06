# Phase 7: Real Impact Score - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the hardcoded impact constants (every researcher gets 84.2 with fixed pillar scores) with a 7-pillar score computed from live ORCID + Crossref data via a real weighted formula. Pillars with insufficient data are reported as `insufficient_data`, not fabricated. Covers IMP-01, IMP-02, IMP-03. Independent of the crypto chain.

</domain>

<decisions>
## Implementation Decisions

### Locked
- **Data sources (live):**
  - **ORCID public API** (no auth for public data): fetch the researcher's record + works by `researcher.orcidId`. e.g. `GET https://pub.orcid.org/v3.0/{orcid}/works` and `/record` (Accept: application/json). Also read the peer-review and funding sections for those pillars.
  - **Crossref** (no key; polite pool with a `mailto`): enrich citation counts by DOI, e.g. `GET https://api.crossref.org/works/{doi}` → `message['is-referenced-by-count']`.
  - `axios` is already a dependency — use it.
- **Clients:** `OrcidClient` + `CrossrefClient` under `packages/api/src/modules/impact/sources/`, injectable, with base URLs configurable via env (`ORCID_API_BASE`, `CROSSREF_API_BASE`, `CROSSREF_MAILTO`). Fully mockable in tests (no live calls in the test suite).
- **Metrics → pillars (real functions of fetched data, IMP-02):** compute pillar sub-scores in [0,1] from real metrics via documented normalizations (not constants):
  - `knowledge` — works count + distinct venues.
  - `impact` — total citations + **h-index computed from per-work Crossref citation counts**.
  - `review` — count of ORCID peer-review activities.
  - `leadership` — collaboration signal from co-author/contributor counts across works.
  - `recognition` — count/'value' of ORCID funding entries.
  - `ethics`, `repro` — thin signal; if no data source available, mark `insufficient_data`.
- **Insufficient data (IMP-03):** any pillar with no usable source data is reported with an `insufficient_data` marker (e.g. `score: null, status: "insufficient_data"`) and is EXCLUDED from the weighted total (renormalize remaining weights, or report a partial total with a `coverage` field). NEVER emit a fabricated number for a pillar with no data.
- **calculate() requires an ORCID iD.** If `researcher.orcidId` is missing, return a clear "no ORCID linked" result (all pillars insufficient) rather than fake numbers. Persist the computed `ImpactScore` (real `totalScore` + `pillars` JSON incl. per-pillar status/metrics).
- **getScore():** return the latest persisted real score (or a clear "not yet calculated" state) — NO hardcoded 84.2 fallback.

### Claude's Discretion
- Exact normalization formulas + constants (e.g. logarithmic scaling of citation/works counts, h-index → [0,1]) — must be deterministic functions of the fetched metrics; document them. Reasonable, defensible curves.
- Whether to keep the existing pillar weights (22/18/12/18/18/6/6) or adjust; keep them unless there's a reason.
- Caching/rate-limit politeness (Crossref mailto header, small concurrency) — keep it simple; no persistence of raw API responses required.
- How partial coverage is surfaced in the response (a `coverage` percentage + per-pillar `status`).
- Whether h-index is computed in a helper (`sources/metrics.ts`).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `ImpactService` (impact.service.ts) — `getScore`, `calculate`, `getHistory`; all currently return/store hardcoded pillars. Rewrite `getScore` + `calculate`.
- `ImpactModule` — add the two clients as providers.
- `impact.controller.ts` — `GET :did`, `POST :did/calculate`, `GET :did/history` (keep the routes).
- `Researcher.orcidId` field (exists). `ImpactScore` model: `totalScore`, `pillars` (Json), `bonuses`, `penalty`, `calculatedAt`.
- `axios` dependency (already present).

### Established Patterns
- `@Injectable()` services, constructor DI (`prisma`).
- No global HTTP client yet — introduce injectable clients wrapping axios.

### Integration Points
- `calculate()` orchestrates: load researcher → OrcidClient (works/record/reviews/funding) → CrossrefClient (citations per DOI) → compute pillars + total → persist ImpactScore.
- `getScore()` returns latest persisted score.

</code_context>

<specifics>
## Specific Ideas

- Tests (MANDATORY, all with MOCKED HTTP — no live network in the suite):
  - Two different mocked ORCID/Crossref datasets produce DIFFERENT scores (proves it's data-driven, not constant). Assert the score is NOT the old 84.2 constant for a realistic dataset.
  - h-index helper returns the correct value for a known citation-count vector.
  - A researcher with no orcidId → all pillars `insufficient_data`, no fabricated numbers.
  - A pillar with no source data is marked `insufficient_data` and excluded from the total.
  - getScore returns the latest persisted real score (no 84.2 fallback).
  - Static: the hardcoded 84.2 / fixed-pillar arrays are removed from impact.service.ts (grep).
- Handle API errors gracefully (network failure → surfaced/typed error or insufficient_data, not a crash or a fake score).

</specifics>

<deferred>
## Deferred Ideas

- OpenAlex + funding-database enrichment — v2 (IMP-04).
- ORCID OAuth for private records — future (public API only now).
- Full Zod DTO hardening — Phase 8.

</deferred>
