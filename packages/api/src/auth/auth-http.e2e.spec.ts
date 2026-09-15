/**
 * auth-http.e2e.spec.ts — the guards over a REAL HTTP pipeline.
 *
 * The unit specs prove the guard classes reject the right things when called
 * directly. They cannot prove two things that only exist once Nest is actually
 * serving requests:
 *
 *   1. @UseGuards is wired to the routes at all — a guard that is never applied
 *      is exactly the bug this work fixes (the old AuthGuard existed, returned
 *      true, and appeared in zero controllers).
 *   2. rawBody survives body parsing, so sha256(rawBody) on the server matches
 *      what the client signed. Re-serialising parsed JSON would not reproduce
 *      the client's bytes, and every signed request would fail.
 *
 * So this boots a real Nest app on an ephemeral port and drives it with fetch.
 * Prisma is faked; the crypto and the HTTP stack are real.
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { Test } from '@nestjs/testing';
import { Module } from '@nestjs/common';
import { bytesToHex } from '@noble/hashes/utils';

import { CryptoModule } from '../crypto/crypto.module';
import { CryptoService } from '../crypto/crypto.service';
import { PrismaService } from '../prisma/prisma.service';
import { IdentityController } from '../modules/identity/identity.controller';
import { IdentityService } from '../modules/identity/identity.service';
import { LedgerService } from '../ledger/ledger.service';
import { AuthModule } from './auth.module';
import { buildSignedMessage, sha256Hex } from './did-sig';

// ── Fake persistence ─────────────────────────────────────────────────────────

const researchers: Record<string, any>[] = [];
const claimedNonces = new Set<string>();

const fakePrisma = {
  researcher: {
    findUnique: vi.fn(async ({ where }: any) => {
      if (where.did) return researchers.find((r) => r.did === where.did) ?? null;
      if (where.handle) return researchers.find((r) => r.handle === where.handle) ?? null;
      return null;
    }),
    update: vi.fn(async ({ where, data }: any) => {
      const r = researchers.find((x) => x.did === where.did);
      Object.assign(r, data);
      return r;
    }),
  },
  authNonce: {
    // Mirrors the UNIQUE(did, nonce) constraint the real table enforces.
    create: vi.fn(async ({ data }: any) => {
      const key = `${data.did}|${data.nonce}`;
      if (claimedNonces.has(key)) {
        throw Object.assign(new Error('Unique constraint failed'), { code: 'P2002' });
      }
      claimedNonces.add(key);
      return { id: 'n1', ...data };
    }),
    deleteMany: vi.fn(async () => ({ count: 0 })),
  },
} as unknown as PrismaService;

const fakeLedger = {
  registerDid: vi.fn(async () => ({})),
  mintSbt: vi.fn(),
  revokeSbt: vi.fn(),
  getTransaction: vi.fn(),
} as unknown as LedgerService;

// CryptoModule is @Global and supplies CryptoService to AuthModule's verifier —
// the same arrangement AppModule relies on in production.
@Module({
  imports: [CryptoModule, AuthModule],
  controllers: [IdentityController],
  providers: [
    IdentityService,
    { provide: PrismaService, useValue: fakePrisma },
    { provide: LedgerService, useValue: fakeLedger },
  ],
})
class TestAppModule {}

// ── Harness ──────────────────────────────────────────────────────────────────

let app: any;
let baseUrl: string;
let crypto: CryptoService;
let alice: { did: string; privateKey: Uint8Array; publicKeyHex: string };
let bob: { did: string; privateKey: Uint8Array; publicKeyHex: string };

async function makeIdentity() {
  const { publicKey, privateKey } = await crypto.generateKeypair();
  const did = await crypto.encodeDid(publicKey);
  return { did, privateKey, publicKeyHex: bytesToHex(publicKey) };
}

beforeAll(async () => {
  const moduleRef = await Test.createTestingModule({
    imports: [TestAppModule],
  }).compile();

  // rawBody + the same global prefix production uses, so signed paths match.
  app = moduleRef.createNestApplication({ rawBody: true });
  app.setGlobalPrefix('api');
  await app.listen(0);

  const addr = app.getHttpServer().address();
  baseUrl = `http://127.0.0.1:${addr.port}`;

  crypto = moduleRef.get(CryptoService);
  alice = await makeIdentity();
  bob = await makeIdentity();

  researchers.push(
    { id: 'r-alice', did: alice.did, handle: 'alice', publicKey: alice.publicKeyHex },
    { id: 'r-bob', did: bob.did, handle: 'bob', publicKey: bob.publicKeyHex },
  );
}, 60_000);

afterAll(async () => {
  await app?.close();
});

let nonceCounter = 0;

/** Issue a request, signing it as `identity` unless `signed: false`. */
async function request(
  path: string,
  opts: {
    method?: string;
    body?: unknown;
    identity?: { did: string; privateKey: Uint8Array };
    ts?: number;
    nonce?: string;
    /** Body actually sent, if it should differ from the body that was signed. */
    sendInstead?: unknown;
  } = {},
) {
  const method = opts.method ?? 'POST';
  const signedBody = opts.body === undefined ? '' : JSON.stringify(opts.body);
  const sentBody =
    opts.sendInstead === undefined ? signedBody : JSON.stringify(opts.sendInstead);

  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (opts.identity) {
    const ts = opts.ts ?? Math.floor(Date.now() / 1000);
    const nonce = opts.nonce ?? `e2enonce${String(nonceCounter++).padStart(8, '0')}`;
    const message = buildSignedMessage(
      method,
      path,
      sha256Hex(Buffer.from(signedBody, 'utf8')),
      ts,
      nonce,
    );
    const sig = await crypto.sign(message, opts.identity.privateKey);
    headers.authorization = `DIDSig did="${opts.identity.did}",ts="${ts}",nonce="${nonce}",sig="${Buffer.from(sig).toString('base64')}"`;
  }

  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers,
    body: method === 'GET' ? undefined : sentBody,
  });
  return { status: res.status, body: await res.text() };
}

// ─────────────────────────────────────────────────────────────────────────────

describe('DIDSig over real HTTP', () => {
  it('serves public routes without a signature', async () => {
    const res = await request('/api/identity/check-handle?handle=someone', {
      method: 'GET',
    });
    expect(res.status).toBe(200);
  });

  it('rejects an unsigned write with 401 — the guard IS applied to the route', async () => {
    // The precise regression this work fixes: previously every write endpoint
    // answered happily with no credentials at all.
    const res = await request(`/api/identity/did/${alice.did}`, {
      method: 'PUT',
      body: { displayName: 'Anyone At All' },
    });
    expect(res.status).toBe(401);
  });

  it('accepts a correctly signed write', async () => {
    const res = await request(`/api/identity/did/${alice.did}`, {
      method: 'PUT',
      body: { displayName: 'Alice Updated' },
      identity: alice,
    });
    expect(res.status).toBe(200);
  });

  it('rejects a body altered in flight — rawBody reaches the guard intact', async () => {
    // If the guard hashed the re-serialised parsed body instead of rawBody, this
    // tamper could slip through whenever the re-serialisation happened to match.
    const res = await request(`/api/identity/did/${alice.did}`, {
      method: 'PUT',
      body: { displayName: 'Alice' },
      sendInstead: { displayName: 'Mallory' },
      identity: alice,
    });
    expect(res.status).toBe(401);
  });

  it("forbids Alice writing to Bob's profile with 403", async () => {
    const res = await request(`/api/identity/did/${bob.did}`, {
      method: 'PUT',
      body: { displayName: 'Owned By Alice' },
      identity: alice,
    });
    expect(res.status).toBe(403);
  });

  it('rejects a replayed request with 401', async () => {
    const send = () =>
      request(`/api/identity/did/${alice.did}`, {
        method: 'PUT',
        body: { displayName: 'Replay Me' },
        identity: alice,
        nonce: 'fixedreplaynonce01',
        ts: Math.floor(Date.now() / 1000),
      });

    const first = await send();
    expect(first.status).toBe(200);

    // Same nonce again — even though the signature is perfectly valid.
    const second = await send();
    expect(second.status).toBe(401);
    expect(second.body).toMatch(/replay/i);
  });

  it('rejects a stale request with 401', async () => {
    const res = await request(`/api/identity/did/${alice.did}`, {
      method: 'PUT',
      body: { displayName: 'Too Late' },
      identity: alice,
      ts: Math.floor(Date.now() / 1000) - 3600,
    });
    expect(res.status).toBe(401);
    expect(res.body).toMatch(/freshness/i);
  });

  it('rejects an unsigned read of recovery shards with 401', async () => {
    // Guardian names are personal data about third parties.
    const res = await request(`/api/identity/did/${alice.did}/recovery`, {
      method: 'GET',
    });
    expect(res.status).toBe(401);
  });

  it('does not expose recoveryShards on the public DID-resolution route', async () => {
    const res = await request(`/api/identity/did/${alice.did}`, { method: 'GET' });
    expect(res.status).toBe(200);
    expect(res.body).not.toMatch(/recoveryShards/);
  });
});
