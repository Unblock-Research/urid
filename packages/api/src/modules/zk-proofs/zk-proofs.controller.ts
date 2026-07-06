import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZkProofsService } from "./zk-proofs.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { proveBodySchema, verifyBodySchema, ProveBody, VerifyBody } from "./zk-proofs.dto";

@ApiTags("ZK Proofs")
@Controller("zk")
export class ZkProofsController {
  constructor(private svc: ZkProofsService) {}

  /**
   * Generate a Groth16 disclosure proof for a single claim of a credential.
   *
   * Body: credentialId + disclosedClaimName + appName + consentWindow required.
   * threshold and predicateEnabled are optional (default off).
   */
  @Post("prove")
  prove(
    @Body(new ZodValidationPipe(proveBodySchema))
    body: ProveBody,
  ) {
    return this.svc.prove(body);
  }

  @Post("verify")
  verify(
    @Body(new ZodValidationPipe(verifyBodySchema)) body: VerifyBody,
  ) {
    return this.svc.verify(body.proofHash);
  }

  @Get(":did/active")
  listActive(@Param("did") did: string) {
    return this.svc.listActive(did);
  }

  @Post(":id/revoke")
  revoke(@Param("id") id: string) {
    return this.svc.revoke(id);
  }

  @Get(":did/audit")
  audit(@Param("did") did: string) {
    return this.svc.getAuditLog(did);
  }
}
