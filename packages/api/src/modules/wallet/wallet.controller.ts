import { Controller, Get, Post, Param, Body, ForbiddenException, UseGuards } from "@nestjs/common";
import { ApiTags, ApiSecurity } from "@nestjs/swagger";
import { DidAuthGuard, type UridPrincipal } from "../../auth/did-auth.guard";
import { Principal } from "../../auth/principal.decorator";
import { WalletService } from "./wallet.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { linkBodySchema, LinkBodyDto } from "./wallet.dto";

@ApiTags("Wallet")
@Controller("wallet")
export class WalletController {
  constructor(private svc: WalletService) {}

  /** HOLDER-only: balances and linked addresses are financial data. */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Get(":did") getBalance(@Param("did") did: string) { return this.svc.getBalance(did); }

  /** HOLDER-only: the subject DID is in the body, so it is checked here. */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Post("link")
  link(
    @Body(new ZodValidationPipe(linkBodySchema)) body: LinkBodyDto,
    @Principal() principal: UridPrincipal,
  ) {
    if (body.researcherDid !== principal.did) {
      throw new ForbiddenException(
        "Cannot link a wallet to another researcher",
      );
    }
    return this.svc.linkWallet(body);
  }

  /** HOLDER-only: transaction history is financial data. */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Get(":did/transactions") transactions(@Param("did") did: string) { return this.svc.getTransactions(did); }
}
