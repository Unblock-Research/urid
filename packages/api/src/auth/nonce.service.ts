/**
 * nonce.service.ts — single-use token store backing DIDSig replay protection.
 *
 * A signature is only as good as its window. The timestamp bounds how long a
 * captured Authorization header stays valid; the nonce is what stops it being
 * replayed within that window. Both live inside the signed bytes, so neither can
 * be edited without breaking the signature.
 *
 * DURABILITY:
 *   Backed by the database rather than process memory. An in-memory set would be
 *   emptied by a restart, handing an attacker a fresh replay window for every
 *   header captured in the preceding two minutes, and would not be shared across
 *   instances.
 *
 * ATOMICITY:
 *   Claiming is an INSERT against a UNIQUE(did, nonce) constraint. A check-then-
 *   insert would race: two concurrent replays could both observe "unused" before
 *   either wrote. Letting the database reject the duplicate makes first-wins the
 *   only possible outcome.
 */

import { Injectable, Logger } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';

/** Prisma's error code for a unique-constraint violation. */
const PRISMA_UNIQUE_VIOLATION = 'P2002';

/** Minimum gap between opportunistic sweeps of expired rows. */
const SWEEP_INTERVAL_MS = 60_000;

@Injectable()
export class NonceService {
  private readonly logger = new Logger(NonceService.name);

  /** Epoch ms of the last expired-row sweep. */
  private lastSweepAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Attempt to claim `nonce` for `did`.
   *
   * @returns true when the nonce was unused and is now claimed; false when it has
   *          already been seen (i.e. this is a replay).
   */
  async claim(did: string, nonce: string, expiresAt: Date): Promise<boolean> {
    try {
      await this.prisma.authNonce.create({
        data: { did, nonce, expiresAt },
      });
      void this.maybeSweep();
      return true;
    } catch (err: unknown) {
      if ((err as { code?: string })?.code === PRISMA_UNIQUE_VIOLATION) {
        // Already claimed — a replay.
        return false;
      }
      // Anything else (connectivity, constraint drift) must NOT be treated as a
      // successful claim: failing open here would disable replay protection
      // exactly when the database is unhealthy.
      throw err;
    }
  }

  /**
   * Delete nonces whose validity window has passed.
   *
   * Rate-limited to once per SWEEP_INTERVAL_MS. Expired rows are useless — the
   * timestamp check rejects those requests before the nonce is ever consulted —
   * so this is pure housekeeping and its failure is non-fatal.
   */
  async maybeSweep(now: Date = new Date()): Promise<void> {
    if (now.getTime() - this.lastSweepAt < SWEEP_INTERVAL_MS) return;
    this.lastSweepAt = now.getTime();
    try {
      await this.prisma.authNonce.deleteMany({
        where: { expiresAt: { lt: now } },
      });
    } catch (err) {
      this.logger.warn(
        `NonceService: expired-nonce sweep failed (non-fatal): ${(err as Error).message}`,
      );
    }
  }
}
