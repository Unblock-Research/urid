/**
 * local-ledger.service.ts — Hash-chained, DB-backed LedgerService implementation.
 *
 * CONCURRENCY DECISION:
 *   Appends are serialized through an in-process promise-chain mutex: each call
 *   chains onto a `this._appendQueue` Promise, and the actual DB work runs
 *   inside a Prisma interactive transaction. This guarantees that:
 *     (a) no two appends race to read `MAX(index)` simultaneously, and
 *     (b) index + prevHash assignment is atomic within a single transaction.
 *
 *   SINGLE-INSTANCE ASSUMPTION: This mutex is in-process only. A multi-instance
 *   (horizontally-scaled) deployment would require a DB-level advisory lock or
 *   row-level locking inside the transaction to prevent cross-instance races.
 *   That requirement is deferred alongside the Sui/EVM chain swap (CHN-01).
 */

import { Injectable } from '@nestjs/common';
import { LedgerService, LedgerPayload, LedgerRecord } from './ledger.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  GENESIS_PREV_HASH,
  computeTxHash,
  verifyChain,
  type ChainRow,
} from './hash-chain';

@Injectable()
export class LocalLedgerService extends LedgerService {
  /**
   * In-process promise-chain mutex.
   * Each append chains its work onto this promise so that concurrent callers
   * are queued rather than racing on index / prevHash reads.
   */
  private _appendQueue: Promise<unknown> = Promise.resolve();

  constructor(private readonly prisma: PrismaService) {
    super();
  }

  // ── Public interface ──────────────────────────────────────────────────────

  /** Anchor a DID-registration event. Type string: "register_did". */
  registerDid(payload: LedgerPayload): Promise<LedgerRecord> {
    return this._enqueue('register_did', payload);
  }

  /** Anchor an SBT-minting event. Type string: "mint_sbt". */
  mintSbt(payload: LedgerPayload): Promise<LedgerRecord> {
    return this._enqueue('mint_sbt', payload);
  }

  /** Anchor an SBT-revocation event. Type string: "revoke_sbt". */
  revokeSbt(payload: LedgerPayload): Promise<LedgerRecord> {
    return this._enqueue('revoke_sbt', payload);
  }

  /** Retrieve a transaction by its unique txHash. Returns null if not found. */
  async getTransaction(txHash: string): Promise<LedgerRecord | null> {
    const row = await this.prisma.ledgerTransaction.findUnique({
      where: { txHash },
    });
    return row ? this._toRecord(row) : null;
  }

  /**
   * Walk every row in ascending index order, recompute each txHash, and
   * verify that every prevHash links correctly to the prior row.
   *
   * Returns { valid: true } for an intact chain, or
   * { valid: false, brokenAt: <first failing index> } on tampering.
   */
  async verifyChainIntegrity(): Promise<{ valid: boolean; brokenAt?: number }> {
    const rows = await this.prisma.ledgerTransaction.findMany({
      orderBy: { index: 'asc' },
    });

    const chainRows: ChainRow[] = rows.map((r) => ({
      index: r.index,
      type: r.type,
      payload: r.payload,
      txHash: r.txHash,
      prevHash: r.prevHash,
    }));

    return verifyChain(chainRows);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  /**
   * Enqueue an append operation onto the in-process mutex chain.
   * Returns a promise that resolves once this specific append has completed.
   */
  private _enqueue(type: string, payload: LedgerPayload): Promise<LedgerRecord> {
    const next = this._appendQueue.then(() => this._append(type, payload));
    // Drain errors so the queue doesn't permanently break on a single failure;
    // the caller still receives the rejection via `next`.
    this._appendQueue = next.catch(() => undefined);
    return next;
  }

  /**
   * Core append — must only be called from within the mutex chain.
   *
   * Runs inside a Prisma interactive transaction so that the read of the last
   * row and the write of the new row are atomic at the DB level.
   */
  private async _append(type: string, payload: LedgerPayload): Promise<LedgerRecord> {
    return this.prisma.$transaction(async (tx) => {
      // Determine the previous row (or genesis anchor)
      const last = await tx.ledgerTransaction.findFirst({
        orderBy: { index: 'desc' },
      });

      const prevHash = last?.txHash ?? GENESIS_PREV_HASH;
      const index = last !== null && last !== undefined ? last.index + 1 : 0;

      // Compute the chain hash for this entry
      const txHash = computeTxHash({ index, type, payload }, prevHash);

      // Persist the new row
      const row = await tx.ledgerTransaction.create({
        data: {
          index,
          type,
          payload: payload as object,
          txHash,
          prevHash,
        },
      });

      return this._toRecord(row);
    });
  }

  /** Map a raw Prisma LedgerTransaction row to the normalised LedgerRecord shape. */
  private _toRecord(row: {
    index: number;
    type: string;
    payload: unknown;
    txHash: string;
    prevHash: string;
    createdAt: Date;
  }): LedgerRecord {
    return {
      index: row.index,
      type: row.type,
      payload: row.payload as LedgerPayload,
      txHash: row.txHash,
      prevHash: row.prevHash,
      createdAt: row.createdAt,
    };
  }
}
