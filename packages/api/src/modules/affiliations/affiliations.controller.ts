import { Controller, Get, Post, Param, Body } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { AffiliationsService } from "./affiliations.service";
@ApiTags("Affiliations")
@Controller("affiliations")
export class AffiliationsController {
  constructor(private svc: AffiliationsService) {}
  @Get(":did") list(@Param("did") did: string) { return this.svc.list(did); }
  @Post("request") request(@Body() body: { researcherDid: string; organizationName: string; role: string }) { return this.svc.request(body); }
  @Post(":id/approve") approve(@Param("id") id: string) { return this.svc.approve(id); }
  @Post(":id/revoke") revoke(@Param("id") id: string) { return this.svc.revoke(id); }
}
