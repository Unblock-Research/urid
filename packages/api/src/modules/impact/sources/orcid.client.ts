/**
 * OrcidClient — injectable, axios-based client for the ORCID public API.
 *
 * Exposes four narrow methods for the impact-score pillars:
 *   - getRecord()      → OrcidRecordSummary (name, works-group count)
 *   - getWorks()       → NormalizedWork[]   (titles, DOIs, venues)
 *   - getPeerReviews() → PeerReviewSummary  (count of peer-review groups)
 *   - getFundings()    → FundingSummary     (count of funding groups)
 *
 * Graceful degradation contract:
 *   All methods catch HTTP/network failures and resolve to empty/undefined
 *   values rather than throwing.  They NEVER return fabricated data.
 *
 * Env vars:
 *   ORCID_API_BASE  — override the base URL
 *                     (default: https://pub.orcid.org/v3.0)
 *
 * Injection for testing:
 *   Pass `{ get: vi.fn() }` as the `http` constructor argument to avoid live
 *   network calls.  NestJS resolves the provider with no arguments, using the
 *   env-configured axios instance automatically.
 *
 * Security (T-07-01, T-07-02, T-07-04):
 *   - orcidId percent-encoded via encodeURIComponent before path interpolation.
 *   - Every external-JSON field accessed via optional chaining.
 *   - axios instance configured with a 10 s request timeout.
 */

import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';
import {
  FundingSummary,
  NormalizedWork,
  OrcidRecordSummary,
  PeerReviewSummary,
} from './types';

/** Default ORCID public API base URL (no authentication required). */
export const ORCID_API_DEFAULT_BASE = 'https://pub.orcid.org/v3.0';

@Injectable()
export class OrcidClient {
  private readonly http: AxiosInstance;

  /**
   * @param http - Optional axios instance.  Inject a `{ get: vi.fn() }` fake in
   *               tests to avoid live network calls.  Omit in production —
   *               an env-backed instance is created automatically.
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? OrcidClient.createDefaultHttp();
  }

  private static createDefaultHttp(): AxiosInstance {
    return axios.create({
      baseURL: process.env.ORCID_API_BASE ?? ORCID_API_DEFAULT_BASE,
      headers: { Accept: 'application/json' },
      timeout: 10_000, // T-07-04: per-request timeout prevents stalled upstreams
    });
  }

  // ── getRecord ─────────────────────────────────────────────────────────────

  /**
   * Fetch a researcher's ORCID record summary.
   * Returns undefined on HTTP/network failure (graceful degradation).
   */
  async getRecord(orcidId: string): Promise<OrcidRecordSummary | undefined> {
    // T-07-02: percent-encode before path interpolation
    const encoded = encodeURIComponent(orcidId);
    try {
      const { data } = await this.http.get(`/${encoded}/record`);
      // T-07-01: optional-chain every external-JSON field access
      const givenName: string = data?.person?.name?.['given-names']?.value ?? '';
      const familyName: string = data?.person?.name?.['family-name']?.value ?? '';
      const nameParts = [givenName, familyName].filter(Boolean);
      return {
        name: nameParts.length > 0 ? nameParts.join(' ') : 'Unknown',
        worksGroupCount:
          (data?.['activities-summary']?.works?.group?.length as number | undefined) ?? 0,
      };
    } catch {
      // Graceful failure: return undefined; never rethrow raw axios error
      return undefined;
    }
  }

  // ── getWorks ──────────────────────────────────────────────────────────────

  /**
   * Fetch and normalize the researcher's works list.
   * Returns an empty array on HTTP/network failure.
   */
  async getWorks(orcidId: string): Promise<NormalizedWork[]> {
    const encoded = encodeURIComponent(orcidId);
    try {
      const { data } = await this.http.get(`/${encoded}/works`);
      const groups: unknown[] = Array.isArray(data?.group) ? data.group : [];
      return groups.flatMap((group: unknown) => {
        const summaries: unknown[] = Array.isArray(
          (group as any)?.['work-summary'],
        )
          ? (group as any)['work-summary']
          : [];
        return summaries.map((ws: unknown): NormalizedWork => ({
          title: (ws as any)?.title?.title?.value ?? '',
          doi:
            ((ws as any)?.['external-ids']?.['external-id'] as unknown[] | undefined)
              ?.find((id: unknown) => (id as any)?.['external-id-type'] === 'doi')
              ?.['external-id-value'] ?? null,
          venue: (ws as any)?.['journal-title']?.value ?? null,
          // ORCID /works summary does not carry contributor detail.
          // coAuthorCount is 0 here; enrichment from /work/{put-code} is deferred.
          coAuthorCount: 0,
        }));
      });
    } catch {
      return [];
    }
  }

  // ── getPeerReviews ────────────────────────────────────────────────────────

  /**
   * Fetch the count of peer-review activities from the /peer-reviews section.
   * Returns { count: 0 } on HTTP/network failure.
   */
  async getPeerReviews(orcidId: string): Promise<PeerReviewSummary> {
    const encoded = encodeURIComponent(orcidId);
    try {
      const { data } = await this.http.get(`/${encoded}/peer-reviews`);
      const groups: unknown[] = Array.isArray(data?.group) ? data.group : [];
      return { count: groups.length };
    } catch {
      return { count: 0 };
    }
  }

  // ── getFundings ───────────────────────────────────────────────────────────

  /**
   * Fetch the count of funding entries from the /fundings section.
   * Returns { count: 0 } on HTTP/network failure.
   */
  async getFundings(orcidId: string): Promise<FundingSummary> {
    const encoded = encodeURIComponent(orcidId);
    try {
      const { data } = await this.http.get(`/${encoded}/fundings`);
      const groups: unknown[] = Array.isArray(data?.group) ? data.group : [];
      return { count: groups.length };
    } catch {
      return { count: 0 };
    }
  }
}
