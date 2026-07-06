/**
 * OrcidClient — injectable, axios-based client for the ORCID public API.
 *
 * Exposes methods for the four ORCID sections consumed by the impact pillars:
 *   - getRecord()      → OrcidRecordSummary (name, works count)
 *   - getWorks()       → NormalizedWork[]   (titles, DOIs, venues)
 *   - getPeerReviews() → PeerReviewSummary  (count of review activities)
 *   - getFundings()    → FundingSummary     (count of funding entries)
 *
 * All methods degrade gracefully: an HTTP or network failure resolves to an
 * empty/undefined result rather than throwing a raw axios error or fabricating
 * data.  See SourceError in types.ts for the typed error shape.
 *
 * Env vars:
 *   ORCID_API_BASE  — override the ORCID base URL (default: https://pub.orcid.org/v3.0)
 *
 * Injection for testing:
 *   Pass a `{ get: vi.fn() }` fake as the `http` constructor argument to avoid
 *   live network calls.  NestJS resolves the provider without arguments, using
 *   the env-configured axios instance automatically.
 *
 * Security (T-07-01, T-07-02):
 *   - orcidId is percent-encoded via encodeURIComponent before URL interpolation.
 *   - Every external-JSON field access uses optional chaining to guard untrusted shapes.
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

// ---------------------------------------------------------------------------
// STUB — TDD RED phase.  Methods compile but return degenerate values.
// Full implementation is in the GREEN commit.
// ---------------------------------------------------------------------------

@Injectable()
export class OrcidClient {
  private readonly http: AxiosInstance;

  /**
   * @param http - Optional axios instance. Inject a `{ get: vi.fn() }` fake in
   *               tests to avoid live network calls.  Omit in production —
   *               the env-backed default is used automatically.
   */
  constructor(http?: AxiosInstance) {
    this.http = http ?? OrcidClient.createDefaultHttp();
  }

  private static createDefaultHttp(): AxiosInstance {
    return axios.create({
      baseURL: process.env.ORCID_API_BASE ?? ORCID_API_DEFAULT_BASE,
      headers: { Accept: 'application/json' },
      timeout: 10_000,
    });
  }

  /** Fetch a researcher's ORCID record summary. */
  async getRecord(_orcidId: string): Promise<OrcidRecordSummary | undefined> {
    // stub — returns undefined regardless of input
    return undefined;
  }

  /** Fetch and normalize the researcher's works list. */
  async getWorks(_orcidId: string): Promise<NormalizedWork[]> {
    // stub — returns empty array regardless of input
    return [];
  }

  /** Fetch the count of peer-review activities. */
  async getPeerReviews(_orcidId: string): Promise<PeerReviewSummary> {
    // stub — returns zero count regardless of input
    return { count: 0 };
  }

  /** Fetch the count of funding entries. */
  async getFundings(_orcidId: string): Promise<FundingSummary> {
    // stub — returns zero count regardless of input
    return { count: 0 };
  }
}
