import { Module } from "@nestjs/common";
import { ImpactController } from "./impact.controller";
import { ImpactService } from "./impact.service";
import { PrismaService } from "../../prisma/prisma.service";
import { OrcidClient } from "./sources/orcid.client";
import { CrossrefClient } from "./sources/crossref.client";

@Module({
  controllers: [ImpactController],
  providers: [ImpactService, PrismaService, OrcidClient, CrossrefClient],
  exports: [ImpactService],
})
export class ImpactModule {}
