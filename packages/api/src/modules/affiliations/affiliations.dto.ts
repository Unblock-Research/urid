/**
 * Zod DTO schema for the affiliations controller's write endpoint.
 *
 * Threat register coverage:
 *   T-08-05: rejects malformed request bodies with 400 before Prisma create executes
 */

import { z } from 'zod';

/** POST /affiliations/request */
export const requestBodySchema = z.object({
  researcherDid: z.string().min(1, 'researcherDid is required'),
  organizationName: z.string().min(1, 'organizationName is required'),
  role: z.string().min(1, 'role is required'),
});

// Explicit TypeScript type (not z.infer) to avoid TS5.x + Zod 3.25
// addQuestionMarks inference that makes required fields optional.
export type RequestBodyDto = {
  researcherDid: string;
  organizationName: string;
  role: string;
};
