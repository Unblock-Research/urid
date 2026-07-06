import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
@Injectable()
export class AffiliationsService {
  constructor(private prisma: PrismaService) {}
  async list(did: string) { const r = await this.prisma.researcher.findUnique({ where: { did } }); if (!r) return []; return this.prisma.affiliation.findMany({ where: { researcherId: r.id } }); }
  async request(data: { researcherDid: string; organizationName: string; role: string }) { const r = await this.prisma.researcher.findUnique({ where: { did: data.researcherDid } }); if (!r) throw new Error("Not found"); return this.prisma.affiliation.create({ data: { researcherId: r.id, organizationName: data.organizationName, role: data.role, status: "pending" } }); }
  async approve(id: string) { return this.prisma.affiliation.update({ where: { id }, data: { status: "active" } }); }
  async revoke(id: string) { return this.prisma.affiliation.update({ where: { id }, data: { status: "expired" } }); }
}
