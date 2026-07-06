/**
 * Ed25519 keygen / sign / verify primitives.
 *
 * Uses @noble/ed25519 v2 which requires an explicit SHA-512 hook from
 * @noble/hashes. The hook is wired once at module load so callers never
 * have to think about it.
 */

import * as ed from '@noble/ed25519';
import { sha512 } from '@noble/hashes/sha512';

// Wire the SHA-512 hook required by @noble/ed25519 v2.
// Without this, sign/verify throw "etc.sha512 must be set" at runtime.
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));
ed.etc.sha512Async = (...msgs) => Promise.resolve(ed.etc.sha512Sync!(...msgs));

export interface Keypair {
  publicKey: Uint8Array;
  privateKey: Uint8Array;
}

/**
 * Generate a fresh Ed25519 keypair.
 * Returns { publicKey: 32 bytes, privateKey: 32 bytes }.
 */
export async function generateKeypair(): Promise<Keypair> {
  const privateKey = ed.utils.randomPrivateKey();          // 32 bytes
  const publicKey = await ed.getPublicKeyAsync(privateKey); // 32 bytes
  return { publicKey, privateKey };
}

/**
 * Sign a message with an Ed25519 private key.
 * Returns the 64-byte signature.
 */
export async function sign(
  message: Uint8Array,
  privateKey: Uint8Array,
): Promise<Uint8Array> {
  return ed.signAsync(message, privateKey);
}

/**
 * Verify an Ed25519 signature.
 * Returns true only when the signature was produced by the private key
 * corresponding to publicKey over the exact message bytes.
 */
export async function verify(
  signature: Uint8Array,
  message: Uint8Array,
  publicKey: Uint8Array,
): Promise<boolean> {
  try {
    return await ed.verifyAsync(signature, message, publicKey);
  } catch {
    // Noble throws on malformed inputs; treat as verification failure.
    return false;
  }
}
