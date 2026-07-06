import { Module } from "@nestjs/common";
import { ZkProofsController } from "./zk-proofs.controller";
import { ZkProofsService } from "./zk-proofs.service";
import { PrismaService } from "../../prisma/prisma.service";
@Module({ controllers: [ZkProofsController], providers: [ZkProofsService, PrismaService], exports: [ZkProofsService] })
export class ZkProofsModule {}
