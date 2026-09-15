import { Injectable, Logger } from "@nestjs/common";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerService } from "../../ledger/ledger.service";
import { CryptoService } from "../../crypto/crypto.service";
import { IssuerKeyService } from "../../crypto/issuer-key.service";
import { IssuerRegistryService } from "../../crypto/issuer-registry.service";
import {
  buildClaimSet,
  encodeClaimsToLeaves,
  rootMessageBytes,
  type Claim,
} from "../../crypto/claim-encoding";

// ── Circuit depth alignment ────────────────────────────────────────────────────
//
// The committed circuit is MerkleInclusionProof(4), so the tree it verifies
// against is ALWAYS depth-4 (16 leaves).  Both mint() and verifyCredential()
// must pre-pad their claim leaf array to exactly this size before building the
// Merkle tree; otherwise prove() — which also pads to CIRCUIT_TREE_SIZE — would
// compute a different root than the one stored at mint time.
//
// See packages/api/circuits/merkle_inclusion.circom for the circuit definition
// and packages/api/src/modules/zk-proofs/zk-proofs.service.ts for the matching
// CIRCUIT_DEPTH / TREE_SIZE constants.

const CIRCUIT_DEPTH = 4;
/** Number of leaves in the depth-4 Poseidon Merkle tree (2^CIRCUIT_DEPTH). */
const CIRCUIT_TREE_SIZE = Math.pow(2, CIRCUIT_DEPTH); // 16

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private crypto: CryptoService,
    private issuerKey: IssuerKeyService,
    private issuerRegistry: IssuerRegistryService,
  ) {}

  /**
   * Mint a Soulbound Token for the given researcher DID.
   *
   * Steps:
   *   1. Load the researcher (throws if not found).
   *   2. Create the SBT row so we capture Prisma's server-side `issuedAt`.
   *   3. Build the canonical claim set from the SBT's field values.
   *   4. Compute the Poseidon-Merkle root over the encoded claim leaves.
   *   5. Sign `rootMessageBytes(root)` with the platform issuer key (Ed25519).
   *   6. Anchor on the ledger via `ledger.mintSbt(...)` (CRD-03 preserved).
   *   7. Persist all crypto fields + `onChainTxHash` in a single update.
   *   8. Return the updated SBT row (includes merkleRoot and issuerPublicKey).
   *
   * Security (T-05-01): the issuer private key never leaves IssuerKeyService —
   * only `issuerPublicKey` and `merkleRoot` are returned to the caller.
   */
  async mint(data: {
    researcherDid: string;
    credentialType: string;
    title: string;
    issuer: string;
    tone?: string;
    fieldOfStudy?: string;
  }) {
    const researcher = await this.prisma.researcher.findUnique({
      where: { did: data.researcherDid },
    });
    if (!researcher) throw new Error("Researcher not found");

    // Step 1 — create the SBT row (captures server-side issuedAt timestamp)
    const sbt = await this.prisma.soulboundToken.create({
      data: {
        researcherId: researcher.id,
        credentialType: data.credentialType,
        title: data.title,
        issuer: data.issuer,
        tone: data.tone || "default",
        fieldOfStudy: data.fieldOfStudy,
      },
    });

    // Step 2 — build canonical claim set using the SBT's server-assigned issuedAt
    const issuedAt =
      sbt.issuedAt instanceof Date
        ? sbt.issuedAt.toISOString()
        : String(sbt.issuedAt);

    const claims = buildClaimSet({
      holderDid: data.researcherDid,
      credentialType: data.credentialType,
      title: data.title,
      issuer: data.issuer,
      fieldOfStudy: data.fieldOfStudy ?? null,
      issuedAt,
    });

    // Step 3 — compute Poseidon-Merkle root over the encoded claim leaves
    // PRE-PAD to CIRCUIT_TREE_SIZE (16) so the tree depth is fixed at
    // CIRCUIT_DEPTH (4) — exactly matching MerkleInclusionProof(4) in the
    // committed circuit and the TREE_SIZE constant in ZkProofsService.prove().
    // Without this, prove() pads to 16 internally and computes a root that
    // disagrees with the shallower root stored here (depth-mismatch defect).
    const leaves = await encodeClaimsToLeaves(claims);
    const paddedLeaves: bigint[] = [...leaves];
    while (paddedLeaves.length < CIRCUIT_TREE_SIZE) paddedLeaves.push(0n);
    const { root: merkleRoot } = await this.crypto.buildMerkleTree(paddedLeaves);

    // Step 4 — sign rootMessageBytes(root) with the platform issuer key
    const sigBytes = await this.issuerKey.sign(rootMessageBytes(merkleRoot));
    const issuerSignature = bytesToHex(sigBytes);
    const issuerPublicKey = this.issuerKey.getPublicKeyHex();

    // Step 5 — anchor on the ledger (CRD-03: ledger anchor preserved)
    const record = await this.ledger.mintSbt({
      holder: data.researcherDid,
      credential: data.credentialType,
      title: data.title,
    });

    // Step 6 — persist all crypto fields + ledger anchor in one update
    // Cast claims to `any` to satisfy Prisma's opaque InputJsonValue type.
    const updated = await this.prisma.soulboundToken.update({
      where: { id: sbt.id },
      data: {
        claims: claims as any,
        merkleRoot,
        issuerSignature,
        issuerPublicKey,
        onChainTxHash: record.txHash,
      },
    });

    this.logger.log(
      `SBT minted: ${data.credentialType} for ${data.researcherDid}`,
    );
    return updated;
  }

  /**
   * Independently verify a stored credential.
   *
   * Algorithm (CRD-02):
   *   1. Load the SBT; return false if missing or crypto fields are absent.
   *   2. Require the stored issuerPublicKey to be a TRUSTED issuer key.
   *   3. Recompute the Merkle root from the STORED claims (same encoder as mint).
   *      Any mutated claim changes the root → returns false (tamper-evidence).
   *   4. Ed25519.verify(issuerSignature, rootMessageBytes(merkleRoot), issuerPublicKey).
   *      A signature not produced by the matching issuer private key → false.
   *
   * Step 2 is what makes steps 3–4 mean anything. Verifying a signature against a
   * public key that travels on the same row only proves the row is self-consistent:
   * an attacker who can write the row re-signs the tampered claims with a key they
   * control, stores that public key alongside, and the signature checks out. The
   * registry lookup is the step that ties the credential to an issuer we trust
   * rather than to whichever key the row happens to assert (critical finding #5).
   *
   * Never throws; returns `{ valid: false, reason }` on any failure path.
   */
  async verifyCredential(
    id: string,
  ): Promise<{ valid: boolean; reason?: string }> {
    const sbt = await this.prisma.soulboundToken.findUnique({ where: { id } });

    // Guard: missing row or incomplete crypto fields
    if (
      !sbt ||
      !sbt.claims ||
      !sbt.merkleRoot ||
      !sbt.issuerSignature ||
      !sbt.issuerPublicKey
    ) {
      return { valid: false, reason: "Credential not found or missing crypto fields" };
    }

    // Revocation gate (critical finding #4). A revoked credential is still a
    // perfectly well-formed signed object — its claims still hash to the root and
    // the issuer signature is still valid — so nothing downstream would reject it.
    // Revocation is a statement the issuer makes AFTER signing, and only an
    // explicit check honours it.
    if (sbt.revoked) {
      return { valid: false, reason: "Credential has been revoked" };
    }

    // Trust gate: the issuer key on the row must be one this deployment trusts.
    // Checked BEFORE any signature work so an untrusted key can never pass on the
    // strength of a signature it produced itself.
    if (!this.issuerRegistry.isTrusted(sbt.issuerPublicKey)) {
      return { valid: false, reason: "Issuer is not in the trusted issuer registry" };
    }

    // Recompute the root from STORED claims (tamper-evidence: T-05-02)
    // Prisma returns Json as `JsonValue`; cast via `unknown` for safety.
    // Must apply the same CIRCUIT_TREE_SIZE padding as mint() so the
    // recomputed root matches the stored root for untampered credentials.
    const storedClaims = sbt.claims as unknown as Claim[];
    const leaves = await encodeClaimsToLeaves(storedClaims);
    const paddedLeaves: bigint[] = [...leaves];
    while (paddedLeaves.length < CIRCUIT_TREE_SIZE) paddedLeaves.push(0n);
    const { root: recomputedRoot } = await this.crypto.buildMerkleTree(paddedLeaves);

    if (recomputedRoot !== sbt.merkleRoot) {
      return { valid: false, reason: "Claims do not match the committed Merkle root" };
    }

    // Verify Ed25519 signature against the (now trust-gated) issuer public key (T-05-03)
    const sigBytes = hexToBytes(sbt.issuerSignature);
    const pubKeyBytes = hexToBytes(sbt.issuerPublicKey);
    const valid = await this.crypto.verify(
      sigBytes,
      rootMessageBytes(sbt.merkleRoot),
      pubKeyBytes,
    );

    return valid
      ? { valid: true }
      : { valid: false, reason: "Issuer signature over root invalid" };
  }

  async listByDid(did: string) {
    const researcher = await this.prisma.researcher.findUnique({
      where: { did },
    });
    if (!researcher) return [];
    return this.prisma.soulboundToken.findMany({
      where: { researcherId: researcher.id, revoked: false },
      orderBy: { issuedAt: "desc" },
    });
  }

  async revoke(id: string) {
    return this.prisma.soulboundToken.update({
      where: { id },
      data: { revoked: true, revokedAt: new Date() },
    });
  }
}
