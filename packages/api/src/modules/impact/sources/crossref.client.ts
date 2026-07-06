/**
 * CrossrefClient — injectable, axios-based client for the Crossref API.
 *
 * Exposes:
 *   - getCitationCount(doi)   → per-DOI `is-referenced-by-count` value
 *   - getCitationCounts(dois) → Map<doi, number|undefined> with bounded concurrency
 *
 * Env vars:
 *   CROSSREF_API_BASE — override the Crossref base URL
 *                       (default: https://api.crossref.org)
 *   CROSSREF_MAILTO   — polite-pool contact email attached as ?mailto=<email>
 *                       (default: contact@urid.app)
 *
 * STUB — TDD RED phase.  Methods compile but return degenerate values.
 * Full implementation is in the GREEN commit.
 */

import { Injectable } from '@nestjs/common';
import axios, { AxiosInstance } from 'axios';

/** Default Crossref API base URL. */
export const CROSSREF_API_DEFAULT_BASE = 'https://api.crossref.org';

/** Default polite-pool contact email (overridden by CROSSREF_MAILTO env var). */
export const CROSSREF_MAILTO_DEFAULT = 'contact@urid.app';

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
      timeout: 10_000,
    });
  }

  /** Stub: always returns undefined. */
  async getCitationCount(_doi: string): Promise<number | undefined> {
    return undefined;
  }

  /** Stub: always returns empty Map. */
  async getCitationCounts(_dois: string[]): Promise<Map<string, number | undefined>> {
    return new Map();
  }
}
