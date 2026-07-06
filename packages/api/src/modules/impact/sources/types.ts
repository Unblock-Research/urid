/**
 * Shared type definitions for the impact source clients (OrcidClient, CrossrefClient).
 *
 * These are the normalized shapes the scoring layer (ImpactService, plan 07-03) consumes.
 * Keep shapes minimal — only fields the 7 pillars actually need.
 */

// ---------------------------------------------------------------------------
// Normalized work shape
// ---------------------------------------------------------------------------

/**
 * A single research work from ORCID, normalized for pillar scoring.
 *
 * Fields are intentionally narrow — only what the knowledge, impact, and
 * leadership pillars consume.  All ORCID-specific fields (put-code, etc.)
 * are discarded here.
 */
export interface NormalizedWork {
  /** Work title (may be empty string if the ORCID record is incomplete). */
  title: string;
  /**
   * Digital Object Identifier — null if the work has no DOI recorded in ORCID.
   * Used to fan-out to Crossref for citation counts.
   */
  doi: string | null;
  /** Publication venue / journal name — null if not recorded. */
  venue: string | null;
  /**
   * Number of co-authors / contributors on this work (knowledge of collaboration
   * signal for the leadership pillar).
   *
   * NOTE: The ORCID /works summary endpoint does not carry contributor detail.
   * A value of 0 is emitted when only the summary is available; enrichment
   * from the full /work/{put-code} endpoint is deferred to a future plan.
   */
  coAuthorCount: number;
}

// ---------------------------------------------------------------------------
// ORCID record summary
// ---------------------------------------------------------------------------

/**
 * High-level summary of an ORCID record, used for the knowledge pillar.
 * Parsed from the /record endpoint response.
 */
export interface OrcidRecordSummary {
  /** Researcher display name (given + family concatenated, space-separated). */
  name: string;
  /** Number of work groups in the ORCID /record activities-summary.works.group. */
  worksGroupCount: number;
}

// ---------------------------------------------------------------------------
// Peer-review and funding aggregates
// ---------------------------------------------------------------------------

/**
 * Aggregate result for the review pillar from the /peer-reviews endpoint.
 */
export interface PeerReviewSummary {
  /** Total number of peer-review group entries on the ORCID record. */
  count: number;
}

/**
 * Aggregate result for the recognition pillar from the /fundings endpoint.
 */
export interface FundingSummary {
  /** Total number of funding group entries on the ORCID record. */
  count: number;
}

// ---------------------------------------------------------------------------
// Typed error
// ---------------------------------------------------------------------------

/**
 * Typed error emitted by source clients when an HTTP/network failure occurs
 * and the caller needs to distinguish it from application-level errors.
 *
 * Graceful degradation contract: most client methods swallow this and return
 * an empty/undefined result.  SourceError is retained as an exported type so
 * the scoring layer can attach typed context if it needs to surface the failure
 * in the ImpactScore response (e.g. partial coverage metadata).
 */
export class SourceError extends Error {
  constructor(
    /** Which external source produced this error. */
    public readonly source: 'orcid' | 'crossref',
    /**
     * HTTP status code from the upstream response, if available.
     * Undefined for network-level failures (ECONNREFUSED, timeout, etc.).
     */
    public readonly status: number | undefined,
    /** The underlying error from axios or the environment. */
    public readonly cause: unknown,
  ) {
    super(
      `${source} source error: ${status !== undefined ? `HTTP ${status}` : 'network error'}`,
    );
    this.name = 'SourceError';
  }
}
