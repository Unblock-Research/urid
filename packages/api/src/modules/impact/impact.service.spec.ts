/**
 * impact.service.spec.ts — Task 1 RED phase
 *
 * Minimal failing tests for the new calculate() behavior.
 * These FAIL with the current hardcoded mock because:
 *   - calculate() ignores injected clients and returns the same constant
 *   - two different datasets → same score (wrong)
 */

import { describe, it, expect, vi } from 'vitest';
import { ImpactService } from './impact.service';
import type { NormalizedWork } from './sources/types';

// ---------------------------------------------------------------------------
// In-memory Prisma fake
// ---------------------------------------------------------------------------

function makeInMemoryPrisma(
  researcher: { id: string; did: string; orcidId: string | null } | null = null,
) {
  const scoreStore: any[] = [];

  return {
    researcher: {
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        if (!researcher) return null;
        if (where.did === researcher.did || where.id === researcher.id) return researcher;
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
        const matching = scoreStore.filter((r) => r.researcherId === where.researcherId);
        if (matching.length === 0) return null;
        return matching.sort(
          (a, b) => b.calculatedAt.getTime() - a.calculatedAt.getTime(),
        )[0];
      }),
      findMany: vi.fn().mockImplementation(async ({ where, take }: any) => {
        const matching = scoreStore.filter((r) => r.researcherId === where.researcherId);
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
// ---------------------------------------------------------------------------

/** Dataset A — moderate works, moderate citations, several reviews/funding */
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
  // citation vector per DOI — total 55 citations, h-index 5
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
};

/** Dataset B — fewer works, many citations per work, no reviews/funding */
const DATASET_B = {
  researcher: { id: 'r-b', did: 'did:ub:dataset-b', orcidId: '0000-0001-2222-0002' },
  works: [
    { title: 'High-impact work 1', doi: '10.2000/b1', venue: 'Nature', coAuthorCount: 0 },
    { title: 'High-impact work 2', doi: '10.2000/b2', venue: 'Science', coAuthorCount: 0 },
    { title: 'High-impact work 3', doi: '10.2000/b3', venue: 'Cell', coAuthorCount: 0 },
    { title: 'High-impact work 4', doi: '10.2000/b4', venue: 'Nature', coAuthorCount: 0 },
    { title: 'Low-impact work 5', doi: '10.2000/b5', venue: 'Cell', coAuthorCount: 0 },
  ] as NormalizedWork[],
  // citation vector — total 203 citations, known h-index 4
  citationMap: new Map<string, number>([
    ['10.2000/b1', 100],
    ['10.2000/b2', 50],
    ['10.2000/b3', 30],
    ['10.2000/b4', 20],
    ['10.2000/b5', 3],
  ]),
  reviewCount: 0,
  fundingCount: 0,
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('ImpactService — Task 1 RED (calculate)', () => {
  it('two datasets produce DIFFERENT totalScores (data-driven, not constant)', async () => {
    const prismaA = makeInMemoryPrisma(DATASET_A.researcher);
    const svcA = new (ImpactService as any)(
      prismaA,
      makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
      makeCrossrefMock(DATASET_A.citationMap),
    );

    const prismaB = makeInMemoryPrisma(DATASET_B.researcher);
    const svcB = new (ImpactService as any)(
      prismaB,
      makeOrcidMock(DATASET_B.works, DATASET_B.reviewCount, DATASET_B.fundingCount),
      makeCrossrefMock(DATASET_B.citationMap),
    );

    const scoreA = await svcA.calculate(DATASET_A.researcher.did);
    const scoreB = await svcB.calculate(DATASET_B.researcher.did);

    expect(scoreA.totalScore).not.toBeCloseTo(scoreB.totalScore, 3);
  });

  it('realistic dataset totalScore is NOT the old hardcoded constant', async () => {
    const prisma = makeInMemoryPrisma(DATASET_A.researcher);
    const svc = new (ImpactService as any)(
      prisma,
      makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
      makeCrossrefMock(DATASET_A.citationMap),
    );

    const score = await svc.calculate(DATASET_A.researcher.did);

    // Must not return the old hardcoded constant (84.2 raw score / 76.94 weighted)
    expect(score.totalScore).not.toBeCloseTo(84.2, 0);
    expect(score.totalScore).not.toBeCloseTo(76.94, 0);
    // Must be a value in [0, 1] (renormalized total)
    expect(score.totalScore).toBeGreaterThanOrEqual(0);
    expect(score.totalScore).toBeLessThanOrEqual(1);
  });
});

// ---------------------------------------------------------------------------
// Task 2 RED — getScore() must return { status: 'not_calculated' } when
// no score has been persisted, not null.
// (This FAILS until getScore() is updated in Task 2 GREEN.)
// ---------------------------------------------------------------------------

describe('ImpactService — Task 2 RED (getScore)', () => {
  it('returns { status: "not_calculated" } when no score persisted for a known researcher', async () => {
    const prisma = makeInMemoryPrisma({ id: 'r-nc', did: 'did:ub:no-calc', orcidId: '0000-0001-9999-0000' });
    const svc = new (ImpactService as any)(
      prisma,
      makeOrcidMock([], 0, 0),
      makeCrossrefMock(new Map()),
    );

    const result = await svc.getScore('did:ub:no-calc');

    // Must NOT be null — must be a clear not-calculated state
    expect(result).not.toBeNull();
    expect((result as any).status).toBe('not_calculated');
  });

  it('returns the persisted ImpactScore after calculate() is called', async () => {
    const prisma = makeInMemoryPrisma(DATASET_A.researcher);
    const svc = new (ImpactService as any)(
      prisma,
      makeOrcidMock(DATASET_A.works, DATASET_A.reviewCount, DATASET_A.fundingCount),
      makeCrossrefMock(DATASET_A.citationMap),
    );

    const calculated = await svc.calculate(DATASET_A.researcher.did);
    const retrieved = await svc.getScore(DATASET_A.researcher.did);

    expect(retrieved).not.toBeNull();
    expect((retrieved as any).status).toBeUndefined(); // not a 'not_calculated' stub
    expect((retrieved as any).id).toBe(calculated.id);
    expect((retrieved as any).totalScore).toBeCloseTo(calculated.totalScore, 10);
  });
});
