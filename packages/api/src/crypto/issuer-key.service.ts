/**
 * IssuerKeyService — injectable, env-backed Ed25519 issuer key provider.
 *
 * Provides the single platform issuer keypair used to sign Merkle roots at
 * credential mint time.  The keypair is loaded once at module init from the
 * `ISSUER_PRIVATE_KEY` environment variable (64-char hex / 32 bytes); if the
 * variable is absent a fresh keypair is generated at boot and only the public
 * key is logged.
 *
 * Security contract (T-05-01):
 *   - The private key is held in a `private` field only.
 *   - No public method, getter, or log line ever returns or emits the private key.
 *   - `getPublicKeyHex()` and `sign()` are the only surfaces that interact with
 *     the private key; `getPublicKeyHex()` exposes only the public component.
 *   - The spec asserts that no method whose name suggests private-key access exists.
 *
 * CryptoModule registers and exports this service globally so that
 * CredentialsService in wave 2 can inject it without re-importing CryptoModule.
 */

import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { bytesToHex, hexToBytes } from '@noble/hashes/utils';
import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

import { CryptoService } from './crypto.service';

// Ensure the SHA-512 hook required by @noble/ed25519 v2 is always set,
// even if this service is instantiated before the main ed25519 module loads.
ed.etc.sha512Sync = (...msgs: Uint8Array[]) => sha512(ed.etc.concatBytes(...msgs));
ed.etc.sha512Async = (...msgs: Uint8Array[]) =>
  Promise.resolve(ed.etc.sha512Sync!(...msgs));

@Injectable()
export class IssuerKeyService implements OnModuleInit {
  private readonly logger = new Logger(IssuerKeyService.name);

  /** The issuer private key bytes (32 bytes).  NEVER logged or returned. */
  private issuerPrivateKey!: Uint8Array;

  /** The derived issuer public key bytes (32 bytes). */
  private issuerPublicKey!: Uint8Array;

  constructor(private readonly crypto: CryptoService) {}

  /**
   * Load or generate the issuer keypair.
   *
   * If `ISSUER_PRIVATE_KEY` is set: validate that it is exactly 64 lower/upper
   * hex characters (32 bytes), decode it, and derive the corresponding public
   * key.  Throws with a descriptive message naming the env var if validation
   * fails so operators see the exact problem immediately.
   *
   * If `ISSUER_PRIVATE_KEY` is unset: generate a fresh keypair via CryptoService
   * and emit a single `Logger.warn` that includes ONLY the public key hex plus
   * guidance to set the env var for a stable issuer identity across restarts.
   */
  async onModuleInit(): Promise<void> {
    const raw = process.env.ISSUER_PRIVATE_KEY;

    if (raw !== undefined) {
      // Validate: must be exactly 64 hex characters (32 bytes)
      if (!/^[0-9a-fA-F]{64}$/.test(raw)) {
        throw new Error(
          `IssuerKeyService: ISSUER_PRIVATE_KEY is malformed — ` +
            `expected exactly 64 hex characters (32 bytes), got "${raw.length}" characters. ` +
            `Provide a valid 32-byte hex-encoded Ed25519 private key.`,
        );
      }

      const privBytes = hexToBytes(raw);
      const pubBytes = ed.getPublicKey(privBytes);

      this.issuerPrivateKey = privBytes;
      this.issuerPublicKey = pubBytes;
    } else {
      // Generate a fresh ephemeral keypair and log ONLY the public key
      const keypair = await this.crypto.generateKeypair();
      this.issuerPrivateKey = keypair.privateKey;
      this.issuerPublicKey = keypair.publicKey;

      this.logger.warn(
        `IssuerKeyService: ISSUER_PRIVATE_KEY is not set — generated an ephemeral issuer keypair. ` +
          `This keypair is NOT persisted across restarts. ` +
          `Set ISSUER_PRIVATE_KEY=<your-32-byte-private-key-hex> to use a stable issuer identity. ` +
          `Ephemeral issuer public key (for reference only): ${bytesToHex(this.issuerPublicKey)}`,
      );
    }
  }

  /**
   * Return the issuer public key as a lowercase hex string (64 chars / 32 bytes).
   * Safe to log, store, and return in API responses.
   */
  getPublicKeyHex(): string {
    return bytesToHex(this.issuerPublicKey);
  }

  /**
   * Return the issuer public key as a raw Uint8Array (32 bytes).
   * Used for in-process Ed25519 signature verification.
   */
  getPublicKey(): Uint8Array {
    return this.issuerPublicKey;
  }

  /**
   * Sign `message` bytes with the issuer private key using Ed25519.
   * Returns the 64-byte signature.
   *
   * The private key is accessed inside CryptoService.sign and is never
   * passed out of this module or included in any return value.
   */
  async sign(message: Uint8Array): Promise<Uint8Array> {
    return this.crypto.sign(message, this.issuerPrivateKey);
  }
}
