import { Module } from "@nestjs/common";
import { ZkProofsController } from "./zk-proofs.controller";
import { ZkProofsService } from "./zk-proofs.service";
import { ProverPool } from "./prover.pool";
import { PrismaService } from "../../prisma/prisma.service";

@Module({
  controllers: [ZkProofsController],
  providers: [ZkProofsService, ProverPool, PrismaService],
  exports: [ZkProofsService],
})
export class ZkProofsModule {}
