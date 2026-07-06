/**
 * CryptoModule — global NestJS module for all cryptographic primitives.
 *
 * Marked @Global() so that any feature module in the monorepo can inject
 * CryptoService without needing to import CryptoModule explicitly. The single
 * registration in AppModule is sufficient for all downstream phases.
 */

import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';

@Global()
@Module({
  providers: [CryptoService],
  exports: [CryptoService],
})
export class CryptoModule {}
