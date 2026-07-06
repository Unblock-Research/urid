/**
 * OrcidClient spec — TDD tests for the ORCID public API client.
 *
 * All HTTP is mocked via an injectable fake `{ get: vi.fn() }` — no live
 * network calls are made.  Fixtures are realistic ORCID API response shapes
 * so the parsing logic is exercised against real-world structures.
 *
 * Coverage:
 *   - getWorks()       → normalized NormalizedWork array, null doi/venue, graceful failure
 *   - getRecord()      → OrcidRecordSummary fields, graceful failure
 *   - getPeerReviews() → count from group array, graceful failure
 *   - getFundings()    → count from group array, graceful failure
 *   - percent-encoding of orcidId in every URL path (T-07-02)
 *   - graceful degradation: network/HTTP errors resolve to empty/undefined (never crash)
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { AxiosInstance } from 'axios';
import { OrcidClient, ORCID_API_DEFAULT_BASE } from './orcid.client';

// ---------------------------------------------------------------------------
// ORCID API fixture payloads (realistic response shapes)
// ---------------------------------------------------------------------------

/** A normal ORCID iD. */
const ORCID_ID = '0000-0001-2345-6789';

/**
 * An ORCID iD containing a forward slash (URL-reserved character).
 * Used to verify encodeURIComponent is applied (T-07-02).
 */
const ORCID_ID_WITH_SLASH = '0000-0001-2345/6789';

const WORKS_FIXTURE = {
  group: [
    {
      'work-summary': [
        {
          title: { title: { value: 'Quantum Entanglement Revisited' } },
          'external-ids': {
            'external-id': [
              { 'external-id-type': 'doi', 'external-id-value': '10.1000/xyz123' },
              { 'external-id-type': 'pmid', 'external-id-value': '12345678' },
            ],
          },
          'journal-title': { value: 'Nature Physics' },
        },
      ],
    },
    {
      'work-summary': [
        {
          title: { title: { value: 'Dark Matter Hypothesis' } },
          'external-ids': {
            'external-id': [], // no DOI
          },
          'journal-title': null, // no venue
        },
      ],
    },
  ],
};

const RECORD_FIXTURE = {
  person: {
    name: {
      'given-names': { value: 'Alice' },
      'family-name': { value: 'Quantum' },
    },
  },
  'activities-summary': {
    works: {
      group: [{}, {}], // 2 work groups
    },
  },
};

const PEER_REVIEWS_FIXTURE = {
  group: [
    { 'peer-review-group': [] },
    { 'peer-review-group': [] },
    { 'peer-review-group': [] },
  ], // 3 peer-review groups
};

const FUNDINGS_FIXTURE = {
  group: [
    { 'funding-summary': [{ title: 'NSF Grant 2023' }] },
    { 'funding-summary': [{ title: 'NIH Grant 2024' }] },
  ], // 2 funding groups
};

// ---------------------------------------------------------------------------
// Helper: build client with a mock HTTP layer
// ---------------------------------------------------------------------------

function makeClient(): { client: OrcidClient; mockGet: ReturnType<typeof vi.fn> } {
  const mockGet = vi.fn();
  const client = new OrcidClient({ get: mockGet } as unknown as AxiosInstance);
  return { client, mockGet };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('OrcidClient', () => {
  // ── getWorks() ────────────────────────────────────────────────────────────

  describe('getWorks()', () => {
    it('resolves to a NormalizedWork array from a mocked /works response', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: WORKS_FIXTURE });

      const works = await client.getWorks(ORCID_ID);

      expect(works).toHaveLength(2);
      expect(works[0].title).toBe('Quantum Entanglement Revisited');
      expect(works[0].doi).toBe('10.1000/xyz123');
      expect(works[0].venue).toBe('Nature Physics');
      expect(typeof works[0].coAuthorCount).toBe('number');
    });

    it('sets doi to null when no DOI external-id is present in the work', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: WORKS_FIXTURE });

      const works = await client.getWorks(ORCID_ID);

      expect(works[1].doi).toBeNull();
    });

    it('sets venue to null when journal-title is absent', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: WORKS_FIXTURE });

      const works = await client.getWorks(ORCID_ID);

      expect(works[1].venue).toBeNull();
    });

    it('returns an empty array on network failure (graceful degradation)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockRejectedValueOnce(new Error('Network error'));

      const works = await client.getWorks(ORCID_ID);

      expect(works).toEqual([]);
    });

    it('returns an empty array on HTTP 500 (graceful degradation)', async () => {
      const { client, mockGet } = makeClient();
      const err = Object.assign(new Error('Internal Server Error'), {
        response: { status: 500 },
      });
      mockGet.mockRejectedValueOnce(err);

      const works = await client.getWorks(ORCID_ID);

      expect(works).toEqual([]);
    });

    it('percent-encodes orcidId before URL interpolation (T-07-02)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: { group: [] } });

      await client.getWorks(ORCID_ID_WITH_SLASH);

      const calledPath: string = mockGet.mock.calls[0][0];
      // The encoded form must appear in the path
      expect(calledPath).toContain(encodeURIComponent(ORCID_ID_WITH_SLASH));
      // The raw slash in the id must NOT appear as a literal path separator
      expect(calledPath).not.toContain('/6789');
    });
  });

  // ── getRecord() ───────────────────────────────────────────────────────────

  describe('getRecord()', () => {
    it('resolves to OrcidRecordSummary with name and worksGroupCount', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: RECORD_FIXTURE });

      const record = await client.getRecord(ORCID_ID);

      expect(record).toBeDefined();
      expect(record!.name).toBe('Alice Quantum');
      expect(record!.worksGroupCount).toBe(2);
    });

    it('returns undefined on network failure (graceful degradation)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockRejectedValueOnce(new Error('timeout'));

      const record = await client.getRecord(ORCID_ID);

      expect(record).toBeUndefined();
    });

    it('percent-encodes orcidId before URL interpolation (T-07-02)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: RECORD_FIXTURE });

      await client.getRecord(ORCID_ID_WITH_SLASH);

      const calledPath: string = mockGet.mock.calls[0][0];
      expect(calledPath).toContain(encodeURIComponent(ORCID_ID_WITH_SLASH));
      expect(calledPath).not.toContain('/6789');
    });
  });

  // ── getPeerReviews() ──────────────────────────────────────────────────────

  describe('getPeerReviews()', () => {
    it('resolves to PeerReviewSummary with count equal to group array length', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: PEER_REVIEWS_FIXTURE });

      const result = await client.getPeerReviews(ORCID_ID);

      expect(result.count).toBe(3);
    });

    it('returns { count: 0 } on network failure (graceful degradation)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockRejectedValueOnce(new Error('timeout'));

      const result = await client.getPeerReviews(ORCID_ID);

      expect(result.count).toBe(0);
    });

    it('percent-encodes orcidId before URL interpolation (T-07-02)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: PEER_REVIEWS_FIXTURE });

      await client.getPeerReviews(ORCID_ID_WITH_SLASH);

      const calledPath: string = mockGet.mock.calls[0][0];
      expect(calledPath).toContain(encodeURIComponent(ORCID_ID_WITH_SLASH));
    });
  });

  // ── getFundings() ─────────────────────────────────────────────────────────

  describe('getFundings()', () => {
    it('resolves to FundingSummary with count equal to group array length', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: FUNDINGS_FIXTURE });

      const result = await client.getFundings(ORCID_ID);

      expect(result.count).toBe(2);
    });

    it('returns { count: 0 } on network failure (graceful degradation)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockRejectedValueOnce(new Error('timeout'));

      const result = await client.getFundings(ORCID_ID);

      expect(result.count).toBe(0);
    });

    it('percent-encodes orcidId before URL interpolation (T-07-02)', async () => {
      const { client, mockGet } = makeClient();
      mockGet.mockResolvedValueOnce({ data: FUNDINGS_FIXTURE });

      await client.getFundings(ORCID_ID_WITH_SLASH);

      const calledPath: string = mockGet.mock.calls[0][0];
      expect(calledPath).toContain(encodeURIComponent(ORCID_ID_WITH_SLASH));
    });
  });

  // ── constants ─────────────────────────────────────────────────────────────

  describe('ORCID_API_DEFAULT_BASE constant', () => {
    it('is set to the ORCID v3.0 public API base URL', () => {
      expect(ORCID_API_DEFAULT_BASE).toBe('https://pub.orcid.org/v3.0');
    });
  });
});
