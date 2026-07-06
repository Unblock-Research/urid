/**
 * full-flow.integration.spec.ts — HRD-03 End-to-End Real-Crypto Integration Test
 *
 * Drives the complete URID onboarding flow against real services and the test
 * PostgreSQL database (DATABASE_URL from packages/api/.env):
 *
 *   register (real Ed25519 DID)
 *     → mint (real Poseidon-Merkle root + Ed25519 issuer signature)
 *     → verifyCredential (recomputes root from stored claims)
 *     → prove (real Groth16 via committed circuit artifacts)
 *     → verify (Groth16 + Ed25519 both pass)
 *     → tampered proof fails verification
 *
 * ISOLATION STRATEGY: Cleanup-after-run.
 *   All rows are tagged with a namespaced handle prefix
 *   (itest-<timestamp>-<rand>) and deleted in afterAll inside a try/finally
 *   in FK order: zkProof → auditLog → soulboundToken → researcher.
 *   Ledger transactions for the test run are also cleaned up via the tracked
 *   txHash on the minted SBT's onChainTxHash field.
 *   prisma.$disconnect() is always called in finally.
 *
 * SECURITY NOTE: The returned privateKey is NEVER logged or stored in any
 * assertion — only its existence (truthy) is verified. The issuer keypair
 * generated at module init is ephemeral and never logged by this test.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import type { TestingModule } from '@nestjs/testing';
import { Test } from '@nestjs/testing';

import { PrismaService } from '../prisma/prisma.service';
import { CryptoService } from '../crypto/crypto.service';
import { IssuerKeyService } from '../crypto/issuer-key.service';
import { LedgerService } from '../ledger/ledger.service';
import { LocalLedgerService } from '../ledger/local-ledger.service';
import { IdentityService } from '../modules/identity/identity.service';
import { CredentialsService } from '../modules/credentials/credentials.service';
import { ZkProofsService } from '../modules/zk-proofs/zk-proofs.service';

// ── Test identifiers ──────────────────────────────────────────────────────────

const timestamp = Date.now();
const rand = Math.random().toString(36).slice(2, 8);
const TEST_HANDLE = `itest-${timestamp}-${rand}`;
const TEST_DISPLAY_NAME = 'Integration Test Researcher';

// ── Shared state (populated across sequential test steps) ─────────────────────

let moduleRef: TestingModule;
let prisma: PrismaService;
let identityService: IdentityService;
let credentialsService: CredentialsService;
let zkProofsService: ZkProofsService;

// Captured from each step for downstream assertions
let researcherDid = '';
let sbtId = '';
let zkProofId = '';
let mintedOnChainTxHash: string | null = null;

// ── Module setup + teardown ───────────────────────────────────────────────────

beforeAll(
  async () => {
    // Build a flat test module with all real providers.
    // No module class imports — providers are registered directly so the DI
    // graph is fully visible and there are no circular-module surprises.
    moduleRef = await Test.createTestingModule({
      providers: [
        PrismaService,
        CryptoService,
        IssuerKeyService,
        // Bind the abstract LedgerService token to the real hash-chain implementation
        { provide: LedgerService, useClass: LocalLedgerService },
        IdentityService,
        CredentialsService,
        ZkProofsService,
      ],
    }).compile();

    // Run onModuleInit() on all providers:
    //   - PrismaService.$connect() establishes the real DB connection
    //   - CryptoService pre-warms Poseidon and base58btc (~50-100 ms each)
    //   - IssuerKeyService loads/generates the issuer keypair
    // This ensures mint (signing the root) and verify (Ed25519 root check)
    // use exactly the same keypair instance.
    await moduleRef.init();

    prisma = moduleRef.get(PrismaService);
    identityService = moduleRef.get(IdentityService);
    credentialsService = moduleRef.get(CredentialsService);
    zkProofsService = moduleRef.get(ZkProofsService);
  },
  30_000,
);

afterAll(
  async () => {
    // Delete in FK order so no foreign-key constraint errors occur.
    // Wrapped in try/finally to guarantee $disconnect() even if cleanup fails.
    try {
      if (researcherDid) {
        const researcher = await prisma.researcher.findUnique({
          where: { did: researcherDid },
        });

        if (researcher) {
          await prisma.zkProof.deleteMany({ where: { researcherId: researcher.id } });
          await prisma.auditLog.deleteMany({ where: { researcherId: researcher.id } });
          await prisma.soulboundToken.deleteMany({ where: { researcherId: researcher.id } });
          await prisma.researcher.delete({ where: { id: researcher.id } });
        }
      }

      // Clean up the ledger transactions anchored during this test run.
      // The SBT's onChainTxHash is the mint ledger entry; we can also try to
      // locate the register_did entry by payload lookup.
      if (mintedOnChainTxHash) {
        await prisma.ledgerTransaction
          .deleteMany({ where: { txHash: mintedOnChainTxHash } })
          .catch(() => {
            /* best-effort: ledger entries are append-only; skip if not found */
          });
      }
    } finally {
      await prisma.$disconnect();
    }
  },
  30_000,
);

// ── HRD-03: The full real-crypto flow ─────────────────────────────────────────

describe('HRD-03: Full real-crypto onboarding flow', () => {
  // ─── Step 1: Register ───────────────────────────────────────────────────────
  //
  // Calls the REAL IdentityService.register(): generates an Ed25519 keypair,
  // derives a did:ub DID, persists the researcher, and anchors on the ledger.

  it('Step 1: register() returns a real did:ub DID and a non-null privateKey', async () => {
    const result = await identityService.register({
      handle: TEST_HANDLE,
      displayName: TEST_DISPLAY_NAME,
    });

    // Capture DID for downstream steps (must persist before assertions)
    researcherDid = result.did;

    // DID shape: did:ub:z6Mk… (base58btc multibase + Ed25519 multicodec prefix)
    expect(result.did).toMatch(/^did:ub:z6Mk/);
    // Private key returned exactly once; we only assert existence (NEVER log)
    expect(result.privateKey).toBeTruthy();
    expect(result.researcher).toBeDefined();
  });

  // ─── Step 2: Mint ───────────────────────────────────────────────────────────
  //
  // Calls the REAL CredentialsService.mint(): builds the canonical claim set,
  // computes a Poseidon-Merkle root (depth-4 / 16-leaf, matching the circuit),
  // signs the root with the Ed25519 issuer key, and anchors on the ledger.

  it('Step 2: mint() returns a non-null merkleRoot, issuerSignature, and issuerPublicKey', async () => {
    expect(researcherDid).toBeTruthy();

    const sbt = await credentialsService.mint({
      researcherDid,
      credentialType: 'AcademicDegree',
      title: 'Bachelor of Science in Computer Science',
      issuer: 'URID Test University',
      fieldOfStudy: 'Computer Science',
    });

    // Capture for downstream steps
    sbtId = sbt.id;
    mintedOnChainTxHash = sbt.onChainTxHash ?? null;

    expect(sbt.merkleRoot).toBeTruthy();
    expect(sbt.issuerSignature).toBeTruthy();
    expect(sbt.issuerPublicKey).toBeTruthy();
    expect(sbt.onChainTxHash).toBeTruthy(); // anchored on ledger
  });

  // ─── Step 3: verifyCredential ───────────────────────────────────────────────
  //
  // Independently recomputes the Merkle root from stored claims (same padding
  // as mint) and Ed25519-verifies the issuer signature.

  it('Step 3: verifyCredential() returns valid:true for the freshly minted credential', async () => {
    expect(sbtId).toBeTruthy();

    const result = await credentialsService.verifyCredential(sbtId);

    expect(result.valid).toBe(true);
  });

  // ─── Step 4: Prove ─────────────────────────────────────────────────────────
  //
  // Calls the REAL ZkProofsService.prove(): rebuilds the depth-4 padded tree,
  // generates a Groth16 inclusion proof via snarkjs.groth16.fullProve with the
  // committed .wasm + .zkey artifacts, and self-verifies before persisting.
  //
  // This step is expected to fail if mint() built the root at a different depth
  // than prove() — the Merkle root mismatch error would surface here.

  it(
    'Step 4: prove() produces a real Groth16 proof (protocol === "groth16") and returns a proofHash',
    async () => {
      expect(sbtId).toBeTruthy();

      const proof = await zkProofsService.prove({
        credentialId: sbtId,
        disclosedClaimName: 'fieldOfStudy',
        appName: 'integration-test-app',
        consentWindow: 'forever',
        predicateEnabled: false,
      });

      // Capture ZkProof row ID for step 5 verify
      zkProofId = proof.id;

      expect((proof.proof as { protocol: string }).protocol).toBe('groth16');
      expect(proof.proofHash).toBeTruthy();
    },
    60_000, // Groth16 fullProve typically takes 1–5 s; allow up to 60 s
  );

  // ─── Step 5: Verify ────────────────────────────────────────────────────────
  //
  // Calls the REAL ZkProofsService.verify(): BOTH conditions must hold
  // (ZKP-02, T-06-07, T-06-12):
  //   1. snarkjs.groth16.verify(vKey, publicSignals, proof) === true
  //   2. Ed25519.verify(issuerSignature, rootMessageBytes(root), issuerPublicKey) === true

  it(
    'Step 5: verify(proofHash) returns valid:true — Groth16 AND Ed25519 both pass',
    async () => {
      expect(zkProofId).toBeTruthy();

      const proofRow = await prisma.zkProof.findUnique({ where: { id: zkProofId } });
      expect(proofRow).not.toBeNull();

      const result = await zkProofsService.verify(proofRow!.proofHash);

      expect(result.valid).toBe(true);
    },
    30_000,
  );

  // ─── Step 6: Tampered proof fails (T-08-07) ────────────────────────────────
  //
  // Inserts a new ZkProof row that copies the real proof but replaces
  // publicSignals[1] (the root) with a bogus decimal value.  verify() must
  // detect the Groth16 inconsistency and return valid:false.
  //
  // This asserts the end-to-end tamper-rejection property (T-08-07).

  it(
    'Step 6: a tampered Groth16 publicSignals root causes verify() to return valid:false (T-08-07)',
    async () => {
      expect(zkProofId).toBeTruthy();

      const realProofRow = await prisma.zkProof.findUnique({ where: { id: zkProofId } });
      expect(realProofRow).not.toBeNull();

      const originalSignals = realProofRow!.publicSignals as string[];

      // Replace publicSignals[1] (root) with a bogus decimal — the real proof
      // cannot satisfy these signals, so snarkjs.groth16.verify will fail.
      const tamperedSignals = [...originalSignals];
      tamperedSignals[1] = '12345678';

      // Use a clearly-namespaced proofHash so cleanup can target it precisely
      const tamperedProofHash = `itest-tampered-${rand}`;

      // Persist the tampered row (it is only used for this one verify() call)
      await prisma.zkProof.create({
        data: {
          researcherId: realProofRow!.researcherId,
          appName: 'integration-test-tamper-app',
          claims: realProofRow!.claims as object,
          consentWindow: 'forever',
          proofHash: tamperedProofHash,
          proof: realProofRow!.proof as object,
          publicSignals: tamperedSignals as unknown as object,
          circuitId: 'merkle_inclusion',
          disclosedClaims: realProofRow!.disclosedClaims as object,
          verified: false,
        },
      });

      const result = await zkProofsService.verify(tamperedProofHash);

      expect(result.valid).toBe(false);

      // Clean up the tampered row immediately so afterAll deletion by researcherId
      // does not leave a dangling row after it deletes the researcher's other proofs.
      await prisma.zkProof
        .deleteMany({ where: { proofHash: tamperedProofHash } })
        .catch(() => {});
    },
    30_000,
  );
});
