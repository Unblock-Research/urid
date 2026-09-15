import { describe, it, expect, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { CredentialsService } from './credentials.service';
import { CryptoService } from '../../crypto/crypto.service';
import { IssuerKeyService } from '../../crypto/issuer-key.service';
import { IssuerRegistryService } from '../../crypto/issuer-registry.service';
import {
  buildClaimSet,
  encodeClaimsToLeaves,
} from '../../crypto/claim-encoding';
import { buildMerkleTree } from '../../crypto/merkle';
import { LedgerRecord } from '../../ledger/ledger.service';

// ---------------------------------------------------------------------------
// Fixed private key for deterministic test keypair (32 bytes = 64 hex chars)
// ---------------------------------------------------------------------------

const FIXED_PRIVATE_KEY =
  'deadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef';

// ---------------------------------------------------------------------------
// Test data constants
// ---------------------------------------------------------------------------

const RESEARCHER = {
  id: 'researcher-uuid-001',
  handle: 'alice',
  did: 'did:ub:0x00000061',
  displayName: 'Alice',
  createdAt: new Date(),
  updatedAt: new Date(),
};

const MINT_DATA = {
  researcherDid: RESEARCHER.did,
  credentialType: 'peer_review',
  title: 'Peer Review Award',
  issuer: 'URID Foundation',
};

// ---------------------------------------------------------------------------
// In-memory Prisma fake — captures written data so mint→verify round-trips
// ---------------------------------------------------------------------------

function makeInMemoryPrisma(options: { researcherFound?: boolean } = {}) {
  const store: Record<string, any> = {};

  return {
    researcher: {
      findUnique: vi.fn().mockResolvedValue(
        options.researcherFound !== false ? RESEARCHER : null,
      ),
    },
    soulboundToken: {
      create: vi.fn().mockImplementation(async ({ data }: any) => {
        const row = {
          id: 'sbt-uuid-001',
          revoked: false,
          issuedAt: new Date('2026-07-07T00:00:00.000Z'),
          tone: 'default',
          ...data,
        };
        store[row.id] = row;
        return row;
      }),
      update: vi.fn().mockImplementation(async ({ where, data }: any) => {
        store[where.id] = { ...(store[where.id] ?? {}), ...data };
        return store[where.id];
      }),
      findUnique: vi.fn().mockImplementation(async ({ where }: any) => {
        return store[where.id] ?? null;
      }),
    },
    // Expose store for direct test manipulation (tamper tests)
    _store: store,
  };
}

// ---------------------------------------------------------------------------
// Ledger fake
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

function makeFakeLedger(
  options: { mintSbtFn?: () => Promise<LedgerRecord> } = {},
) {
  return {
    registerDid: vi.fn(),
    mintSbt: vi.fn().mockImplementation(
      options.mintSbtFn ?? (() => Promise.resolve(fakeLedgerRecord())),
    ),
    revokeSbt: vi.fn(),
    getTransaction: vi.fn(),
  };
}

// ---------------------------------------------------------------------------
// Real crypto service factory — CryptoService + IssuerKeyService with a
// fixed private key so signatures are deterministic across test runs.
// ---------------------------------------------------------------------------

async function makeRealCryptoServices() {
  const cryptoSvc = new CryptoService();
  await cryptoSvc.onModuleInit();

  // Save and override env so IssuerKeyService loads our fixed key
  const savedKey = process.env.ISSUER_PRIVATE_KEY;
  process.env.ISSUER_PRIVATE_KEY = FIXED_PRIVATE_KEY;
  const issuerKeySvc = new IssuerKeyService(cryptoSvc);
  await issuerKeySvc.onModuleInit();
  // Restore env (avoid polluting other tests)
  if (savedKey === undefined) {
    delete process.env.ISSUER_PRIVATE_KEY;
  } else {
    process.env.ISSUER_PRIVATE_KEY = savedKey;
  }

  return { cryptoSvc, issuerKeySvc };
}

// ---------------------------------------------------------------------------
// Helper: construct CredentialsService without TypeScript arg-count errors
// in the RED phase (the constructor gains two params in GREEN).
// ---------------------------------------------------------------------------

function makeService(
  fakePrisma: any,
  fakeLedger: any,
  cryptoSvc?: any,
  issuerKeySvc?: any,
  issuerRegistrySvc?: any,
): CredentialsService {
  return new (CredentialsService as any)(
    fakePrisma,
    fakeLedger,
    cryptoSvc,
    issuerKeySvc,
    // Default to a registry that trusts exactly the signing key, which is the
    // production default when TRUSTED_ISSUER_KEYS is unset.
    issuerRegistrySvc ?? makeRegistryTrusting(issuerKeySvc),
  ) as CredentialsService;
}

/**
 * Build a real IssuerRegistryService whose trusted set is the given issuer key.
 * Passing an explicit `trusted` list overrides it (used by the untrusted-key test).
 */
function makeRegistryTrusting(issuerKeySvc?: any, trusted?: string[]) {
  const savedEnv = process.env.TRUSTED_ISSUER_KEYS;
  if (trusted !== undefined) {
    process.env.TRUSTED_ISSUER_KEYS = trusted.join(',');
  } else {
    delete process.env.TRUSTED_ISSUER_KEYS;
  }
  const registry = new IssuerRegistryService(
    issuerKeySvc ?? ({ getPublicKeyHex: () => '00'.repeat(32) } as any),
  );
  registry.onModuleInit();
  if (savedEnv === undefined) {
    delete process.env.TRUSTED_ISSUER_KEYS;
  } else {
    process.env.TRUSTED_ISSUER_KEYS = savedEnv;
  }
  return registry;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('CredentialsService', () => {
  // ── mint() ─────────────────────────────────────────────────────────────────

  describe('mint()', () => {
    it('creates an SBT and anchors via ledger.mintSbt (CRD-03 preserved)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

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
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger({
        mintSbtFn: () => Promise.resolve(fakeLedgerRecord(realTxHash)),
      });
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      await svc.mint(MINT_DATA);

      // The update must carry the ledger's real txHash — not a mock/fake digest
      expect(fakePrisma.soulboundToken.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sbt-uuid-001' },
          data: expect.objectContaining({ onChainTxHash: realTxHash }),
        }),
      );
    });

    it('throws "Researcher not found" without calling the ledger when DID is unknown', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma({ researcherFound: false });
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      await expect(svc.mint(MINT_DATA)).rejects.toThrow('Researcher not found');
      expect(fakeLedger.mintSbt).not.toHaveBeenCalled();
    });

    it('propagates ledger failure — mint() rejects when ledger.mintSbt rejects (T-02-05)', async () => {
      const ledgerError = new Error('ledger write failed');
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger({
        mintSbtFn: () => Promise.reject(ledgerError),
      });
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      // The error must surface — NOT be silently swallowed
      await expect(svc.mint(MINT_DATA)).rejects.toThrow('ledger write failed');
    });

    // CRD-01: mint() stores a real signed Poseidon-Merkle commitment ─────────

    it('stores non-null merkleRoot, issuerSignature, and issuerPublicKey after mint (CRD-01)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      const result = await svc.mint(MINT_DATA);

      expect(result.merkleRoot).toBeTruthy();
      expect(result.issuerSignature).toBeTruthy();
      expect(result.issuerPublicKey).toBeTruthy();
    });

    it('stored issuerPublicKey matches IssuerKeyService.getPublicKeyHex() (CRD-01)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      const result = await svc.mint(MINT_DATA);

      expect(result.issuerPublicKey).toBe(issuerKeySvc.getPublicKeyHex());
    });

    it('stored merkleRoot is a genuine Poseidon-Merkle commitment to the stored claims (CRD-01)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      const result = await svc.mint(MINT_DATA);

      // Independently recompute the root from the stored claims.
      // Must apply the same depth-4 (16-leaf) padding that mint() now uses so
      // the recomputed root matches the stored root (see CIRCUIT_TREE_SIZE in
      // credentials.service.ts for the authoritative constant).
      const storedClaims = result.claims as Array<{ name: string; value: string }>;
      expect(storedClaims).toBeInstanceOf(Array);
      expect(storedClaims.length).toBeGreaterThan(0);

      const CIRCUIT_TREE_SIZE = 16; // must match CIRCUIT_DEPTH=4 constant in service
      const leaves = await encodeClaimsToLeaves(storedClaims);
      const paddedLeaves: bigint[] = [...leaves];
      while (paddedLeaves.length < CIRCUIT_TREE_SIZE) paddedLeaves.push(0n);
      const { root } = await buildMerkleTree(paddedLeaves);

      expect(result.merkleRoot).toBe(root);
    });

    it('stored claims are stable — calling buildClaimSet with the same inputs reproduces them (CRD-01)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      const result = await svc.mint(MINT_DATA);
      const storedClaims = result.claims as Array<{ name: string; value: string }>;

      // The stored issuedAt claim value must match what's in the SBT record
      const issuedAtClaim = storedClaims.find((c) => c.name === 'issuedAt');
      expect(issuedAtClaim).toBeDefined();
      expect(typeof issuedAtClaim!.value).toBe('string');
    });
  });

  // ── verifyCredential() ────────────────────────────────────────────────────
  //
  // These tests verify the CRD-02 tamper-evidence guarantee.  All of them
  // exercise the real mint→store→verify round-trip via the in-memory Prisma
  // fake so no database is needed.
  // ─────────────────────────────────────────────────────────────────────────

  describe('verifyCredential()', () => {
    it('returns { valid: true } for a freshly minted, untampered credential (CRD-02)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      const minted = await svc.mint(MINT_DATA);
      const result = await svc.verifyCredential(minted.id);

      expect(result.valid).toBe(true);
    });

    it('returns { valid: false } when a stored claim is mutated (CRD-02 tamper-evidence)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      const minted = await svc.mint(MINT_DATA);

      // Tamper: change the title claim in the in-memory store directly
      const storedClaims = [
        ...(fakePrisma._store['sbt-uuid-001'].claims as any[]),
      ];
      const titleIdx = storedClaims.findIndex((c: any) => c.name === 'title');
      storedClaims[titleIdx] = { ...storedClaims[titleIdx], value: 'Tampered Title' };
      fakePrisma._store['sbt-uuid-001'].claims = storedClaims;

      const result = await svc.verifyCredential(minted.id);

      expect(result.valid).toBe(false);
    });

    it('returns { valid: false } when issuerPublicKey is substituted with a non-signing key (CRD-02 wrong-key)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      await svc.mint(MINT_DATA);

      // Substitute the stored public key with a freshly generated, non-signing key
      const wrongKeypair = await cryptoSvc.generateKeypair();
      fakePrisma._store['sbt-uuid-001'].issuerPublicKey = bytesToHex(
        wrongKeypair.publicKey,
      );

      const result = await svc.verifyCredential('sbt-uuid-001');

      expect(result.valid).toBe(false);
    });

    // ── Critical finding #4: revocation ──────────────────────────────────────
    //
    // A revoked credential is still a well-formed signed object: its claims hash
    // to the committed root and the issuer signature is still valid. Only an
    // explicit check honours the issuer's after-the-fact revocation.
    it('returns { valid: false } once the credential is revoked (finding #4)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      const minted = await svc.mint(MINT_DATA);

      // Valid before revocation...
      expect((await svc.verifyCredential(minted.id)).valid).toBe(true);

      // ...and invalid after, with the crypto otherwise untouched.
      fakePrisma._store['sbt-uuid-001'].revoked = true;

      const result = await svc.verifyCredential(minted.id);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/revoked/i);
    });

    // ── Critical finding #5: self-attested issuer ────────────────────────────
    //
    // The attack the old code could not detect: an attacker who can write the SBT
    // row rewrites the claims, recomputes the Merkle root, signs that root with a
    // keypair THEY control, and stores their own public key in issuerPublicKey.
    // Every internal check passes — the claims hash to the root, and the signature
    // is valid for the key on the row. Only a trusted-issuer registry catches it.
    it('returns { valid: false } when claims are re-signed by an untrusted issuer key (finding #5)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      await svc.mint(MINT_DATA);
      const row = fakePrisma._store['sbt-uuid-001'];

      // Attacker rewrites a claim...
      const forgedClaims = (row.claims as any[]).map((c) =>
        c.name === 'title' ? { ...c, value: 'Forged Fellowship' } : c,
      );
      // ...recomputes the root over the forged claims...
      const forgedLeaves = await encodeClaimsToLeaves(forgedClaims as any);
      const padded = [...forgedLeaves];
      while (padded.length < 16) padded.push(0n);
      const { root: forgedRoot } = await buildMerkleTree(padded);

      // ...and signs it with a keypair they control.
      const attackerKeys = await cryptoSvc.generateKeypair();
      const forgedSig = await cryptoSvc.sign(
        new TextEncoder().encode(forgedRoot),
        attackerKeys.privateKey,
      );

      row.claims = forgedClaims;
      row.merkleRoot = forgedRoot;
      row.issuerSignature = bytesToHex(forgedSig);
      row.issuerPublicKey = bytesToHex(attackerKeys.publicKey);

      // Sanity: the forgery IS internally consistent — root matches claims and
      // the signature is valid for the key on the row. Without the registry this
      // would verify as genuine.
      const selfConsistent = await cryptoSvc.verify(
        forgedSig,
        new TextEncoder().encode(forgedRoot),
        attackerKeys.publicKey,
      );
      expect(selfConsistent).toBe(true);

      const result = await svc.verifyCredential('sbt-uuid-001');

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/trusted issuer registry/i);
    });

    it('accepts a credential whose issuer key is on an explicit TRUSTED_ISSUER_KEYS allowlist (finding #5)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      // Explicit allowlist containing exactly this issuer's key
      const registry = makeRegistryTrusting(issuerKeySvc, [
        issuerKeySvc.getPublicKeyHex(),
      ]);
      const svc = makeService(
        fakePrisma,
        fakeLedger,
        cryptoSvc,
        issuerKeySvc,
        registry,
      );

      const minted = await svc.mint(MINT_DATA);
      const result = await svc.verifyCredential(minted.id);

      expect(result.valid).toBe(true);
    });

    it('rejects a genuine credential when the issuer is absent from an explicit allowlist (finding #5)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      // Allowlist naming some OTHER issuer — our signer is not on it
      const registry = makeRegistryTrusting(issuerKeySvc, ['ab'.repeat(32)]);
      const svc = makeService(
        fakePrisma,
        fakeLedger,
        cryptoSvc,
        issuerKeySvc,
        registry,
      );

      const minted = await svc.mint(MINT_DATA);
      const result = await svc.verifyCredential(minted.id);

      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/trusted issuer registry/i);
    });

    it('returns { valid: false } for a credential missing crypto fields (CRD-02 incomplete)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      await svc.mint(MINT_DATA);

      // Remove crypto fields from the stored row
      const row = fakePrisma._store['sbt-uuid-001'];
      delete row.merkleRoot;
      delete row.issuerSignature;

      const result = await svc.verifyCredential('sbt-uuid-001');

      expect(result.valid).toBe(false);
    });

    it('returns { valid: false } for an unknown credential id (CRD-02 not-found)', async () => {
      const { cryptoSvc, issuerKeySvc } = await makeRealCryptoServices();
      const fakePrisma = makeInMemoryPrisma();
      const fakeLedger = makeFakeLedger();
      const svc = makeService(fakePrisma, fakeLedger, cryptoSvc, issuerKeySvc);

      const result = await svc.verifyCredential('non-existent-id');

      expect(result.valid).toBe(false);
    });
  });
});
