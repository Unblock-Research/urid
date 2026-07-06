/**
 * ledger.service.ts — Provider-agnostic LedgerService interface (LDG-01).
 *
 * Defined as a NestJS abstract class so it can be used as a DI token via:
 *   { provide: LedgerService, useClass: LocalLedgerService }
 *
 * This pattern keeps business logic (identity, credentials) depending only on
 * the interface, not any concrete implementation. Swappable to Sui/EVM in v2
 * (CHN-01, deferred).
 *
 * No concrete implementation is imported or referenced here.
 */

/** Arbitrary anchoring metadata passed to ledger operations. */
export type LedgerPayload = Record<string, unknown>;

/**
 * Normalised shape returned by all LedgerService operations.
 *
 * Callers never receive a raw Prisma row — returning a normalised shape keeps
 * the interface decoupled from Prisma so it remains swappable (CHN-01).
 */
export interface LedgerRecord {
  index: number;
  type: string;
  payload: LedgerPayload;
  txHash: string;
  prevHash: string;
  createdAt: Date;
}

/**
 * Abstract DI token for the ledger subsystem.
 *
 * Concrete implementations (LocalLedgerService, future Sui/EVM adapters) must
 * extend this class and be bound via `{ provide: LedgerService, useClass: ... }`.
 */
export abstract class LedgerService {
  /**
   * Anchor a DID-registration event on the ledger.
   * Returns the persisted LedgerRecord with its computed txHash.
   */
  abstract registerDid(payload: LedgerPayload): Promise<LedgerRecord>;

  /**
   * Anchor a soulbound-token minting event on the ledger.
   * Returns the persisted LedgerRecord with its computed txHash.
   */
  abstract mintSbt(payload: LedgerPayload): Promise<LedgerRecord>;

  /**
   * Anchor a soulbound-token revocation event on the ledger.
   * Returns the persisted LedgerRecord with its computed txHash.
   */
  abstract revokeSbt(payload: LedgerPayload): Promise<LedgerRecord>;

  /**
   * Retrieve a single transaction by its unique txHash.
   * Returns null if no matching row exists.
   */
  abstract getTransaction(txHash: string): Promise<LedgerRecord | null>;
}
