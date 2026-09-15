/**
 * did-sig.verifier.ts — the shared signature-checking core for both guards.
 *
 * Holder auth and issuer auth differ only in WHO the signing key must belong to:
 * a registered researcher, or a trusted issuer. Everything before that — parsing,
 * freshness, signature verification, replay — is identical, and is done here once
 * so the two guards cannot drift apart on the parts that matter.
 *
 * Verification order is deliberate. Cheap, purely local checks (shape, clock)
 * run before the Ed25519 verification, and the nonce is claimed only AFTER the
 * signature is known to be good — otherwise anyone could burn an honest client's
 * nonces with unsigned garbage.
 */

import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { bytesToHex } from '@noble/hashes/utils';

import { CryptoService } from '../crypto/crypto.service';
import { NonceService } from './nonce.service';
import {
  DEFAULT_MAX_SKEW_SECONDS,
  buildSignedMessage,
  isTimestampFresh,
  parseDidSigHeader,
  sha256Hex,
} from './did-sig';

/** A request that carried a valid DIDSig signature. */
export interface VerifiedSigner {
  /** The DID that signed the request. */
  did: string;
  /** The Ed25519 public key that DID resolves to, lowercase hex. */
  publicKeyHex: string;
}

/** The subset of an Express request the verifier needs. */
export interface SignableRequest {
  method?: string;
  originalUrl?: string;
  url?: string;
  headers?: Record<string, unknown>;
  rawBody?: Buffer | Uint8Array;
}

@Injectable()
export class DidSigVerifier {
  private readonly logger = new Logger(DidSigVerifier.name);

  constructor(
    private readonly crypto: CryptoService,
    private readonly nonces: NonceService,
  ) {}

  /**
   * Verify the DIDSig header on `req`, returning the signer on success.
   *
   * Throws UnauthorizedException on every failure. The message names the stage
   * that failed but never echoes header content back — that would turn the
   * endpoint into an oracle for probing.
   */
  async verify(
    req: SignableRequest,
    maxSkewSeconds: number = DEFAULT_MAX_SKEW_SECONDS,
  ): Promise<VerifiedSigner> {
    // 1. Shape
    const authHeader = req.headers?.authorization as string | undefined;
    const parsed = parseDidSigHeader(authHeader);
    if (parsed.ok !== true) {
      // Note: destructured rather than narrowed — this package compiles with
      // `strict: false`, where discriminated-union narrowing is unreliable.
      const error = (parsed as { error: string }).error;
      throw new UnauthorizedException(
        error === 'missing'
          ? 'Missing Authorization header (expected DIDSig)'
          : 'Malformed DIDSig Authorization header',
      );
    }
    const { did, ts, nonce, signature } = (
      parsed as { value: import('./did-sig').DidSigHeader }
    ).value;

    // 2. Freshness — before any crypto, so a stale request costs nothing.
    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!isTimestampFresh(ts, nowSeconds, maxSkewSeconds)) {
      throw new UnauthorizedException(
        `Request timestamp outside the ${maxSkewSeconds}s freshness window`,
      );
    }

    // 3. Resolve the DID to its public key. did:ub is self-certifying: the key
    //    is encoded in the identifier itself, so this cannot be spoofed — but it
    //    also means anyone can mint a DID. Binding it to an account is the
    //    caller's job (see DidAuthGuard / IssuerAuthGuard).
    let publicKey: Uint8Array;
    try {
      publicKey = await this.crypto.decodeDid(did);
    } catch {
      throw new UnauthorizedException('Unresolvable DID in Authorization header');
    }

    // 4. Signature over the canonical message
    const method = (req.method ?? 'GET').toUpperCase();
    const path = req.originalUrl ?? req.url ?? '';
    const message = buildSignedMessage(
      method,
      path,
      sha256Hex(req.rawBody),
      ts,
      nonce,
    );

    const signatureValid = await this.crypto.verify(signature, message, publicKey);
    if (!signatureValid) {
      throw new UnauthorizedException('Invalid request signature');
    }

    // 5. Replay — claimed last, so only genuine signatures consume a nonce.
    //    Expiry matches the freshness window: once the timestamp check would
    //    reject the request anyway, the nonce row has no further purpose.
    const expiresAt = new Date((ts + maxSkewSeconds) * 1000);
    const claimed = await this.nonces.claim(did, nonce, expiresAt);
    if (!claimed) {
      throw new UnauthorizedException('Replayed nonce');
    }

    return { did, publicKeyHex: bytesToHex(publicKey).toLowerCase() };
  }
}
