/**
 * did-auth.guard.ts — holder authentication.
 *
 * Establishes that the caller controls the private key of a REGISTERED
 * researcher, and that they are acting on their own resources.
 *
 * Two distinct checks, easily conflated:
 *
 *   Authentication — the signature is valid for the DID's public key. Because
 *     did:ub is self-certifying this alone proves only "someone holds the key
 *     for this identifier"; anyone can generate a keypair and derive a DID. So
 *     the guard additionally requires the DID to resolve to a Researcher row
 *     whose stored publicKey matches the one encoded in the DID.
 *
 *   Authorisation — when the route carries a :did parameter, it must be the
 *     authenticated principal's own DID. Without this, a valid signature from
 *     researcher A would authorise writes to researcher B's profile, recovery
 *     shards, or wallet. Routes that key off a resource id instead (a proof id,
 *     a credential id) cannot be checked here and enforce ownership in the
 *     service, using the principal this guard attaches.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { DidSigVerifier } from './did-sig.verifier';

/** The authenticated caller, attached to the request for downstream handlers. */
export interface UridPrincipal {
  did: string;
  researcherId: string;
  publicKeyHex: string;
}

/** Request property the principal is attached to. */
export const PRINCIPAL_KEY = 'uridPrincipal';

@Injectable()
export class DidAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: DidSigVerifier,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // 1. Authenticate the signature.
    const signer = await this.verifier.verify(req);

    // 2. Bind the DID to a registered researcher. A self-certifying DID proves
    //    key possession, not that an account exists.
    const researcher = await this.prisma.researcher.findUnique({
      where: { did: signer.did },
    });
    if (!researcher) {
      throw new UnauthorizedException('DID is not a registered researcher');
    }

    // 3. Cross-check the stored key against the one the DID encodes. These should
    //    always agree; if they ever diverge (tampered row, botched migration) the
    //    safe reading is that the row is untrustworthy, not that the DID wins.
    if (
      !researcher.publicKey ||
      researcher.publicKey.toLowerCase() !== signer.publicKeyHex
    ) {
      throw new UnauthorizedException(
        'DID does not match the registered public key for this researcher',
      );
    }

    const principal: UridPrincipal = {
      did: signer.did,
      researcherId: researcher.id,
      publicKeyHex: signer.publicKeyHex,
    };
    req[PRINCIPAL_KEY] = principal;

    // 4. Authorise :did routes against the principal.
    const routeDid = req.params?.did;
    if (typeof routeDid === 'string' && routeDid !== principal.did) {
      throw new ForbiddenException(
        'Authenticated DID does not match the DID in the request path',
      );
    }

    return true;
  }
}
