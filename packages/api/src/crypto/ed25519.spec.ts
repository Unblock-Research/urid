import { describe, it, expect } from 'vitest';
import { generateKeypair, sign, verify } from './ed25519';

describe('Ed25519 primitives', () => {
  it('generateKeypair returns 32-byte publicKey and 32-byte privateKey', async () => {
    const kp = await generateKeypair();
    expect(kp.publicKey).toBeInstanceOf(Uint8Array);
    expect(kp.privateKey).toBeInstanceOf(Uint8Array);
    expect(kp.publicKey.length).toBe(32);
    expect(kp.privateKey.length).toBe(32);
  });

  it('sign + verify roundtrip: verify returns true for the same keypair and message', async () => {
    const kp = await generateKeypair();
    const message = new TextEncoder().encode('hello urid');
    const sig = await sign(message, kp.privateKey);
    const result = await verify(sig, message, kp.publicKey);
    expect(result).toBe(true);
  });

  it('verify returns false when using a different keypair public key', async () => {
    const kp1 = await generateKeypair();
    const kp2 = await generateKeypair();
    const message = new TextEncoder().encode('hello urid');
    const sig = await sign(message, kp1.privateKey);
    const result = await verify(sig, message, kp2.publicKey);
    expect(result).toBe(false);
  });

  it('verify returns false for a tampered message', async () => {
    const kp = await generateKeypair();
    const message = new TextEncoder().encode('hello urid');
    const sig = await sign(message, kp.privateKey);
    const tampered = new TextEncoder().encode('hello TAMPERED');
    const result = await verify(sig, tampered, kp.publicKey);
    expect(result).toBe(false);
  });
});
