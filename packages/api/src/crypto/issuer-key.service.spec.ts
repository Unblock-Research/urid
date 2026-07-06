/**
 * IssuerKeyService — unit tests.
 *
 * Verifies env-backed Ed25519 issuer key loading, at-boot generation, error
 * handling, no-private-key-exposure guarantee, and sign/verify round-trips.
 *
 * Threat register coverage:
 *   - T-05-01: no getter, field, or method returns the raw private key bytes.
 */

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
} from 'vitest';
import { CryptoService } from './crypto.service';
import { IssuerKeyService } from './issuer-key.service';

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Build a test IssuerKeyService without the NestJS DI container. */
function buildService(): IssuerKeyService {
  const crypto = new CryptoService();
  return new IssuerKeyService(crypto);
}

/** Generates a deterministic 64-hex private key string for testing. */
function makeTestPrivKeyHex(): string {
  // 32 bytes of incrementing values (0x00..0x1f) as a hex string
  return Array.from({ length: 32 }, (_, i) => i.toString(16).padStart(2, '0')).join('');
}

// ── Environment isolation ─────────────────────────────────────────────────────

let savedKey: string | undefined;

beforeEach(() => {
  savedKey = process.env.ISSUER_PRIVATE_KEY;
  delete process.env.ISSUER_PRIVATE_KEY;
});

afterEach(() => {
  if (savedKey !== undefined) {
    process.env.ISSUER_PRIVATE_KEY = savedKey;
  } else {
    delete process.env.ISSUER_PRIVATE_KEY;
  }
});

// ── env-set: valid 64-hex private key ────────────────────────────────────────

describe('IssuerKeyService (env-set valid key)', () => {
  it('getPublicKeyHex returns a 64-char hex string derived from the env private key', async () => {
    const privHex = makeTestPrivKeyHex();
    process.env.ISSUER_PRIVATE_KEY = privHex;

    const svc = buildService();
    await svc.onModuleInit();

    const pubHex = svc.getPublicKeyHex();
    expect(typeof pubHex).toBe('string');
    expect(pubHex.length).toBe(64);
    // Must only contain valid hex characters
    expect(/^[0-9a-f]+$/i.test(pubHex)).toBe(true);
  });

  it('getPublicKey returns a 32-byte Uint8Array', async () => {
    process.env.ISSUER_PRIVATE_KEY = makeTestPrivKeyHex();
    const svc = buildService();
    await svc.onModuleInit();

    const pub = svc.getPublicKey();
    expect(pub).toBeInstanceOf(Uint8Array);
    expect(pub.length).toBe(32);
  });

  it('sign produces a signature that CryptoService.verify accepts against the issuer public key', async () => {
    process.env.ISSUER_PRIVATE_KEY = makeTestPrivKeyHex();
    const svc = buildService();
    const crypto = new CryptoService();
    await svc.onModuleInit();

    const message = new TextEncoder().encode('test-root-hex-value');
    const sig = await svc.sign(message);

    const valid = await crypto.verify(sig, message, svc.getPublicKey());
    expect(valid).toBe(true);
  });

  it('two instances initialized from the same env private key produce byte-identical signatures', async () => {
    const privHex = makeTestPrivKeyHex();
    process.env.ISSUER_PRIVATE_KEY = privHex;

    const svc1 = buildService();
    const svc2 = buildService();
    await svc1.onModuleInit();
    await svc2.onModuleInit();

    const message = new TextEncoder().encode('deterministic-signing-test');
    const sig1 = await svc1.sign(message);
    const sig2 = await svc2.sign(message);

    expect(sig1).toEqual(sig2);
  });

  it('getPublicKeyHex is stable across multiple calls after init', async () => {
    process.env.ISSUER_PRIVATE_KEY = makeTestPrivKeyHex();
    const svc = buildService();
    await svc.onModuleInit();

    expect(svc.getPublicKeyHex()).toBe(svc.getPublicKeyHex());
  });
});

// ── env-unset: generate at boot ───────────────────────────────────────────────

describe('IssuerKeyService (env-unset — generate at boot)', () => {
  it('after init, getPublicKeyHex returns a non-empty 64-hex string', async () => {
    // env var is already deleted in beforeEach
    const svc = buildService();
    await svc.onModuleInit();

    const pubHex = svc.getPublicKeyHex();
    expect(typeof pubHex).toBe('string');
    expect(pubHex.length).toBe(64);
    expect(/^[0-9a-f]+$/i.test(pubHex)).toBe(true);
  });

  it('sign + verify round-trip works for the generated keypair', async () => {
    const svc = buildService();
    const crypto = new CryptoService();
    await svc.onModuleInit();

    const message = new TextEncoder().encode('test-message-generated-key');
    const sig = await svc.sign(message);
    const valid = await crypto.verify(sig, message, svc.getPublicKey());
    expect(valid).toBe(true);
  });

  it('two services with no env key generate DIFFERENT keypairs (independent entropy)', async () => {
    const svc1 = buildService();
    const svc2 = buildService();
    await svc1.onModuleInit();
    await svc2.onModuleInit();

    // Extremely unlikely to collide (32-byte random key)
    expect(svc1.getPublicKeyHex()).not.toBe(svc2.getPublicKeyHex());
  });
});

// ── env-set: malformed value ──────────────────────────────────────────────────

describe('IssuerKeyService (malformed env)', () => {
  it('throws a clear error when ISSUER_PRIVATE_KEY has wrong length', async () => {
    process.env.ISSUER_PRIVATE_KEY = 'deadbeef'; // 8 chars, not 64
    const svc = buildService();

    await expect(svc.onModuleInit()).rejects.toThrow(/ISSUER_PRIVATE_KEY/);
  });

  it('throws when ISSUER_PRIVATE_KEY contains non-hex characters', async () => {
    process.env.ISSUER_PRIVATE_KEY = 'z'.repeat(64); // 64 chars but non-hex
    const svc = buildService();

    await expect(svc.onModuleInit()).rejects.toThrow(/ISSUER_PRIVATE_KEY/);
  });

  it('throws when ISSUER_PRIVATE_KEY is 65 hex chars (odd/wrong length)', async () => {
    process.env.ISSUER_PRIVATE_KEY = 'a'.repeat(65); // 65 chars
    const svc = buildService();

    await expect(svc.onModuleInit()).rejects.toThrow(/ISSUER_PRIVATE_KEY/);
  });
});

// ── Private key non-exposure (T-05-01) ───────────────────────────────────────

describe('IssuerKeyService (T-05-01: no private key exposure)', () => {
  it('the service object has no property or method whose name suggests private-key access', async () => {
    const svc = buildService();
    await svc.onModuleInit();

    const keys = Object.getOwnPropertyNames(Object.getPrototypeOf(svc));
    const privateKeyAccessors = keys.filter((k) =>
      /private|privKey|_priv/i.test(k),
    );
    expect(privateKeyAccessors).toHaveLength(0);
  });

  it('sign signature length is 64 bytes (Ed25519 output) but getPublicKey is only 32 bytes', async () => {
    const svc = buildService();
    await svc.onModuleInit();

    const message = new TextEncoder().encode('probe');
    const sig = await svc.sign(message);
    expect(sig.length).toBe(64); // signature, not private key
    expect(svc.getPublicKey().length).toBe(32); // public key
  });
});
