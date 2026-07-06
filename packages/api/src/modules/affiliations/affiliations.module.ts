import { Module } from "@nestjs/common";
import { AffiliationsController } from "./affiliations.controller";
import { AffiliationsService } from "./affiliations.service";
import { PrismaService } from "../../prisma/prisma.service";
@Module({ controllers: [AffiliationsController], providers: [AffiliationsService, PrismaService], exports: [AffiliationsService] })
export class AffiliationsModule {}
