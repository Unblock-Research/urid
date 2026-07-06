/**
 * CryptoService smoke tests.
 *
 * Exercises the aggregation wiring, not the underlying primitives themselves
 * (those are already covered by ed25519.spec.ts, did.spec.ts, merkle.spec.ts).
 *
 * Coverage:
 *   - Ed25519: sign/verify roundtrip (positive) + wrong-key negative
 *   - Poseidon Merkle: build tree → generate proof → verify membership (positive)
 *   - did:ub: encodeDid → decodeDid roundtrip preserves exact public key bytes
 *
 * Threat register coverage:
 *   - T-01-11: confirms CryptoService does not drop/alter primitive guarantees
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { CryptoService } from './crypto.service';

describe('CryptoService', () => {
  let service: CryptoService;

  beforeAll(async () => {
    service = new CryptoService();
    // Pre-warm Poseidon and base58btc (mirrors OnModuleInit)
    await service.onModuleInit();
  });

  // ── Ed25519 ────────────────────────────────────────────────────────────────

  describe('Ed25519 keygen / sign / verify', () => {
    it('sign + verify roundtrip returns true for the same keypair', async () => {
      const kp = await service.generateKeypair();
      const message = new TextEncoder().encode('urid smoke test');
      const sig = await service.sign(message, kp.privateKey);
      const result = await service.verify(sig, message, kp.publicKey);
      expect(result).toBe(true);
    });

    it('verify returns false when the public key does not match the signer', async () => {
      const kp1 = await service.generateKeypair();
      const kp2 = await service.generateKeypair();
      const message = new TextEncoder().encode('urid smoke test');
      const sig = await service.sign(message, kp1.privateKey);
      // kp2's public key was not used to sign — verification must fail
      const result = await service.verify(sig, message, kp2.publicKey);
      expect(result).toBe(false);
    });
  });

  // ── Poseidon Merkle ────────────────────────────────────────────────────────

  describe('Poseidon Merkle tree', () => {
    it('build tree → generate proof → verify inclusion returns true', async () => {
      const leaves = [BigInt(10), BigInt(20), BigInt(30), BigInt(40)];
      const tree = await service.buildMerkleTree(leaves);

      // Verify every leaf is provably a member of the tree
      for (let idx = 0; idx < leaves.length; idx++) {
        const proof = service.generateInclusionProof(tree, idx);
        const valid = await service.verifyInclusionProof(proof.leaf, proof, tree.root);
        expect(valid).toBe(true);
      }
    });

    it('verifyInclusionProof returns false for a non-member leaf hash', async () => {
      const leaves = [BigInt(10), BigInt(20), BigInt(30), BigInt(40)];
      const tree = await service.buildMerkleTree(leaves);
      const proof = service.generateInclusionProof(tree, 0);

      // Produce the leaf hash of a value NOT in the tree
      const outsiderTree = await service.buildMerkleTree([BigInt(999)]);
      const nonMemberLeaf = outsiderTree.layers[0][0];

      const valid = await service.verifyInclusionProof(nonMemberLeaf, proof, tree.root);
      expect(valid).toBe(false);
    });
  });

  // ── did:ub ─────────────────────────────────────────────────────────────────

  describe('did:ub encode / decode', () => {
    it('encodeDid → decodeDid roundtrip preserves the original public key bytes', async () => {
      const { publicKey } = await service.generateKeypair();
      const did = await service.encodeDid(publicKey);

      // Must start with the expected method prefix
      expect(did.startsWith('did:ub:')).toBe(true);

      const decoded = await service.decodeDid(did);

      // Decoded bytes must match the original public key exactly (byte-for-byte)
      expect(decoded).toBeInstanceOf(Uint8Array);
      expect(decoded.length).toBe(32);
      expect(decoded).toEqual(publicKey);
    });
  });
});
