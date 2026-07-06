/**
 * Zod DTO schema for the wallet controller's write endpoint.
 *
 * Threat register coverage:
 *   T-08-05: rejects malformed link bodies with 400 before Prisma create executes
 */

import { z } from 'zod';

/** POST /wallet/link */
export const linkBodySchema = z.object({
  researcherDid: z.string().min(1, 'researcherDid is required'),
  address: z.string().min(1, 'address is required'),
  chain: z.string().min(1, 'chain is required'),
  label: z.string().optional(),
});

// Explicit TypeScript type (not z.infer) to avoid TS5.x + Zod 3.25
// addQuestionMarks inference that makes required fields optional.
export type LinkBodyDto = {
  researcherDid: string;
  address: string;
  chain: string;
  label?: string;
};
