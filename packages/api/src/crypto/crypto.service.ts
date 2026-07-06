/**
 * CryptoService — injectable NestJS service aggregating all crypto primitives.
 *
 * Delegates to the standalone ed25519, did, and merkle helper modules so that
 * every downstream phase (identity, credentials, zk-proofs, recovery) has a
 * single DI entry point for all cryptographic operations.
 *
 * OnModuleInit pre-warms the Poseidon and base58btc instances so the first
 * real request does not pay the lazy-init cost.
 */

import { Injectable, OnModuleInit } from '@nestjs/common';

import {
  generateKeypair,
  sign,
  verify,
  type Keypair,
} from './ed25519';

import {
  buildMerkleTree,
  generateInclusionProof,
  verifyInclusionProof,
  type MerkleTree,
  type InclusionProof,
} from './merkle';

import { encodeDid, decodeDid } from './did';

@Injectable()
export class CryptoService implements OnModuleInit {
  /**
   * Pre-warm Poseidon and base58btc on module start so the first API call
   * does not pay the lazy-init cost (~50–100 ms each).
   */
  async onModuleInit(): Promise<void> {
    // Warm Poseidon by building a trivial 1-leaf tree (discarded immediately)
    await buildMerkleTree([BigInt(0)]);
    // Warm base58btc by encoding then discarding a zero-filled 32-byte key
    const zeroKey = new Uint8Array(32);
    await encodeDid(zeroKey);
  }

  // ── Ed25519 ──────────────────────────────────────────────────────────────

  /** Generate a fresh Ed25519 keypair. */
  async generateKeypair(): Promise<Keypair> {
    return generateKeypair();
  }

  /**
   * Sign a message with an Ed25519 private key.
   * Returns the 64-byte signature.
   */
  async sign(message: Uint8Array, privateKey: Uint8Array): Promise<Uint8Array> {
    return sign(message, privateKey);
  }

  /**
   * Verify an Ed25519 signature.
   * Returns true only when the signature was produced by the private key
   * corresponding to publicKey over the exact message bytes.
   */
  async verify(
    signature: Uint8Array,
    message: Uint8Array,
    publicKey: Uint8Array,
  ): Promise<boolean> {
    return verify(signature, message, publicKey);
  }

  // ── Poseidon Merkle ──────────────────────────────────────────────────────

  /**
   * Build a binary Poseidon Merkle tree from an array of leaf values.
   * Each leaf must be a BN254 field-range BigInt.
   */
  async buildMerkleTree(leaves: bigint[]): Promise<MerkleTree> {
    return buildMerkleTree(leaves);
  }

  /**
   * Generate an inclusion proof for the leaf at `leafIndex` in the given tree.
   * The proof is compatible with circomlib's MerkleProof template.
   */
  generateInclusionProof(tree: MerkleTree, leafIndex: number): InclusionProof {
    return generateInclusionProof(tree, leafIndex);
  }

  /**
   * Verify an inclusion proof against the given Merkle root.
   * Returns true if and only if the leaf is a member of the tree with that root.
   */
  async verifyInclusionProof(
    leaf: string,
    proof: InclusionProof,
    root: string,
  ): Promise<boolean> {
    return verifyInclusionProof(leaf, proof, root);
  }

  // ── did:ub ───────────────────────────────────────────────────────────────

  /**
   * Encode a 32-byte Ed25519 public key as a did:ub DID string.
   * Returns "did:ub:z6Mk…"
   */
  async encodeDid(publicKey: Uint8Array): Promise<string> {
    return encodeDid(publicKey);
  }

  /**
   * Decode a did:ub DID string back to its 32-byte Ed25519 public key.
   * Throws if the DID is malformed or the multicodec header is wrong.
   */
  async decodeDid(did: string): Promise<Uint8Array> {
    return decodeDid(did);
  }
}
