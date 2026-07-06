import { Injectable } from "@nestjs/common";
import { PrismaService } from "../../prisma/prisma.service";
@Injectable()
export class WalletService {
  constructor(private prisma: PrismaService) {}
  async getBalance(did: string) { const r = await this.prisma.researcher.findUnique({ where: { did } }); if (!r) return null; const wallets = await this.prisma.walletLink.findMany({ where: { researcherId: r.id } }); return { ubrBalance: "8420.18", delta7d: "+412.40", linkedWallets: wallets }; }
  async linkWallet(data: { researcherDid: string; address: string; chain: string; label?: string }) { const r = await this.prisma.researcher.findUnique({ where: { did: data.researcherDid } }); if (!r) throw new Error("Not found"); return this.prisma.walletLink.create({ data: { researcherId: r.id, address: data.address, chain: data.chain, label: data.label } }); }
  async getTransactions(did: string) { return [
    { id: "tx1", type: "inflow", description: "NIH R01 — milestone 3", amount: "+4,200.00", time: "2d ago" },
    { id: "tx2", type: "inflow", description: "Cell Reports — review reward", amount: "+120.00", time: "3d ago" },
    { id: "tx3", type: "outflow", description: "Compute — GPU cluster", amount: "-45.00", time: "4d ago" },
    { id: "tx4", type: "inflow", description: "Patent royalty — US11,234,567", amount: "+89.40", time: "5d ago" },
    { id: "tx5", type: "outflow", description: "Storage — 2TB pinning", amount: "-12.00", time: "6d ago" },
  ]; }
}
