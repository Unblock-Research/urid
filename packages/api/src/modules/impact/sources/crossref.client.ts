/**
 * CrossrefClient — injectable, axios-based client for the Crossref REST API.
 *
 * Exposes:
 *   - getCitationCount(doi)   → per-DOI citation count from is-referenced-by-count
 *   - getCitationCounts(dois) → Map<doi, number|undefined> with bounded concurrency
 *
 * Graceful degradation contract:
 *   A per-DOI HTTP/network failure resolves to undefined for that DOI.
 *   The batch never crashes; every DOI is always in the result Map.
 *   Values are never fabricated — undefined means "no data".
 *
 * Env vars:
 *   CROSSREF_API_BASE — override base URL (default: https://api.crossref.org)
 *   CROSSREF_MAILTO   — polite-pool contact email, appended as ?mailto=<email>
 *                       (default: contact@urid.app)
 *
 * Injection for testing:
 *   Pass `{ get: vi.fn() }` as the `http` constructor argument to avoid live
 *   network calls.  NestJS resolves the provider with no arguments.
 *
 * Security (T-07-02, T-07-03, T-07-04):
 *   - DOI is percent-encoded via encodeURIComponent before path interpolation.
 *   - getCitationCounts uses a CONCURRENCY_CAP chunk loop (T-07-03 DoS mitigation).
 *   - axios instance configured with a 10 s per-request timeout (T-07-04).
 */

import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

/** Default Crossref REST API base URL. */
export const CROSSREF_API_DEFAULT_BASE = 'https://api.crossref.org';

/**
 * Default polite-pool contact email.
 * Crossref rewards a registered contact address with higher rate limits.
 * Override via CROSSREF_MAILTO env var with a monitored address for production.
 */
export const CROSSREF_MAILTO_DEFAULT = 'contact@urid.app';

/**
 * Maximum number of concurrent Crossref requests in getCitationCounts.
 * Keeps the outbound fan-out polite (T-07-03).
 */
const CONCURRENCY_CAP = 5;

@Injectable()
export class CrossrefClient {
  private readonly http: AxiosInstance;
  private readonly mailto: string;

  /**
   * @param http - Optional axios instance.  Inject a `{ get: vi.fn() }` fake in
   *               tests to avoid live network calls.
   */
  constructor(http?: AxiosInstance) {
    this.mailto = process.env.CROSSREF_MAILTO ?? CROSSREF_MAILTO_DEFAULT;
    this.http = http ?? CrossrefClient.createDefaultHttp();
  }

  private static createDefaultHttp(): AxiosInstance {
    return axios.create({
      baseURL: process.env.CROSSREF_API_BASE ?? CROSSREF_API_DEFAULT_BASE,
      timeout: 10_000, // T-07-04: per-request timeout prevents stalled upstreams
    });
  }

  // ── getCitationCount ──────────────────────────────────────────────────────

  /**
   * Return the citation count for a single DOI.
   *
   * GET {base}/works/{encodeURIComponent(doi)}?mailto={mailto}
   *
   * Returns undefined if:
   *   - The HTTP request fails (network error, 4xx, 5xx)
   *   - The response body does not contain is-referenced-by-count
   *   - The count value is not a finite number
   */
  async getCitationCount(doi: string): Promise<number | undefined> {
    // T-07-02: percent-encode DOI before path interpolation
    const encoded = encodeURIComponent(doi);
    try {
      const { data } = await this.http.get(`/works/${encoded}`, {
        params: { mailto: this.mailto }, // polite-pool identifier
      });
      // T-07-01: optional-chain external JSON; guard non-finite values
      const count: unknown = data?.message?.['is-referenced-by-count'];
      if (typeof count === 'number' && isFinite(count)) {
        return count;
      }
      return undefined;
    } catch {
      // Graceful failure: per-DOI error → undefined, never rethrow
      return undefined;
    }
  }

  // ── getCitationCounts ─────────────────────────────────────────────────────

  /**
   * Return citation counts for a batch of DOIs.
   *
   * Results are fetched with bounded concurrency (CONCURRENCY_CAP = 5) to
   * stay polite to the Crossref API (T-07-03).
   *
   * A per-DOI failure yields undefined for that entry without crashing the
   * rest of the batch.  Every input DOI is present as a key in the result Map.
   */
  async getCitationCounts(
    dois: string[],
  ): Promise<Map<string, number | undefined>> {
    const result = new Map<string, number | undefined>();
    if (dois.length === 0) return result;

    // Chunk-based concurrency cap (T-07-03: DoS mitigation)
    for (let i = 0; i < dois.length; i += CONCURRENCY_CAP) {
      const chunk = dois.slice(i, i + CONCURRENCY_CAP);
      const counts = await Promise.all(
        chunk.map((doi) => this.getCitationCount(doi)),
      );
      chunk.forEach((doi, idx) => {
        result.set(doi, counts[idx]);
      });
    }

    return result;
  }
}
