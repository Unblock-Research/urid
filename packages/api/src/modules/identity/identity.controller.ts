import { Controller, Get, Post, Put, Param, Body, Query, UseGuards } from "@nestjs/common";
import { ApiTags, ApiSecurity } from "@nestjs/swagger";
import { DidAuthGuard } from "../../auth/did-auth.guard";
import { IdentityService } from "./identity.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import {
  registerBodySchema,
  updateBodySchema,
  setupRecoveryBodySchema,
  RegisterBody,
  UpdateBody,
  SetupRecoveryBody,
} from "./identity.dto";

@ApiTags("Identity")
@Controller("identity")
export class IdentityController {
  constructor(private svc: IdentityService) {}

  /** PUBLIC: bootstrapping — the caller has no key until this call returns one. */
  @Post("register")
  register(
    @Body(new ZodValidationPipe(registerBodySchema)) body: RegisterBody,
  ) {
    return this.svc.register(body);
  }

  /** PUBLIC: handle availability is not sensitive and is needed pre-registration. */
  @Get("check-handle")
  checkHandle(@Query("handle") handle: string) {
    return this.svc.checkHandleAvailability(handle);
  }

  /** PUBLIC: DID resolution. Sensitive relations are excluded in the service. */
  @Get("did/:did")
  getByDid(@Param("did") did: string) {
    return this.svc.getByDid(did);
  }

  /** PUBLIC: handle resolution. */
  @Get("handle/:handle")
  getByHandle(@Param("handle") handle: string) {
    return this.svc.getByHandle(handle);
  }

  /** Holder-only: overwrites profile fields, including the ORCID iD used for scoring. */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
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
   * Store a recovery setup the holder prepared locally. The body carries
   * ciphertexts only — the server never receives the secret, a plaintext share,
   * or a guardian key.
   *
   * HOLDER-authenticated: you still control your key when setting recovery up.
   * Guardian keys are returned to the holder by `prepareRecovery()` on their own
   * device and must be delivered out-of-band.
   */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Post("did/:did/recovery")
  setupRecovery(
    @Param("did") did: string,
    @Body(new ZodValidationPipe(setupRecoveryBodySchema))
    body: SetupRecoveryBody,
  ) {
    return this.svc.storeRecoverySetup(did, body);
  }

  /**
   * GET identity/did/:did/recovery
   *
   * Recovery status for the holder — safe metadata only (guardian name, kind,
   * status, shardIndex, threshold). Never returns ciphertext or key material.
   */
  @UseGuards(DidAuthGuard)
  @ApiSecurity("DIDSig")
  @Get("did/:did/recovery")
  getRecovery(@Param("did") did: string) {
    return this.svc.getRecoveryStatus(did);
  }

  /**
   * GET identity/did/:did/recovery/shards
   *
   * The stored ciphertexts, for the holder to reconstruct locally with
   * `reconstructSecret()` from crypto/recovery.ts.
   *
   * PUBLIC by necessity and by design. Recovery exists because the holder has
   * LOST their key, so requiring a DIDSig signature here would make the endpoint
   * useless for its only purpose — an earlier revision of this work did exactly
   * that. Authorisation instead comes from possessing `threshold` guardian keys,
   * without which these ciphertexts reveal nothing.
   *
   * There is deliberately no server-side reconstruct endpoint: the capability
   * was removed, not relocated.
   */
  @Get("did/:did/recovery/shards")
  getRecoveryShards(@Param("did") did: string) {
    return this.svc.getRecoveryShards(did);
  }
}
