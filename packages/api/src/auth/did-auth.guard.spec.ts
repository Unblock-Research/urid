/**
 * did-auth.guard.spec.ts — end-to-end guard behaviour with REAL Ed25519 keys.
 *
 * Every request here is signed with an actual keypair and verified through the
 * real CryptoService; only Prisma is faked. A guard tested against a stubbed
 * verifier would pass while proving nothing about whether signatures are
 * actually checked.
 *
 * Covers critical finding #1: before this, AuthGuard returned true and was never
 * applied, so all of these attacks succeeded.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import { bytesToHex } from '@noble/hashes/utils';
import { ForbiddenException, UnauthorizedException } from '@nestjs/common';

import { CryptoService } from '../crypto/crypto.service';
import { IssuerRegistryService } from '../crypto/issuer-registry.service';
import { DidAuthGuard } from './did-auth.guard';
import { IssuerAuthGuard } from './issuer-auth.guard';
import { DidSigVerifier } from './did-sig.verifier';
import { NonceService } from './nonce.service';
import { buildSignedMessage, sha256Hex } from './did-sig';

// ── Fakes ────────────────────────────────────────────────────────────────────

/** In-memory stand-in for the AuthNonce table, including its unique constraint. */
function makeNonceService() {
  const seen = new Set<string>();
  return {
    service: {
      claim: vi.fn(async (did: string, nonce: string) => {
        const key = `${did}|${nonce}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
      maybeSweep: vi.fn(async () => undefined),
    } as unknown as NonceService,
    seen,
  };
}

function makePrisma(researchers: Record<string, unknown>[]) {
  return {
    researcher: {
      findUnique: vi.fn(async ({ where }: any) =>
        researchers.find((r: any) => r.did === where.did) ?? null,
      ),
    },
  } as any;
}

/** Minimal ExecutionContext exposing a request object. */
function ctx(req: unknown) {
  return {
    switchToHttp: () => ({ getRequest: () => req }),
  } as any;
}

// ── Shared real crypto ───────────────────────────────────────────────────────

let crypto: CryptoService;

beforeAll(async () => {
  crypto = new CryptoService();
  await crypto.onModuleInit();
}, 30_000);

/** Create a real keypair plus its did:ub identifier. */
async function makeIdentity() {
  const { publicKey, privateKey } = await crypto.generateKeypair();
  const did = await crypto.encodeDid(publicKey);
  return { publicKey, privateKey, did, publicKeyHex: bytesToHex(publicKey) };
}

/** Build a request signed by `identity`, with optional tampering afterwards. */
async function signedRequest(
  identity: { did: string; privateKey: Uint8Array },
  opts: {
    method?: string;
    path?: string;
    body?: string;
    ts?: number;
    nonce?: string;
    params?: Record<string, string>;
  } = {},
) {
  const method = opts.method ?? 'POST';
  const path = opts.path ?? '/api/identity/did/x';
  const rawBody = Buffer.from(opts.body ?? '', 'utf8');
  const ts = opts.ts ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? `n${Math.floor(Math.random() * 1e16)}`.padEnd(16, '0');

  const message = buildSignedMessage(method, path, sha256Hex(rawBody), ts, nonce);
  const sig = await crypto.sign(message, identity.privateKey);

  return {
    method,
    originalUrl: path,
    rawBody,
    params: opts.params ?? {},
    headers: {
      authorization: `DIDSig did="${identity.did}",ts="${ts}",nonce="${nonce}",sig="${Buffer.from(sig).toString('base64')}"`,
    },
  } as any;
}

function makeGuard(researchers: Record<string, unknown>[]) {
  const { service: nonces, seen } = makeNonceService();
  const verifier = new DidSigVerifier(crypto, nonces);
  const prisma = makePrisma(researchers);
  return { guard: new DidAuthGuard(verifier, prisma), prisma, seen, verifier };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('DidAuthGuard', () => {
  it('admits a correctly signed request from a registered researcher', async () => {
    const alice = await makeIdentity();
    const { guard } = makeGuard([
      { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
    ]);
    const req = await signedRequest(alice, { body: '{"displayName":"Alice"}' });

    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.uridPrincipal).toEqual({
      did: alice.did,
      researcherId: 'r1',
      publicKeyHex: alice.publicKeyHex.toLowerCase(),
    });
  }, 30_000);

  it('rejects an unauthenticated request', async () => {
    const { guard } = makeGuard([]);
    const req = { method: 'POST', originalUrl: '/api/x', headers: {}, params: {} };
    await expect(guard.canActivate(ctx(req))).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a DID that resolves but is not a registered researcher', async () => {
    // did:ub is self-certifying, so anyone can mint one and sign with it. Only the
    // database lookup ties a valid signature to an actual account.
    const stranger = await makeIdentity();
    const { guard } = makeGuard([]);
    const req = await signedRequest(stranger);

    await expect(guard.canActivate(ctx(req))).rejects.toThrow(/not a registered/i);
  }, 30_000);

  it('rejects when the stored publicKey disagrees with the DID', async () => {
    const alice = await makeIdentity();
    const mallory = await makeIdentity();
    const { guard } = makeGuard([
      { id: 'r1', did: alice.did, publicKey: mallory.publicKeyHex },
    ]);
    const req = await signedRequest(alice);

    await expect(guard.canActivate(ctx(req))).rejects.toThrow(
      /does not match the registered public key/i,
    );
  }, 30_000);

  describe('signature binding', () => {
    it('rejects a body swapped after signing', async () => {
      const alice = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      const req = await signedRequest(alice, { body: '{"displayName":"Alice"}' });
      req.rawBody = Buffer.from('{"displayName":"Mallory"}', 'utf8');

      await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Invalid request signature/);
    }, 30_000);

    it('rejects a signature replayed onto a different path', async () => {
      const alice = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      const req = await signedRequest(alice, { path: '/api/impact/x' });
      req.originalUrl = '/api/credentials/mint';

      await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Invalid request signature/);
    }, 30_000);

    it('rejects a signature replayed onto a different method', async () => {
      const alice = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      const req = await signedRequest(alice, { method: 'GET' });
      req.method = 'POST';

      await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Invalid request signature/);
    }, 30_000);

    it("rejects a request signed with someone else's key", async () => {
      const alice = await makeIdentity();
      const mallory = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      // Mallory signs, then claims to be Alice.
      const req = await signedRequest(mallory);
      req.headers.authorization = req.headers.authorization.replace(
        mallory.did,
        alice.did,
      );

      await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Invalid request signature/);
    }, 30_000);
  });

  describe('freshness and replay', () => {
    it('rejects a stale request', async () => {
      const alice = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      const req = await signedRequest(alice, {
        ts: Math.floor(Date.now() / 1000) - 3600,
      });

      await expect(guard.canActivate(ctx(req))).rejects.toThrow(/freshness window/i);
    }, 30_000);

    it('rejects a future-dated request', async () => {
      const alice = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      const req = await signedRequest(alice, {
        ts: Math.floor(Date.now() / 1000) + 3600,
      });

      await expect(guard.canActivate(ctx(req))).rejects.toThrow(/freshness window/i);
    }, 30_000);

    it('rejects the exact same request sent twice', async () => {
      const alice = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      const req = await signedRequest(alice, { nonce: 'replaynonce12345' });

      await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
      await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Replayed nonce/);
    }, 30_000);

    it('does not consume a nonce for an invalid signature', async () => {
      // Otherwise an attacker could burn an honest client's nonces with garbage.
      const alice = await makeIdentity();
      const { guard, seen } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      const req = await signedRequest(alice, { nonce: 'unburnednonce123' });
      const good = req.rawBody;
      req.rawBody = Buffer.from('tampered');

      await expect(guard.canActivate(ctx(req))).rejects.toThrow(/Invalid request signature/);
      expect(seen.size).toBe(0);

      // The honest client can still use that nonce.
      req.rawBody = good;
      await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    }, 30_000);
  });

  describe('ownership of :did routes', () => {
    it('allows a principal acting on their own DID', async () => {
      const alice = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
      ]);
      const req = await signedRequest(alice, { params: { did: alice.did } });

      await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    }, 30_000);

    it("forbids a valid principal acting on someone else's DID", async () => {
      // The core authorisation bug: a valid signature from A must not authorise
      // writes to B's profile, recovery shards, or wallet.
      const alice = await makeIdentity();
      const bob = await makeIdentity();
      const { guard } = makeGuard([
        { id: 'r1', did: alice.did, publicKey: alice.publicKeyHex },
        { id: 'r2', did: bob.did, publicKey: bob.publicKeyHex },
      ]);
      const req = await signedRequest(alice, { params: { did: bob.did } });

      await expect(guard.canActivate(ctx(req))).rejects.toThrow(ForbiddenException);
    }, 30_000);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('IssuerAuthGuard', () => {
  function makeIssuerGuard(trustedHex: string[]) {
    const { service: nonces } = makeNonceService();
    const verifier = new DidSigVerifier(crypto, nonces);
    const saved = process.env.TRUSTED_ISSUER_KEYS;
    process.env.TRUSTED_ISSUER_KEYS = trustedHex.join(',');
    const registry = new IssuerRegistryService({
      getPublicKeyHex: () => trustedHex[0] ?? '00'.repeat(32),
    } as any);
    registry.onModuleInit();
    if (saved === undefined) delete process.env.TRUSTED_ISSUER_KEYS;
    else process.env.TRUSTED_ISSUER_KEYS = saved;
    return new IssuerAuthGuard(verifier, registry);
  }

  it('admits a request signed by a trusted issuer key', async () => {
    const issuer = await makeIdentity();
    const guard = makeIssuerGuard([issuer.publicKeyHex]);
    const req = await signedRequest(issuer, { path: '/api/credentials/mint' });

    await expect(guard.canActivate(ctx(req))).resolves.toBe(true);
    expect(req.uridIssuerPrincipal?.isIssuer).toBe(true);
  }, 30_000);

  it('forbids a valid signature from a key that is not a trusted issuer', async () => {
    // This is the separation that matters: a researcher proving control of their
    // own key must not thereby be able to mint themselves a credential.
    const issuer = await makeIdentity();
    const researcher = await makeIdentity();
    const guard = makeIssuerGuard([issuer.publicKeyHex]);
    const req = await signedRequest(researcher, { path: '/api/credentials/mint' });

    await expect(guard.canActivate(ctx(req))).rejects.toThrow(ForbiddenException);
  }, 30_000);

  it('rejects an unsigned mint attempt', async () => {
    const issuer = await makeIdentity();
    const guard = makeIssuerGuard([issuer.publicKeyHex]);
    const req = { method: 'POST', originalUrl: '/api/credentials/mint', headers: {}, params: {} };

    await expect(guard.canActivate(ctx(req))).rejects.toThrow(UnauthorizedException);
  }, 30_000);
});
