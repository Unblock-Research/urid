/**
 * CrossrefClient spec — TDD tests for the Crossref API client.
 *
 * All HTTP is mocked via an injectable fake `{ get: vi.fn() }` — no live
 * network calls are made.  Fixtures are realistic Crossref /works/{doi}
 * response shapes.
 *
 * Coverage:
 *   - getCitationCount()  → parses is-referenced-by-count, percent-encodes DOI,
 *                           attaches mailto query param, graceful failure → undefined
 *   - getCitationCounts() → fans out to all DOIs, concurrency cap (all queried),
 *                           per-DOI failure → undefined without crashing batch
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import {
  CrossrefClient,
  CROSSREF_API_DEFAULT_BASE,
  CROSSREF_MAILTO_DEFAULT,
} from './crossref.client';

// ---------------------------------------------------------------------------
// Fixture payloads
// ---------------------------------------------------------------------------

const DOI = '10.1000/xyz123';
const DOI_WITH_SLASH = '10.1000/xyz/456'; // already contains slash — must be encoded

const CROSSREF_WORKS_RESPONSE = {
  status: 'ok',
  'message-type': 'work',
  message: {
    DOI: '10.1000/xyz123',
    title: ['Quantum Entanglement Revisited'],
    'is-referenced-by-count': 42,
    'published-print': { 'date-parts': [[2023, 4, 15]] },
  },
};

const CROSSREF_ZERO_CITATIONS = {
  status: 'ok',
  'message-type': 'work',
  message: {
    DOI: '10.9999/new-paper',
    title: ['Brand New Work'],
    'is-referenced-by-count': 0,
  },
};

// ---------------------------------------------------------------------------
// Helper: build client with a mock HTTP layer
// ---------------------------------------------------------------------------

function makeClient(): { client: CrossrefClient; mockGet: ReturnType<typeof vi.fn> } {
  const mockGet = vi.fn();
  const client = new CrossrefClient({ get: mockGet } as unknown as AxiosInstance);
  return { client, mockGet };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CrossrefClient', () => {
  // ── getCitationCount() ────────────────────────────────────────────────────

  describe('getCitationCount()', () => {
    it('resolves to is-referenced-by-count from a mocked Crossref /works response', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: CROSSREF_WORKS_RESPONSE });

      const count = await client.getCitationCount(DOI);

      expect(count).toBe(42);
    });

    it('resolves to 0 when is-referenced-by-count is 0', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: CROSSREF_ZERO_CITATIONS });

      const count = await client.getCitationCount('10.9999/new-paper');

      expect(count).toBe(0);
    });

    it('percent-encodes DOI in the URL path (T-07-02)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: CROSSREF_WORKS_RESPONSE });

      await client.getCitationCount(DOI_WITH_SLASH);

      const calledPath: string = mockGet.mock.calls[0][0];
      expect(calledPath).toContain(encodeURIComponent(DOI_WITH_SLASH));
    });

    it('attaches mailto as a query param for the polite pool', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: CROSSREF_WORKS_RESPONSE });

      await client.getCitationCount(DOI);

      const callConfig = mockGet.mock.calls[0][1];
      expect(callConfig?.params?.mailto).toBeDefined();
    });

    it('returns undefined on network failure (graceful degradation)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockRejectedValueOnce(new Error('Network error'));

      const count = await client.getCitationCount(DOI);

      expect(count).toBeUndefined();
    });

    it('returns undefined on HTTP 404 (graceful degradation)', async () => {
      const { client, mockGet } = makeClient();
      const err = Object.assign(new Error('Not Found'), {
        response: { status: 404 },
      });
      mockGet.mockRejectedValueOnce(err);

      const count = await client.getCitationCount(DOI);

      expect(count).toBeUndefined();
    });

    it('returns undefined when is-referenced-by-count is missing from response', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({
        data: { status: 'ok', message: { DOI: '10.1000/xyz' /* no count field */ } },
      });

      const count = await client.getCitationCount(DOI);

      expect(count).toBeUndefined();
    });
  });

  // ── getCitationCounts() ───────────────────────────────────────────────────

  describe('getCitationCounts()', () => {
    it('returns a Map with citation counts for all provided DOIs', async () => {
      const { client, mockGet } = makeClient();
      const dois = ['10.1/a', '10.2/b', '10.3/c'];
      mockGet
        .mockResolvedValueOnce({ data: { message: { 'is-referenced-by-count': 10 } } })
        .mockResolvedValueOnce({ data: { message: { 'is-referenced-by-count': 20 } } })
        .mockResolvedValueOnce({ data: { message: { 'is-referenced-by-count': 30 } } });

      const result = await client.getCitationCounts(dois);

      expect(result.get('10.1/a')).toBe(10);
      expect(result.get('10.2/b')).toBe(20);
      expect(result.get('10.3/c')).toBe(30);
    });

    it('queries every DOI in the provided list', async () => {
      const { client, mockGet } = makeClient();
      const dois = ['10.1/a', '10.2/b', '10.3/c'];
      mockGet.mockResolvedValue({ data: { message: { 'is-referenced-by-count': 5 } } });

      await client.getCitationCounts(dois);

      expect(mockGet).toHaveBeenCalledTimes(3);
    });

    it('maps a failing DOI to undefined without crashing the batch', async () => {
      const { client, mockGet } = makeClient();
      const dois = ['10.1/ok', '10.2/fail', '10.3/ok'];
      mockGet
        .mockResolvedValueOnce({ data: { message: { 'is-referenced-by-count': 7 } } })
        .mockRejectedValueOnce(new Error('timeout for 10.2/fail'))
        .mockResolvedValueOnce({ data: { message: { 'is-referenced-by-count': 9 } } });

      const result = await client.getCitationCounts(dois);

      expect(result.get('10.1/ok')).toBe(7);
      expect(result.get('10.2/fail')).toBeUndefined();
      expect(result.get('10.3/ok')).toBe(9);
    });

    it('returns empty Map for an empty DOI list', async () => {
      const { client } = makeClient();

      const result = await client.getCitationCounts([]);

      expect(result.size).toBe(0);
    });

    it('processes more than CONCURRENCY_CAP DOIs without missing any (batch spanning multiple chunks)', async () => {
      const { client, mockGet } = makeClient();
      // 7 DOIs → spans at least 2 chunks if the cap is 5
      const dois = Array.from({ length: 7 }, (_, i) => `10.${i}/test`);
      mockGet.mockResolvedValue({ data: { message: { 'is-referenced-by-count': 1 } } });

      const result = await client.getCitationCounts(dois);

      expect(mockGet).toHaveBeenCalledTimes(7);
      expect(result.size).toBe(7);
      dois.forEach((doi) => {
        expect(result.has(doi)).toBe(true);
      });
    });
  });

  // ── constants ─────────────────────────────────────────────────────────────

  describe('constants', () => {
    it('CROSSREF_API_DEFAULT_BASE is the Crossref REST API base URL', () => {
      expect(CROSSREF_API_DEFAULT_BASE).toBe('https://api.crossref.org');
    });

    it('CROSSREF_MAILTO_DEFAULT is a non-empty contact email', () => {
      expect(typeof CROSSREF_MAILTO_DEFAULT).toBe('string');
      expect(CROSSREF_MAILTO_DEFAULT.length).toBeGreaterThan(0);
      expect(CROSSREF_MAILTO_DEFAULT).toContain('@');
    });
  });
});
