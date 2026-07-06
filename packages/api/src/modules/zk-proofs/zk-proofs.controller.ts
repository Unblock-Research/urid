import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ZkProofsService } from "./zk-proofs.service";

@ApiTags("ZK Proofs")
@Controller("zk")
export class ZkProofsController {
  constructor(private svc: ZkProofsService) {}

  /**
   * Generate a Groth16 disclosure proof for a single claim of a credential.
   *
   * Body: credentialId + disclosedClaimName are required.
   * threshold and predicateEnabled are optional (default off).
   * Phase 8 will add Zod DTO validation.
   */
  @Post("prove")
  prove(
    @Body()
    body: {
      credentialId: string;
      disclosedClaimName: string;
      appName: string;
      consentWindow: string;
      threshold?: string;
      predicateEnabled?: boolean;
    },
  ) {
    return this.svc.prove(body);
  }

  @Post("verify")
  verify(@Body() body: { proofHash: string }) {
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
