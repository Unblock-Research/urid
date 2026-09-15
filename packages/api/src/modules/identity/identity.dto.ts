/**
 * Zod DTO schemas for the identity controller's write endpoints.
 *
 * Threat register coverage:
 *   T-08-03: rejects malformed register/update/setupRecovery bodies with 400
 *   T-08-04: setupRecoveryBodySchema constrains guardian shard payloads before
 *            they reach persistence
 *
 * The reconstruct schema is gone: reconstruction now happens on the holder's
 * device, so the server has no endpoint to validate (high finding #2).
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

/**
 * POST /identity/did/:did/recovery
 *
 * Accepts a setup the HOLDER prepared locally with crypto/recovery.ts
 * `prepareRecovery()`. Note what is absent: no `secret` field. The server has no
 * use for one, and accepting it would reintroduce exactly the custodial exposure
 * this flow removes (high finding #2).
 */
export const setupRecoveryBodySchema = z.object({
  threshold: z.number().int().min(2),
  /** sha256(secret) hex — a non-secret commitment used to check reconstruction. */
  verificationTag: z.string().regex(/^[0-9a-f]{64}$/, 'verificationTag must be 64 hex chars'),
  guardians: z
    .array(
      z.object({
        name: z.string().min(1),
        kind: z.string().min(1),
        shardIndex: z.number().int().min(0),
        /**
         * JSON-serialised EncryptedShardEnvelope. Bounded so an oversized blob
         * cannot be used to bloat the table; a v1 envelope for a 32-byte secret
         * is a few hundred bytes.
         */
        encryptedShard: z.string().min(1).max(8192),
      }),
    )
    .min(2),
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
  threshold: number;
  verificationTag: string;
  guardians: {
    name: string;
    kind: string;
    shardIndex: number;
    encryptedShard: string;
  }[];
};
