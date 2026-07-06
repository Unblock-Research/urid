import { Module } from "@nestjs/common";
import { CredentialsController } from "./credentials.controller";
import { CredentialsService } from "./credentials.service";
import { PrismaService } from "../../prisma/prisma.service";
import { LedgerModule } from "../../ledger/ledger.module";

@Module({
  imports: [LedgerModule],
  controllers: [CredentialsController],
  providers: [CredentialsService, PrismaService],
  exports: [CredentialsService],
})
export class CredentialsModule {}
