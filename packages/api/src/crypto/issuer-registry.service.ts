/**
 * IssuerRegistryService — the set of issuer public keys this deployment trusts.
 *
 * WHY THIS EXISTS (critical finding #5):
 *   `CredentialsService.verifyCredential()` used to verify a credential's issuer
 *   signature against `sbt.issuerPublicKey` — a value stored on the very row being
 *   verified. That check is circular: anyone who can write the row can re-sign the
 *   tampered claims with their own key, store their own public key alongside, and
 *   the signature verifies. It proved the row was internally consistent, never that
 *   a trusted issuer vouched for it.
 *
 *   Verification must therefore answer two separate questions:
 *     1. Is the signature valid for the key on the row?   (CryptoService.verify)
 *     2. Is that key one we actually trust?               (this service)
 *   Both must hold. This service owns question 2.
 *
 * CONFIGURATION:
 *   TRUSTED_ISSUER_KEYS — comma-separated list of 64-char hex Ed25519 public keys.
 *     When set, it is the complete allowlist: the locally-held issuer key is NOT
 *     auto-trusted, because silently widening an explicit allowlist would defeat
 *     the point of configuring one. A boot-time warning fires if the local issuer
 *     key is absent from the list, since minting would then produce credentials
 *     this deployment cannot verify.
 *   When unset, the allowlist defaults to the single live IssuerKeyService key,
 *     which keeps local development working without configuration.
 *
 * Comparison is on lowercase hex so casing never decides a trust outcome.
 *
 * INITIALISATION ORDER:
 *   Nest invokes every provider's onModuleInit concurrently (Promise.all), so this
 *   service cannot read IssuerKeyService's public key from its own hook — the key
 *   may still be generating. onModuleInit therefore only validates and parses the
 *   env allowlist (which needs nothing else); the default-to-local-key path resolves
 *   lazily on first use, by which time boot has completed.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';

import { IssuerKeyService } from './issuer-key.service';

/** Env var holding the explicit issuer allowlist. */
export const TRUSTED_ISSUER_KEYS_ENV = 'TRUSTED_ISSUER_KEYS';

@Injectable()
export class IssuerRegistryService implements OnModuleInit {
  private readonly logger = new Logger(IssuerRegistryService.name);

  /**
   * Lowercase hex public keys this deployment accepts as credential issuers.
   * `null` until resolved — see resolve().
   */
  private trusted: Set<string> | null = null;

  /** True when the set came from TRUSTED_ISSUER_KEYS rather than the local default. */
  private explicitlyConfigured = false;

  /** Guards the one-time "local key missing from allowlist" warning. */
  private warnedLocalKeyMissing = false;

  constructor(private readonly issuerKey: IssuerKeyService) {}

  /**
   * Validate and parse the env allowlist.
   *
   * Deliberately does NOT touch IssuerKeyService: sibling onModuleInit hooks run
   * concurrently, so the issuer keypair may not exist yet. A malformed env value
   * still fails fast here, at boot, rather than at first verification.
   */
  onModuleInit(): void {
    const raw = process.env[TRUSTED_ISSUER_KEYS_ENV];

    if (raw === undefined || raw.trim() === '') {
      // Defer to the local issuer key, resolved lazily on first use.
      this.trusted = null;
      this.explicitlyConfigured = false;
      this.logger.log(
        `IssuerRegistryService: ${TRUSTED_ISSUER_KEYS_ENV} not set — defaulting to the local issuer key only.`,
      );
      return;
    }

    const entries = raw
      .split(',')
      .map((e) => e.trim())
      .filter((e) => e !== '');

    const malformed = entries.filter((e) => !/^[0-9a-fA-F]{64}$/.test(e));
    if (malformed.length > 0) {
      throw new Error(
        `IssuerRegistryService: ${TRUSTED_ISSUER_KEYS_ENV} contains ${malformed.length} ` +
          `malformed entr${malformed.length === 1 ? 'y' : 'ies'} — every key must be exactly ` +
          `64 hex characters (32-byte Ed25519 public key).`,
      );
    }

    this.trusted = new Set(entries.map((e) => e.toLowerCase()));
    this.explicitlyConfigured = true;
    this.logger.log(
      `IssuerRegistryService: trusting ${this.trusted.size} issuer key(s) from ${TRUSTED_ISSUER_KEYS_ENV}.`,
    );
  }

  /**
   * The resolved trusted set.
   *
   * With an explicit allowlist this is fixed at boot. Without one it is derived
   * from the live issuer key on first call and memoised.
   */
  private resolve(): Set<string> {
    if (this.trusted !== null) return this.trusted;
    this.trusted = new Set([this.issuerKey.getPublicKeyHex().toLowerCase()]);
    return this.trusted;
  }

  /**
   * Is `publicKeyHex` an issuer this deployment trusts?
   *
   * Fails closed: anything malformed, empty, or absent from the set is untrusted.
   */
  isTrusted(publicKeyHex: string | null | undefined): boolean {
    if (typeof publicKeyHex !== 'string') return false;
    const normalised = publicKeyHex.trim().toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(normalised)) return false;

    const trusted = this.resolve();

    // One-time operational warning: an explicit allowlist that omits the key this
    // instance mints with means locally-issued credentials will never verify here.
    if (this.explicitlyConfigured && !this.warnedLocalKeyMissing) {
      this.warnedLocalKeyMissing = true;
      try {
        const localKey = this.issuerKey.getPublicKeyHex().toLowerCase();
        if (!trusted.has(localKey)) {
          this.logger.warn(
            `IssuerRegistryService: the local issuer key is NOT in ${TRUSTED_ISSUER_KEYS_ENV}. ` +
              `Credentials minted by this instance will fail verification here. ` +
              `Add ${localKey} to the allowlist if that is not intended.`,
          );
        }
      } catch {
        // Issuer key not ready — the warning is advisory, never a failure path.
      }
    }

    return trusted.has(normalised);
  }

  /** The trusted keys, lowercase hex. Safe to log — public keys only. */
  listTrusted(): string[] {
    return [...this.resolve()];
  }

  /** True when the allowlist was configured via env rather than defaulted. */
  isExplicitlyConfigured(): boolean {
    return this.explicitlyConfigured;
  }
}
