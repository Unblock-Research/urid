import { BadRequestException, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerService } from "../../ledger/ledger.service";
import { CryptoService } from "../../crypto/crypto.service";
import { isEncryptedShardEnvelope } from "../../crypto/recovery";

// ---------------------------------------------------------------------------
// IdentityService
// ---------------------------------------------------------------------------

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
    private crypto: CryptoService,
  ) {}

  async register(data: { handle: string; displayName: string }) {
    // Guard: check handle uniqueness BEFORE generating any key material
    const existing = await this.prisma.researcher.findUnique({ where: { handle: data.handle } });
    if (existing) throw new Error("Handle already taken");

    // Generate a real Ed25519 keypair and derive the self-certifying DID
    const { publicKey, privateKey } = await this.crypto.generateKeypair();
    const did = await this.crypto.encodeDid(publicKey);

    // Encode keys as hex for storage and transport consistency
    const publicKeyHex = Buffer.from(publicKey).toString("hex");
    const privateKeyHex = Buffer.from(privateKey).toString("hex");

    // Persist only the public key — private key is NEVER stored
    const researcher = await this.prisma.researcher.create({
      data: {
        handle: data.handle,
        displayName: data.displayName,
        did,
        publicKey: publicKeyHex,
        keyType: "Ed25519",
        // encryptedPrivateKey intentionally omitted (stays null) — client custody
      },
    });

    this.logger.log(`Registered: @${data.handle} → ${did}`);

    // Anchor the real identity on the ledger
    await this.ledger.registerDid({ handle: data.handle, did, publicKey: publicKeyHex });

    // Return the private key exactly once, flagged as non-recoverable
    return {
      researcher,
      did,
      publicKey: publicKeyHex,
      privateKey: privateKeyHex,
      keyCustody: "Store this private key now — it is shown once and never recoverable if lost.",
    };
  }

  /**
   * Public DID resolution.
   *
   * recoveryShards is deliberately NOT included: guardian names are personal data
   * about third parties, and this route is unauthenticated so anyone could
   * enumerate a researcher's social graph from it. The authenticated
   * `GET identity/did/:did/recovery` serves that information to the holder, already
   * projected to safe fields.
   */
  async getByDid(did: string) {
    return this.prisma.researcher.findUnique({ where: { did }, include: { sbts: true, affilRecords: true, walletLinks: true } });
  }

  async getByHandle(handle: string) {
    return this.prisma.researcher.findUnique({ where: { handle }, include: { sbts: true, affilRecords: true } });
  }

  async update(did: string, data: Partial<{ displayName: string; bio: string; orcidId: string; affiliations: string[]; fieldOfStudy: string; careerStage: string }>) {
    return this.prisma.researcher.update({ where: { did }, data });
  }

  async checkHandleAvailability(handle: string) {
    const exists = await this.prisma.researcher.findUnique({ where: { handle } });
    return { available: !exists, handle };
  }

  /**
   * Store a recovery setup that the HOLDER prepared on their own device.
   *
   * The server is an encrypted blob store here and nothing more. It receives
   * ciphertexts, validates their structure, and writes them. It never sees the
   * secret, a plaintext share, or a guardian key, so compromising it cannot
   * reconstruct anything (high finding #2).
   *
   * The client produces `payload` with `prepareRecovery()` in
   * ../../crypto/recovery.ts. That module is deliberately free of server
   * dependencies so the identical code runs in a browser or mobile app.
   *
   * Replaces the previous flow, in which the server generated the secret, split
   * it, held every ciphertext, and returned every guardian key in one response.
   */
  async storeRecoverySetup(
    did: string,
    payload: {
      threshold: number;
      verificationTag: string;
      guardians: {
        name: string;
        kind: string;
        shardIndex: number;
        encryptedShard: string;
      }[];
    },
  ) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) throw new Error("Researcher not found");

    const { threshold, guardians } = payload;
    const n = guardians.length;

    if (n < 2) throw new BadRequestException("At least 2 guardians required");
    if (!Number.isInteger(threshold) || threshold < 2 || threshold > n) {
      throw new BadRequestException(
        `Threshold must be an integer between 2 and ${n} (got ${threshold})`,
      );
    }

    // Shard indices must be exactly 0..n-1, each once. A gap or duplicate would
    // make a share unaddressable at reconstruction time, and the client cannot
    // be assumed to have got this right.
    const indices = guardians.map((g) => g.shardIndex).sort((x, y) => x - y);
    const expected = Array.from({ length: n }, (_, i) => i);
    if (indices.join(",") !== expected.join(",")) {
      throw new BadRequestException(
        "Guardian shardIndex values must be exactly 0..N-1 with no gaps or duplicates",
      );
    }

    // Structural validation only — checking that a ciphertext decrypts would
    // need the guardian keys, which the server must never hold.
    for (const g of guardians) {
      let envelope: unknown;
      try {
        envelope = JSON.parse(g.encryptedShard);
      } catch {
        throw new BadRequestException(
          `Guardian "${g.name}" has a malformed encryptedShard (not JSON)`,
        );
      }
      if (!isEncryptedShardEnvelope(envelope)) {
        throw new BadRequestException(
          `Guardian "${g.name}" has an encryptedShard that is not a valid v1 AES-256-GCM envelope`,
        );
      }
    }

    // Replace any previous setup for this researcher.
    await this.prisma.recoveryShard.deleteMany({
      where: { researcherId: researcher.id },
    });

    await this.prisma.recoveryShard.createMany({
      data: guardians.map((g) => ({
        researcherId: researcher.id,
        guardianName: g.name,
        guardianKind: g.kind,
        status: "active",
        shardIndex: g.shardIndex,
        threshold,
        encryptedShard: g.encryptedShard,
      })),
    });

    this.logger.log(
      `storeRecoverySetup: ${n} shards stored for ${did} (threshold ${threshold}/${n})`,
    );

    return { did, threshold, guardianCount: n };
  }

  /**
   * Return the stored ciphertexts so the holder can reconstruct locally.
   *
   * Safe to serve without authentication: an encrypted share is useless without
   * its guardian key, and requiring a signature here would be incoherent —
   * recovery exists precisely because the holder has lost that key.
   *
   * Guardian NAMES are omitted. They are personal data about third parties and
   * are not needed to reconstruct; each guardian already knows their own
   * shardIndex from the kit they were given.
   */
  async getRecoveryShards(did: string) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) return null;

    const shards = await this.prisma.recoveryShard.findMany({
      where: { researcherId: researcher.id },
      orderBy: { shardIndex: "asc" },
    });
    if (shards.length === 0) return null;

    return {
      did,
      threshold: (shards[0] as any).threshold as number | null,
      shards: shards.map((s: any) => ({
        shardIndex: s.shardIndex as number | null,
        encryptedShard: s.encryptedShard as string | null,
      })),
    };
  }

  /**
   * Returns a safe projection of the researcher's RecoveryShard rows.
   *
   * SECURITY: Never returns encryptedShard, plaintext secret, or any key
   * material.  Only safe metadata is exposed.
   */
  async getRecoveryStatus(did: string) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) return null;

    const shards = await this.prisma.recoveryShard.findMany({
      where: { researcherId: researcher.id },
    });

    // Project to safe fields only — never expose encryptedShard
    return shards.map((s: any) => ({
      guardianName: s.guardianName as string,
      guardianKind: s.guardianKind as string,
      status: s.status as string,
      shardIndex: s.shardIndex as number | null,
      threshold: s.threshold as number | null,
    }));
  }
}
