import { Controller, Get, Post, Param } from "@nestjs/common";
import { ApiTags } from "@nestjs/swagger";
import { ImpactService } from "./impact.service";
import { ZodValidationPipe } from "../../common/zod-validation.pipe";
import { didParamSchema } from "./impact.dto";

@ApiTags("Impact")
@Controller("impact")
export class ImpactController {
  constructor(private svc: ImpactService) {}

  @Get(":did") getScore(@Param("did") did: string) { return this.svc.getScore(did); }

  @Post(":did/calculate")
  calculate(@Param("did", new ZodValidationPipe(didParamSchema)) did: string) {
    return this.svc.calculate(did);
  }

  @Get(":did/history") history(@Param("did") did: string) { return this.svc.getHistory(did); }
}
