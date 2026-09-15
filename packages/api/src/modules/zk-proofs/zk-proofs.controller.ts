import { Controller, Get, Post, Param, Body, UseGuards } from "@nestjs/common";
import { ApiTags, ApiSecurity } from "@nestjs/swagger";
import { ZkProofsService } from "./zk-proofs.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { proveBodySchema, verifyBodySchema, ProveBody, VerifyBody } from "./zk-proofs.dto";
import { DidAuthGuard, type UridPrincipal } from "../../auth/did-auth.guard";
import { Principal } from "../../auth/principal.decorator";

@ApiTags("ZK Proofs")
@Controller("zk")
export class ZkProofsController {
  constructor(private svc: ZkProofsService) {}

  /**
   * Generate a Groth16 disclosure proof for a single claim of a credential.
   *
   * Body: credentialId + disclosedClaimName + appName + consentWindow required.
   * threshold and predicateEnabled are optional (default off).
   *
   * HOLDER-only. The credential is named by id rather than by :did, so the guard
   * cannot settle ownership from the path — the principal is passed through and
   * the service checks the credential belongs to the caller.
   */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Post("prove")
  prove(
    @Body(new ZodValidationPipe(proveBodySchema))
    body: ProveBody,
    @Principal() principal: UridPrincipal,
  ) {
    return this.svc.prove(body, principal.researcherId);
  }

  /**
   * PUBLIC: verification is the point of a proof — a relying party holding a
   * proofHash must be able to check it without an account. It returns only a
   * boolean and a reason, never claim values.
   */
  @Post("verify")
  verify(
    @Body(new ZodValidationPipe(verifyBodySchema)) body: VerifyBody,
  ) {
    return this.svc.verify(body.proofHash);
  }

  /** HOLDER-only: :did must be the authenticated principal (enforced by the guard). */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Get(":did/active")
  listActive(@Param("did") did: string) {
    return this.svc.listActive(did);
  }

  /** HOLDER-only: ownership is by proof id, so the service enforces it. */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Post(":id/revoke")
  revoke(@Param("id") id: string, @Principal() principal: UridPrincipal) {
    return this.svc.revoke(id, principal.researcherId);
  }

  /** HOLDER-only: the audit log records who proved what to whom. */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Get(":did/audit")
  audit(@Param("did") did: string) {
    return this.svc.getAuditLog(did);
  }
}
