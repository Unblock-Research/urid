import { describe, it, expect, vi } from 'vitest';
import { IdentityService } from './identity.service';
import { CryptoService } from '../../crypto/crypto.service';
import { createHash } from 'crypto';

// ---------------------------------------------------------------------------
// Test constants
// ---------------------------------------------------------------------------

const TEST_DID = 'did:ub:z6MkRecoveryTest00000001';

// ---------------------------------------------------------------------------
// Fake PrismaService for recovery tests
// A mutable shard store is shared across create/findMany/deleteMany so the
// service's full setup→recover flow works end-to-end without a real DB.
// ---------------------------------------------------------------------------

function makeFakePrismaForRecovery() {
  const researcherRow = {
    id: 'researcher-uuid-recovery-001',
    handle: 'alice',
    did: TEST_DID,
    displayName: 'Alice',
    createdAt: new Date(),
    updatedAt: new Date(),
  };

  // In-memory shard store — deleteMany clears, create appends, findMany reads
  const shards: Array<Record<string, unknown>> = [];
  let shardCounter = 0;

  return {
    researcher: {
      findUnique: vi.fn().mockResolvedValue(researcherRow),
    },
    recoveryShard: {
      create: vi.fn().mockImplementation(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `shard-${++shardCounter}`, ...data };
        shards.push(row);
        return row;
      }),
      findMany: vi.fn().mockImplementation(async () => [...shards]),
      deleteMany: vi.fn().mockImplementation(async () => {
        shards.length = 0;
        return { count: 0 };
      }),
    },
  };
}

const fakeLedger = {
  registerDid: vi.fn(),
  mintSbt: vi.fn(),
  revokeSbt: vi.fn(),
  getTransaction: vi.fn(),
};

function sha256hex(buf: Buffer): string {
  return createHash('sha256').update(buf).digest('hex');
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('IdentityService — Shamir Recovery', () => {
  /**
   * (1) setupRecovery with N=5 guardians and threshold T=3 calls
   *     recoveryShard.create exactly 5 times; each data payload has
   *     non-null encryptedShard (parseable JSON envelope {v,alg,iv,authTag,
   *     ciphertext,tag}), an integer shardIndex, and threshold === 3.
   */
  it('(1) setupRecovery N=5 T=3 creates exactly 5 shard rows, each with valid encryptedShard + shardIndex + threshold', async () => {
    const fakePrisma = makeFakePrismaForRecovery();
    const svc = new IdentityService(
      fakePrisma as any,
      fakeLedger as any,
      new CryptoService() as any,
    );

    const guardians = [
      { name: 'Alice', kind: 'friend' },
      { name: 'Bob', kind: 'colleague' },
      { name: 'Carol', kind: 'family' },
      { name: 'Dave', kind: 'friend' },
      { name: 'Eve', kind: 'colleague' },
    ];

    await svc.setupRecovery(TEST_DID, guardians, undefined, 3);

    expect(fakePrisma.recoveryShard.create).toHaveBeenCalledTimes(5);

    for (const call of fakePrisma.recoveryShard.create.mock.calls as any[]) {
      const data = call[0].data as Record<string, unknown>;

      // encryptedShard must be a non-null, parseable JSON envelope
      expect(data.encryptedShard).not.toBeNull();
      expect(typeof data.encryptedShard).toBe('string');
      const envelope = JSON.parse(data.encryptedShard as string);
      expect(envelope.v).toBe(1);
      expect(envelope.alg).toBe('aes-256-gcm');
      expect(typeof envelope.iv).toBe('string');
      expect(typeof envelope.authTag).toBe('string');
      expect(typeof envelope.ciphertext).toBe('string');
      expect(typeof envelope.tag).toBe('string');

      // shardIndex must be a non-negative integer
      expect(Number.isInteger(data.shardIndex)).toBe(true);
      expect(data.shardIndex as number).toBeGreaterThanOrEqual(0);

      // threshold must equal the T we supplied
      expect(data.threshold).toBe(3);
    }
  });

  /**
   * (2) Round-trip: call setupRecovery with a KNOWN 32-byte secret; take T
   *     of the returned recovery kits and call recover() — the reconstructed
   *     secret hex must equal the original.
   */
  it('(2) round-trip: recover(T valid submissions) reconstructs the original known secret hex', async () => {
    const fakePrisma = makeFakePrismaForRecovery();
    const svc = new IdentityService(
      fakePrisma as any,
      fakeLedger as any,
      new CryptoService() as any,
    );

    // A fixed 32-byte secret expressed as 64 hex chars
    const knownSecretHex = 'a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2';

    const guardians = [
      { name: 'Alice', kind: 'friend' },
      { name: 'Bob', kind: 'colleague' },
      { name: 'Carol', kind: 'family' },
    ];

    // N=3, T=2
    const result = await svc.setupRecovery(TEST_DID, guardians, knownSecretHex, 2);

    // Submit T=2 of the 3 kits (indices 0 and 1)
    const submissions = result.recoveryKits.slice(0, 2).map(
      (kit: { shardIndex: number; key: string }) => ({ shardIndex: kit.shardIndex, key: kit.key }),
    );

    const recovery = await svc.recover(TEST_DID, submissions);

    expect(recovery.success).toBe(true);
    expect(recovery.secret).toBe(knownSecretHex);
  });

  /**
   * (3) recover with >=T valid submissions returns success:true and
   *     verified:true; sha256(reconstructed secret) must equal the stored
   *     verification tag from the encryptedShard envelope.
   */
  it('(3) recover >=T valid submissions returns success:true and sha256(secret) === stored tag', async () => {
    const fakePrisma = makeFakePrismaForRecovery();
    const svc = new IdentityService(
      fakePrisma as any,
      fakeLedger as any,
      new CryptoService() as any,
    );

    // Different known secret to avoid cross-test confusion
    const knownSecretHex = 'deadbeefcafebabedeadbeefcafebabedeadbeefcafebabedeadbeefcafebabe';

    const guardians = [
      { name: 'Alice', kind: 'friend' },
      { name: 'Bob', kind: 'colleague' },
      { name: 'Carol', kind: 'family' },
    ];

    const result = await svc.setupRecovery(TEST_DID, guardians, knownSecretHex, 2);

    // Fetch the verification tag directly from the stored envelope
    const storedShards = await fakePrisma.recoveryShard.findMany();
    const firstEnvelope = JSON.parse(storedShards[0].encryptedShard as string);
    const storedTag: string = firstEnvelope.tag;

    const submissions = result.recoveryKits.slice(0, 2).map(
      (kit: { shardIndex: number; key: string }) => ({ shardIndex: kit.shardIndex, key: kit.key }),
    );

    const recovery = await svc.recover(TEST_DID, submissions);

    expect(recovery.success).toBe(true);
    expect(recovery.verified).toBe(true);

    // sha256 of the reconstructed secret must match the stored tag
    const reconstructedBuffer = Buffer.from(recovery.secret as string, 'hex');
    expect(sha256hex(reconstructedBuffer)).toBe(storedTag);
  });

  /**
   * (4) recover with <T valid submissions (T-1) returns success:false.
   *     The JSON-stringified response must contain NONE of:
   *     the original secret hex, any guardian key hex.
   */
  it('(4) recover <T submissions returns failure and leaks no secret or key bytes', async () => {
    const fakePrisma = makeFakePrismaForRecovery();
    const svc = new IdentityService(
      fakePrisma as any,
      fakeLedger as any,
      new CryptoService() as any,
    );

    const knownSecretHex = 'cafebabecafebabecafebabecafebabecafebabecafebabecafebabecafebabe';

    const guardians = [
      { name: 'Alice', kind: 'friend' },
      { name: 'Bob', kind: 'colleague' },
      { name: 'Carol', kind: 'family' },
    ];

    // T=3, so T-1=2 submissions must fail
    const result = await svc.setupRecovery(TEST_DID, guardians, knownSecretHex, 3);

    // Only submit T-1 = 2 valid submissions
    const submissions = result.recoveryKits.slice(0, 2).map(
      (kit: { shardIndex: number; key: string }) => ({ shardIndex: kit.shardIndex, key: kit.key }),
    );

    const recovery = await svc.recover(TEST_DID, submissions);

    expect(recovery.success).toBe(false);

    const responseStr = JSON.stringify(recovery);

    // Must not contain the original secret
    expect(responseStr).not.toContain(knownSecretHex);

    // Must not contain any guardian key
    for (const kit of result.recoveryKits) {
      expect(responseStr).not.toContain(kit.key);
    }

    // Must not contain a 'secret' field at all
    expect(recovery).not.toHaveProperty('secret');
  });

  /**
   * (5) A wrong/garbled guardian key is rejected (GCM auth failure) and
   *     does NOT count toward the threshold.
   *     Submit T-1 correct + 1 garbled = total T submissions; recover returns failure.
   */
  it('(5) garbled guardian key is rejected — T-1 correct + 1 garbled does not meet threshold T', async () => {
    const fakePrisma = makeFakePrismaForRecovery();
    const svc = new IdentityService(
      fakePrisma as any,
      fakeLedger as any,
      new CryptoService() as any,
    );

    const guardians = [
      { name: 'Alice', kind: 'friend' },
      { name: 'Bob', kind: 'colleague' },
      { name: 'Carol', kind: 'family' },
    ];

    // T=3, N=3 — need all 3 valid to succeed
    const result = await svc.setupRecovery(TEST_DID, guardians, undefined, 3);

    // T total submissions but shard 2 uses a garbled (all-ff) key
    const submissions = [
      { shardIndex: result.recoveryKits[0].shardIndex, key: result.recoveryKits[0].key },
      { shardIndex: result.recoveryKits[1].shardIndex, key: result.recoveryKits[1].key },
      { shardIndex: result.recoveryKits[2].shardIndex, key: 'ff'.repeat(32) }, // garbled key
    ];

    const recovery = await svc.recover(TEST_DID, submissions);

    // Should fail — only 2 valid shares out of T=3 required
    expect(recovery.success).toBe(false);
  });

  /**
   * Bonus: getRecoveryStatus must return only the safe projection
   * {guardianName, guardianKind, status, shardIndex, threshold} —
   * no encryptedShard, no plaintext secret, no share material.
   */
  it('getRecoveryStatus returns safe projection only — no encryptedShard or secret material', async () => {
    const fakePrisma = makeFakePrismaForRecovery();
    const svc = new IdentityService(
      fakePrisma as any,
      fakeLedger as any,
      new CryptoService() as any,
    );

    const guardians = [
      { name: 'Alice', kind: 'friend' },
      { name: 'Bob', kind: 'colleague' },
    ];

    await svc.setupRecovery(TEST_DID, guardians, undefined, 2);

    const status = await svc.getRecoveryStatus(TEST_DID);

    expect(Array.isArray(status)).toBe(true);

    for (const shard of status as Array<Record<string, unknown>>) {
      // Must NOT expose the encrypted blob
      expect(shard).not.toHaveProperty('encryptedShard');

      // Must contain safe metadata fields
      expect(shard).toHaveProperty('guardianName');
      expect(shard).toHaveProperty('guardianKind');
      expect(shard).toHaveProperty('status');
      expect(shard).toHaveProperty('shardIndex');
      expect(shard).toHaveProperty('threshold');
    }
  });
});
