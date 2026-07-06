import { Controller, Get, Post, Put, Param, Body, Query } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { IdentityService } from "./identity.service";

@ApiTags("Identity")
@Controller("identity")
export class IdentityController {
  constructor(private svc: IdentityService) {}

  @Post("register")
  register(@Body() body: { handle: string; displayName: string; did?: string }) {
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
  update(@Param("did") did: string, @Body() body: any) {
    return this.svc.update(did, body);
  }

  @Post("did/:did/recovery")
  setupRecovery(@Param("did") did: string, @Body() body: { guardians: { name: string; kind: string }[] }) {
    return this.svc.setupRecovery(did, body.guardians);
  }

  @Get("did/:did/recovery")
  getRecovery(@Param("did") did: string) {
    return this.svc.getRecoveryStatus(did);
  }
}
