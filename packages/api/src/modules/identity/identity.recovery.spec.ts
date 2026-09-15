/**
 * identity.recovery.spec.ts — client-side Shamir social recovery (high finding #2).
 *
 * The previous suite tested a server that generated the secret, split it, held
 * every ciphertext, and reconstructed on demand. That capability is gone, so
 * these tests cover the arrangement that replaced it:
 *
 *   - the holder's device does all the crypto (crypto/recovery.ts)
 *   - the server stores ciphertexts and validates only their structure
 *   - reconstruction happens on the holder's device
 *
 * The central assertion is negative: nothing the server receives or returns is
 * sufficient to reconstruct the secret. That is the whole point of the change,
 * and it is the kind of property that quietly regresses, so it is checked
 * directly rather than inferred from the API shape.
 */

import { describe, it, expect, vi } from 'vitest';

import { IdentityService } from './identity.service';
import {
  computeVerificationTag,
  decryptShard,
  isEncryptedShardEnvelope,
  prepareRecovery,
  reconstructSecret,
} from '../../crypto/recovery';

const TEST_DID = 'did:ub:z6MkRecoveryTest00000001';

const GUARDIANS = [
  { name: 'Aria M. (sister)', kind: 'Personal' },
  { name: 'UCSF Weill IT', kind: 'Institutional' },
  { name: 'iPhone 15 Pro', kind: 'Device' },
  { name: 'Ledger Nano X', kind: 'Device' },
  { name: 'r.tanaka.eth', kind: 'Peer' },
];

// ── Fake Prisma with an in-memory shard table ────────────────────────────────

function makeFakePrisma() {
  const researcherRow = {
    id: 'researcher-uuid-recovery-001',
    handle: 'alice',
    did: TEST_DID,
    displayName: 'Alice',
  };
  const shards: Array<Record<string, unknown>> = [];

  return {
    researcher: { findUnique: vi.fn().mockResolvedValue(researcherRow) },
    recoveryShard: {
      createMany: vi.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        shards.push(...data);
        return { count: data.length };
      }),
      findMany: vi.fn(async () =>
        [...shards].sort(
          (a, b) => (a.shardIndex as number) - (b.shardIndex as number),
        ),
      ),
      deleteMany: vi.fn(async () => {
        const count = shards.length;
        shards.length = 0;
        return { count };
      }),
    },
    _shards: shards,
  } as any;
}

function makeService(prisma: any): IdentityService {
  return new (IdentityService as any)(prisma, {}, {}) as IdentityService;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('client-side recovery library', () => {
  it('round-trips: prepare → decrypt T shares → combine', async () => {
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });

    const stored = prepared.payload.guardians.map((g) => ({
      shardIndex: g.shardIndex,
      encryptedShard: g.encryptedShard,
    }));
    const submissions = prepared.recoveryKits
      .slice(0, 3)
      .map((k) => ({ shardIndex: k.shardIndex, key: k.key }));

    const result = await reconstructSecret(stored, submissions, 3);

    expect(result.success).toBe(true);
    if (result.success) expect(result.secretHex).toBe(prepared.secretHex);
  });

  it('reconstructs from ANY T of the N guardians', async () => {
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
    const stored = prepared.payload.guardians.map((g) => ({
      shardIndex: g.shardIndex,
      encryptedShard: g.encryptedShard,
    }));

    // Guardians 1, 3 and 4 — not the first three.
    const submissions = [1, 3, 4].map((i) => ({
      shardIndex: prepared.recoveryKits[i].shardIndex,
      key: prepared.recoveryKits[i].key,
    }));

    const result = await reconstructSecret(stored, submissions, 3);
    expect(result.success).toBe(true);
  });

  it('fails below the threshold without producing partial material', async () => {
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
    const stored = prepared.payload.guardians.map((g) => ({
      shardIndex: g.shardIndex,
      encryptedShard: g.encryptedShard,
    }));
    const submissions = prepared.recoveryKits
      .slice(0, 2)
      .map((k) => ({ shardIndex: k.shardIndex, key: k.key }));

    const result = await reconstructSecret(stored, submissions, 3);

    expect(result.success).toBe(false);
    expect(JSON.stringify(result)).not.toContain(prepared.secretHex);
  });

  it('ignores a wrong guardian key rather than counting it toward the threshold', async () => {
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
    const stored = prepared.payload.guardians.map((g) => ({
      shardIndex: g.shardIndex,
      encryptedShard: g.encryptedShard,
    }));

    const submissions = [
      { shardIndex: 0, key: prepared.recoveryKits[0].key },
      { shardIndex: 1, key: prepared.recoveryKits[1].key },
      { shardIndex: 2, key: 'ff'.repeat(32) }, // wrong key — GCM auth fails
    ];

    const result = await reconstructSecret(stored, submissions, 3);
    expect(result.success).toBe(false);
    expect(result.success === false && result.reason).toMatch(/insufficient/i);
  });

  it('detects a tampered ciphertext instead of yielding a wrong secret', async () => {
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
    const stored = prepared.payload.guardians.map((g) => ({
      shardIndex: g.shardIndex,
      encryptedShard: g.encryptedShard,
    }));

    // Flip a byte in one ciphertext.
    const envelope = JSON.parse(stored[0].encryptedShard);
    envelope.ciphertext =
      (envelope.ciphertext[0] === 'a' ? 'b' : 'a') + envelope.ciphertext.slice(1);
    stored[0].encryptedShard = JSON.stringify(envelope);

    const submissions = prepared.recoveryKits
      .slice(0, 3)
      .map((k) => ({ shardIndex: k.shardIndex, key: k.key }));

    // GCM rejects the tampered share, leaving only 2 valid — below threshold.
    const result = await reconstructSecret(stored, submissions, 3);
    expect(result.success).toBe(false);
  });

  it('defaults the threshold to a majority', async () => {
    const prepared = await prepareRecovery(GUARDIANS); // N = 5
    expect(prepared.payload.threshold).toBe(3);
  });

  it('rejects nonsensical guardian counts and thresholds', async () => {
    await expect(prepareRecovery([GUARDIANS[0]])).rejects.toThrow(/2 guardians/);
    await expect(
      prepareRecovery(GUARDIANS, { threshold: 1 }),
    ).rejects.toThrow(/Threshold/);
    await expect(
      prepareRecovery(GUARDIANS, { threshold: 6 }),
    ).rejects.toThrow(/Threshold/);
  });

  it('commits to the secret with a tag that does not reveal it', async () => {
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
    const secret = new Uint8Array(Buffer.from(prepared.secretHex, 'hex'));
    expect(prepared.payload.verificationTag).toBe(computeVerificationTag(secret));
    expect(prepared.payload.verificationTag).not.toContain(prepared.secretHex);
  });
});

// ─────────────────────────────────────────────────────────────────────────────

describe('IdentityService recovery storage', () => {
  it('stores exactly what the client uploaded — ciphertexts and metadata', async () => {
    const prisma = makeFakePrisma();
    const svc = makeService(prisma);
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });

    const res = await svc.storeRecoverySetup(TEST_DID, prepared.payload);

    expect(res).toEqual({ did: TEST_DID, threshold: 3, guardianCount: 5 });
    expect(prisma._shards).toHaveLength(5);
    for (const row of prisma._shards) {
      expect(isEncryptedShardEnvelope(JSON.parse(row.encryptedShard as string))).toBe(true);
    }
  });

  it('never receives or returns anything that reconstructs the secret', async () => {
    // The property the whole redesign exists for. Serialise everything that
    // crossed the server boundary and assert the secret and every guardian key
    // are absent — then confirm the stored ciphertexts really are inert without
    // those keys.
    const prisma = makeFakePrisma();
    const svc = makeService(prisma);
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });

    const stored = await svc.storeRecoverySetup(TEST_DID, prepared.payload);
    const shards = await svc.getRecoveryShards(TEST_DID);
    const status = await svc.getRecoveryStatus(TEST_DID);

    const everythingTheServerTouched = JSON.stringify({
      uploaded: prepared.payload,
      rows: prisma._shards,
      stored,
      shards,
      status,
    });

    expect(everythingTheServerTouched).not.toContain(prepared.secretHex);
    for (const kit of prepared.recoveryKits) {
      expect(everythingTheServerTouched).not.toContain(kit.key);
    }

    // And the ciphertexts alone decrypt to nothing without a key.
    for (const row of prisma._shards) {
      const envelope = JSON.parse(row.encryptedShard as string);
      expect(decryptShard(envelope, new Uint8Array(32))).toBeNull();
    }
  });

  it('exposes ciphertexts for local reconstruction without guardian names', async () => {
    const prisma = makeFakePrisma();
    const svc = makeService(prisma);
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
    await svc.storeRecoverySetup(TEST_DID, prepared.payload);

    const shards = await svc.getRecoveryShards(TEST_DID);

    expect(shards!.threshold).toBe(3);
    expect(shards!.shards).toHaveLength(5);
    // This route is public, so third-party personal data must not appear on it.
    expect(JSON.stringify(shards)).not.toContain('Aria M.');
    expect(JSON.stringify(shards)).not.toContain('UCSF');
  });

  it('completes a full round trip through the server', async () => {
    const prisma = makeFakePrisma();
    const svc = makeService(prisma);
    const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
    await svc.storeRecoverySetup(TEST_DID, prepared.payload);

    const fetched = await svc.getRecoveryShards(TEST_DID);
    const result = await reconstructSecret(
      fetched!.shards.map((s) => ({
        shardIndex: s.shardIndex as number,
        encryptedShard: s.encryptedShard as string,
      })),
      prepared.recoveryKits.slice(0, 3).map((k) => ({
        shardIndex: k.shardIndex,
        key: k.key,
      })),
      fetched!.threshold as number,
    );

    expect(result.success).toBe(true);
    if (result.success) expect(result.secretHex).toBe(prepared.secretHex);
  });

  it('replaces a previous setup rather than accumulating shards', async () => {
    const prisma = makeFakePrisma();
    const svc = makeService(prisma);

    await svc.storeRecoverySetup(
      TEST_DID,
      (await prepareRecovery(GUARDIANS, { threshold: 3 })).payload,
    );
    await svc.storeRecoverySetup(
      TEST_DID,
      (await prepareRecovery(GUARDIANS.slice(0, 3), { threshold: 2 })).payload,
    );

    expect(prisma._shards).toHaveLength(3);
  });

  describe('upload validation', () => {
    it('rejects a shard that is not valid JSON', async () => {
      const prisma = makeFakePrisma();
      const svc = makeService(prisma);
      const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
      prepared.payload.guardians[0].encryptedShard = 'not json';

      await expect(
        svc.storeRecoverySetup(TEST_DID, prepared.payload),
      ).rejects.toThrow(/malformed/i);
    });

    it('rejects a shard that is not a v1 AES-256-GCM envelope', async () => {
      const prisma = makeFakePrisma();
      const svc = makeService(prisma);
      const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
      prepared.payload.guardians[1].encryptedShard = JSON.stringify({
        v: 1,
        alg: 'rot13',
        iv: 'zz',
        authTag: '',
        ciphertext: '',
        tag: '',
      });

      await expect(
        svc.storeRecoverySetup(TEST_DID, prepared.payload),
      ).rejects.toThrow(/envelope/i);
    });

    it('rejects shard indices with gaps or duplicates', async () => {
      const prisma = makeFakePrisma();
      const svc = makeService(prisma);
      const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
      prepared.payload.guardians[2].shardIndex = 0; // duplicate

      await expect(
        svc.storeRecoverySetup(TEST_DID, prepared.payload),
      ).rejects.toThrow(/0\.\.N-1/);
    });

    it('rejects a threshold outside [2, N]', async () => {
      const prisma = makeFakePrisma();
      const svc = makeService(prisma);
      const prepared = await prepareRecovery(GUARDIANS, { threshold: 3 });
      prepared.payload.threshold = 9;

      await expect(
        svc.storeRecoverySetup(TEST_DID, prepared.payload),
      ).rejects.toThrow(/Threshold/);
    });
  });

  it('has no server-side reconstruct capability at all', () => {
    // Removed, not relocated. A reappearing method here would mean the server
    // can rebuild the secret again.
    const svc = makeService(makeFakePrisma()) as any;
    expect(svc.recover).toBeUndefined();
    expect(svc.reconstructSecret).toBeUndefined();
  });
});
