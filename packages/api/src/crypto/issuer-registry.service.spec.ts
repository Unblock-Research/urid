/**
 * issuer-registry.service.spec.ts — trusted issuer allowlist (critical finding #5)
 *
 * Covers the three behaviours verification depends on:
 *   - default (env unset) trusts exactly the local issuer key
 *   - an explicit TRUSTED_ISSUER_KEYS list REPLACES the default, never widens it
 *   - anything malformed, empty, or absent fails closed
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';

import {
  IssuerRegistryService,
  TRUSTED_ISSUER_KEYS_ENV,
} from './issuer-registry.service';

const LOCAL_KEY = 'aa'.repeat(32); // 64 hex chars
const OTHER_KEY = 'bb'.repeat(32);
const THIRD_KEY = 'cc'.repeat(32);

/** Minimal IssuerKeyService stand-in — the registry only reads the public key. */
function fakeIssuerKey(pubHex: string = LOCAL_KEY) {
  return { getPublicKeyHex: () => pubHex } as any;
}

function build(envValue: string | undefined, pubHex: string = LOCAL_KEY) {
  if (envValue === undefined) {
    delete process.env[TRUSTED_ISSUER_KEYS_ENV];
  } else {
    process.env[TRUSTED_ISSUER_KEYS_ENV] = envValue;
  }
  const svc = new IssuerRegistryService(fakeIssuerKey(pubHex));
  svc.onModuleInit();
  return svc;
}

describe('IssuerRegistryService', () => {
  let saved: string | undefined;

  beforeEach(() => {
    saved = process.env[TRUSTED_ISSUER_KEYS_ENV];
  });

  afterEach(() => {
    if (saved === undefined) delete process.env[TRUSTED_ISSUER_KEYS_ENV];
    else process.env[TRUSTED_ISSUER_KEYS_ENV] = saved;
  });

  describe('default behaviour (env unset)', () => {
    it('trusts the local issuer key', () => {
      const svc = build(undefined);
      expect(svc.isTrusted(LOCAL_KEY)).toBe(true);
      expect(svc.isExplicitlyConfigured()).toBe(false);
    });

    it('trusts nothing else', () => {
      const svc = build(undefined);
      expect(svc.isTrusted(OTHER_KEY)).toBe(false);
      expect(svc.listTrusted()).toEqual([LOCAL_KEY]);
    });
  });

  describe('explicit allowlist', () => {
    it('trusts every key on the list', () => {
      const svc = build(`${OTHER_KEY},${THIRD_KEY}`);
      expect(svc.isTrusted(OTHER_KEY)).toBe(true);
      expect(svc.isTrusted(THIRD_KEY)).toBe(true);
      expect(svc.isExplicitlyConfigured()).toBe(true);
    });

    it('REPLACES the default rather than widening it — the local key is not auto-trusted', () => {
      // This is the property that makes an allowlist meaningful: configuring one
      // must not silently keep trusting the key this process happens to hold.
      const svc = build(OTHER_KEY);
      expect(svc.isTrusted(LOCAL_KEY)).toBe(false);
    });

    it('tolerates whitespace and blank entries around keys', () => {
      const svc = build(`  ${OTHER_KEY} , , ${THIRD_KEY}  `);
      expect(svc.listTrusted().sort()).toEqual([OTHER_KEY, THIRD_KEY].sort());
    });

    it('treats an empty/whitespace-only value as unset', () => {
      const svc = build('   ');
      expect(svc.isExplicitlyConfigured()).toBe(false);
      expect(svc.isTrusted(LOCAL_KEY)).toBe(true);
    });

    it('throws at boot on a malformed key rather than silently dropping it', () => {
      expect(() => build(`${OTHER_KEY},not-a-key`)).toThrow(
        /malformed|64 hex/i,
      );
    });
  });

  describe('matching rules', () => {
    it('is case-insensitive on both sides', () => {
      const svc = build(OTHER_KEY.toUpperCase());
      expect(svc.isTrusted(OTHER_KEY.toLowerCase())).toBe(true);
      expect(svc.isTrusted(OTHER_KEY.toUpperCase())).toBe(true);
    });

    it('ignores surrounding whitespace on the queried key', () => {
      const svc = build(OTHER_KEY);
      expect(svc.isTrusted(`  ${OTHER_KEY}  `)).toBe(true);
    });

    it('fails closed on null, undefined, empty, and malformed input', () => {
      const svc = build(OTHER_KEY);
      expect(svc.isTrusted(null)).toBe(false);
      expect(svc.isTrusted(undefined)).toBe(false);
      expect(svc.isTrusted('')).toBe(false);
      expect(svc.isTrusted('zz'.repeat(32))).toBe(false); // right length, not hex
      expect(svc.isTrusted(OTHER_KEY.slice(0, 63))).toBe(false); // too short
      expect(svc.isTrusted(OTHER_KEY + 'aa')).toBe(false); // too long
    });
  });
});
