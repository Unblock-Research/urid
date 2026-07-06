/**
 * @module sources/metrics
 *
 * Pure, deterministic metric helpers for the URID impact scoring pipeline.
 *
 * These are the "real functions of fetched data" required by IMP-02 — every
 * pillar sub-score is a documented, testable, deterministic function of raw
 * external data.  No I/O, no NestJS decorators, no side effects.
 *
 * NOTE — ethics and repro pillars:
 *   These two pillars have no available data source in the current milestone
 *   (plan 07-02).  They are therefore handled as `insufficient_data` by the
 *   service (plan 07-03) and are NOT scored here.
 */

// ─────────────────────────────────────────────────────────────────────────────
// Scale constants
//
// Each constant is the raw-metric value that maps to ~1.0 on the log curve
// (i.e. the saturation point).  Raising a scale makes the curve gentler —
// higher absolute values are required to reach 1.0; lowering makes it steeper.
//
// These values are defensible baselines calibrated to early-career → established
// researcher ranges based on typical ORCID/Crossref distributions.  Adjust per
// cohort once calibration data becomes available.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Works count at which the knowledge/productivity sub-score saturates (~1.0).
 * 100 published works marks a highly prolific researcher.
 */
export const WORKS_SCALE = 100;

/**
 * Distinct-venue count that saturates the venue-diversity component of the
 * knowledge pillar.  50 unique venues is broad publication coverage.
 */
export const VENUES_SCALE = 50;

/**
 * Total citation count that saturates the citation component of impact.
 * 500 citations is a well-cited active researcher across a career.
 */
export const CITATIONS_SCALE = 500;

/**
 * h-index value that saturates the h-index component of impact.
 * h=20 is a strong marker for a highly-cited researcher in most fields.
 */
export const HINDEX_SCALE = 20;

/**
 * Peer-review count that saturates the review pillar.
 * 30 documented reviews represents significant community service.
 */
export const REVIEW_SCALE = 30;

/**
 * Cumulative co-author/contributor signal (sum of coAuthorCount across works)
 * that saturates the leadership/collaboration pillar.
 * 200 represents broad, sustained collaborative activity.
 */
export const COLLAB_SCALE = 200;

/**
 * Funding-entry count that saturates the recognition pillar.
 * 10 funding entries is strong external recognition.
 */
export const FUNDING_SCALE = 10;

// ─────────────────────────────────────────────────────────────────────────────
// Private helper: input sanitization
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Sanitize a raw numeric input:
 *   - Non-finite values (NaN, ±Infinity) → 0
 *   - Negative values → 0
 *
 * Guarantees that downstream math never sees NaN, ±Infinity, or negatives,
 * satisfying the T-07-05 threat mitigation (no NaN propagation).
 */
function sanitize(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, value);
}

// ─────────────────────────────────────────────────────────────────────────────
// Log-scale normalization primitive
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Map a raw metric value to a sub-score in [0, 1] using a logarithmic curve.
 *
 * Formula:
 *   ```
 *   f(value, scale) = clamp( ln(1 + value) / ln(1 + scale), 0, 1 )
 *   ```
 *
 * Properties:
 *   - f(0, scale)     = 0 for any scale > 0  (zero metric → zero score)
 *   - f(scale, scale) ≈ 1.0  (saturation at the scale point)
 *   - Strictly monotonically increasing in `value`
 *   - Clamped to [0, 1] — values beyond the scale never exceed 1
 *   - Concave: proportional gains diminish as the metric grows
 *   - Safe on malformed input: non-finite/negative `value` → 0
 *
 * Why logarithmic?  Impact metrics are heavily right-skewed (citation counts,
 * works counts).  A log curve provides meaningful differentiation at the low
 * end where most researchers sit, while gracefully saturating at the high end.
 *
 * @param value - Raw metric value (e.g. citation count).  Non-finite or
 *   negative values are treated as 0 (T-07-05 sanitization).
 * @param scale - The raw value that maps to a sub-score of ~1.0.
 *   Must be > 0.  If ≤ 0 or non-finite, returns 0.
 * @returns Sub-score in [0, 1].  Never NaN.
 */
export function normalizeLog(value: number, scale: number): number {
  const v = sanitize(value);
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  const raw = Math.log(1 + v) / Math.log(1 + scale);
  // clamp to [0,1] — handles value > scale and any floating-point edge
  return Math.min(1, Math.max(0, raw));
}

// ─────────────────────────────────────────────────────────────────────────────
// h-index
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute the h-index from a per-work citation-count vector.
 *
 * **Definition:** The largest integer h such that at least h works in the
 * vector have been cited at least h times.
 *
 * **Algorithm (O(n log n)):**
 * 1. Sanitize: replace non-finite entries with 0; floor negatives to 0.
 * 2. Sort descending.
 * 3. Walk the sorted array: h is the last index i (0-based) where
 *    `sortedCounts[i] >= i + 1`.
 *
 * **Examples:**
 * - `[10, 8, 5, 4, 3]` → sorted `[10,8,5,4,3]` → h=4 (4 works with ≥4 cites)
 * - `[25, 8, 5, 3, 3]` → sorted `[25,8,5,3,3]` → h=3 (3 works with ≥3 cites;
 *    4th has only 3 cites ✓ but 4th position requires ≥4 — fails)
 * - `[]` or `[0,0,0]` → h=0
 *
 * @param citationCounts - Per-work Crossref citation count array.  May contain
 *   non-finite or negative values; they are sanitized.
 * @returns h-index integer ≥ 0.  Never NaN, never throws.
 */
export function computeHIndex(citationCounts: number[]): number {
  if (citationCounts.length === 0) return 0;

  // Sanitize: non-finite → 0, negatives → 0
  const clean = citationCounts.map(sanitize);

  // Sort descending (O(n log n))
  const sorted = clean.slice().sort((a, b) => b - a);

  let h = 0;
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i] >= i + 1) {
      h = i + 1;
    } else {
      // Once the condition fails on the sorted array, no larger h is possible
      break;
    }
  }
  return h;
}

// ─────────────────────────────────────────────────────────────────────────────
// Per-pillar sub-score helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * **Knowledge pillar sub-score** — research productivity and venue breadth.
 *
 * Inputs:
 *   - `worksCount`     — total works on the ORCID record.
 *   - `distinctVenues` — count of unique publication venues across all works.
 *
 * Formula (weighted blend):
 * ```
 * score = 0.7 × normalizeLog(worksCount, WORKS_SCALE)
 *       + 0.3 × normalizeLog(distinctVenues, VENUES_SCALE)
 * ```
 * clamped to [0, 1].
 *
 * Rationale: publication volume (70 %) is the primary productivity signal;
 * venue breadth (30 %) rewards interdisciplinary reach.
 *
 * @param worksCount     Total ORCID works count.  Non-finite/negative → 0.
 * @param distinctVenues Count of unique venues.  Non-finite/negative → 0.
 * @returns Sub-score in [0, 1].
 */
export function scoreKnowledge(worksCount: number, distinctVenues: number): number {
  const productivity = normalizeLog(worksCount, WORKS_SCALE);
  const diversity = normalizeLog(distinctVenues, VENUES_SCALE);
  return Math.min(1, 0.7 * productivity + 0.3 * diversity);
}

/**
 * **Impact pillar sub-score** — citation reach and sustained per-work impact.
 *
 * Inputs:
 *   - `totalCitations` — cumulative Crossref citation count across all works.
 *   - `hIndex`         — h-index computed via `computeHIndex()`.
 *
 * Formula (weighted blend):
 * ```
 * score = 0.6 × normalizeLog(totalCitations, CITATIONS_SCALE)
 *       + 0.4 × normalizeLog(hIndex, HINDEX_SCALE)
 * ```
 * clamped to [0, 1].
 *
 * Rationale: raw citation volume (60 %) captures breadth of reach; h-index
 * (40 %) captures sustained per-work impact, penalising single-paper citation
 * spikes.
 *
 * @param totalCitations Total Crossref citation count.  Non-finite/negative → 0.
 * @param hIndex         Pre-computed h-index.  Non-finite/negative → 0.
 * @returns Sub-score in [0, 1].
 */
export function scoreImpact(totalCitations: number, hIndex: number): number {
  const citationScore = normalizeLog(totalCitations, CITATIONS_SCALE);
  const hScore = normalizeLog(hIndex, HINDEX_SCALE);
  return Math.min(1, 0.6 * citationScore + 0.4 * hScore);
}

/**
 * **Review pillar sub-score** — peer-review community service.
 *
 * Input:
 *   - `reviewCount` — number of peer-review group entries on the ORCID record.
 *
 * Formula:
 * ```
 * score = normalizeLog(reviewCount, REVIEW_SCALE)
 * ```
 *
 * Rationale: peer-review activity is the only available signal for research
 * community service in this milestone.
 *
 * @param reviewCount ORCID peer-review count.  Non-finite/negative → 0.
 * @returns Sub-score in [0, 1].
 */
export function scoreReview(reviewCount: number): number {
  return normalizeLog(reviewCount, REVIEW_SCALE);
}

/**
 * **Leadership pillar sub-score** — collaborative breadth.
 *
 * Input:
 *   - `collaborationSignal` — cumulative co-author/contributor count across all
 *     works (sum of `NormalizedWork.coAuthorCount`).
 *
 * Formula:
 * ```
 * score = normalizeLog(collaborationSignal, COLLAB_SCALE)
 * ```
 *
 * Rationale: breadth of collaboration is the best available proxy for scholarly
 * leadership in the absence of role/position data.  Note: `NormalizedWork.coAuthorCount`
 * is currently 0 when only the ORCID /works summary is available (detail
 * enrichment from /work/{put-code} is deferred).  A collaboration signal of 0
 * yields a score of 0 — correct behaviour (insufficient data, not a fabricated
 * positive number).
 *
 * @param collaborationSignal Sum of coAuthorCount across all works.
 *   Non-finite/negative → 0.
 * @returns Sub-score in [0, 1].
 */
export function scoreLeadership(collaborationSignal: number): number {
  return normalizeLog(collaborationSignal, COLLAB_SCALE);
}

/**
 * **Recognition pillar sub-score** — external funding recognition.
 *
 * Input:
 *   - `fundingCount` — number of funding group entries on the ORCID record.
 *
 * Formula:
 * ```
 * score = normalizeLog(fundingCount, FUNDING_SCALE)
 * ```
 *
 * Rationale: external funding is a strong signal of peer recognition and
 * validation of research quality.
 *
 * @param fundingCount ORCID funding-group count.  Non-finite/negative → 0.
 * @returns Sub-score in [0, 1].
 */
export function scoreRecognition(fundingCount: number): number {
  return normalizeLog(fundingCount, FUNDING_SCALE);
}
