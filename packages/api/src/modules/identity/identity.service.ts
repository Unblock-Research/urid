import { Injectable, Logger } from "@nestjs/common";
import {
  randomBytes,
  createCipheriv,
  createDecipheriv,
  createHash,
} from "crypto";
import { split, combine } from "shamir-secret-sharing";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerService } from "../../ledger/ledger.service";
import { CryptoService } from "../../crypto/crypto.service";

// ---------------------------------------------------------------------------
// Internal types
// ---------------------------------------------------------------------------

interface EncryptedShardEnvelope {
  v: 1;
  alg: "aes-256-gcm";
  iv: string;
  authTag: string;
  ciphertext: string;
  /** sha256(secret) hex — non-secret verification commitment */
  tag: string;
}

interface RecoveryKit {
  guardianName: string;
  shardIndex: number;
  key: string; // 32-byte AES key, hex-encoded — return to guardian out-of-band
}

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
   * Shamir T-of-N social recovery setup.
   *
   * Splits `secret` (or generates a fresh 32-byte secret if omitted) into N
   * Shamir shares, AES-256-GCM-encrypts each share under a per-guardian
   * random key, and persists N RecoveryShard rows.  Returns per-guardian
   * recovery kits containing the AES key for out-of-band delivery.
   *
   * SECURITY CONTRACT:
   *   - The plaintext Shamir shares are NEVER stored — only their ciphertext.
   *   - The secret buffer is zeroed immediately after splitting.
   *   - No secret, share, or guardian key is ever logged.
   *   - A sha256(secret) verification tag is stored on every shard row so that
   *     recover() can validate the reconstructed value without storing the
   *     secret itself.
   */
  async setupRecovery(
    did: string,
    guardians: { name: string; kind: string }[],
    secretHex?: string,
    threshold?: number,
  ) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) throw new Error("Researcher not found");

    const N = guardians.length;
    if (N < 2) throw new Error("At least 2 guardians required");

    const T = threshold ?? Math.floor(N / 2) + 1;
    if (T < 2 || T > N) throw new Error(`Threshold must be between 2 and ${N} (got ${T})`);

    // Prepare secret bytes — use caller-supplied hex or generate fresh
    let secretBuf: Buffer;
    let generatedSecretHex: string | undefined;

    if (secretHex) {
      secretBuf = Buffer.from(secretHex, "hex");
    } else {
      secretBuf = randomBytes(32);
      generatedSecretHex = secretBuf.toString("hex");
    }

    // Non-secret verification commitment stored on every shard row
    const verificationTag = createHash("sha256").update(secretBuf).digest("hex");

    // Shamir-split into N shares (each share is self-describing / carries its x-coord)
    const secretUint8 = new Uint8Array(secretBuf);
    const shares = await split(secretUint8, N, T);

    // HARDENING: zero the secret material as soon as splitting is done
    secretBuf.fill(0);
    secretUint8.fill(0);

    // Remove any previously stored shards for this researcher
    await this.prisma.recoveryShard.deleteMany({ where: { researcherId: researcher.id } });

    const recoveryKits: RecoveryKit[] = [];

    for (let i = 0; i < N; i++) {
      const guardian = guardians[i];
      const share = shares[i]; // Uint8Array — plaintext Shamir share

      // Per-guardian AES-256-GCM encryption of the share
      const aesKey = randomBytes(32);
      const iv = randomBytes(12);

      const cipher = createCipheriv("aes-256-gcm", aesKey, iv);
      const ciphertext = Buffer.concat([
        cipher.update(Buffer.from(share)),
        cipher.final(),
      ]);
      const authTag = cipher.getAuthTag();

      // Self-describing envelope — plaintext share is NOT included
      const envelope: EncryptedShardEnvelope = {
        v: 1,
        alg: "aes-256-gcm",
        iv: iv.toString("hex"),
        authTag: authTag.toString("hex"),
        ciphertext: ciphertext.toString("hex"),
        tag: verificationTag,
      };

      await this.prisma.recoveryShard.create({
        data: {
          researcherId: researcher.id,
          guardianName: guardian.name,
          guardianKind: guardian.kind,
          status: "active",
          shardIndex: i,
          threshold: T,
          encryptedShard: JSON.stringify(envelope),
        },
      });

      // Recovery kit for this guardian — AES key is the only secret here
      recoveryKits.push({
        guardianName: guardian.name,
        shardIndex: i,
        key: aesKey.toString("hex"),
        // key is shown once; caller must deliver it to the guardian out-of-band
      });
    }

    this.logger.log(`setupRecovery: ${N} shards created for ${did} (threshold ${T}/${N})`);

    return {
      did,
      threshold: T,
      guardianCount: N,
      verificationTag,
      recoveryKits,
      ...(generatedSecretHex !== undefined
        ? {
            generatedSecret: generatedSecretHex,
            notice:
              "Store this generated secret now — it is shown once and never recoverable if lost.",
          }
        : {}),
    };
  }

  /**
   * Reconstruct the recovery secret from guardian-supplied submissions.
   *
   * Each submission provides the guardian's shard index and the AES key they
   * were given at setup.  The server decrypts the stored ciphertext to recover
   * the Shamir share, then combines >= T valid shares to reconstruct the
   * secret.  If fewer than T shares are valid, returns failure WITHOUT calling
   * combine and WITHOUT leaking any partial material.
   *
   * SECURITY CONTRACT:
   *   - GCM auth failures (wrong key / tampered ciphertext) are caught and
   *     silently skipped — the submission does not count toward T.
   *   - If validShares.length < T the method returns immediately with only
   *     { success: false, message } — no secret, no share, no key bytes.
   *   - The reconstructed secret is validated against the stored sha256 tag
   *     before being returned.
   *   - Nothing sensitive is logged.
   */
  async recover(
    did: string,
    submissions: { shardIndex: number; key: string }[],
  ) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) throw new Error("Researcher not found");

    const shards = await this.prisma.recoveryShard.findMany({
      where: { researcherId: researcher.id },
    });

    if (shards.length === 0) {
      return { success: false, message: "No recovery shards found for this researcher" };
    }

    // Threshold stored on every shard row (all rows agree on the same value)
    const T = (shards[0] as any).threshold as number;

    const validShares: Uint8Array[] = [];

    for (const submission of submissions) {
      const shard = shards.find((s: any) => s.shardIndex === submission.shardIndex);
      if (!shard || !(shard as any).encryptedShard) continue;

      try {
        const envelope: EncryptedShardEnvelope = JSON.parse((shard as any).encryptedShard as string);
        const key = Buffer.from(submission.key, "hex");
        const iv = Buffer.from(envelope.iv, "hex");
        const authTag = Buffer.from(envelope.authTag, "hex");
        const ciphertext = Buffer.from(envelope.ciphertext, "hex");

        const decipher = createDecipheriv("aes-256-gcm", key, iv);
        decipher.setAuthTag(authTag);
        // If the key is wrong or the ciphertext is tampered, final() throws
        const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
        validShares.push(new Uint8Array(plaintext));
      } catch {
        // GCM authentication failure — invalid key; skip, do not count toward T
      }
    }

    // Threshold gate: do NOT call combine if we cannot meet T
    if (validShares.length < T) {
      return { success: false, message: "Insufficient valid shares to reconstruct the secret" };
    }

    // Reconstruct the secret
    const reconstructed = await combine(validShares.slice(0, T));
    const reconstructedHex = Buffer.from(reconstructed).toString("hex");

    // Validate against stored verification tag (sha256 commitment)
    const computedTag = createHash("sha256")
      .update(Buffer.from(reconstructed))
      .digest("hex");

    // All shard envelopes share the same tag; use the first one
    const storedEnvelope: EncryptedShardEnvelope = JSON.parse(
      (shards[0] as any).encryptedShard as string,
    );
    const storedTag = storedEnvelope.tag;

    if (computedTag !== storedTag) {
      // Reconstruction produced a wrong result — do not return it
      return {
        success: false,
        message: "Reconstruction failed — verification tag mismatch",
      };
    }

    return {
      success: true,
      verified: true,
      secret: reconstructedHex,
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
