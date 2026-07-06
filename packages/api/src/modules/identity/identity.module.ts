import { Module } from "@nestjs/common";
import { IdentityController } from "./identity.controller";
import { IdentityService } from "./identity.service";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerModule } from "../../ledger/ledger.module";

@Module({
  imports: [LedgerModule],
  controllers: [IdentityController],
  providers: [IdentityService, PrismaService],
  exports: [IdentityService],
})
export class IdentityModule {}
