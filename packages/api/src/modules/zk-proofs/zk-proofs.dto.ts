/**
 * Zod DTO schemas for the zk-proofs controller's write endpoints.
 *
 * Threat register coverage:
 *   T-08-03: rejects malformed prove/verify bodies with 400 before the
 *            Groth16 circuit and snarkjs execution paths are entered
 */

import { z } from 'zod';

/** POST /zk/prove */
export const proveBodySchema = z.object({
  credentialId: z.string().min(1),
  disclosedClaimName: z.string().min(1),
  appName: z.string().min(1),
  consentWindow: z.string().min(1),
  threshold: z.string().optional(),
  predicateEnabled: z.boolean().optional(),
});

/** POST /zk/verify */
export const verifyBodySchema = z.object({
  proofHash: z.string().min(1),
});

// Explicit TypeScript types (not z.infer) to avoid TS5.x + Zod 3.25
// addQuestionMarks inference that makes required fields optional.
export type ProveBody = {
  credentialId: string;
  disclosedClaimName: string;
  appName: string;
  consentWindow: string;
  threshold?: string;
  predicateEnabled?: boolean;
};

export type VerifyBody = { proofHash: string };
