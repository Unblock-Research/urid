/**
 * ledger.module.ts — NestJS module wiring the LedgerService DI token.
 *
 * NOT @Global — consumers must import LedgerModule explicitly so the
 * dependency is visible in each feature module's imports array.
 *
 * Binding:
 *   { provide: LedgerService, useClass: LocalLedgerService }
 *
 * Feature modules should inject the abstract LedgerService token, never
 * LocalLedgerService directly, so the underlying implementation remains
 * swappable (Sui/EVM swap deferred to CHN-01).
 */

import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';
import { LocalLedgerService } from './local-ledger.service';
import { PrismaService } from '../prisma/prisma.service';

@Module({
  providers: [
    PrismaService,
    {
      provide: LedgerService,
      useClass: LocalLedgerService,
    },
  ],
  exports: [LedgerService],
})
export class LedgerModule {}
