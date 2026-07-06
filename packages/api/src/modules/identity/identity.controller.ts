import { Controller, Get, Post, Put, Param, Body, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IdentityService } from "./identity.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  registerBodySchema,
  updateBodySchema,
  setupRecoveryBodySchema,
  reconstructBodySchema,
  RegisterBody,
  UpdateBody,
  SetupRecoveryBody,
  ReconstructBody,
} from "./identity.dto";

@ApiTags("Identity")
@Controller("identity")
export class IdentityController {
  constructor(private svc: IdentityService) {}

  @Post("register")
  register(
    @Body(new ZodValidationPipe(registerBodySchema)) body: RegisterBody,
  ) {
    return this.svc.register(body);
  }

  @Get("check-handle")
  checkHandle(@Query("handle") handle: string) {
    return this.svc.checkHandleAvailability(handle);
  }

  @Get("did/:did")
  getByDid(@Param("did") did: string) {
    return this.svc.getByDid(did);
  }

  @Get("handle/:handle")
  getByHandle(@Param("handle") handle: string) {
    return this.svc.getByHandle(handle);
  }

  @Put("did/:did")
  update(
    @Param("did") did: string,
    @Body(new ZodValidationPipe(updateBodySchema)) body: UpdateBody,
  ) {
    return this.svc.update(did, body);
  }

  /**
   * POST identity/did/:did/recovery
   *
   * Set up T-of-N Shamir social recovery for a researcher.
   * Body: { guardians: { name, kind }[], secret?: string, threshold?: number }
   *
   * Returns per-guardian recovery kits (AES key + shardIndex) and a
   * verification tag.  Recovery kits must be delivered to guardians
   * out-of-band — they are shown only once.
   */
  @Post("did/:did/recovery")
  setupRecovery(
    @Param("did") did: string,
    @Body(new ZodValidationPipe(setupRecoveryBodySchema))
    body: SetupRecoveryBody,
  ) {
    return this.svc.setupRecovery(did, body.guardians, body.secret, body.threshold);
  }

  /**
   * GET identity/did/:did/recovery
   *
   * Returns the recovery status for a researcher — safe projection only
   * (guardianName, guardianKind, status, shardIndex, threshold).
   * Never returns encryptedShard or any plaintext material.
   */
  @Get("did/:did/recovery")
  getRecovery(@Param("did") did: string) {
    return this.svc.getRecoveryStatus(did);
  }

  /**
   * POST identity/did/:did/recovery/reconstruct
   *
   * Reconstruct the recovery secret from >=T guardian submissions.
   * Body: { submissions: { shardIndex: number; key: string }[] }
   *
   * Each submission provides the guardian's shardIndex and the AES key
   * they were given at setup.  Returns success + secret when >=T shares
   * are valid; returns failure (no secret bytes) when fewer are valid or
   * a key is wrong/garbled.
   */
  @Post("did/:did/recovery/reconstruct")
  reconstruct(
    @Param("did") did: string,
    @Body(new ZodValidationPipe(reconstructBodySchema)) body: ReconstructBody,
  ) {
    return this.svc.recover(did, body.submissions);
  }
}
