import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { WalletService } from "./wallet.service";
@ApiTags("Wallet")
@Controller("wallet")
export class WalletController {
  constructor(private svc: WalletService) {}
  @Get(":did") getBalance(@Param("did") did: string) { return this.svc.getBalance(did); }
  @Post("link") link(@Body() body: { researcherDid: string; address: string; chain: string; label?: string }) { return this.svc.linkWallet(body); }
  @Get(":did/transactions") transactions(@Param("did") did: string) { return this.svc.getTransactions(did); }
}
