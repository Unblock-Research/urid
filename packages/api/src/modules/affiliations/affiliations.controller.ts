import { Controller, Get, Post, Param, Body, ForbiddenException, UseGuards } from "@nestjs/common";
import { ApiTags, ApiSecurity } from "@nestjs/swagger";
import { DidAuthGuard, type UridPrincipal } from "../../auth/did-auth.guard";
import { IssuerAuthGuard } from "../../auth/issuer-auth.guard";
import { Principal } from "../../auth/principal.decorator";
import { AffiliationsService } from "./affiliations.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { requestBodySchema, RequestBodyDto } from "./affiliations.dto";

@ApiTags("Affiliations")
@Controller("affiliations")
export class AffiliationsController {
  constructor(private svc: AffiliationsService) {}

  /** PUBLIC: affiliations are a public claim about where someone works. */
  @Get(":did") list(@Param("did") did: string) { return this.svc.list(did); }

  /**
   * HOLDER-only: you may only request an affiliation for yourself. The subject
   * DID is in the body, so the guard cannot check it from the route.
   */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Post("request")
  request(
    @Body(new ZodValidationPipe(requestBodySchema)) body: RequestBodyDto,
    @Principal() principal: UridPrincipal,
  ) {
    if (body.researcherDid !== principal.did) {
      throw new ForbiddenException(
        "Cannot request an affiliation for another researcher",
      );
    }
    return this.svc.request(body);
  }

  /**
   * ISSUER-only. Approval is the institution attesting to the affiliation — if
   * the holder could approve their own request the record would assert nothing.
   */
  @UseGuards(IssuerAuthGuard)
  @ApiSecurity("DIDSig")
  @Post(":id/approve") approve(@Param("id") id: string) { return this.svc.approve(id); }

  /** ISSUER-only: withdrawing an attestation is the issuer's decision. */
  @UseGuards(IssuerAuthGuard)
  @ApiSecurity("DIDSig")
  @Post(":id/revoke") revoke(@Param("id") id: string) { return this.svc.revoke(id); }
}
