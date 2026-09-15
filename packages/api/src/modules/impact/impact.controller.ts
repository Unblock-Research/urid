import { Controller, Get, Post, Param, UseGuards } from "@nestjs/common";
import { ApiTags, ApiSecurity } from "@nestjs/swagger";
import { DidAuthGuard } from "../../auth/did-auth.guard";
import { ImpactService } from "./impact.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { didParamSchema } from "./impact.dto";

@ApiTags("Impact")
@Controller("impact")
export class ImpactController {
  constructor(private svc: ImpactService) {}

  /** PUBLIC: an impact score is a reputation signal meant to be read by others. */
  @Get(":did") getScore(@Param("did") did: string) { return this.svc.getScore(did); }

  /**
   * HOLDER-only: recomputation triggers outbound ORCID/Crossref fetches, so an
   * open endpoint would let anyone drive traffic through this server.
   */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Post(":did/calculate")
  calculate(@Param("did", new ZodValidationPipe(didParamSchema)) did: string) {
    return this.svc.calculate(did);
  }

  /** PUBLIC: score history, same rationale as the current score. */
  @Get(":did/history") history(@Param("did") did: string) { return this.svc.getHistory(did); }
}
