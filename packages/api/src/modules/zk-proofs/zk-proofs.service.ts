import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
import * as crypto from "crypto";

@Injectable()
export class ZkProofsService {
  private readonly logger = new Logger(ZkProofsService.name);
  constructor(private prisma: PrismaService) {}

  async prove(data: { researcherDid: string; appName: string; claims: { id: string; label: string; scope: string }[]; consentWindow: string }) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did: data.researcherDid } });
    if (!researcher) throw new Error("Researcher not found");

    const proofHash = crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex");
    const expiresAt = data.consentWindow === "forever" ? null :
      data.consentWindow === "30d" ? new Date(Date.now() + 30 * 86400000) :
      data.consentWindow === "24h" ? new Date(Date.now() + 86400000) :
      new Date(Date.now() + 3600000);

    const proof = await this.prisma.zkProof.create({
      data: { researcherId: researcher.id, appName: data.appName, claims: data.claims, consentWindow: data.consentWindow, proofHash, expiresAt },
    });

    await this.prisma.auditLog.create({
      data: { researcherId: researcher.id, action: "zk_proof_created", appName: data.appName, claims: data.claims.map(c => c.id).join(",") },
    });

    this.logger.log(`ZK proof created: ${data.appName} → ${data.claims.length} claims (${data.consentWindow})`);
    return { ...proof, proofHash };
  }

  async verify(proofHash: string) {
    const proof = await this.prisma.zkProof.findFirst({ where: { proofHash, status: "active" } });
    if (!proof) return { valid: false, reason: "Proof not found or expired" };
    if (proof.expiresAt && proof.expiresAt < new Date()) {
      await this.prisma.zkProof.update({ where: { id: proof.id }, data: { status: "expired" } });
      return { valid: false, reason: "Proof expired" };
    }
    return { valid: true, appName: proof.appName, claims: proof.claims, consentWindow: proof.consentWindow };
  }

  async listActive(did: string) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) return [];
    return this.prisma.zkProof.findMany({ where: { researcherId: researcher.id, status: "active" }, orderBy: { createdAt: "desc" } });
  }

  async revoke(id: string) {
    const proof = await this.prisma.zkProof.update({ where: { id }, data: { status: "revoked" } });
    return proof;
  }

  async getAuditLog(did: string) {
    const researcher = await this.prisma.researcher.findUnique({ where: { did } });
    if (!researcher) return [];
    return this.prisma.auditLog.findMany({ where: { researcherId: researcher.id }, orderBy: { timestamp: "desc" }, take: 50 });
  }
}
