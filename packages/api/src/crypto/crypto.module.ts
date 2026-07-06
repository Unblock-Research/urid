/**
 * CryptoModule — global NestJS module for all cryptographic primitives.
 *
 * Marked @Global() so that any feature module in the monorepo can inject
 * CryptoService or IssuerKeyService without needing to import CryptoModule
 * explicitly. The single registration in AppModule is sufficient for all
 * downstream phases (credentials, zk-proofs, recovery).
 *
 * Providers registered here:
 *   - CryptoService        — Ed25519 keygen/sign/verify, Poseidon Merkle, did:ub
 *   - IssuerKeyService     — env-backed Ed25519 issuer key provider (Phase 5+)
 */

import { Global, Module } from '@nestjs/common';
import { CryptoService } from './crypto.service';
import { IssuerKeyService } from './issuer-key.service';

@Global()
@Module({
  providers: [CryptoService, IssuerKeyService],
  exports: [CryptoService, IssuerKeyService],
})
export class CryptoModule {}
