/**
 * auth.module.ts — global module providing DIDSig authentication.
 *
 * @Global because guards are referenced by class in @UseGuards() across every
 * feature module; without it each would need to import AuthModule just to have
 * the guard's dependencies resolvable.
 *
 * CryptoModule is itself @Global, so CryptoService and IssuerRegistryService are
 * already injectable here without an explicit import.
 */

import { Global, Module } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { DidAuthGuard } from './did-auth.guard';
import { DidSigVerifier } from './did-sig.verifier';
import { IssuerAuthGuard } from './issuer-auth.guard';
import { NonceService } from './nonce.service';

@Global()
@Module({
  providers: [
    PrismaService,
    NonceService,
    DidSigVerifier,
    DidAuthGuard,
    IssuerAuthGuard,
  ],
  exports: [NonceService, DidSigVerifier, DidAuthGuard, IssuerAuthGuard],
})
export class AuthModule {}
