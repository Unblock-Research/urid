import { Module } from "@nestjs/common";
import { ImpactController } from "./impact.controller";
import { ImpactService } from "./impact.service";
import { PrismaService } from "../../prisma/prisma.service";
@Module({ controllers: [ImpactController], providers: [ImpactService, PrismaService], exports: [ImpactService] })
export class ImpactModule {}
