/**
 * hash-chain.ts — Pure, DB-free hash-chain core for the URID ledger.
 *
 * Provides the cryptographic primitives needed to build and verify an
 * append-only, hash-chained transaction log. This module has zero
 * dependencies on NestJS, Prisma, or any I/O — it can be tested in
 * pure Node without a database.
 *
 * Hash formula:
 *   txHash = sha256( canonicalize({ index, type, payload }) + prevHash )
 *
 * The genesis row (index 0) anchors the chain with GENESIS_PREV_HASH (64 zeros).
 */

import { sha256 } from '@noble/hashes/sha256';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
import { canonicalize } from './canonical';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * The prevHash used by the first ledger row (index 0).
 * A fixed 64-character all-zero hex string that anchors the chain without
 * requiring a prior real transaction.
 */
export const GENESIS_PREV_HASH: string = '0'.repeat(64);

// ── Types ─────────────────────────────────────────────────────────────────────

/** The data committed inside a transaction hash — no hash fields included. */
export interface LedgerEntry {
  index: number;
  type: string;
  payload: unknown;
}

/**
 * A fully-materialised chain row including both hash fields.
 * Mirrors the structure of a persisted LedgerTransaction row.
 */
export interface ChainRow {
  index: number;
  type: string;
  payload: unknown;
  txHash: string;
  prevHash: string;
}

// ── Core functions ────────────────────────────────────────────────────────────

/**
 * Compute the sha256 hash for a ledger entry.
 *
 * Input bytes = UTF-8 encoding of:
 *   canonicalize({ index, type, payload }) + prevHash
 *
 * Returns a 64-character lowercase hex string.
 */
export function computeTxHash(entry: LedgerEntry, prevHash: string): string {
  const canonical = canonicalize({ index: entry.index, type: entry.type, payload: entry.payload });
  const input = canonical + prevHash;
  const digest = sha256(utf8ToBytes(input));
  return bytesToHex(digest);
}

/**
 * Verify the integrity of an ordered chain of rows.
 *
 * For each row at position i:
 *  1. index must equal i (monotonic, gap-free)
 *  2. prevHash must equal GENESIS_PREV_HASH (i=0) or rows[i-1].txHash
 *  3. txHash must equal computeTxHash({ index, type, payload }, prevHash)
 *
 * Returns { valid: true } if the entire chain is intact, or
 * { valid: false, brokenAt: <first failing index> } on the first violation.
 */
export function verifyChain(rows: ChainRow[]): { valid: boolean; brokenAt?: number } {
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];

    // Check monotonic index
    if (row.index !== i) {
      return { valid: false, brokenAt: i };
    }

    // Check prevHash link
    const expectedPrevHash = i === 0 ? GENESIS_PREV_HASH : rows[i - 1].txHash;
    if (row.prevHash !== expectedPrevHash) {
      return { valid: false, brokenAt: i };
    }

    // Recompute and verify txHash
    const recomputed = computeTxHash(
      { index: row.index, type: row.type, payload: row.payload },
      row.prevHash,
    );
    if (recomputed !== row.txHash) {
      return { valid: false, brokenAt: i };
    }
  }

  return { valid: true };
}
