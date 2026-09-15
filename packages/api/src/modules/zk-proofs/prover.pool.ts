/**
 * prover.pool.ts — bounded worker pool for Groth16 proving (high finding #3).
 *
 * THE PROBLEM:
 *   snarkjs.groth16.fullProve runs 1–5 s of WASM. On Node's single thread that
 *   blocks every other request for its whole duration, so a handful of
 *   concurrent proofs takes the entire API down — not just the proving endpoint.
 *
 * THE SHAPE OF THE FIX:
 *   Three separate limits, because moving work to a worker alone is not enough.
 *
 *   1. Child processes — proving leaves the event loop, so unrelated routes stay
 *                       responsive while proofs run. Processes rather than
 *                       worker threads because snarkjs's `web-worker` dependency
 *                       dispatches on `isMainThread` and breaks on import inside
 *                       a thread; a process also lets a wedged WASM loop be
 *                       killed outright, which a thread cannot reliably be.
 *   2. Concurrency    — a fixed worker count. Unbounded workers would just move
 *                       the contention to the CPU and start thrashing.
 *   3. A bounded queue — past that, reject immediately with 503. An unbounded
 *                       queue does not shed load, it hides it: callers wait
 *                       behind a backlog they cannot see, time out, retry, and
 *                       deepen it. A fast rejection is the honest answer.
 *
 * Per-job timeouts sit alongside these: a worker wedged inside WASM cannot be
 * interrupted cooperatively, so it is terminated and replaced.
 */

import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ChildProcess, fork } from 'child_process';
import * as os from 'os';
import * as path from 'path';

/** A proving job as handed to a worker. */
export interface ProveJob {
  witness: Record<string, unknown>;
  wasmPath: string;
  zkeyPath: string;
}

export interface ProveResult {
  proof: object;
  publicSignals: string[];
}

/** Thrown when the queue is full. The caller maps this to HTTP 503. */
export class ProverBusyError extends Error {
  constructor(queueLimit: number) {
    super(
      `Proving queue is full (limit ${queueLimit}) — the server is at capacity, retry shortly`,
    );
    this.name = 'ProverBusyError';
  }
}

/** Thrown when a job exceeds its time budget. */
export class ProverTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Proof generation exceeded ${timeoutMs}ms and was aborted`);
    this.name = 'ProverTimeoutError';
  }
}

interface PendingJob {
  id: number;
  job: ProveJob;
  resolve: (r: ProveResult) => void;
  reject: (e: Error) => void;
}

interface PoolWorker {
  child: ChildProcess;
  /** The job this worker is running, or null when idle. */
  current: PendingJob | null;
  timer: NodeJS.Timeout | null;
  /** False until the child reports snarkjs is loaded. */
  ready: boolean;
}

/** Defaults chosen to leave headroom for the rest of the API on a small box. */
function defaultConcurrency(): number {
  const envValue = Number(process.env.ZK_PROVE_CONCURRENCY);
  if (Number.isInteger(envValue) && envValue > 0) return envValue;
  // Never take every core: the main thread still has an API to serve.
  return Math.max(1, Math.min(2, os.cpus().length - 1));
}

function defaultQueueLimit(): number {
  const envValue = Number(process.env.ZK_PROVE_QUEUE_LIMIT);
  return Number.isInteger(envValue) && envValue > 0 ? envValue : 16;
}

function defaultTimeoutMs(): number {
  const envValue = Number(process.env.ZK_PROVE_TIMEOUT_MS);
  return Number.isInteger(envValue) && envValue > 0 ? envValue : 30_000;
}

@Injectable()
export class ProverPool implements OnModuleDestroy {
  private readonly logger = new Logger(ProverPool.name);

  // All configuration is resolved once, at construction. Reading env lazily
  // would let the pool's behaviour change mid-process depending on when a given
  // code path first ran.
  private readonly concurrency = defaultConcurrency();
  private readonly queueLimit = defaultQueueLimit();
  private readonly timeoutMs = defaultTimeoutMs();
  private readonly resolvedWorkerPath =
    process.env.ZK_PROVE_WORKER_PATH ??
    path.join(__dirname, '../../../workers/prove.worker.js');

  private readonly workers: PoolWorker[] = [];
  private readonly queue: PendingJob[] = [];
  private nextJobId = 1;
  private destroyed = false;

  /**
   * Absolute path to the worker script.
   *
   * `workers/` sits outside `src/`, so this resolves identically from
   * `src/modules/zk-proofs` under ts-node and from `dist/modules/zk-proofs`
   * after a build.
   */
  private workerPath(): string {
    return this.resolvedWorkerPath;
  }

  /** Current pool state — used by tests and useful for a health endpoint. */
  stats() {
    return {
      concurrency: this.concurrency,
      queueLimit: this.queueLimit,
      timeoutMs: this.timeoutMs,
      workers: this.workers.length,
      busy: this.workers.filter((w) => w.current !== null).length,
      ready: this.workers.filter((w) => w.ready).length,
      queued: this.queue.length,
    };
  }

  /**
   * Run a proving job on a worker.
   *
   * @throws ProverBusyError    when the queue is at its limit
   * @throws ProverTimeoutError when the job exceeds its time budget
   */
  async prove(job: ProveJob): Promise<ProveResult> {
    if (this.destroyed) {
      throw new Error('ProverPool has been shut down');
    }

    // Shed load rather than queueing without limit.
    const busy = this.workers.filter((w) => w.current !== null).length;
    if (busy >= this.concurrency && this.queue.length >= this.queueLimit) {
      throw new ProverBusyError(this.queueLimit);
    }

    return new Promise<ProveResult>((resolve, reject) => {
      this.queue.push({ id: this.nextJobId++, job, resolve, reject });
      this.dispatch();
    });
  }

  /** Hand queued jobs to idle workers, spawning up to `concurrency` of them. */
  private dispatch(): void {
    while (this.queue.length > 0) {
      // Only a ready worker can take a job: dispatching before snarkjs has
      // finished loading would bill that load to the job's timeout.
      let slot = this.workers.find((w) => w.current === null && w.ready);

      if (!slot && this.workers.length < this.concurrency) {
        this.spawn();
        return; // resumes from the child's ready signal
      }
      if (!slot) return; // all workers busy or still starting

      const pending = this.queue.shift()!;
      slot.current = pending;

      const assigned = slot;
      slot.timer = setTimeout(() => {
        // WASM cannot be interrupted cooperatively, so kill the process.
        this.logger.warn(
          `ProverPool: job ${pending.id} exceeded ${this.timeoutMs}ms — killing worker`,
        );
        this.failCurrent(assigned, new ProverTimeoutError(this.timeoutMs));
        this.replace(assigned);
      }, this.timeoutMs);

      slot.child.send({
        id: pending.id,
        witness: pending.job.witness,
        wasmPath: pending.job.wasmPath,
        zkeyPath: pending.job.zkeyPath,
      });
    }
  }

  private spawn(): PoolWorker {
    // execArgv: [] stops the child inheriting the parent's Node flags. Under a
    // test runner those install a loader that bootstraps the runner's own worker
    // runtime; the proving worker is plain CommonJS and needs no flags.
    const child = fork(this.workerPath(), [], {
      execArgv: [],
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    });
    const slot: PoolWorker = { child, current: null, timer: null, ready: false };

    child.on(
      'message',
      (msg: {
        ready?: boolean;
        id?: number;
        ok?: boolean;
        error?: string;
        proof?: object;
        publicSignals?: string[];
      }) => {
        if (msg.ready) {
          slot.ready = true;
          this.dispatch();
          return;
        }

        const pending = slot.current;
        // A late reply from a job already timed out — discard it.
        if (!pending || pending.id !== msg.id) return;

        this.clearTimer(slot);
        slot.current = null;

        if (msg.ok) {
          pending.resolve({
            proof: msg.proof as object,
            publicSignals: msg.publicSignals as string[],
          });
        } else {
          pending.reject(new Error(msg.error ?? 'Proof generation failed'));
        }

        this.dispatch();
      },
    );

    child.on('error', (err) => {
      this.logger.error(`ProverPool: worker error — ${err.message}`);
      this.failCurrent(slot, err);
      this.replace(slot);
    });

    child.on('exit', (code, signal) => {
      if (this.destroyed) return;
      this.failCurrent(
        slot,
        new Error(
          `Proving worker exited unexpectedly (code ${code}, signal ${signal})`,
        ),
      );
      this.replace(slot);
    });

    this.workers.push(slot);
    return slot;
  }

  private clearTimer(slot: PoolWorker): void {
    if (slot.timer) {
      clearTimeout(slot.timer);
      slot.timer = null;
    }
  }

  /** Reject whatever this worker was running, if anything. */
  private failCurrent(slot: PoolWorker, err: Error): void {
    this.clearTimer(slot);
    const pending = slot.current;
    slot.current = null;
    pending?.reject(err);
  }

  /** Drop a dead or wedged worker; the next dispatch spawns a replacement. */
  private replace(slot: PoolWorker): void {
    const idx = this.workers.indexOf(slot);
    if (idx >= 0) this.workers.splice(idx, 1);
    slot.ready = false;
    if (!slot.child.killed) slot.child.kill('SIGKILL');
    if (!this.destroyed) this.dispatch();
  }

  /** Terminate workers and fail anything still outstanding. */
  async onModuleDestroy(): Promise<void> {
    this.destroyed = true;

    for (const pending of this.queue.splice(0)) {
      pending.reject(new Error('ProverPool shutting down'));
    }
    for (const slot of this.workers.splice(0)) {
      this.failCurrent(slot, new Error('ProverPool shutting down'));
      if (!slot.child.killed) slot.child.kill('SIGKILL');
    }
  }
}
