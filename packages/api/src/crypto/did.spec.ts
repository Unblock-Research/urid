import { describe, it, expect } from 'vitest';
import { generateKeypair } from './ed25519';
import { encodeDid, decodeDid } from './did';

describe('DID encode / decode', () => {
  it('encodeDid returns a string starting with "did:ub:z6Mk"', async () => {
    const { publicKey } = await generateKeypair();
    const did = await encodeDid(publicKey);
    expect(typeof did).toBe('string');
    expect(did.startsWith('did:ub:z6Mk')).toBe(true);
  });

  it('decodeDid(encodeDid(pk)) round-trips to the original 32-byte public key', async () => {
    const { publicKey } = await generateKeypair();
    const did = await encodeDid(publicKey);
    const decoded = await decodeDid(did);
    expect(decoded).toBeInstanceOf(Uint8Array);
    expect(decoded.length).toBe(32);
    expect(decoded).toEqual(publicKey);
  });

  it('decodeDid rejects a malformed string', async () => {
    await expect(decodeDid('not-a-did')).rejects.toThrow();
  });

  it('decodeDid rejects a DID with the wrong method', async () => {
    // did:key uses the same multibase encoding style but a different method prefix
    const { publicKey } = await generateKeypair();
    const validDid = await encodeDid(publicKey);
    // Replace method with something else
    const wrongMethod = validDid.replace('did:ub:', 'did:key:');
    await expect(decodeDid(wrongMethod)).rejects.toThrow();
  });
});
