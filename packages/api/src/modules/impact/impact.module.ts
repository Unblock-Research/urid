import { Module } from "@nestjs/common";
import { ImpactController } from "./impact.controller";
import { ImpactService } from "./impact.service";
import { PrismaService } from "../../prisma/prisma.service";
import { OrcidClient } from "./sources/orcid.client";
import { CrossrefClient } from "./sources/crossref.client";

// OrcidClient and CrossrefClient declare `constructor(http?: AxiosInstance)` so
// tests can inject a fake. AxiosInstance is a callable interface, so
// emitDecoratorMetadata records the parameter's design:paramtypes as `Function`,
// which Nest then tries — and fails — to resolve as a provider:
//
//   Nest can't resolve dependencies of the OrcidClient (?).
//
// Registering them via useFactory sidesteps constructor introspection entirely
// and preserves the intended behaviour: no argument means "build the real
// env-configured axios instance". This was a pre-existing startup failure; the
// unit tests construct both clients directly, so it never surfaced there.
@Module({
  controllers: [ImpactController],
  providers: [
    ImpactService,
    PrismaService,
    { provide: OrcidClient, useFactory: () => new OrcidClient() },
    { provide: CrossrefClient, useFactory: () => new CrossrefClient() },
  ],
  exports: [ImpactService],
})
export class ImpactModule {}
