import { Injectable, Logger } from "@nestjs/common";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerService } from "../../ledger/ledger.service";
import { CryptoService } from "../../crypto/crypto.service";
import { IssuerKeyService } from "../../crypto/issuer-key.service";
import {
  buildClaimSet,
  encodeClaimsToLeaves,
  rootMessageBytes,
  type Claim,
} from "../../crypto/claim-encoding";

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private crypto: CryptoService,
    private issuerKey: IssuerKeyService,
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
    const leaves = encodeClaimsToLeaves(claims);
    const { root: merkleRoot } = await this.crypto.buildMerkleTree(leaves);

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
   *   2. Recompute the Merkle root from the STORED claims (same encoder as mint).
   *      Any mutated claim changes the root → returns false (tamper-evidence).
   *   3. Ed25519.verify(issuerSignature, rootMessageBytes(merkleRoot), issuerPublicKey).
   *      A signature not produced by the matching issuer private key → false.
   *
   * Never throws; returns `{ valid: false }` on any failure path.
   */
  async verifyCredential(id: string): Promise<{ valid: boolean }> {
    const sbt = await this.prisma.soulboundToken.findUnique({ where: { id } });

    // Guard: missing row or incomplete crypto fields
    if (
      !sbt ||
      !sbt.claims ||
      !sbt.merkleRoot ||
      !sbt.issuerSignature ||
      !sbt.issuerPublicKey
    ) {
      return { valid: false };
    }

    // Recompute the root from STORED claims (tamper-evidence: T-05-02)
    // Prisma returns Json as `JsonValue`; cast via `unknown` for safety.
    const storedClaims = sbt.claims as unknown as Claim[];
    const leaves = encodeClaimsToLeaves(storedClaims);
    const { root: recomputedRoot } = await this.crypto.buildMerkleTree(leaves);

    if (recomputedRoot !== sbt.merkleRoot) {
      return { valid: false };
    }

    // Verify Ed25519 signature against the stored issuer public key (T-05-03)
    const sigBytes = hexToBytes(sbt.issuerSignature);
    const pubKeyBytes = hexToBytes(sbt.issuerPublicKey);
    const valid = await this.crypto.verify(
      sigBytes,
      rootMessageBytes(sbt.merkleRoot),
      pubKeyBytes,
    );

    return { valid };
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
