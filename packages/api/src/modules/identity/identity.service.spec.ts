import { describe, it, expect, vi } from 'vitest';
import { IdentityService } from './identity.service';
import { LedgerRecord } from '../../ledger/ledger.service';
import { CryptoService } from '../../crypto/crypto.service';

// ---------------------------------------------------------------------------
// Minimal fakes — no NestJS testing module needed for unit tests
// ---------------------------------------------------------------------------

/** Build a fake LedgerRecord to return from mock ledger methods */
function fakeLedgerRecord(overrides: Partial<LedgerRecord> = {}): LedgerRecord {
  return {
    index: 1,
    type: 'register_did',
    payload: {},
    txHash: 'abc123deadbeef',
    prevHash: '0'.repeat(64),
    createdAt: new Date(),
    ...overrides,
  };
}

/**
 * Minimal PrismaService fake — researcher.create echoes back its data argument
 * merged with id/timestamps so tests can assert exactly what was written to DB.
 */
function makeFakePrisma(options: { researcherExists?: boolean } = {}) {
  const existingRow = {
    id: 'researcher-uuid-001',
    handle: 'alice',
    did: 'did:ub:0x00000061',
    displayName: 'Alice',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    researcher: {
      findUnique: vi.fn().mockResolvedValue(options.researcherExists ? existingRow : null),
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => ({
        id: 'researcher-uuid-001',
        createdAt: new Date(),
        updatedAt: new Date(),
        ...data,
      })),
    },
  };
}

/** Minimal LedgerService fake */
function makeFakeLedger(options: { registerDidFn?: () => Promise<LedgerRecord> } = {}) {
  return {
    registerDid: vi.fn().mockImplementation(
      options.registerDidFn ?? (() => Promise.resolve(fakeLedgerRecord())),
    ),
    mintSbt: vi.fn(),
    revokeSbt: vi.fn(),
    getTransaction: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Tests — all of (1)-(5) and (7) MUST fail against the legacy char-code
// register() implementation (RED state). Test (6) may already pass.
// ---------------------------------------------------------------------------

describe('IdentityService', () => {
  describe('register()', () => {
    /**
     * (1) DID format: result.did must match did:ub:z6Mk… and must NOT be the
     *     legacy 0x char-code-sum form.
     */
    it('(1) returns a DID matching did:ub:z6Mk… and NOT the legacy 0x hex form', async () => {
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger();
      const crypto = new CryptoService();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any, crypto as any);

      const result = await svc.register({ handle: 'alice', displayName: 'Alice' });

      expect(result.did).toMatch(/^did:ub:z6Mk/);
      expect(result.did).not.toMatch(/^did:ub:0x/);
    });

    /**
     * (2) Private key in response: returned exactly once as a top-level field,
     *     hex-encoded (~64 hex chars for a 32-byte Ed25519 key).
     */
    it('(2) response body contains the generated private key exactly once (hex ~64 chars)', async () => {
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger();
      const crypto = new CryptoService();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any, crypto as any);

      const result = await svc.register({ handle: 'alice', displayName: 'Alice' });

      expect(result.privateKey).toBeDefined();
      expect(typeof result.privateKey).toBe('string');
      // 32 bytes → 64 hex chars
      expect((result.privateKey as string).length).toBeGreaterThanOrEqual(60);
      expect(result.privateKey).toMatch(/^[0-9a-f]+$/i);
    });

    /**
     * (3) DB write: prisma.researcher.create is called with non-null publicKey
     *     (hex string) and keyType 'Ed25519'. encryptedPrivateKey must NOT be
     *     set; no raw private key must appear in the create payload.
     */
    it('(3) prisma.researcher.create has non-null publicKey + keyType Ed25519; no plaintext private key written', async () => {
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger();
      const crypto = new CryptoService();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any, crypto as any);

      await svc.register({ handle: 'alice', displayName: 'Alice' });

      const createArg = (fakePrisma.researcher.create.mock.calls[0] as any)[0].data;
      expect(createArg.publicKey).toBeDefined();
      expect(typeof createArg.publicKey).toBe('string');
      expect((createArg.publicKey as string).length).toBeGreaterThan(0);
      expect(createArg.keyType).toBe('Ed25519');
      // Private key must NEVER be written to the DB
      expect(createArg.encryptedPrivateKey ?? null).toBeNull();
      expect(createArg.privateKey).toBeUndefined();
    });

    /**
     * (4) Ledger anchor: registerDid called exactly once with a payload
     *     containing the real did:ub:z6Mk… DID and the hex publicKey.
     */
    it('(4) ledger.registerDid is called once with the real did + publicKey in the payload', async () => {
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger();
      const crypto = new CryptoService();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any, crypto as any);

      await svc.register({ handle: 'alice', displayName: 'Alice' });

      expect(fakeLedger.registerDid).toHaveBeenCalledOnce();
      expect(fakeLedger.registerDid).toHaveBeenCalledWith(
        expect.objectContaining({
          did: expect.stringMatching(/^did:ub:z6Mk/),
          publicKey: expect.stringMatching(/^[0-9a-f]+$/i),
        }),
      );
    });

    /**
     * (5) Self-certifying round-trip: decodeDid(result.did) must equal the
     *     publicKey bytes that were written to the DB.
     */
    it('(5) self-certifying: decodeDid(result.did) equals the stored publicKey bytes', async () => {
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger();
      const crypto = new CryptoService();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any, crypto as any);

      const result = await svc.register({ handle: 'alice', displayName: 'Alice' });

      const createArg = (fakePrisma.researcher.create.mock.calls[0] as any)[0].data;
      const storedPublicKeyBytes = Buffer.from(createArg.publicKey as string, 'hex');
      const decodedPublicKeyBytes = await crypto.decodeDid(result.did as string);

      expect(decodedPublicKeyBytes).toEqual(new Uint8Array(storedPublicKeyBytes));
    });

    /**
     * (6) Duplicate handle: throws 'Handle already taken' and does NOT call the
     *     ledger. Dedup is preserved.  (May already pass in RED state.)
     */
    it('(6) duplicate handle throws "Handle already taken" without calling the ledger', async () => {
      const fakePrisma = makeFakePrisma({ researcherExists: true });
      const fakeLedger = makeFakeLedger();
      const crypto = new CryptoService();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any, crypto as any);

      await expect(
        svc.register({ handle: 'alice', displayName: 'Alice' }),
      ).rejects.toThrow('Handle already taken');
      expect(fakeLedger.registerDid).not.toHaveBeenCalled();
    });

    /**
     * (7) No DID spoofing: a caller-supplied `did` field on the input body is
     *     ignored — the returned DID is always derived from the freshly
     *     generated Ed25519 public key.
     */
    it('(7) external did input is ignored — result.did is always derived from the generated key', async () => {
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger();
      const crypto = new CryptoService();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any, crypto as any);

      // Cast to any — the new register() type no longer accepts a `did` field at all
      const result = await svc.register({
        handle: 'alice',
        displayName: 'Alice',
        did: 'did:ub:SPOOFED_VALUE',
      } as any);

      expect(result.did).toMatch(/^did:ub:z6Mk/);
      expect(result.did).not.toBe('did:ub:SPOOFED_VALUE');
    });

    /**
     * Regression: ledger failures must NOT be swallowed (T-02-05).
     */
    it('propagates ledger failure — register() rejects when ledger.registerDid rejects (T-02-05)', async () => {
      const ledgerError = new Error('ledger unavailable');
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger({
        registerDidFn: () => Promise.reject(ledgerError),
      });
      const crypto = new CryptoService();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any, crypto as any);

      await expect(
        svc.register({ handle: 'alice', displayName: 'Alice' }),
      ).rejects.toThrow('ledger unavailable');
    });
  });
});
