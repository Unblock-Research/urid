import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiSecurity } from "@nestjs/swagger";
import { IssuerAuthGuard } from "../../auth/issuer-auth.guard";
import { CredentialsService } from "./credentials.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { mintBodySchema, MintBody } from "./credentials.dto";

@ApiTags("Credentials")
@Controller("credentials")
export class CredentialsController {
  constructor(private svc: CredentialsService) {}

  /**
   * ISSUER-only. Deliberately not holder-authenticated: a researcher proving
   * control of their own key must not be able to mint themselves a credential —
   * an issuer-signed credential is worth something precisely because the subject
   * did not issue it.
   */
  @UseGuards(IssuerAuthGuard)
  @ApiSecurity("DIDSig")
  @Post("mint")
  mint(
    @Body(new ZodValidationPipe(mintBodySchema))
    body: MintBody,
  ) {
    return this.svc.mint(body);
  }

  /**
   * GET credentials/:id/verify
   *
   * Independently verify that the stored credential identified by `:id` has not
   * been tampered with and that its issuer signature is valid.
   *
   * Note: the two-segment path `/:id/verify` does NOT shadow the existing
   * single-segment `@Get(":did")` route — NestJS resolves by specificity.
   *
   * Returns: { id: string, valid: boolean }
   */
  @Get(":id/verify")
  async verify(@Param("id") id: string) {
    const { valid } = await this.svc.verifyCredential(id);
    return { id, valid };
  }

  /** PUBLIC: a holder's non-revoked credentials are meant to be presentable. */
  @Get(":did")
  list(@Param("did") did: string) {
    return this.svc.listByDid(did);
  }

  /** ISSUER-only: revocation is the issuer withdrawing its own attestation. */
  @UseGuards(IssuerAuthGuard)
  @ApiSecurity("DIDSig")
  @Post(":id/revoke")
  revoke(@Param("id") id: string) {
    return this.svc.revoke(id);
  }
}
