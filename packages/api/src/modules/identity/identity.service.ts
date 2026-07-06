import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerService } from "../../ledger/ledger.service";

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  async register(data: { handle: string; displayName: string; did?: string }) {
    const hash = Array.from(data.handle).reduce((a, c) => a + c.charCodeAt(0), 0);
    const did = data.did || "did:ub:0x" + Math.abs(hash).toString(16).padStart(8, "0").toUpperCase();

    const existing = await this.prisma.researcher.findUnique({ where: { handle: data.handle } });
    if (existing) throw new Error("Handle already taken");

    const researcher = await this.prisma.researcher.create({
      data: { handle: data.handle, did, displayName: data.displayName },
    });
    this.logger.log(`Registered: @${data.handle} → ${did}`);

    await this.ledger.registerDid({ handle: data.handle, did });

    return researcher;
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
