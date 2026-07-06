/**
 * impact.service.spec.ts — mandatory spec (Task 3)
 *
 * Covers every IMP-02 / IMP-03 behavioral requirement using mocked HTTP
 * (no live network).  In-memory Prisma fake captures rows so calculate →
 * getScore round-trips work without a database.
 *
 * Required behaviors (per plan 07-03):
 *  1. Two different mocked ORCID/Crossref datasets → different totalScores,
 *     and neither is the old hardcoded constant.
 *  2. h-index correctness exercised end-to-end.
 *  3. Researcher with no orcidId → all 7 pillars insufficient_data, zero
 *     client HTTP calls made, no fabricated numbers.
 *  4. A pillar with no source data is insufficient_data and EXCLUDED from the
 *     renormalized weighted total.
 *  5. getScore() returns the latest persisted score after calculate(); returns
 *     { status: 'not_calculated' } when none persisted.
 *  6. Client failure degrades gracefully (insufficient_data / no crash / no
 *     fabricated score).
 *  7. Static: 84.2 constant and fixed pillar arrays absent from the service.
 */

import { describe, it, expect, vi } from 'vitest';
import { ImpactService } from './impact.service';
import { computeHIndex } from './sources/metrics';
import type { NormalizedWork } from './sources/types';

// ---------------------------------------------------------------------------
// In-memory Prisma fake
//
// impactScore.create captures rows into a shared store; findFirst queries
// the same store so calculate → getScore round-trips work in-process.
// ---------------------------------------------------------------------------

function makeInMemoryPrisma(
  researcher: { id: string; did: string; orcidId: string | null } | null = null,
) {
  const scoreStore: any[] = [];

  return {
    researcher: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (!researcher) return null;
        if (where.did === researcher.did || where.id === researcher.id) {
          return researcher;
        }
        return null;
      }),
    },
    impactScore: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: `score-${scoreStore.length + 1}`,
          calculatedAt: new Date(Date.now() + scoreStore.length * 1000),
          ...data,
        };
        scoreStore.push(row);
        return row;
      }),
      findFirst: vi.fn().mockImplementation(async ({ where }: any) => {
        const matching = scoreStore.filter(
          (r) => r.researcherId === where.researcherId,
        );
        if (matching.length === 0) return null;
        return matching.sort(
          (a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime(),
        )[0];
      }),
      findMany: vi.fn().mockImplementation(async ({ where, take }: any) => {
        const matching = scoreStore.filter(
          (r) => r.researcherId === where.researcherId,
        );
        return matching.slice(0, take ?? 20);
      }),
    },
    _store: scoreStore,
  };
}

// ---------------------------------------------------------------------------
// Client fakes
// ---------------------------------------------------------------------------

function makeOrcidMock(
  works: NormalizedWork[],
  reviewCount: number,
  fundingCount: number,
) {
  return {
    getWorks: vi.fn().mockResolvedValue(works),
    getRecord: vi.fn().mockResolvedValue({
      name: 'Test Researcher',
      worksGroupCount: works.length,
    }),
    getPeerReviews: vi.fn().mockResolvedValue({ count: reviewCount }),
    getFundings: vi.fn().mockResolvedValue({ count: fundingCount }),
  };
}

function makeCrossrefMock(citationMap: Map<string, number>) {
  return {
    getCitationCount: vi.fn().mockImplementation(async (doi: string) =>
      citationMap.get(doi),
    ),
    getCitationCounts: vi.fn().mockImplementation(async (dois: string[]) => {
      const result = new Map<string, number | undefined>();
      for (const doi of dois) result.set(doi, citationMap.get(doi));
      return result;
    }),
  };
}

// ---------------------------------------------------------------------------
// Fixture datasets
//
// Dataset A — moderate works (10), moderate citations (~55), 3 reviews, 2 funding
// Dataset B — fewer works (5), high citations (203), known h-index 4, 0 reviews/funding
//
// These two datasets are intentionally different enough that their renormalized
// totalScores will differ by > 5 percentage points.
// ---------------------------------------------------------------------------

const DATASET_A = {
  researcher: { id: 'r-a', did: 'did:ub:dataset-a', orcidId: '0000-0001-1111-0001' },
  works: [
    { title: 'Work 1', doi: '10.1000/a1', venue: 'Nature', coAuthorCount: 0 },
    { title: 'Work 2', doi: '10.1000/a2', venue: 'Science', coAuthorCount: 0 },
    { title: 'Work 3', doi: '10.1000/a3', venue: 'Cell', coAuthorCount: 0 },
    { title: 'Work 4', doi: '10.1000/a4', venue: 'Nature', coAuthorCount: 0 }, // duplicate venue
    { title: 'Work 5', doi: '10.1000/a5', venue: 'PLOS ONE', coAuthorCount: 0 },
    { title: 'Work 6', doi: '10.1000/a6', venue: 'Science', coAuthorCount: 0 },
    { title: 'Work 7', doi: '10.1000/a7', venue: 'PLOS ONE', coAuthorCount: 0 },
    { title: 'Work 8', doi: '10.1000/a8', venue: 'eLife', coAuthorCount: 0 },
    { title: 'Work 9', doi: '10.1000/a9', venue: 'Nature', coAuthorCount: 0 },
    { title: 'Work 10', doi: '10.1000/a10', venue: 'BMJ', coAuthorCount: 0 },
  ] as NormalizedWork[],
  // total citations 55; h-index 5 (5 works have ≥5 citations: 20,10,8,7,5)
  citationMap: new Map<string, number>([
    ['10.1000/a1', 20],
    ['10.1000/a2', 10],
    ['10.1000/a3', 8],
    ['10.1000/a4', 7],
    ['10.1000/a5', 5],
    ['10.1000/a6', 3],
    ['10.1000/a7', 1],
    ['10.1000/a8', 1],
    ['10.1000/a9', 0],
    ['10.1000/a10', 0],
  ]),
  reviewCount: 3,
  fundingCount: 2,
  // known h-index: sorted [20,10,8,7,5,3,1,1,0,0]
  //   i=0: 20≥1, i=1: 10≥2, i=2: 8≥3, i=3: 7≥4, i=4: 5≥5 → h=5
  expectedHIndex: 5,
};

const DATASET_B = {
  researcher: { id: 'r-b', did: 'did:ub:dataset-b', orcidId: '0000-0001-2222-0002' },
  works: [
    { title: 'High-impact 1', doi: '10.2000/b1', venue: 'Nature', coAuthorCount: 0 },
    { title: 'High-impact 2', doi: '10.2000/b2', venue: 'Science', coAuthorCount: 0 },
    { title: 'High-impact 3', doi: '10.2000/b3', venue: 'Cell', coAuthorCount: 0 },
    { title: 'High-impact 4', doi: '10.2000/b4', venue: 'Nature', coAuthorCount: 0 },
    { title: 'Low-impact 5', doi: '10.2000/b5', venue: 'Cell', coAuthorCount: 0 },
  ] as NormalizedWork[],
  // total citations 203; known h-index 4
  // sorted [100,50,30,20,3]: i=0:100≥1, i=1:50≥2, i=2:30≥3, i=3:20≥4, i=4:3≥5? NO → h=4
  citationMap: new Map<string, number>([
    ['10.2000/b1', 100],
    ['10.2000/b2', 50],
    ['10.2000/b3', 30],
    ['10.2000/b4', 20],
    ['10.2000/b5', 3],
  ]),
  reviewCount: 0,
  fundingCount: 0,
  expectedHIndex: 4,
};

// ---------------------------------------------------------------------------
// Helper: extract pillars array from persisted score
// ---------------------------------------------------------------------------

function getPillars(score: any): any[] {
  return (score.pillars as any).pillars as any[];
}

function getCoverage(score: any): number {
  return (score.pillars as any).coverage as number;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImpactService', () => {

  // ── 1. Data-driven: two different datasets → different totalScores ─────────

  describe('calculate() — data-driven scores', () => {
    it('two researchers with different datasets receive DIFFERENT totalScores', async () => {
      const svcA = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_A.researcher),
        makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
        makeCrossrefMock(DATASET_A.citationMap),
      );
      const svcB = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_B.researcher),
        makeOrcidMock(DATASET_B.works, DATASET_B.reviewCount, DATASET_B.fundingCount),
        makeCrossrefMock(DATASET_B.citationMap),
      );

      const scoreA = await svcA.calculate(DATASET_A.researcher.did);
      const scoreB = await svcB.calculate(DATASET_B.researcher.did);

      // totalScores must be distinct (different researchers, different data)
      expect(scoreA.totalScore).not.toBeCloseTo(scoreB.totalScore, 3);
    });

    it('realistic dataset totalScore is NOT the old hardcoded constant (~84.2 or ~76.94)', async () => {
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_A.researcher),
        makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
        makeCrossrefMock(DATASET_A.citationMap),
      );

      const score = await svc.calculate(DATASET_A.researcher.did);

      expect(score.totalScore).not.toBeCloseTo(84.2, 0);
      expect(score.totalScore).not.toBeCloseTo(76.94, 0);
      // Must be a renormalized value in [0, 1]
      expect(score.totalScore).toBeGreaterThanOrEqual(0);
      expect(score.totalScore).toBeLessThanOrEqual(1);
    });

    it('OrcidClient and CrossrefClient are called during calculate()', async () => {
      const fakeOrcid = makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount);
      const fakeCrossref = makeCrossrefMock(DATASET_A.citationMap);

      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_A.researcher),
        fakeOrcid,
        fakeCrossref,
      );

      await svc.calculate(DATASET_A.researcher.did);

      expect(fakeOrcid.getWorks).toHaveBeenCalledOnce();
      expect(fakeOrcid.getPeerReviews).toHaveBeenCalledOnce();
      expect(fakeOrcid.getFundings).toHaveBeenCalledOnce();
      expect(fakeCrossref.getCitationCounts).toHaveBeenCalledOnce();
    });
  });

  // ── 2. h-index end-to-end correctness ─────────────────────────────────────

  describe('calculate() — h-index', () => {
    it('computeHIndex helper returns 4 for known vector [100,50,30,20,3]', () => {
      // sorted: [100,50,30,20,3]
      // i=0:100≥1 h=1; i=1:50≥2 h=2; i=2:30≥3 h=3; i=3:20≥4 h=4; i=4:3≥5? NO → h=4
      expect(computeHIndex([100, 50, 30, 20, 3])).toBe(4);
    });

    it('computeHIndex helper returns 5 for vector [20,10,8,7,5,3,1,1,0,0]', () => {
      expect(computeHIndex([20, 10, 8, 7, 5, 3, 1, 1, 0, 0])).toBe(5);
    });

    it('impact pillar score for dataset B reflects expected h-index=4 and 203 total citations', async () => {
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_B.researcher),
        makeOrcidMock(DATASET_B.works, DATASET_B.reviewCount, DATASET_B.fundingCount),
        makeCrossrefMock(DATASET_B.citationMap),
      );

      const score = await svc.calculate(DATASET_B.researcher.did);
      const pillars = getPillars(score);
      const impactPillar = pillars.find((p: any) => p.id === 'impact');

      expect(impactPillar.status).toBe('scored');
      expect(impactPillar.metrics.hIndex).toBe(DATASET_B.expectedHIndex);
      expect(impactPillar.metrics.totalCitations).toBe(203);
    });

    it('impact pillar score for dataset A reflects expected h-index=5 and 55 total citations', async () => {
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_A.researcher),
        makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
        makeCrossrefMock(DATASET_A.citationMap),
      );

      const score = await svc.calculate(DATASET_A.researcher.did);
      const pillars = getPillars(score);
      const impactPillar = pillars.find((p: any) => p.id === 'impact');

      expect(impactPillar.status).toBe('scored');
      expect(impactPillar.metrics.hIndex).toBe(DATASET_A.expectedHIndex);
      expect(impactPillar.metrics.totalCitations).toBe(55);
    });
  });

  // ── 3. No orcidId → all insufficient_data, zero client calls ──────────────

  describe('calculate() — no orcidId', () => {
    it('all 7 pillars are insufficient_data when researcher has no orcidId', async () => {
      const researcher = { id: 'r-noorcid', did: 'did:ub:no-orcid', orcidId: null };
      const fakeOrcid = makeOrcidMock([], 0, 0);
      const fakeCrossref = makeCrossrefMock(new Map());

      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        fakeOrcid,
        fakeCrossref,
      );

      const score = await svc.calculate('did:ub:no-orcid');
      const pillars = getPillars(score);

      expect(pillars).toHaveLength(7);
      for (const p of pillars) {
        expect(p.status).toBe('insufficient_data');
        expect(p.score).toBeNull();
      }
    });

    it('totalScore is 0 and coverage is 0 when researcher has no orcidId', async () => {
      const researcher = { id: 'r-noorcid2', did: 'did:ub:no-orcid-2', orcidId: null };
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        makeOrcidMock([], 0, 0),
        makeCrossrefMock(new Map()),
      );

      const score = await svc.calculate('did:ub:no-orcid-2');

      expect(score.totalScore).toBe(0);
      expect(getCoverage(score)).toBe(0);
    });

    it('no client HTTP calls are made when researcher has no orcidId', async () => {
      const researcher = { id: 'r-noorcid3', did: 'did:ub:no-orcid-3', orcidId: null };
      const fakeOrcid = makeOrcidMock([], 0, 0);
      const fakeCrossref = makeCrossrefMock(new Map());

      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        fakeOrcid,
        fakeCrossref,
      );

      await svc.calculate('did:ub:no-orcid-3');

      expect(fakeOrcid.getWorks).not.toHaveBeenCalled();
      expect(fakeOrcid.getPeerReviews).not.toHaveBeenCalled();
      expect(fakeOrcid.getFundings).not.toHaveBeenCalled();
      expect(fakeCrossref.getCitationCounts).not.toHaveBeenCalled();
    });

    it('no-orcidId result is persisted (no fabricated numbers)', async () => {
      const researcher = { id: 'r-noorcid4', did: 'did:ub:no-orcid-4', orcidId: null };
      const fakePrisma = makeInMemoryPrisma(researcher);

      const svc = new (ImpactService as any)(
        fakePrisma,
        makeOrcidMock([], 0, 0),
        makeCrossrefMock(new Map()),
      );

      const score = await svc.calculate('did:ub:no-orcid-4');

      // impactScore.create was called once (persisted)
      expect(fakePrisma.impactScore.create).toHaveBeenCalledOnce();
      // totalScore is the real data-derived value (0), not 84.2
      expect(score.totalScore).toBe(0);
      expect(score.totalScore).not.toBeCloseTo(84.2, 0);
    });
  });

  // ── 4. Insufficient pillars excluded from renormalized total ───────────────

  describe('calculate() — insufficient_data exclusion', () => {
    it('ethics and repro pillars are always insufficient_data', async () => {
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_A.researcher),
        makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
        makeCrossrefMock(DATASET_A.citationMap),
      );

      const score = await svc.calculate(DATASET_A.researcher.did);
      const pillars = getPillars(score);

      const ethics = pillars.find((p: any) => p.id === 'ethics');
      const repro = pillars.find((p: any) => p.id === 'repro');

      expect(ethics.status).toBe('insufficient_data');
      expect(ethics.score).toBeNull();
      expect(repro.status).toBe('insufficient_data');
      expect(repro.score).toBeNull();
    });

    it('totalScore equals the renormalized weighted sum over scored pillars only', async () => {
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_A.researcher),
        makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
        makeCrossrefMock(DATASET_A.citationMap),
      );

      const score = await svc.calculate(DATASET_A.researcher.did);
      const pillars = getPillars(score);

      const scoredPillars = pillars.filter((p: any) => p.status === 'scored');
      const scoredWeightSum = scoredPillars.reduce((s: number, p: any) => s + p.weight, 0);
      const expectedTotal =
        scoredPillars.reduce((s: number, p: any) => s + p.score * p.weight, 0) /
        scoredWeightSum;

      expect(score.totalScore).toBeCloseTo(expectedTotal, 10);
    });

    it('coverage reflects scored weight fraction (ethics+repro excluded = 12/100)', async () => {
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(DATASET_A.researcher),
        makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
        makeCrossrefMock(DATASET_A.citationMap),
      );

      const score = await svc.calculate(DATASET_A.researcher.did);
      const pillars = getPillars(score);

      const scoredWeightSum = pillars
        .filter((p: any) => p.status === 'scored')
        .reduce((s: number, p: any) => s + p.weight, 0);
      const expectedCoverage = scoredWeightSum / 100;

      expect(getCoverage(score)).toBeCloseTo(expectedCoverage, 10);
    });

    it('knowledge/impact/leadership pillars are insufficient_data when researcher has zero works', async () => {
      const researcher = { id: 'r-noworks', did: 'did:ub:zero-works', orcidId: '0000-0001-0000-0000' };
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        makeOrcidMock(
          [],   // zero works
          5,    // 5 peer reviews
          3,    // 3 funding entries
        ),
        makeCrossrefMock(new Map()),
      );

      const score = await svc.calculate('did:ub:zero-works');
      const pillars = getPillars(score);

      const knowledge = pillars.find((p: any) => p.id === 'knowledge');
      const impact = pillars.find((p: any) => p.id === 'impact');
      const leadership = pillars.find((p: any) => p.id === 'leadership');

      // Works-dependent pillars have no source data
      expect(knowledge.status).toBe('insufficient_data');
      expect(impact.status).toBe('insufficient_data');
      expect(leadership.status).toBe('insufficient_data');

      // review and recognition are still scored (0 works doesn't affect them)
      const review = pillars.find((p: any) => p.id === 'review');
      const recognition = pillars.find((p: any) => p.id === 'recognition');
      expect(review.status).toBe('scored');
      expect(recognition.status).toBe('scored');
    });

    it('insufficient pillars do not contribute to totalScore', async () => {
      const researcher = { id: 'r-noworks2', did: 'did:ub:zero-works-2', orcidId: '0000-0001-0001-0001' };
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        makeOrcidMock([], 5, 3), // 0 works, 5 reviews, 3 funding
        makeCrossrefMock(new Map()),
      );

      const score = await svc.calculate('did:ub:zero-works-2');
      const pillars = getPillars(score);

      const scoredPillars = pillars.filter((p: any) => p.status === 'scored');
      const scoredWeightSum = scoredPillars.reduce((s: number, p: any) => s + p.weight, 0);
      const expectedTotal =
        scoredPillars.reduce((s: number, p: any) => s + p.score * p.weight, 0) /
        scoredWeightSum;

      expect(score.totalScore).toBeCloseTo(expectedTotal, 10);
      // Insufficient pillars (knowledge=22, impact=18, leadership=18, ethics=6, repro=6 = 70)
      // Scored pillars: review=12, recognition=18 → scoredWeightSum=30
      expect(scoredWeightSum).toBe(30);
    });
  });

  // ── 5. getScore() — persisted and not-calculated ───────────────────────────

  describe('getScore()', () => {
    it('returns the latest persisted ImpactScore after calculate()', async () => {
      const fakePrisma = makeInMemoryPrisma(DATASET_A.researcher);
      const svc = new (ImpactService as any)(
        fakePrisma,
        makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
        makeCrossrefMock(DATASET_A.citationMap),
      );

      const calculated = await svc.calculate(DATASET_A.researcher.did);
      const retrieved = await svc.getScore(DATASET_A.researcher.did);

      expect(retrieved).toBeDefined();
      // Must not be a 'not_calculated' stub
      expect((retrieved as any).status).toBeUndefined();
      expect((retrieved as any).id).toBe(calculated.id);
      expect((retrieved as any).totalScore).toBeCloseTo(calculated.totalScore, 10);
    });

    it('returns { status: "not_calculated" } when no score has been persisted', async () => {
      const researcher = { id: 'r-nocalc', did: 'did:ub:no-calc', orcidId: '0000-0001-9999-0000' };
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        makeOrcidMock([], 0, 0),
        makeCrossrefMock(new Map()),
      );

      const result = await svc.getScore('did:ub:no-calc');

      expect(result).not.toBeNull();
      expect((result as any).status).toBe('not_calculated');
    });

    it('returns null for an unknown DID', async () => {
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(null), // researcher not found
        makeOrcidMock([], 0, 0),
        makeCrossrefMock(new Map()),
      );

      const result = await svc.getScore('did:ub:ghost');

      expect(result).toBeNull();
    });

    it('getScore never returns the old hardcoded 84.2 fallback', async () => {
      const researcher = { id: 'r-old', did: 'did:ub:old', orcidId: null };
      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        makeOrcidMock([], 0, 0),
        makeCrossrefMock(new Map()),
      );

      // No score persisted — must not fall back to 84.2
      const result = await svc.getScore('did:ub:old');

      expect((result as any).totalScore).not.toBeCloseTo(84.2, 0);
    });
  });

  // ── 6. Client failure → graceful degradation ──────────────────────────────

  describe('calculate() — graceful degradation on client failure', () => {
    it('OrcidClient.getWorks failure → knowledge/impact/leadership become insufficient_data', async () => {
      const researcher = {
        id: 'r-orcid-fail',
        did: 'did:ub:orcid-fail',
        orcidId: '0000-0001-FAIL-0001',
      };
      const failingOrcid = {
        getWorks: vi.fn().mockRejectedValue(new Error('ORCID network error')),
        getRecord: vi.fn().mockRejectedValue(new Error('ORCID network error')),
        getPeerReviews: vi.fn().mockResolvedValue({ count: 2 }),
        getFundings: vi.fn().mockResolvedValue({ count: 1 }),
      };
      const fakeCrossref = makeCrossrefMock(new Map());

      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        failingOrcid,
        fakeCrossref,
      );

      // Should not throw
      const score = await svc.calculate('did:ub:orcid-fail');

      expect(score).toBeDefined();
      // totalScore must be a valid number (not NaN, not fabricated)
      expect(Number.isFinite(score.totalScore)).toBe(true);
      expect(score.totalScore).toBeGreaterThanOrEqual(0);
      expect(score.totalScore).toBeLessThanOrEqual(1);
      // Must not be the old constant
      expect(score.totalScore).not.toBeCloseTo(84.2, 0);

      const pillars = getPillars(score);
      // knowledge/impact/leadership depend on works → insufficient_data after failure
      expect(pillars.find((p: any) => p.id === 'knowledge').status).toBe('insufficient_data');
      expect(pillars.find((p: any) => p.id === 'impact').status).toBe('insufficient_data');
      expect(pillars.find((p: any) => p.id === 'leadership').status).toBe('insufficient_data');
    });

    it('CrossrefClient.getCitationCounts failure → impact pillar gets 0 citations (still scored)', async () => {
      const researcher = {
        id: 'r-crossref-fail',
        did: 'did:ub:crossref-fail',
        orcidId: '0000-0001-XREF-0001',
      };
      const fakeOrcid = makeOrcidMock(DATASET_A.works, 1, 1);
      const failingCrossref = {
        getCitationCount: vi.fn().mockRejectedValue(new Error('Crossref down')),
        getCitationCounts: vi.fn().mockRejectedValue(new Error('Crossref down')),
      };

      const svc = new (ImpactService as any)(
        makeInMemoryPrisma(researcher),
        fakeOrcid,
        failingCrossref,
      );

      // Should not throw
      const score = await svc.calculate('did:ub:crossref-fail');

      expect(score).toBeDefined();
      expect(Number.isFinite(score.totalScore)).toBe(true);

      const pillars = getPillars(score);
      const impactPillar = pillars.find((p: any) => p.id === 'impact');
      // Impact is still scored (0 citations → low score, not insufficient_data)
      // because the works list is non-empty — the Crossref failure gracefully
      // returns 0 citations via the service's .catch() fallback.
      expect(impactPillar.status).toBe('scored');
      expect(impactPillar.metrics.totalCitations).toBe(0);
      expect(impactPillar.score).toBeGreaterThanOrEqual(0);
    });
  });

  // ── 7. Static mock-removal verification ───────────────────────────────────
  //
  // These grep the actual service source file on disk to confirm the hardcoded
  // constants have been removed.  They are static assertions, not behavioral.

  describe('static: mock constants removed from impact.service.ts', () => {
    it('84.2 constant does not appear in impact.service.ts', async () => {
      const { readFileSync } = await import('fs');
      const { resolve } = await import('path');
      const src = readFileSync(
        resolve(__dirname, 'impact.service.ts'),
        'utf-8',
      );
      const count = (src.match(/84\.2/g) ?? []).length;
      expect(count).toBe(0);
    });

    it('fixed pillar sub-score arrays (0.83/0.72/0.78/0.69/0.81/0.74/0.82) do not appear in impact.service.ts', async () => {
      const { readFileSync } = await import('fs');
      const { resolve } = await import('path');
      const src = readFileSync(
        resolve(__dirname, 'impact.service.ts'),
        'utf-8',
      );
      const fixedScorePattern = /\b0\.(83|72|78|69|81|74|82)\b/g;
      const matches = src.match(fixedScorePattern) ?? [];
      expect(matches).toHaveLength(0);
    });
  });
});
