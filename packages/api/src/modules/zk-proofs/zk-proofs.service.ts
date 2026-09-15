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
 * against the stored issuerPublicKey.  BOTH checks must pass (ZKP-02, T-06-07,
 * T-06-12).  The signature check stays OUTSIDE the circuit (LOCKED constraint).
 *
 * It additionally requires (critical findings #3 and #4):
 *   - publicSignals[IDX_CLAIM_NAME_HASH] to match the hash of the disclosed claim
 *     name on the proof row, so the proof attests a NAMED claim rather than
 *     merely "some leaf in this tree"
 *   - the bound credential not to be revoked
 */

import {
  ForbiddenException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { CryptoService } from "../../crypto/crypto.service";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import * as snarkjs from "snarkjs";
import * as path from "path";
import * as fs from "fs";
import {
  claimNameHash,
  claimValueCommitment,
  encodeClaimsToLeaves,
  isNumericClaim,
  rootMessageBytes,
  type Claim,
} from "../../crypto/claim-encoding";
import { canonicalize } from "../../ledger/canonical";
import { ProverBusyError, ProverPool } from "./prover.pool";

// ── Circuit constants ──────────────────────────────────────────────────────

const CIRCUIT_DEPTH = 4;
const TREE_SIZE = Math.pow(2, CIRCUIT_DEPTH); // 16 — must match MerkleInclusionProof(4)

// Public signal indices — v2 contract, asserted in circuit-artifacts.spec.ts:
//   [0] predicateResult   (public output)
//   [1] claimNameHash     (first public input)  — identifies WHICH claim
//   [2] root              (second public input)
//   [3] threshold         (third public input)
//   [4] predicateEnabled  (fourth public input)
const IDX_PREDICATE_RESULT = 0;
const IDX_CLAIM_NAME_HASH = 1;
const IDX_ROOT = 2;
const IDX_THRESHOLD = 3;
const IDX_PREDICATE_ENABLED = 4;

@Injectable()
export class ZkProofsService {
  private readonly logger = new Logger(ZkProofsService.name);

  /** Lazily-loaded verification key (cached after first load). */
  private _vkey: object | null = null;

  constructor(
    private prisma: PrismaService,
    private crypto: CryptoService,
    private prover: ProverPool,
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
  async prove(
    data: {
      credentialId: string;
      disclosedClaimName: string;
      appName: string;
      consentWindow: string;
      threshold?: string;
      predicateEnabled?: boolean;
    },
    actorResearcherId: string,
  ) {
    // 1. Load the SoulboundToken by credentialId
    const sbt = await this.prisma.soulboundToken.findUnique({
      where: { id: data.credentialId },
    });
    if (!sbt || !sbt.claims || !sbt.merkleRoot) {
      throw new Error(
        "Credential not found or missing crypto fields (claims/merkleRoot)",
      );
    }

    // Ownership (critical finding #1). The credential is addressed by id, so the
    // guard could not check this from the route — only the holder of a credential
    // may disclose it. Reported as not-found rather than forbidden so the endpoint
    // does not confirm which credential ids exist.
    if (sbt.researcherId !== actorResearcherId) {
      throw new ForbiddenException("Credential not found for this researcher");
    }

    // Refuse to mint new proofs over a revoked credential (critical finding #4).
    // verify() rejects them too, but failing here avoids handing out a proof
    // handle that can never verify.
    if (sbt.revoked) {
      throw new Error("Credential has been revoked — cannot generate a proof");
    }

    // 2. Decode the stored ordered claim set
    const storedClaims = sbt.claims as unknown as Claim[];

    // 3. Encode to BN254 leaf values (v2: poseidon([nameHash, valueHash]))
    const leafValues = await encodeClaimsToLeaves(storedClaims);

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

    // 6a. The threshold predicate only means something for a numeric claim, whose
    //     value is committed as poseidon([NUMERIC_VALUE_TAG, n]) and can therefore
    //     be re-derived and bound inside the circuit. Asking for it on a string
    //     claim would produce an unsatisfiable witness, so reject it here with an
    //     explanation rather than surfacing a witness-generation failure.
    if (data.predicateEnabled && !isNumericClaim(storedClaims[disclosedIndex])) {
      throw new Error(
        `Claim "${data.disclosedClaimName}" is not numeric — the threshold predicate applies only to numeric claims`,
      );
    }

    // 7. Generate Merkle inclusion proof for the disclosed leaf
    const inclusionProof = this.crypto.generateInclusionProof(
      tree,
      disclosedIndex,
    );

    // 8. Build the snarkjs witness object (signal names must EXACTLY match .circom)
    //    All values must be decimal strings (Pattern 3 + Pattern 6)
    //    The circuit rebuilds leafValue = poseidon([claimNameHash, claimValueHash])
    //    internally, so we supply the two halves rather than the combined leaf.
    const disclosedClaim = storedClaims[disclosedIndex];
    // numericValue is only consulted when predicateEnabled=1; for string claims
    // the circuit's binding constraint is multiplied out, so 0 is a safe filler.
    const numericValue = isNumericClaim(disclosedClaim)
      ? BigInt(disclosedClaim.value)
      : 0n;
    const witness = {
      // Private signals — the value half never leaves this process
      claimValueHash: (await claimValueCommitment(disclosedClaim)).toString(10),
      numericValue: numericValue.toString(10),
      pathElements: inclusionProof.siblings.map((s) =>
        BigInt("0x" + s).toString(10),
      ),
      pathIndices: inclusionProof.pathBits.map((b) => b.toString()),
      // Public signals (also passed as input so fullProve can compute the output)
      claimNameHash: claimNameHash(disclosedClaim.name).toString(10),
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

    // 10. Generate the Groth16 proof on a worker thread (~1-5 s of WASM).
    //
    //     Previously this ran inline, blocking Node's single thread for the whole
    //     duration — so a few concurrent proofs stalled every other route, not
    //     just this one. The pool also bounds concurrency and queue depth, and
    //     sheds load with 503 rather than accumulating an invisible backlog
    //     (high finding #3).
    let proof: object;
    let publicSignals: string[];
    try {
      const result = await this.prover.prove({ witness, wasmPath, zkeyPath });
      proof = result.proof;
      publicSignals = result.publicSignals;
    } catch (err) {
      if (err instanceof ProverBusyError) {
        // 503 with a retry hint is the honest response to saturation; queueing
        // further would just hide the overload from the caller.
        throw new ServiceUnavailableException(err.message);
      }
      throw err;
    }

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
          numericClaim: isNumericClaim(disclosedClaim),
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
  async verify(proofHash: string): Promise<{
    valid: boolean;
    reason?: string;
    /**
     * Whether the numeric threshold predicate was actually engaged, and against
     * what bound. A relying party must be able to tell "value >= 100 was proven"
     * from "membership was proven and the predicate passed vacuously" — those
     * produce the identical predicateResult of 1.
     */
    predicate?: { enabled: boolean; threshold: string };
  }> {
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
      | { credentialId?: string; claimName?: string }
      | null;
    if (!disclosedClaims?.credentialId) {
      return { valid: false, reason: "Proof missing credential linkage" };
    }

    // 3a. Claim binding (critical finding #3).
    //
    //     THIS is what makes the proof mean something specific. The SNARK proves
    //     that a leaf built from publicSignals[IDX_CLAIM_NAME_HASH] and some
    //     private value is a member of the tree. Recomputing that hash from the
    //     claim name the proof row advertises, and requiring the two to match,
    //     upgrades the statement from "some leaf is in this tree" to "the claim
    //     named X is in this credential". Without it, disclosedClaims.claimName
    //     is an unverified label a caller could set to anything.
    if (!disclosedClaims.claimName) {
      return { valid: false, reason: "Proof missing disclosed claim name" };
    }
    const expectedNameHash = claimNameHash(disclosedClaims.claimName).toString(10);
    if (publicSignals[IDX_CLAIM_NAME_HASH] !== expectedNameHash) {
      return {
        valid: false,
        reason: "Proof does not attest the claimed disclosed claim name",
      };
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

    // 7. Bind the predicate to the request it was generated for.
    //
    //    threshold and predicateEnabled are prover-chosen inputs, so without this
    //    a proof generated with the predicate switched OFF is indistinguishable
    //    from one that actually cleared a bound — predicateResult is 1 either way.
    //    Requiring the public signals to match the stored request means the
    //    recorded threshold is the threshold that was proven.
    const storedPredicateEnabled =
      (proofRow.disclosedClaims as { predicateEnabled?: boolean } | null)
        ?.predicateEnabled === true;
    const storedThreshold =
      (proofRow.disclosedClaims as { threshold?: string } | null)?.threshold ??
      "0";

    const signalPredicateEnabled = publicSignals[IDX_PREDICATE_ENABLED] === "1";
    if (signalPredicateEnabled !== storedPredicateEnabled) {
      return {
        valid: false,
        reason: "Proof predicate flag does not match the recorded request",
      };
    }
    if (publicSignals[IDX_THRESHOLD] !== String(storedThreshold)) {
      return {
        valid: false,
        reason: "Proof threshold does not match the recorded request",
      };
    }

    return {
      valid: true,
      // Reported unconditionally so a caller cannot mistake a vacuous pass for a
      // proven bound by omission.
      predicate: {
        enabled: signalPredicateEnabled,
        threshold: signalPredicateEnabled ? String(storedThreshold) : "0",
      },
    };
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

  /**
   * Revoke a proof the caller owns.
   *
   * Ownership is checked here rather than in the guard because the route keys off
   * a proof id (critical finding #1) — otherwise any authenticated researcher
   * could revoke anyone's proofs.
   */
  async revoke(id: string, actorResearcherId: string) {
    const existing = await this.prisma.zkProof.findUnique({ where: { id } });
    if (!existing || existing.researcherId !== actorResearcherId) {
      throw new ForbiddenException("Proof not found for this researcher");
    }
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
