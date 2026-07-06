import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { CredentialsService } from "./credentials.service";

@ApiTags("Credentials")
@Controller("credentials")
export class CredentialsController {
  constructor(private svc: CredentialsService) {}

  @Post("mint")
  mint(@Body() body: { researcherDid: string; credentialType: string; title: string; issuer: string; tone?: string }) {
    return this.svc.mint(body);
  }

  @Get(":did")
  list(@Param("did") did: string) { return this.svc.listByDid(did); }

  @Post(":id/revoke")
  revoke(@Param("id") id: string) { return this.svc.revoke(id); }
}
