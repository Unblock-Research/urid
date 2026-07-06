/**
 * metrics.spec.ts
 *
 * Tests for pure metric helpers in sources/metrics.ts:
 *   - computeHIndex   (Task 1)
 *   - normalizeLog + per-pillar helpers  (Task 2)
 *
 * All assertions are exact-value or ordering (pure functions, no mocking
 * required — these helpers have no I/O, no NestJS dependencies).
 */

import { describe, it, expect } from 'vitest';
import {
  computeHIndex,
  normalizeLog,
  scoreKnowledge,
  scoreImpact,
  scoreReview,
  scoreLeadership,
  scoreRecognition,
  WORKS_SCALE,
  VENUES_SCALE,
  CITATIONS_SCALE,
  HINDEX_SCALE,
  REVIEW_SCALE,
  COLLAB_SCALE,
  FUNDING_SCALE,
} from './metrics';

// ─────────────────────────────────────────────────────────────────────────────
// Task 1: h-index over a per-work citation vector
// ─────────────────────────────────────────────────────────────────────────────

describe('h-index', () => {
  it('computes h-index for [10,8,5,4,3] → 4', () => {
    expect(computeHIndex([10, 8, 5, 4, 3])).toBe(4);
  });

  it('computes h-index for [25,8,5,3,3] → 3', () => {
    expect(computeHIndex([25, 8, 5, 3, 3])).toBe(3);
  });

  it('returns 0 for all-zero vector', () => {
    expect(computeHIndex([0, 0, 0])).toBe(0);
  });

  it('returns 0 for empty vector', () => {
    expect(computeHIndex([])).toBe(0);
  });

  it('returns 1 for a single work with many citations', () => {
    expect(computeHIndex([100])).toBe(1);
  });

  it('does not throw on non-finite / negative entries', () => {
    expect(() => computeHIndex([Infinity, NaN, -1, 5])).not.toThrow();
  });

  it('returns a finite non-negative integer — never NaN — for malformed input', () => {
    const result = computeHIndex([NaN, Infinity, -5]);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBeGreaterThanOrEqual(0);
  });

  it('sanitizes negatives: [5, -10, 3] behaves like [5, 0, 3] → h=2', () => {
    // sorted: [5, 3, 0] → h=2 (2 works with >= 2 citations)
    expect(computeHIndex([5, -10, 3])).toBe(2);
  });

  it('handles a large uniform vector correctly', () => {
    // 10 works each cited 5 times → h=5
    expect(computeHIndex(Array(10).fill(5))).toBe(5);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: normalizeLog primitive
// ─────────────────────────────────────────────────────────────────────────────

describe('normalizeLog', () => {
  it('returns 0 for value=0 with any positive scale', () => {
    expect(normalizeLog(0, 100)).toBe(0);
    expect(normalizeLog(0, 1)).toBe(0);
  });

  it('is strictly increasing (monotonic) with increasing value', () => {
    const a = normalizeLog(10, 100);
    const b = normalizeLog(50, 100);
    const c = normalizeLog(100, 100);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
  });

  it('is clamped to [0,1] for value at scale', () => {
    const atScale = normalizeLog(100, 100);
    expect(atScale).toBeGreaterThanOrEqual(0);
    expect(atScale).toBeLessThanOrEqual(1);
  });

  it('is clamped to [0,1] for value far beyond scale (never exceeds 1)', () => {
    expect(normalizeLog(1_000_000, 100)).toBeLessThanOrEqual(1);
  });

  it('returns 0 for NaN value', () => {
    expect(normalizeLog(NaN, 100)).toBe(0);
  });

  it('returns 0 for negative value', () => {
    expect(normalizeLog(-5, 100)).toBe(0);
  });

  it('returns 0 for undefined coerced to NaN', () => {
    expect(normalizeLog(undefined as unknown as number, 100)).toBe(0);
  });

  it('returns 0 when scale is 0 or negative', () => {
    expect(normalizeLog(10, 0)).toBe(0);
    expect(normalizeLog(10, -5)).toBe(0);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Task 2: per-pillar sub-score helpers
// ─────────────────────────────────────────────────────────────────────────────

describe('scoreKnowledge()', () => {
  it('returns 0 for zero works and zero venues', () => {
    expect(scoreKnowledge(0, 0)).toBe(0);
  });

  it('returns a higher score for higher works count (monotonic)', () => {
    expect(scoreKnowledge(100, 40)).toBeGreaterThan(scoreKnowledge(1, 1));
  });

  it('is clamped to [0,1]', () => {
    const s = scoreKnowledge(50, 20);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('does not exceed 1 for extreme inputs', () => {
    expect(scoreKnowledge(100_000, 100_000)).toBeLessThanOrEqual(1);
  });

  it('returns 0 for NaN inputs', () => {
    expect(scoreKnowledge(NaN, NaN)).toBe(0);
  });

  it('does not return a constant — distinct inputs produce distinct outputs', () => {
    expect(scoreKnowledge(1, 0)).not.toBe(scoreKnowledge(100, 50));
  });
});

describe('scoreImpact()', () => {
  it('returns 0 for zero citations and zero h-index', () => {
    expect(scoreImpact(0, 0)).toBe(0);
  });

  it('returns a higher score for higher citation count (monotonic)', () => {
    expect(scoreImpact(300, 10)).toBeGreaterThan(scoreImpact(10, 2));
  });

  it('is clamped to [0,1]', () => {
    const s = scoreImpact(1_000_000, 100);
    expect(s).toBeGreaterThanOrEqual(0);
    expect(s).toBeLessThanOrEqual(1);
  });

  it('returns 0 for NaN inputs', () => {
    expect(scoreImpact(NaN, NaN)).toBe(0);
  });

  it('does not return a constant — distinct inputs produce distinct outputs', () => {
    expect(scoreImpact(1, 1)).not.toBe(scoreImpact(500, 20));
  });
});

describe('scoreReview()', () => {
  it('returns 0 for zero reviews', () => {
    expect(scoreReview(0)).toBe(0);
  });

  it('is monotonic: more reviews → higher score', () => {
    expect(scoreReview(20)).toBeGreaterThan(scoreReview(5));
  });

  it('is clamped to [0,1] for extreme values', () => {
    expect(scoreReview(0)).toBeGreaterThanOrEqual(0);
    expect(scoreReview(1000)).toBeLessThanOrEqual(1);
  });

  it('returns 0 for NaN input', () => {
    expect(scoreReview(NaN)).toBe(0);
  });

  it('returns 0 for negative input', () => {
    expect(scoreReview(-3)).toBe(0);
  });

  it('does not return a constant — distinct inputs produce distinct outputs', () => {
    expect(scoreReview(1)).not.toBe(scoreReview(30));
  });
});

describe('scoreLeadership()', () => {
  it('returns 0 for zero collaboration signal', () => {
    expect(scoreLeadership(0)).toBe(0);
  });

  it('is monotonic: higher collaboration → higher score', () => {
    expect(scoreLeadership(150)).toBeGreaterThan(scoreLeadership(10));
  });

  it('is clamped to [0,1] for extreme values', () => {
    expect(scoreLeadership(0)).toBeGreaterThanOrEqual(0);
    expect(scoreLeadership(100_000)).toBeLessThanOrEqual(1);
  });

  it('returns 0 for NaN input', () => {
    expect(scoreLeadership(NaN)).toBe(0);
  });

  it('does not return a constant — distinct inputs produce distinct outputs', () => {
    expect(scoreLeadership(1)).not.toBe(scoreLeadership(200));
  });
});

describe('scoreRecognition()', () => {
  it('returns 0 for zero funding entries', () => {
    expect(scoreRecognition(0)).toBe(0);
  });

  it('is monotonic: more funding entries → higher score', () => {
    expect(scoreRecognition(8)).toBeGreaterThan(scoreRecognition(2));
  });

  it('is clamped to [0,1] for extreme values', () => {
    expect(scoreRecognition(0)).toBeGreaterThanOrEqual(0);
    expect(scoreRecognition(1000)).toBeLessThanOrEqual(1);
  });

  it('returns 0 for NaN/negative inputs', () => {
    expect(scoreRecognition(NaN)).toBe(0);
    expect(scoreRecognition(-1)).toBe(0);
  });

  it('does not return a constant — distinct inputs produce distinct outputs', () => {
    expect(scoreRecognition(1)).not.toBe(scoreRecognition(10));
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Scale-constant exports sanity check
// ─────────────────────────────────────────────────────────────────────────────

describe('scale constants', () => {
  it('all scale constants are positive finite numbers', () => {
    for (const [name, val] of [
      ['WORKS_SCALE', WORKS_SCALE],
      ['VENUES_SCALE', VENUES_SCALE],
      ['CITATIONS_SCALE', CITATIONS_SCALE],
      ['HINDEX_SCALE', HINDEX_SCALE],
      ['REVIEW_SCALE', REVIEW_SCALE],
      ['COLLAB_SCALE', COLLAB_SCALE],
      ['FUNDING_SCALE', FUNDING_SCALE],
    ] as [string, number][]) {
      expect(Number.isFinite(val), `${name} must be finite`).toBe(true);
      expect(val, `${name} must be > 0`).toBeGreaterThan(0);
    }
  });
});
