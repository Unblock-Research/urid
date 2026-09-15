/**
 * Zod DTO schema for the credentials controller's write endpoint.
 *
 * Threat register coverage:
 *   T-08-03: rejects malformed mint bodies with 400 before the SBT/Merkle/ledger
 *            path executes
 */

import { z } from 'zod';

/** POST /credentials/mint */
export const mintBodySchema = z.object({
  researcherDid: z.string().min(1),
  credentialType: z.string().min(1),
  title: z.string().min(1),
  issuer: z.string().min(1),
  tone: z.string().optional(),
  fieldOfStudy: z.string().optional(),
  /**
   * Optional numeric claims, e.g. { citationCount: 2841 }.
   *
   * Bounded to non-negative integers below 2^64 because that is what the
   * circuit's GreaterEqThan(64) comparator accepts; rejecting here means a
   * credential cannot be minted carrying a number the predicate could never
   * operate on. Names are constrained so they cannot collide with the fixed
   * string claim fields.
   */
  numericClaims: z
    .record(
      z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, 'invalid numeric claim name'),
      z
        .number()
        .int()
        .nonnegative()
        .max(Number.MAX_SAFE_INTEGER),
    )
    .optional(),
});

// Explicit TypeScript type (not z.infer) to avoid TS5.x + Zod 3.25
// addQuestionMarks inference that makes required fields optional.
export type MintBody = {
  researcherDid: string;
  credentialType: string;
  title: string;
  issuer: string;
  tone?: string;
  fieldOfStudy?: string;
  numericClaims?: Record<string, number>;
};
