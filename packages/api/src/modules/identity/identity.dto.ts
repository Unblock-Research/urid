/**
 * Zod DTO schemas for the identity controller's write endpoints.
 *
 * Threat register coverage:
 *   T-08-03: rejects malformed register/update/setupRecovery/reconstruct bodies with 400
 *   T-08-04: reconstructBodySchema enforces shardIndex int + key string so malformed
 *            guardian payloads cannot reach the Shamir reconstruct path
 */

import { z } from 'zod';

/** POST /identity/register */
export const registerBodySchema = z.object({
  handle: z.string().min(1),
  displayName: z.string().min(1),
});

/** PUT /identity/did/:did */
export const updateBodySchema = z.object({
  displayName: z.string().optional(),
  bio: z.string().optional(),
  orcidId: z.string().optional(),
  fieldOfStudy: z.string().optional(),
  careerStage: z.string().optional(),
  affiliations: z.array(z.string()).optional(),
});

/** POST /identity/did/:did/recovery */
export const setupRecoveryBodySchema = z.object({
  guardians: z
    .array(
      z.object({
        name: z.string().min(1),
        kind: z.string().min(1),
      }),
    )
    .min(2),
  secret: z.string().optional(),
  threshold: z.number().int().optional(),
});

/** POST /identity/did/:did/recovery/reconstruct */
export const reconstructBodySchema = z.object({
  submissions: z
    .array(
      z.object({
        shardIndex: z.number().int(),
        key: z.string().min(1),
      }),
    )
    .min(1),
});

// Explicit TypeScript types (not z.infer) to avoid TS5.x + Zod 3.25 addQuestionMarks
// inference that makes required fields optional in the flattened output type.
export type RegisterBody = { handle: string; displayName: string };

export type UpdateBody = {
  displayName?: string;
  bio?: string;
  orcidId?: string;
  fieldOfStudy?: string;
  careerStage?: string;
  affiliations?: string[];
};

export type SetupRecoveryBody = {
  guardians: { name: string; kind: string }[];
  secret?: string;
  threshold?: number;
};

export type ReconstructBody = {
  submissions: { shardIndex: number; key: string }[];
};
