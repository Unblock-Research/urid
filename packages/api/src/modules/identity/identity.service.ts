import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerService } from "../../ledger/ledger.service";
import { CryptoService } from "../../crypto/crypto.service";

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

  async getByDid(did: string) {
    return this.prisma.researcher.findUnique({ where: { did }, include: { sbts: true, affilRecords: true, walletLinks: true, recoveryShards: true } });
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

  async setupRecovery(did: string, guardians: { name: string; kind: string }[]) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) throw new Error("Researcher not found");

    const shards = await Promise.all(
      guardians.map(g => this.prisma.recoveryShard.create({
        data: { researcherId: researcher.id, guardianName: g.name, guardianKind: g.kind, status: "pending" },
      }))
    );
    return shards;
  }

  async getRecoveryStatus(did: string) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) return null;
    return this.prisma.recoveryShard.findMany({ where: { researcherId: researcher.id } });
  }
}
