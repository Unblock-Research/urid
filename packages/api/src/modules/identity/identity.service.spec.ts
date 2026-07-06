import { describe, it, expect, vi } from 'vitest';
import { IdentityService } from './identity.service';
import { LedgerRecord } from '../../ledger/ledger.service';

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

/** Minimal PrismaService fake — only the methods called by IdentityService */
function makeFakePrisma(options: {
  researcherExists?: boolean;
} = {}) {
  const researcher = {
    id: 'researcher-uuid-001',
    handle: 'alice',
    did: 'did:ub:0x00000061',
    displayName: 'Alice',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  return {
    researcher: {
      findUnique: vi.fn().mockResolvedValue(options.researcherExists ? researcher : null),
      create: vi.fn().mockResolvedValue(researcher),
    },
  };
}

/** Minimal LedgerService fake */
function makeFakeLedger(options: {
  registerDidFn?: () => Promise<LedgerRecord>;
} = {}) {
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
// Tests
// ---------------------------------------------------------------------------

describe('IdentityService', () => {
  describe('register()', () => {
    it('creates a researcher and anchors the DID via ledger.registerDid', async () => {
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any);

      const result = await svc.register({ handle: 'alice', displayName: 'Alice' });

      expect(fakePrisma.researcher.create).toHaveBeenCalledOnce();
      expect(fakeLedger.registerDid).toHaveBeenCalledOnce();
      expect(fakeLedger.registerDid).toHaveBeenCalledWith(
        expect.objectContaining({ handle: 'alice' }),
      );
      expect(result).toMatchObject({ handle: 'alice' });
    });

    it('throws "Handle already taken" without calling the ledger when handle exists', async () => {
      const fakePrisma = makeFakePrisma({ researcherExists: true });
      const fakeLedger = makeFakeLedger();
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any);

      await expect(svc.register({ handle: 'alice', displayName: 'Alice' })).rejects.toThrow(
        'Handle already taken',
      );
      expect(fakeLedger.registerDid).not.toHaveBeenCalled();
    });

    it('propagates ledger failure — register() rejects when ledger.registerDid rejects (T-02-05)', async () => {
      const ledgerError = new Error('ledger unavailable');
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger({
        registerDidFn: () => Promise.reject(ledgerError),
      });
      const svc = new IdentityService(fakePrisma as any, fakeLedger as any);

      // The error must surface — it must NOT be silently swallowed
      await expect(svc.register({ handle: 'alice', displayName: 'Alice' })).rejects.toThrow(
        'ledger unavailable',
      );
    });
  });
});
