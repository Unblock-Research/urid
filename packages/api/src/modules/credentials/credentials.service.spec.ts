import { describe, it, expect, vi } from 'vitest';
import { CredentialsService } from './credentials.service';
import { LedgerRecord } from '../../ledger/ledger.service';

// ---------------------------------------------------------------------------
// Minimal fakes
// ---------------------------------------------------------------------------

function fakeLedgerRecord(txHash = 'real-tx-hash-0xdeadbeef'): LedgerRecord {
  return {
    index: 1,
    type: 'mint_sbt',
    payload: {},
    txHash,
    prevHash: '0'.repeat(64),
    createdAt: new Date(),
  };
}

const RESEARCHER = {
  id: 'researcher-uuid-001',
  handle: 'alice',
  did: 'did:ub:0x00000061',
  displayName: 'Alice',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const SBT = {
  id: 'sbt-uuid-001',
  researcherId: RESEARCHER.id,
  credentialType: 'peer_review',
  title: 'Peer Review Award',
  issuer: 'URID Foundation',
  tone: 'default',
  revoked: false,
  issuedAt: new Date(),
};

function makeFakePrisma(options: { researcherFound?: boolean } = {}) {
  return {
    researcher: {
      findUnique: vi.fn().mockResolvedValue(
        options.researcherFound !== false ? RESEARCHER : null,
      ),
    },
    soulboundToken: {
      create: vi.fn().mockResolvedValue(SBT),
      update: vi.fn().mockResolvedValue({ ...SBT, onChainTxHash: 'real-tx-hash-0xdeadbeef' }),
    },
  };
}

function makeFakeLedger(options: {
  mintSbtFn?: () => Promise<LedgerRecord>;
} = {}) {
  return {
    registerDid: vi.fn(),
    mintSbt: vi.fn().mockImplementation(
      options.mintSbtFn ?? (() => Promise.resolve(fakeLedgerRecord())),
    ),
    revokeSbt: vi.fn(),
    getTransaction: vi.fn(),
  };
}

const MINT_DATA = {
  researcherDid: RESEARCHER.did,
  credentialType: 'peer_review',
  title: 'Peer Review Award',
  issuer: 'URID Foundation',
};

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialsService', () => {
  describe('mint()', () => {
    it('creates an SBT and anchors via ledger.mintSbt', async () => {
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger();
      const svc = new CredentialsService(fakePrisma as any, fakeLedger as any);

      await svc.mint(MINT_DATA);

      expect(fakePrisma.soulboundToken.create).toHaveBeenCalledOnce();
      expect(fakeLedger.mintSbt).toHaveBeenCalledOnce();
      expect(fakeLedger.mintSbt).toHaveBeenCalledWith(
        expect.objectContaining({
          holder: RESEARCHER.did,
          credential: 'peer_review',
          title: 'Peer Review Award',
        }),
      );
    });

    it('stores the ledger-returned txHash into onChainTxHash (T-02-06 — real provenance)', async () => {
      const realTxHash = 'real-tx-hash-0xdeadbeef';
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger({
        mintSbtFn: () => Promise.resolve(fakeLedgerRecord(realTxHash)),
      });
      const svc = new CredentialsService(fakePrisma as any, fakeLedger as any);

      await svc.mint(MINT_DATA);

      // The update must carry the ledger's real txHash — not a mock/fake digest
      expect(fakePrisma.soulboundToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: SBT.id },
          data: expect.objectContaining({ onChainTxHash: realTxHash }),
        }),
      );
    });

    it('throws "Researcher not found" without calling the ledger when DID is unknown', async () => {
      const fakePrisma = makeFakePrisma({ researcherFound: false });
      const fakeLedger = makeFakeLedger();
      const svc = new CredentialsService(fakePrisma as any, fakeLedger as any);

      await expect(svc.mint(MINT_DATA)).rejects.toThrow('Researcher not found');
      expect(fakeLedger.mintSbt).not.toHaveBeenCalled();
    });

    it('propagates ledger failure — mint() rejects when ledger.mintSbt rejects (T-02-05)', async () => {
      const ledgerError = new Error('ledger write failed');
      const fakePrisma = makeFakePrisma();
      const fakeLedger = makeFakeLedger({
        mintSbtFn: () => Promise.reject(ledgerError),
      });
      const svc = new CredentialsService(fakePrisma as any, fakeLedger as any);

      // The error must surface — NOT be silently swallowed
      await expect(svc.mint(MINT_DATA)).rejects.toThrow('ledger write failed');
    });
  });
});
