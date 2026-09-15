/**
 * recovery.ts — client-side Shamir social recovery.
 *
 * WHY THIS MODULE EXISTS (high finding #2):
 *   Recovery used to run entirely on the server: it generated the secret, split
 *   it, encrypted every share, stored every ciphertext, returned every guardian
 *   key in one response, and later reconstructed the plaintext secret on demand.
 *   Each step is individually defensible; together they mean the server saw the
 *   secret and held every input needed to rebuild it. A compromise at setup time
 *   yielded everything, which is the opposite of what "self-sovereign recovery"
 *   claims.
 *
 *   These functions move that work to the holder's device. The server receives
 *   ciphertexts and nothing else — no secret, no plaintext share, no guardian
 *   key — so compromising it cannot reconstruct anything.
 *
 * DESIGN:
 *   Deliberately free of NestJS, Prisma, and any I/O so the identical code can
 *   run in a browser, a mobile app, or a test. The server imports only the types
 *   and the envelope validator; it never calls split, combine, or decrypt.
 *
 * THREAT NOTE:
 *   Guardian keys are the only secrets that leave the holder's device, and each
 *   one alone is useless: it decrypts a single share, and fewer than `threshold`
 *   shares reveal nothing about the secret (that is the Shamir guarantee). The
 *   holder is responsible for delivering each key to its guardian out-of-band —
 *   sending them all through one channel would recreate the very concentration
 *   this module exists to remove.
 */

import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'crypto';
import { combine, split } from 'shamir-secret-sharing';

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * A single encrypted Shamir share, as stored by the server.
 *
 * Self-describing so a future format change is detectable rather than silently
 * misparsed. Contains no plaintext share material.
 */
export interface EncryptedShardEnvelope {
  v: 1;
  alg: 'aes-256-gcm';
  /** 12-byte GCM nonce, hex. */
  iv: string;
  /** 16-byte GCM authentication tag, hex. */
  authTag: string;
  /** Encrypted Shamir share, hex. */
  ciphertext: string;
  /**
   * sha256(secret), hex — a non-secret commitment.
   *
   * Lets whoever reconstructs confirm they rebuilt the right value without
   * anyone having to store the secret. A hash of a 32-byte random secret is not
   * usefully invertible.
   */
  tag: string;
}

/** What a guardian is given out-of-band. The key is the only secret here. */
export interface RecoveryKit {
  guardianName: string;
  shardIndex: number;
  /** 32-byte AES key, hex. Decrypts exactly one share. */
  key: string;
}

/** A guardian, as named by the holder. */
export interface GuardianInput {
  name: string;
  kind: string;
}

/** The payload uploaded to the server. Contains ciphertexts only. */
export interface RecoverySetupPayload {
  threshold: number;
  verificationTag: string;
  guardians: Array<{
    name: string;
    kind: string;
    shardIndex: number;
    /** JSON-serialised EncryptedShardEnvelope. */
    encryptedShard: string;
  }>;
}

/** Everything prepareRecovery produces; only `payload` is for the server. */
export interface PreparedRecovery {
  payload: RecoverySetupPayload;
  /** Deliver each kit to its guardian out-of-band. Never upload these. */
  recoveryKits: RecoveryKit[];
  /** The secret being protected, hex. Shown once; never uploaded. */
  secretHex: string;
}

// ── Primitives ────────────────────────────────────────────────────────────────

/** Generate a fresh 32-byte recovery secret. */
export function generateRecoverySecret(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/** sha256 of the secret, hex — the non-secret verification commitment. */
export function computeVerificationTag(secret: Uint8Array): string {
  return createHash('sha256').update(Buffer.from(secret)).digest('hex');
}

/** Generate a fresh 32-byte AES key for one guardian. */
export function generateShardKey(): Uint8Array {
  return new Uint8Array(randomBytes(32));
}

/**
 * AES-256-GCM encrypt one Shamir share under a guardian's key.
 *
 * GCM rather than CBC so a wrong key or tampered ciphertext fails loudly at
 * decryption instead of yielding plausible garbage that would then be fed into
 * Shamir reconstruction and produce a wrong secret.
 */
export function encryptShard(
  share: Uint8Array,
  key: Uint8Array,
  verificationTag: string,
): EncryptedShardEnvelope {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', Buffer.from(key), iv);
  const ciphertext = Buffer.concat([
    cipher.update(Buffer.from(share)),
    cipher.final(),
  ]);
  return {
    v: 1,
    alg: 'aes-256-gcm',
    iv: iv.toString('hex'),
    authTag: cipher.getAuthTag().toString('hex'),
    ciphertext: ciphertext.toString('hex'),
    tag: verificationTag,
  };
}

/**
 * Decrypt one share.
 *
 * Returns null — rather than throwing — when the key is wrong or the ciphertext
 * was tampered with, so a caller can simply skip that submission and keep
 * collecting toward the threshold.
 */
export function decryptShard(
  envelope: EncryptedShardEnvelope,
  key: Uint8Array,
): Uint8Array | null {
  try {
    const decipher = createDecipheriv(
      'aes-256-gcm',
      Buffer.from(key),
      Buffer.from(envelope.iv, 'hex'),
    );
    decipher.setAuthTag(Buffer.from(envelope.authTag, 'hex'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ciphertext, 'hex')),
      decipher.final(),
    ]);
    return new Uint8Array(plaintext);
  } catch {
    // GCM authentication failure — wrong key or tampered data.
    return null;
  }
}

/**
 * Structural check for a stored envelope.
 *
 * The server uses this to reject malformed uploads. It deliberately cannot tell
 * whether the ciphertext decrypts to anything meaningful — that would require
 * the key, which the server must never have.
 */
export function isEncryptedShardEnvelope(
  value: unknown,
): value is EncryptedShardEnvelope {
  if (value === null || typeof value !== 'object') return false;
  const e = value as Record<string, unknown>;
  return (
    e.v === 1 &&
    e.alg === 'aes-256-gcm' &&
    typeof e.iv === 'string' &&
    /^[0-9a-f]{24}$/.test(e.iv) &&
    typeof e.authTag === 'string' &&
    /^[0-9a-f]{32}$/.test(e.authTag) &&
    typeof e.ciphertext === 'string' &&
    /^[0-9a-f]+$/.test(e.ciphertext) &&
    typeof e.tag === 'string' &&
    /^[0-9a-f]{64}$/.test(e.tag)
  );
}

// ── High-level client flows ───────────────────────────────────────────────────

/**
 * Prepare a T-of-N recovery setup entirely on the holder's device.
 *
 * Generates (or accepts) the secret, Shamir-splits it, encrypts each share under
 * a fresh per-guardian key, and returns the server payload separately from the
 * guardian kits. Only `payload` should ever be uploaded.
 *
 * The secret buffer is zeroed once splitting is done, so it does not linger in
 * memory beyond its use.
 *
 * @param guardians  At least 2.
 * @param options.secretHex  Reuse an existing secret instead of generating one.
 * @param options.threshold  Defaults to floor(N/2)+1.
 */
export async function prepareRecovery(
  guardians: GuardianInput[],
  options: { secretHex?: string; threshold?: number } = {},
): Promise<PreparedRecovery> {
  const n = guardians.length;
  if (n < 2) throw new Error('At least 2 guardians required');

  const threshold = options.threshold ?? Math.floor(n / 2) + 1;
  if (threshold < 2 || threshold > n) {
    throw new Error(`Threshold must be between 2 and ${n} (got ${threshold})`);
  }

  const secret =
    options.secretHex !== undefined
      ? new Uint8Array(Buffer.from(options.secretHex, 'hex'))
      : generateRecoverySecret();
  if (secret.length === 0) throw new Error('Recovery secret must be non-empty');

  const secretHex = Buffer.from(secret).toString('hex');
  const verificationTag = computeVerificationTag(secret);

  const shares = await split(secret, n, threshold);

  // Zero the working copy now that the shares exist.
  secret.fill(0);

  const recoveryKits: RecoveryKit[] = [];
  const payloadGuardians: RecoverySetupPayload['guardians'] = [];

  for (let i = 0; i < n; i++) {
    const key = generateShardKey();
    const envelope = encryptShard(shares[i], key, verificationTag);

    payloadGuardians.push({
      name: guardians[i].name,
      kind: guardians[i].kind,
      shardIndex: i,
      encryptedShard: JSON.stringify(envelope),
    });
    recoveryKits.push({
      guardianName: guardians[i].name,
      shardIndex: i,
      key: Buffer.from(key).toString('hex'),
    });

    shares[i].fill(0);
  }

  return {
    payload: { threshold, verificationTag, guardians: payloadGuardians },
    recoveryKits,
    secretHex,
  };
}

/**
 * Reconstruct the secret on the holder's device from guardian submissions.
 *
 * Takes the ciphertexts fetched from the server plus the keys guardians have
 * supplied, decrypts what it can, and combines once it has `threshold` valid
 * shares.
 *
 * Fails closed: below the threshold it returns without calling combine, so no
 * partial material is produced. The reconstructed value is checked against the
 * stored commitment before being handed back, because Shamir will happily
 * combine mismatched shares into a wrong secret rather than erroring.
 */
export async function reconstructSecret(
  storedShards: Array<{ shardIndex: number; encryptedShard: string }>,
  submissions: Array<{ shardIndex: number; key: string }>,
  threshold: number,
): Promise<
  | { success: true; secretHex: string }
  | { success: false; reason: string }
> {
  if (!Number.isInteger(threshold) || threshold < 2) {
    return { success: false, reason: 'Invalid threshold' };
  }

  const validShares: Uint8Array[] = [];
  let expectedTag: string | null = null;

  for (const submission of submissions) {
    const shard = storedShards.find((s) => s.shardIndex === submission.shardIndex);
    if (!shard) continue;

    let envelope: EncryptedShardEnvelope;
    try {
      envelope = JSON.parse(shard.encryptedShard);
    } catch {
      continue;
    }
    if (!isEncryptedShardEnvelope(envelope)) continue;

    let key: Uint8Array;
    try {
      key = new Uint8Array(Buffer.from(submission.key, 'hex'));
    } catch {
      continue;
    }
    if (key.length !== 32) continue;

    const share = decryptShard(envelope, key);
    if (!share) continue; // wrong key or tampered ciphertext

    expectedTag ??= envelope.tag;
    validShares.push(share);
  }

  if (validShares.length < threshold) {
    return {
      success: false,
      reason: 'Insufficient valid shares to reconstruct the secret',
    };
  }

  const reconstructed = await combine(validShares.slice(0, threshold));
  const secretHex = Buffer.from(reconstructed).toString('hex');

  if (expectedTag !== null && computeVerificationTag(reconstructed) !== expectedTag) {
    return {
      success: false,
      reason: 'Reconstruction failed — verification tag mismatch',
    };
  }

  return { success: true, secretHex };
}
