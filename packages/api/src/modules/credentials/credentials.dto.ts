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
};
