/**
 * zk-proofs.service.spec.ts — ZKP-01, ZKP-02, ZKP-03, ZKP-05 mandatory test suite
 *
 * Covers:
 *   ZKP-01  prove() produces a real Groth16 proof groth16.verify accepts
 *   ZKP-02  publicSignals[2] equals the stored credential root; verify() valid:true;
 *           BOTH snark AND Ed25519 signature required (corrupt sig → valid:false)
 *   ZKP-03  non-member claim throws; tampered publicSignals → valid:false
 *   ZKP-05  static assertion: no sha256+stringify legacy pattern in service source
 *
 * Uses a mocked PrismaService (no live database required). The in-memory SBT is
 * built with real cryptographic operations (Poseidon Merkle + Ed25519) so the
 * Groth16 proof is bound to a genuinely-signed credential root.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import * as path from 'path';
import * as fs from 'fs';
import * as snarkjs from 'snarkjs';
import { bytesToHex } from '@noble/hashes/utils';

import { ZkProofsService } from './zk-proofs.service';
import { CryptoService } from '../../crypto/crypto.service';
import { IssuerKeyService } from '../../crypto/issuer-key.service';
import { PrismaService } from '../../prisma/prisma.service';
import {
  buildClaimSet,
  claimNameHash,
  claimValueHash,
  encodeClaimsToLeaves,
  rootMessageBytes,
} from '../../crypto/claim-encoding';
import { buildMerkleTree } from '../../crypto/merkle';

// ── Circuit artifact paths ────────────────────────────────────────────────────
// __dirname = packages/api/src/modules/zk-proofs
// ../../../circuits = packages/api/circuits

const CIRCUITS_DIR = path.resolve(__dirname, '../../../circuits');
const VKEY_PATH = path.join(CIRCUITS_DIR, 'verification_key.json');

// ── Test constants ────────────────────────────────────────────────────────────

// Public-signal indices — v2 contract (see circuit-artifacts.spec.ts)
const IDX_PREDICATE_RESULT = 0;
const IDX_CLAIM_NAME_HASH = 1;
const IDX_ROOT = 2;

const CREDENTIAL_ID = 'test-credential-id-zkp-001';
const RESEARCHER_ID = 'test-researcher-id-zkp-001';
const TREE_SIZE = 16;

// ── Shared state (populated in beforeAll) ────────────────────────────────────

let service: ZkProofsService;
let mockSbt: Record<string, unknown>;
let lastCreatedProof: Record<string, unknown> | null = null;
let proveResult: Record<string, unknown>;

// ── Mock PrismaService ────────────────────────────────────────────────────────

const mockPrisma = {
  soulboundToken: {
    findUnique: vi.fn(),
  },
  zkProof: {
    create: vi.fn(),
    findUnique: vi.fn(),
    findFirst: vi.fn(),
    update: vi.fn().mockResolvedValue({}),
  },
  researcher: {
    findUnique: vi
      .fn()
      .mockResolvedValue({ id: RESEARCHER_ID, did: 'did:test:researcher' }),
  },
  auditLog: {
    create: vi.fn().mockResolvedValue({}),
  },
};

// ─────────────────────────────────────────────────────────────────────────────
// Suite setup
// ─────────────────────────────────────────────────────────────────────────────

describe('ZkProofsService — real Groth16 ZKP suite', () => {
  beforeAll(
    async () => {
      // ── Step 1: Build a cryptographically-real in-memory SBT ──────────────
      // Use a standalone CryptoService instance for setup crypto operations.
      const cryptoSetup = new CryptoService();
      await cryptoSetup.onModuleInit();

      const claims = buildClaimSet({
        credentialType: 'AcademicDegree',
        fieldOfStudy: 'Computer Science',
        holderDid: 'did:test:holder-zkp',
        issuedAt: '2025-01-01T00:00:00.000Z',
        issuer: 'did:test:issuer-zkp',
        title: 'Bachelor of Science',
      });

      // Encode to BN254 field elements and pre-pad to 16 (circuit depth = 4)
      const leaves = await encodeClaimsToLeaves(claims);
      const paddedLeaves: bigint[] = [...leaves];
      while (paddedLeaves.length < TREE_SIZE) paddedLeaves.push(0n);

      // Build the depth-4 Poseidon Merkle tree
      const tree = await buildMerkleTree(paddedLeaves);

      // Generate a fresh Ed25519 keypair and sign the root
      const keypair = await cryptoSetup.generateKeypair();
      const sigBytes = await cryptoSetup.sign(rootMessageBytes(tree.root), keypair.privateKey);

      mockSbt = {
        id: CREDENTIAL_ID,
        researcherId: RESEARCHER_ID,
        claims: claims,
        merkleRoot: tree.root,
        issuerSignature: bytesToHex(sigBytes),
        issuerPublicKey: bytesToHex(keypair.publicKey),
      };

      // ── Step 2: Wire mock Prisma ──────────────────────────────────────────
      mockPrisma.soulboundToken.findUnique.mockResolvedValue(mockSbt);

      mockPrisma.zkProof.create.mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: 'zkproof-test-001', status: 'active', expiresAt: null, ...data };
        lastCreatedProof = row;
        return row;
      });

      mockPrisma.zkProof.findUnique.mockImplementation(async () => lastCreatedProof);
      mockPrisma.zkProof.findFirst.mockImplementation(async () => lastCreatedProof);

      // ── Step 3: Build NestJS test module ──────────────────────────────────
      const moduleRef = await Test.createTestingModule({
        providers: [
          ZkProofsService,
          CryptoService,
          IssuerKeyService,
          { provide: PrismaService, useValue: mockPrisma },
        ],
      }).compile();

      await moduleRef.init();
      service = moduleRef.get(ZkProofsService);

      // ── Step 4: Run prove() once for all subsequent test cases ────────────
      // This is the expensive Groth16 step (~1-5 s).
      proveResult = await service.prove({
        credentialId: CREDENTIAL_ID,
        disclosedClaimName: 'fieldOfStudy',
        appName: 'test-app-zkp',
        consentWindow: 'forever',
        predicateEnabled: false,
      }) as Record<string, unknown>;
    },
    60_000, // 60 s — Groth16 fullProve can take up to 5 s
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ZKP-01: prove() produces a real Groth16 proof
  // ─────────────────────────────────────────────────────────────────────────

  it('ZKP-01: prove() returns a stored row with proof.protocol === "groth16"', () => {
    expect(proveResult).toBeDefined();
    const proof = proveResult.proof as { protocol: string };
    expect(proof.protocol).toBe('groth16');
  });

  it('ZKP-01: prove() returns publicSignals with length === 5 (v2 adds claimNameHash)', () => {
    const publicSignals = proveResult.publicSignals as string[];
    expect(publicSignals).toHaveLength(5);
  });

  it(
    'ZKP-01: snarkjs.groth16.verify accepts the stored proof and publicSignals',
    async () => {
      const vkey = JSON.parse(fs.readFileSync(VKEY_PATH, 'utf8'));
      const valid = await snarkjs.groth16.verify(
        vkey,
        proveResult.publicSignals as string[],
        proveResult.proof as object,
      );
      expect(valid).toBe(true);
    },
    30_000,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ZKP-02: root binding + full verify() round-trip
  // ─────────────────────────────────────────────────────────────────────────

  it('ZKP-02: publicSignals[IDX_ROOT] (decimal root) converts to the stored credential merkleRoot', () => {
    const publicSignals = proveResult.publicSignals as string[];
    const rootFromSignal = BigInt(publicSignals[IDX_ROOT]).toString(16);
    expect(rootFromSignal).toBe(mockSbt.merkleRoot as string);
  });

  it(
    'ZKP-02: verify(proofHash) returns valid:true for a freshly-proven claim',
    async () => {
      const result = await service.verify(proveResult.proofHash as string);
      expect(result.valid).toBe(true);
    },
    30_000,
  );

  it(
    'ZKP-02: corrupted issuerPublicKey → verify() returns valid:false (both checks required)',
    async () => {
      // Swap in a wrong issuer public key — the SNARK still verifies (same proof)
      // but the Ed25519 check must fail.
      mockPrisma.soulboundToken.findUnique.mockResolvedValueOnce({
        ...mockSbt,
        issuerPublicKey: bytesToHex(new Uint8Array(32).fill(0xab)), // wrong key
      });
      const result = await service.verify(proveResult.proofHash as string);
      expect(result.valid).toBe(false);
      const reason = (result as { valid: boolean; reason?: string }).reason ?? '';
      expect(reason.toLowerCase()).toMatch(/signature/);
    },
    30_000,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // ZKP-03: non-member + tampered proof rejection
  // ─────────────────────────────────────────────────────────────────────────

  it('ZKP-03: prove() with a claimName not in the credential throws', async () => {
    await expect(
      service.prove({
        credentialId: CREDENTIAL_ID,
        disclosedClaimName: 'nonExistentClaimXYZ123',
        appName: 'test-app-zkp',
        consentWindow: 'forever',
      }),
    ).rejects.toThrow();
  });

  it(
    'ZKP-03: tampered publicSignals[IDX_ROOT] → groth16.verify fails → verify() returns valid:false',
    async () => {
      if (!lastCreatedProof) throw new Error('lastCreatedProof not populated');
      const tamperedSignals = [...(lastCreatedProof.publicSignals as string[])];
      tamperedSignals[IDX_ROOT] = '12345678'; // bogus root decimal
      mockPrisma.zkProof.findUnique.mockResolvedValueOnce({
        ...lastCreatedProof,
        publicSignals: tamperedSignals,
      });
      const result = await service.verify(proveResult.proofHash as string);
      expect(result.valid).toBe(false);
    },
    30_000,
  );

  // ─────────────────────────────────────────────────────────────────────────
  // Critical finding #3: the proof must attest WHICH claim it is about
  //
  // Before v2, leafValue was private and no public signal named the claim, so a
  // valid proof said only "some leaf is in this tree" — true for any holder, and
  // satisfiable with one of the padding zeros. disclosedClaims.claimName was an
  // unverified label. These tests pin the binding that replaced it.
  // ─────────────────────────────────────────────────────────────────────────

  it('finding #3: the proven claim name is recoverable from the public signals', () => {
    const publicSignals = proveResult.publicSignals as string[];
    expect(publicSignals[IDX_CLAIM_NAME_HASH]).toBe(
      claimNameHash('fieldOfStudy').toString(10),
    );
  });

  it('finding #3: the claim VALUE is not recoverable from the public signals', () => {
    // Selective disclosure: the name is public, the value is not. The value hash
    // must appear nowhere in the public output.
    const publicSignals = proveResult.publicSignals as string[];
    const valueHash = claimValueHash('Computer Science').toString(10);
    expect(publicSignals).not.toContain(valueHash);
  });

  it('finding #3: verify() rejects a proof relabelled as a different claim', async () => {
    // The attack the binding closes: take a genuine proof and change the claim
    // name recorded next to it, so a relying party is told the proof attests
    // something it does not.
    mockPrisma.zkProof.findUnique.mockResolvedValueOnce({
      ...(lastCreatedProof as Record<string, unknown>),
      disclosedClaims: {
        ...((lastCreatedProof as Record<string, unknown>)
          .disclosedClaims as Record<string, unknown>),
        claimName: 'title', // genuine proof, dishonest label
      },
    });

    const result = await service.verify(proveResult.proofHash as string);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/disclosed claim name/i);
  }, 30_000);

  it('finding #3: verify() rejects a proof with no disclosed claim name at all', async () => {
    mockPrisma.zkProof.findUnique.mockResolvedValueOnce({
      ...(lastCreatedProof as Record<string, unknown>),
      disclosedClaims: { credentialId: CREDENTIAL_ID },
    });

    const result = await service.verify(proveResult.proofHash as string);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/claim name/i);
  }, 30_000);

  it('finding #3: a proof for a different claim carries a different name hash', async () => {
    const other = (await service.prove({
      credentialId: CREDENTIAL_ID,
      disclosedClaimName: 'title',
      appName: 'test-app-zkp',
      consentWindow: 'forever',
      predicateEnabled: false,
    })) as Record<string, unknown>;

    const otherSignals = other.publicSignals as string[];
    const originalSignals = proveResult.publicSignals as string[];

    expect(otherSignals[IDX_CLAIM_NAME_HASH]).toBe(
      claimNameHash('title').toString(10),
    );
    expect(otherSignals[IDX_CLAIM_NAME_HASH]).not.toBe(
      originalSignals[IDX_CLAIM_NAME_HASH],
    );
    // Same credential, so the root is shared — only the claim identity differs.
    expect(otherSignals[IDX_ROOT]).toBe(originalSignals[IDX_ROOT]);

    // Restore the shared fixture for the tests that follow.
    lastCreatedProof = proveResult as Record<string, unknown>;
  }, 60_000);

  // ─────────────────────────────────────────────────────────────────────────
  // Critical finding #2: proofHash must identify exactly one proof
  //
  // The old derivation hashed publicSignals alone. Every public signal is
  // identical across repeated proofs of one credential, so two proofs collided on
  // a single handle — and because verify() resolved that handle with findFirst,
  // revoking one row left its twin answering in its place.
  // ─────────────────────────────────────────────────────────────────────────

  it('finding #2: two proofs over the same credential and claim get different handles', async () => {
    const first = proveResult.proofHash as string;

    const second = (await service.prove({
      credentialId: CREDENTIAL_ID,
      disclosedClaimName: 'fieldOfStudy',
      appName: 'test-app-zkp',
      consentWindow: 'forever',
      predicateEnabled: false,
    })) as Record<string, unknown>;

    // Same credential, same claim, same options — identical public signals...
    expect((second.publicSignals as string[]).join('|')).toBe(
      (proveResult.publicSignals as string[]).join('|'),
    );
    // ...but distinct handles, because the randomised Groth16 proof is hashed too.
    expect(second.proofHash).not.toBe(first);

    // Restore the shared fixture for the tests that follow.
    lastCreatedProof = proveResult as Record<string, unknown>;
  }, 60_000);

  it('finding #2: a revoked proof reports its status instead of verifying', async () => {
    mockPrisma.zkProof.findUnique.mockResolvedValueOnce({
      ...(lastCreatedProof as Record<string, unknown>),
      status: 'revoked',
    });

    const result = await service.verify(proveResult.proofHash as string);

    expect(result.valid).toBe(false);
    expect(result.reason).toMatch(/revoked/i);
  }, 30_000);

  it('finding #2: verify() resolves the handle with findUnique, not findFirst', async () => {
    // findFirst({ proofHash, status: 'active' }) is what allowed a revoked row to
    // be skipped in favour of an active twin. Pin the query shape so the bypass
    // cannot reappear.
    const servicePath = path.resolve(__dirname, './zk-proofs.service.ts');
    const source = fs.readFileSync(servicePath, 'utf8');
    expect(source).not.toMatch(/zkProof\.findFirst/);
    expect(source).toMatch(/zkProof\.findUnique/);
  });

  // ─────────────────────────────────────────────────────────────────────────
  // Critical finding #4: revocation must be honoured by the proof path
  //
  // A Groth16 proof and an Ed25519 signature are both permanently valid once
  // generated — neither encodes whether the credential is still in good standing.
  // These tests pin the explicit revocation check that makes revocation
  // enforceable through proofs.
  // ─────────────────────────────────────────────────────────────────────────

  it('finding #4: verify() returns valid:false once the credential is revoked', async () => {
    const wasRevoked = mockSbt.revoked;
    try {
      mockSbt.revoked = true;
      const result = await service.verify(proveResult.proofHash as string);
      expect(result.valid).toBe(false);
      expect(result.reason).toMatch(/revoked/i);
    } finally {
      mockSbt.revoked = wasRevoked;
    }
  }, 30_000);

  it('finding #4: the same proof verifies again once the credential is un-revoked', async () => {
    // Guards against the revocation check being conflated with an unrelated
    // failure — the proof itself is still cryptographically sound.
    const result = await service.verify(proveResult.proofHash as string);
    expect(result.valid).toBe(true);
  }, 30_000);

  it('finding #4: prove() refuses to mint a new proof over a revoked credential', async () => {
    const wasRevoked = mockSbt.revoked;
    try {
      mockSbt.revoked = true;
      await expect(
        service.prove({
          credentialId: CREDENTIAL_ID,
          disclosedClaimName: 'fieldOfStudy',
          appName: 'test-app-zkp',
          consentWindow: 'forever',
          predicateEnabled: false,
        }),
      ).rejects.toThrow(/revoked/i);
    } finally {
      mockSbt.revoked = wasRevoked;
    }
  }, 30_000);

  // ─────────────────────────────────────────────────────────────────────────
  // ZKP-05: static — no legacy sha256+stringify pattern
  // ─────────────────────────────────────────────────────────────────────────

  it('ZKP-05: zk-proofs.service.ts does NOT contain the legacy sha256+stringify proof pattern', () => {
    const servicePath = path.resolve(__dirname, './zk-proofs.service.ts');
    const source = fs.readFileSync(servicePath, 'utf8');
    // The legacy proof derived proofHash from sha256(JSON.stringify(data)) —
    // assert that pattern no longer exists.
    expect(source).not.toMatch(/sha256[\s\S]{0,80}stringify/);
  });
});
