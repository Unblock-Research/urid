/**
 * ZkProofsService — real Groth16 prove() + Ed25519-bound verify()
 *
 * prove(): loads the referenced SoulboundToken, rebuilds its Poseidon-Merkle
 * tree from the stored claims (PRE-PADDED to 16 leaves so depth is fixed at 4),
 * extracts the disclosed leaf's inclusion path, and calls
 * snarkjs.groth16.fullProve with the committed .wasm + .zkey.  Stores the real
 * proof, publicSignals, circuitId, disclosedClaims, and verified=true.
 *
 * verify(): runs snarkjs.groth16.verify(vKey, publicSignals, proof) AND
 * independently verifies the issuer's Ed25519 signature over the credential root
 * (publicSignals[1]) against the stored issuerPublicKey.  BOTH checks must pass
 * (ZKP-02, T-06-07, T-06-12).  The signature check stays OUTSIDE the circuit
 * (LOCKED constraint).
 */

import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CryptoService } from "../../crypto/crypto.service";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import * as snarkjs from "snarkjs";
import * as path from "path";
import * as fs from "fs";
import {
  encodeClaimsToLeaves,
  rootMessageBytes,
  type Claim,
} from "../../crypto/claim-encoding";
import { canonicalize } from "../../ledger/canonical";

// ── Circuit constants ──────────────────────────────────────────────────────

const CIRCUIT_DEPTH = 4;
const TREE_SIZE = Math.pow(2, CIRCUIT_DEPTH); // 16 — must match MerkleInclusionProof(4)

// Public signal indices (locked contract from Plan 02):
//   [0] predicateResult   (public output)
//   [1] root              (first public input)
//   [2] threshold         (second public input)
//   [3] predicateEnabled  (third public input)
const IDX_PREDICATE_RESULT = 0;
const IDX_ROOT = 1;

@Injectable()
export class ZkProofsService {
  private readonly logger = new Logger(ZkProofsService.name);

  /** Lazily-loaded verification key (cached after first load). */
  private _vkey: object | null = null;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
  ) {}

  // ── Path helpers ──────────────────────────────────────────────────────────

  private getCircuitDir(): string {
    return (
      process.env.CIRCUIT_ARTIFACTS_DIR ??
      path.join(__dirname, "../../../circuits")
    );
  }

  /**
   * Load the Groth16 verification key once and cache it.
   * Called by both prove() (self-check) and verify().
   */
  private getVkey(): object {
    if (!this._vkey) {
      const vkeyPath = path.join(this.getCircuitDir(), "verification_key.json");
      this._vkey = JSON.parse(fs.readFileSync(vkeyPath, "utf8")) as object;
    }
    return this._vkey;
  }

  // ── prove() ───────────────────────────────────────────────────────────────

  /**
   * Generate a real Groth16 inclusion proof for a disclosed claim of a credential.
   *
   * Replaces the legacy request-payload digest with a real Groth16 proof.
   */
  async prove(data: {
    credentialId: string;
    disclosedClaimName: string;
    appName: string;
    consentWindow: string;
    threshold?: string;
    predicateEnabled?: boolean;
  }) {
    // 1. Load the SoulboundToken by credentialId
    const sbt = await this.prisma.soulboundToken.findUnique({
      where: { id: data.credentialId },
    });
    if (!sbt || !sbt.claims || !sbt.merkleRoot) {
      throw new Error(
        "Credential not found or missing crypto fields (claims/merkleRoot)",
      );
    }

    // Refuse to mint new proofs over a revoked credential (critical finding #4).
    // verify() rejects them too, but failing here avoids handing out a proof
    // handle that can never verify.
    if (sbt.revoked) {
      throw new Error("Credential has been revoked — cannot generate a proof");
    }

    // 2. Decode the stored ordered claim set
    const storedClaims = sbt.claims as unknown as Claim[];

    // 3. Encode to BN254 leaf values
    const leafValues = encodeClaimsToLeaves(storedClaims);

    // 4. PRE-PAD to exactly TREE_SIZE (16) so the JS tree depth is fixed at 4
    //    (Pitfall 1: buildMerkleTree infers depth from input length; must supply
    //    exactly 2^circuitDepth leaves to match MerkleInclusionProof(4))
    const paddedLeaves: bigint[] = [...leafValues];
    while (paddedLeaves.length < TREE_SIZE) paddedLeaves.push(0n);

    // 5. Build the depth-4 Poseidon Merkle tree and assert root consistency
    const tree = await this.crypto.buildMerkleTree(paddedLeaves);
    if (tree.root !== sbt.merkleRoot) {
      throw new Error(
        "Merkle root mismatch — stored credential root does not match recomputed tree root",
      );
    }

    // 6. Find the disclosed claim's leaf index; throw on non-member (ZKP-03, T-06-09)
    const disclosedIndex = storedClaims.findIndex(
      (c) => c.name === data.disclosedClaimName,
    );
    if (disclosedIndex < 0) {
      throw new Error(
        `Claim "${data.disclosedClaimName}" not found in credential — non-member claims are not provable`,
      );
    }

    // 7. Generate Merkle inclusion proof for the disclosed leaf
    const inclusionProof = this.crypto.generateInclusionProof(
      tree,
      disclosedIndex,
    );

    // 8. Build the snarkjs witness object (signal names must EXACTLY match .circom)
    //    All values must be decimal strings (Pattern 3 + Pattern 6)
    const witness = {
      // Private signals
      leafValue: paddedLeaves[disclosedIndex].toString(10),
      pathElements: inclusionProof.siblings.map((s) =>
        BigInt("0x" + s).toString(10),
      ),
      pathIndices: inclusionProof.pathBits.map((b) => b.toString()),
      // Public signals (also passed as input so fullProve can compute the output)
      root: BigInt("0x" + tree.root).toString(10),
      threshold: data.threshold ?? "0",
      predicateEnabled: data.predicateEnabled ? "1" : "0",
    };

    // 9. Resolve WASM + zkey paths (allow CIRCUIT_ARTIFACTS_DIR env override)
    const circuitDir = this.getCircuitDir();
    const wasmPath = path.join(
      circuitDir,
      "merkle_inclusion_js",
      "merkle_inclusion.wasm",
    );
    const zkeyPath = path.join(
      circuitDir,
      "merkle_inclusion_final.zkey",
    );

    // 10. Generate real Groth16 proof via snarkjs fullProve (~1-5 s)
    const { proof, publicSignals } = (await snarkjs.groth16.fullProve(
      witness,
      wasmPath,
      zkeyPath,
    )) as { proof: object; publicSignals: string[] };

    // 11. Self-verify before persisting (guard against circuit artifact corruption)
    const vkey = this.getVkey();
    const selfValid = await snarkjs.groth16.verify(vkey, publicSignals, proof);
    if (!selfValid) {
      throw new Error(
        "Generated proof failed self-verification — circuit artifacts may be corrupt",
      );
    }

    // 12. Derive proofHash from the FULL proof artifact, not just its public signals.
    //
    //     Hashing publicSignals alone (the previous behaviour) made proofHash a
    //     function of [predicateResult, claimNameHash, root, threshold,
    //     predicateEnabled] — every one of which is identical across repeated
    //     proves of the same credential. Two proofs therefore collided on one
    //     handle, and since verify() resolved that handle with findFirst, revoking
    //     one row simply left its twin answering for it.
    //
    //     Groth16 proofs are randomised (fresh blinding scalars per invocation), so
    //     including the proof points makes each handle unique to one proof row.
    //     Canonical serialisation keeps the hash stable regardless of key order.
    const proofHash = bytesToHex(
      sha256(new TextEncoder().encode(canonicalize({ proof, publicSignals }))),
    );

    // 13. Calculate expiry
    const expiresAt =
      data.consentWindow === "forever"
        ? null
        : data.consentWindow === "30d"
          ? new Date(Date.now() + 30 * 86400000)
          : data.consentWindow === "24h"
            ? new Date(Date.now() + 86400000)
            : new Date(Date.now() + 3600000);

    // 14. Persist the ZkProof row with real circuit artifacts
    const zkProof = await this.prisma.zkProof.create({
      data: {
        researcherId: sbt.researcherId,
        appName: data.appName,
        claims: [{ name: data.disclosedClaimName }] as unknown as object,
        consentWindow: data.consentWindow,
        proofHash,
        expiresAt,
        proof: proof as unknown as object,
        publicSignals: publicSignals as unknown as object,
        circuitId: "merkle_inclusion",
        disclosedClaims: {
          credentialId: sbt.id,
          claimName: data.disclosedClaimName,
          threshold: data.threshold ?? "0",
          predicateEnabled: !!data.predicateEnabled,
        } as unknown as object,
        verified: true,
      },
    });

    // 15. Audit log (private signals — leafValue, path — are NOT logged; T-06-11)
    await this.prisma.auditLog.create({
      data: {
        researcherId: sbt.researcherId,
        action: "zk_proof_created",
        appName: data.appName,
        claims: data.disclosedClaimName,
      },
    });

    this.logger.log(
      `ZK proof created: ${data.appName} → ${data.disclosedClaimName} (${data.consentWindow})`,
    );
    return { ...zkProof, proofHash };
  }

  // ── verify() ──────────────────────────────────────────────────────────────

  /**
   * Verify a stored ZkProof.
   *
   * BOTH conditions must hold (ZKP-02, T-06-07, T-06-12):
   *   1. snarkjs.groth16.verify(vKey, publicSignals, proof) === true
   *   2. Ed25519.verify(issuerSignature, rootMessageBytes(root), issuerPublicKey) === true
   *
   * Additionally:
   *   - publicSignals[1] hex must match the credential's stored merkleRoot (T-06-10)
   *   - predicateResult (publicSignals[0]) must be "1"
   *
   * Never throws; every failure path returns { valid: false, reason }.
   */
  async verify(proofHash: string): Promise<{ valid: boolean; reason?: string }> {
    // Resolve the proof handle to exactly one row.
    //
    // findUnique (backed by the @unique constraint on proofHash) replaces the
    // previous findFirst({ proofHash, status: 'active' }): with colliding hashes
    // that query silently skipped over a revoked row and answered from an active
    // twin, so revocation could be bypassed. Now the handle names one row, and its
    // status is reported rather than filtered away — a revoked proof says so
    // instead of masquerading as "not found".
    const proofRow = await this.prisma.zkProof.findUnique({
      where: { proofHash },
    });
    if (!proofRow) {
      return { valid: false, reason: "Proof not found" };
    }
    if (proofRow.status !== "active") {
      return { valid: false, reason: `Proof ${proofRow.status}` };
    }

    // Expiry check (keep existing status-management logic)
    if (proofRow.expiresAt && proofRow.expiresAt < new Date()) {
      await this.prisma.zkProof.update({
        where: { id: proofRow.id },
        data: { status: "expired" },
      });
      return { valid: false, reason: "Proof expired" };
    }

    // Extract circuit artifacts from the stored row
    const proof = proofRow.proof as object | null;
    const publicSignals = proofRow.publicSignals as string[] | null;
    if (!proof || !publicSignals) {
      return {
        valid: false,
        reason: "Proof row missing circuit artifacts (proof/publicSignals)",
      };
    }

    // 1. Groth16 SNARK verification
    const vkey = this.getVkey();
    const snarkValid = await snarkjs.groth16.verify(
      vkey,
      publicSignals,
      proof,
    );
    if (!snarkValid) {
      return { valid: false, reason: "SNARK proof invalid" };
    }

    // 2. Extract Merkle root from public signals (index 1 per locked contract)
    const rootHex = BigInt(publicSignals[IDX_ROOT]).toString(16);

    // 3. Load the bound credential using the credentialId stored in disclosedClaims
    const disclosedClaims = proofRow.disclosedClaims as
      | { credentialId?: string }
      | null;
    if (!disclosedClaims?.credentialId) {
      return { valid: false, reason: "Proof missing credential linkage" };
    }
    const sbt = await this.prisma.soulboundToken.findUnique({
      where: { id: disclosedClaims.credentialId },
    });
    if (!sbt || !sbt.issuerSignature || !sbt.issuerPublicKey) {
      return { valid: false, reason: "Credential not found" };
    }

    // Revocation gate (critical finding #4). The SNARK and the issuer signature
    // both remain valid forever once generated — they say nothing about whether
    // the underlying credential is still in good standing. Without this check a
    // proof minted before revocation keeps verifying indefinitely, which makes
    // credential revocation unenforceable through the proof path.
    if (sbt.revoked) {
      return { valid: false, reason: "Credential has been revoked" };
    }

    // 4. Root binding: publicSignals[1] hex must equal the stored merkleRoot
    //    Prevents proof re-use across a different credential (T-06-10)
    if (rootHex !== sbt.merkleRoot) {
      return { valid: false, reason: "Root does not match credential" };
    }

    // 5. Ed25519 issuer signature over the root OUTSIDE the circuit (LOCKED constraint)
    //    Must pass in addition to the SNARK (ZKP-02, T-06-07, T-06-12)
    const sigValid = await this.crypto.verify(
      hexToBytes(sbt.issuerSignature),
      rootMessageBytes(rootHex),
      hexToBytes(sbt.issuerPublicKey),
    );
    if (!sigValid) {
      return { valid: false, reason: "Issuer signature over root invalid" };
    }

    // 6. Predicate result must be "1" (circuit output at index 0)
    if (publicSignals[IDX_PREDICATE_RESULT] !== "1") {
      return { valid: false, reason: "Predicate not satisfied" };
    }

    return { valid: true };
  }

  // ── Supporting endpoints (unchanged logic) ────────────────────────────────

  async listActive(did: string) {
    const researcher = await this.prisma.researcher.findUnique({
      where: { did },
    });
    if (!researcher) return [];
    return this.prisma.zkProof.findMany({
      where: { researcherId: researcher.id, status: "active" },
      orderBy: { createdAt: "desc" },
    });
  }

  async revoke(id: string) {
    return this.prisma.zkProof.update({
      where: { id },
      data: { status: "revoked" },
    });
  }

  async getAuditLog(did: string) {
    const researcher = await this.prisma.researcher.findUnique({
      where: { did },
    });
    if (!researcher) return [];
    return this.prisma.auditLog.findMany({
      where: { researcherId: researcher.id },
      orderBy: { timestamp: "desc" },
      take: 50,
    });
  }
}
