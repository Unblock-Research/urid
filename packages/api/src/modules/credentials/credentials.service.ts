import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerService } from "../../ledger/ledger.service";

@Injectable()
export class CredentialsService {
  private readonly logger = new Logger(CredentialsService.name);

  constructor(
    private prisma: PrismaService,
    private ledger: LedgerService,
  ) {}

  async mint(data: { researcherDid: string; credentialType: string; title: string; issuer: string; tone?: string; fieldOfStudy?: string }) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did: data.researcherDid } });
    if (!researcher) throw new Error("Researcher not found");

    const sbt = await this.prisma.soulboundToken.create({
      data: { researcherId: researcher.id, credentialType: data.credentialType, title: data.title, issuer: data.issuer, tone: data.tone || "default", fieldOfStudy: data.fieldOfStudy },
    });

    const record = await this.ledger.mintSbt({ holder: data.researcherDid, credential: data.credentialType, title: data.title });
    await this.prisma.soulboundToken.update({ where: { id: sbt.id }, data: { onChainTxHash: record.txHash } });

    this.logger.log(`SBT minted: ${data.credentialType} for ${data.researcherDid}`);
    return sbt;
  }

  async listByDid(did: string) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) return [];
    return this.prisma.soulboundToken.findMany({ where: { researcherId: researcher.id, revoked: false }, orderBy: { issuedAt: "desc" } });
  }

  async revoke(id: string) {
    return this.prisma.soulboundToken.update({ where: { id }, data: { revoked: true, revokedAt: new Date() } });
  }
}
