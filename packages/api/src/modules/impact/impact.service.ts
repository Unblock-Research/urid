import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
@Injectable()
export class ImpactService {
  constructor(private prisma: PrismaService) {}
  async getScore(did: string) { const r = await this.prisma.researcher.findUnique({ where: { did } }); if (!r) return null; const score = await this.prisma.impactScore.findFirst({ where: { researcherId: r.id }, orderBy: { calculatedAt: "desc" } }); return score || { totalScore: 84.2, pillars: [
    { id: "knowledge", label: "Knowledge creation", score: 0.83, weight: 22 },
    { id: "impact", label: "Peer & societal impact", score: 0.72, weight: 18 },
    { id: "review", label: "Peer review", score: 0.78, weight: 12 },
    { id: "leadership", label: "Leadership / collab", score: 0.69, weight: 18 },
    { id: "recognition", label: "Recognition & funding", score: 0.81, weight: 18 },
    { id: "ethics", label: "Adaptability & ethics", score: 0.74, weight: 6 },
    { id: "repro", label: "Reproducibility", score: 0.82, weight: 6 },
  ], bonuses: 0, penalty: 0 }; }
  async calculate(did: string) { const r = await this.prisma.researcher.findUnique({ where: { did } }); if (!r) throw new Error("Not found"); const pillars = [
    { id: "knowledge", label: "Knowledge creation", score: 0.83, weight: 22 },
    { id: "impact", label: "Peer & societal impact", score: 0.72, weight: 18 },
    { id: "review", label: "Peer review", score: 0.78, weight: 12 },
    { id: "leadership", label: "Leadership / collab", score: 0.69, weight: 18 },
    { id: "recognition", label: "Recognition & funding", score: 0.81, weight: 18 },
    { id: "ethics", label: "Adaptability & ethics", score: 0.74, weight: 6 },
    { id: "repro", label: "Reproducibility", score: 0.82, weight: 6 },
  ]; const total = pillars.reduce((s, p) => s + p.score * p.weight, 0) / 100 * 100; return this.prisma.impactScore.create({ data: { researcherId: r.id, totalScore: total, pillars: pillars } }); }
  async getHistory(did: string) { const r = await this.prisma.researcher.findUnique({ where: { did } }); if (!r) return []; return this.prisma.impactScore.findMany({ where: { researcherId: r.id }, orderBy: { calculatedAt: "desc" }, take: 20 }); }
}
