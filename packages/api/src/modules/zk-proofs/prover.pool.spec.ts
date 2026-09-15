/**
 * prover.pool.spec.ts — the proving pool (high finding #3).
 *
 * The finding was that fullProve blocked Node's single thread for 1–5 s, so
 * concurrent proofs stalled the entire API rather than just the proving route.
 * The central test here therefore MEASURES event-loop responsiveness during a
 * real proof instead of asserting that a worker exists — "we moved it to a
 * worker" is easy to write and easy to get subtly wrong.
 *
 * Proofs are real: the committed circuit artifacts, through the real child
 * process. Only the load-shedding and timeout tests use a stub worker, since
 * provoking those with genuine proofs would make the suite slow and flaky.
 */

import { describe, it, expect, afterEach } from 'vitest';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

import {
  ProverBusyError,
  ProverPool,
  ProverTimeoutError,
} from './prover.pool';
import {
  buildClaimSet,
  claimNameHash,
  claimValueHash,
  encodeClaimsToLeaves,
} from '../../crypto/claim-encoding';
import { buildMerkleTree, generateInclusionProof } from '../../crypto/merkle';

const CIRCUITS_DIR = path.resolve(__dirname, '../../../circuits');
const WASM_PATH = path.join(CIRCUITS_DIR, 'merkle_inclusion_js', 'merkle_inclusion.wasm');
const ZKEY_PATH = path.join(CIRCUITS_DIR, 'merkle_inclusion_final.zkey');

let pools: ProverPool[] = [];

/** Build a pool with env overrides applied, tracked for teardown. */
function makePool(env: Record<string, string> = {}): ProverPool {
  const saved: Record<string, string | undefined> = {};
  for (const [k, v] of Object.entries(env)) {
    saved[k] = process.env[k];
    process.env[k] = v;
  }
  const pool = new ProverPool(); // reads env in field initialisers
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  pools.push(pool);
  return pool;
}

afterEach(async () => {
  for (const p of pools) await p.onModuleDestroy();
  pools = [];
});

/** A real witness for the committed circuit. */
async function realWitness() {
  const claims = buildClaimSet({
    credentialType: 'AcademicDegree',
    fieldOfStudy: 'Computer Science',
    holderDid: 'did:urid:pool-test',
    issuedAt: '2025-01-01T00:00:00.000Z',
    issuer: 'did:urid:issuer',
    title: 'Bachelor of Science',
  });
  const leaves = await encodeClaimsToLeaves(claims);
  const padded = [...leaves];
  while (padded.length < 16) padded.push(0n);
  const tree = await buildMerkleTree(padded);
  const incl = generateInclusionProof(tree, 0);

  return {
    claimValueHash: claimValueHash(claims[0].value).toString(10),
    numericValue: '0',
    pathElements: incl.siblings.map((s) => BigInt('0x' + s).toString(10)),
    pathIndices: incl.pathBits.map((b) => b.toString()),
    claimNameHash: claimNameHash(claims[0].name).toString(10),
    root: BigInt('0x' + tree.root).toString(10),
    threshold: '0',
    predicateEnabled: '0',
  };
}

/** Write a stub worker that never replies, to provoke the timeout path. */
function writeHangingWorker(): string {
  const file = path.join(os.tmpdir(), `urid-hang-worker-${process.pid}.js`);
  fs.writeFileSync(
    file,
    `'use strict';
     process.on('message', () => { /* never replies */ });
     process.send({ ready: true });\n`,
  );
  return file;
}

/** Write a stub worker that replies after a delay, to fill the queue cheaply. */
function writeSlowWorker(delayMs: number): string {
  const file = path.join(os.tmpdir(), `urid-slow-worker-${process.pid}.js`);
  fs.writeFileSync(
    file,
    `'use strict';
     process.on('message', (job) => {
       setTimeout(() => process.send({
         id: job.id, ok: true, proof: { stub: true }, publicSignals: ['1'],
       }), ${delayMs});
     });
     process.send({ ready: true });\n`,
  );
  return file;
}

// ─────────────────────────────────────────────────────────────────────────────

describe('ProverPool', () => {
  it('produces a real proof through a child process', async () => {
    const pool = makePool({ ZK_PROVE_CONCURRENCY: '1' });
    const result = await pool.prove({
      witness: await realWitness(),
      wasmPath: WASM_PATH,
      zkeyPath: ZKEY_PATH,
    });

    expect((result.proof as { protocol: string }).protocol).toBe('groth16');
    expect(result.publicSignals).toHaveLength(5);
  }, 120_000);

  it('keeps the event loop responsive while a proof runs', async () => {
    // The actual finding. A timer scheduled every 10ms should keep firing
    // throughout; when proving ran inline it could not fire at all for seconds.
    const pool = makePool({ ZK_PROVE_CONCURRENCY: '1' });
    const witness = await realWitness();

    const gaps: number[] = [];
    let last = Date.now();
    const ticker = setInterval(() => {
      const now = Date.now();
      gaps.push(now - last);
      last = now;
    }, 10);

    try {
      await pool.prove({ witness, wasmPath: WASM_PATH, zkeyPath: ZKEY_PATH });
    } finally {
      clearInterval(ticker);
    }

    expect(gaps.length).toBeGreaterThan(5); // the loop kept running
    const worstStall = Math.max(...gaps);
    // Generous bound — this asserts "not blocked for seconds", not scheduler
    // precision, so it should not turn flaky on a loaded machine.
    expect(worstStall).toBeLessThan(1000);
  }, 120_000);

  it('runs queued jobs concurrently up to the worker count', async () => {
    const workerPath = writeSlowWorker(300);
    const pool = makePool({
      ZK_PROVE_CONCURRENCY: '2',
      ZK_PROVE_WORKER_PATH: workerPath,
    });

    const started = Date.now();
    await Promise.all([
      pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' }),
      pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' }),
    ]);
    const elapsed = Date.now() - started;

    // Two 300ms jobs across 2 workers should overlap, not serialise to 600ms.
    expect(elapsed).toBeLessThan(550);
    expect(pool.stats().concurrency).toBe(2);
  }, 30_000);

  describe('load shedding', () => {
    it('rejects with ProverBusyError once the queue is full', async () => {
      // An unbounded queue would accept these and hide the overload; callers
      // would wait behind a backlog they cannot see.
      const workerPath = writeSlowWorker(500);
      const pool = makePool({
        ZK_PROVE_CONCURRENCY: '1',
        ZK_PROVE_QUEUE_LIMIT: '2',
        ZK_PROVE_WORKER_PATH: workerPath,
      });

      const job = () => pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' });

      // 1 in flight + 2 queued = at capacity.
      const accepted = [job(), job(), job()];
      // Give the pool a tick to move the first job onto the worker.
      await new Promise((r) => setTimeout(r, 50));

      await expect(job()).rejects.toThrow(ProverBusyError);

      await Promise.all(accepted);
    }, 30_000);

    it('accepts work again once the queue drains', async () => {
      const workerPath = writeSlowWorker(100);
      const pool = makePool({
        ZK_PROVE_CONCURRENCY: '1',
        ZK_PROVE_QUEUE_LIMIT: '1',
        ZK_PROVE_WORKER_PATH: workerPath,
      });

      await pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' });
      await expect(
        pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' }),
      ).resolves.toBeDefined();
    }, 30_000);
  });

  describe('timeouts', () => {
    it('aborts a job that exceeds its budget', async () => {
      const workerPath = writeHangingWorker();
      const pool = makePool({
        ZK_PROVE_CONCURRENCY: '1',
        ZK_PROVE_TIMEOUT_MS: '600',
        ZK_PROVE_WORKER_PATH: workerPath,
      });

      await expect(
        pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' }),
      ).rejects.toThrow(ProverTimeoutError);
    }, 30_000);

    it('frees the slot after a timeout instead of wedging the pool', async () => {
      // A killed worker must be replaced, or one stuck proof would permanently
      // remove capacity — a slow leak into total unavailability.
      const hanging = writeHangingWorker();
      const pool = makePool({
        ZK_PROVE_CONCURRENCY: '1',
        ZK_PROVE_TIMEOUT_MS: '400',
        ZK_PROVE_WORKER_PATH: hanging,
      });

      await expect(
        pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' }),
      ).rejects.toThrow(ProverTimeoutError);

      // The dead worker was dropped, so the pool can spawn a fresh one.
      expect(pool.stats().busy).toBe(0);

      // And a second job is still accepted rather than rejected as busy.
      await expect(
        pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' }),
      ).rejects.toThrow(ProverTimeoutError);
    }, 30_000);
  });

  it('reports its configured limits', () => {
    const pool = makePool({
      ZK_PROVE_CONCURRENCY: '3',
      ZK_PROVE_QUEUE_LIMIT: '7',
      ZK_PROVE_TIMEOUT_MS: '1234',
    });
    expect(pool.stats()).toMatchObject({
      concurrency: 3,
      queueLimit: 7,
      timeoutMs: 1234,
    });
  });

  it('never claims every core by default', () => {
    // The main thread still has an API to serve.
    const pool = makePool();
    expect(pool.stats().concurrency).toBeLessThanOrEqual(
      Math.max(1, os.cpus().length - 1),
    );
    expect(pool.stats().concurrency).toBeGreaterThanOrEqual(1);
  });

  it('rejects outstanding work on shutdown rather than hanging', async () => {
    const workerPath = writeSlowWorker(5000);
    const pool = makePool({
      ZK_PROVE_CONCURRENCY: '1',
      ZK_PROVE_WORKER_PATH: workerPath,
    });

    const inFlight = pool.prove({ witness: {}, wasmPath: 'x', zkeyPath: 'y' });
    await new Promise((r) => setTimeout(r, 50));
    await pool.onModuleDestroy();

    await expect(inFlight).rejects.toThrow(/shutting down/i);
  }, 30_000);
});
