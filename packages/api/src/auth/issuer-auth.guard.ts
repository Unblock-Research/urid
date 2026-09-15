/**
 * issuer-auth.guard.ts — issuer authentication.
 *
 * Guards the operations that speak with the platform's authority rather than a
 * holder's: minting credentials, revoking them, and approving affiliations.
 *
 * WHY THIS IS NOT DidAuthGuard:
 *   Holder authentication would be actively wrong here. A researcher proving
 *   control of their own key must not thereby be able to mint themselves a
 *   Ph.D. — the whole value of an issuer-signed credential is that the subject
 *   did not issue it. Issuance authority therefore comes from the trusted issuer
 *   registry, the same set CredentialsService.verifyCredential() checks against,
 *   so the key that may mint and the key whose signatures are accepted are one
 *   decision rather than two that can drift.
 */

import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';

import { IssuerRegistryService } from '../crypto/issuer-registry.service';
import { DidSigVerifier } from './did-sig.verifier';

/** The authenticated issuer, attached to the request. */
export interface UridIssuerPrincipal {
  did: string;
  publicKeyHex: string;
  isIssuer: true;
}

/** Request property the issuer principal is attached to. */
export const ISSUER_PRINCIPAL_KEY = 'uridIssuerPrincipal';

@Injectable()
export class IssuerAuthGuard implements CanActivate {
  constructor(
    private readonly verifier: DidSigVerifier,
    private readonly issuerRegistry: IssuerRegistryService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest();

    // Same signature verification as holder auth — only the authority check differs.
    const signer = await this.verifier.verify(req);

    if (!this.issuerRegistry.isTrusted(signer.publicKeyHex)) {
      throw new ForbiddenException(
        'Signing key is not a trusted issuer for this deployment',
      );
    }

    const principal: UridIssuerPrincipal = {
      did: signer.did,
      publicKeyHex: signer.publicKeyHex,
      isIssuer: true,
    };
    req[ISSUER_PRINCIPAL_KEY] = principal;

    return true;
  }
}
