/**
 * prove.worker.js — Groth16 proving, off the request thread.
 *
 * WHY A CHILD PROCESS RATHER THAN A WORKER THREAD:
 *   snarkjs depends on `web-worker`, whose Node shim dispatches on
 *   `worker_threads.isMainThread` alone:
 *
 *       module.exports = threads.isMainThread ? mainThread() : workerThread();
 *
 *   Inside any worker thread that is false, so merely requiring snarkjs makes
 *   web-worker assume it is one of its own workers and destructure a
 *   `workerData` we never set — it throws before proving can start. A forked
 *   process is the main thread of its own process, so the shim takes the branch
 *   it expects.
 *
 *   The isolation is also stronger: a proof wedged inside WASM cannot be
 *   interrupted cooperatively, and a process can be killed outright where a
 *   thread cannot reliably be.
 *
 * WHY PLAIN JAVASCRIPT, OUTSIDE src/:
 *   `tsc` would rewrite a .ts file into dist/ and the path would then differ
 *   between `ts-node src/main.ts` and `node dist/main.js`. Committed CommonJS at
 *   a fixed location resolves identically from both — the same approach the
 *   circuit artifacts already use.
 *
 * PROTOCOL — long-lived, one job at a time. Spawning per proof would add process
 * startup plus a fresh snarkjs load to every request.
 *
 *   in:  { id, witness, wasmPath, zkeyPath }
 *   out: { id, ok: true, proof, publicSignals }
 *        { id, ok: false, error }
 */

'use strict';

if (typeof process.send !== 'function') {
  throw new Error('prove.worker.js must be run as a forked child process');
}

// Loaded once per process rather than per job.
const snarkjs = require('snarkjs');

process.on('message', async (job) => {
  const { id, witness, wasmPath, zkeyPath } = job;
  try {
    const { proof, publicSignals } = await snarkjs.groth16.fullProve(
      witness,
      wasmPath,
      zkeyPath,
    );
    process.send({ id, ok: true, proof, publicSignals });
  } catch (err) {
    // Errors do not survive IPC serialisation with their prototype, so send the
    // message text and let the pool rebuild an Error.
    process.send({
      id,
      ok: false,
      error: (err && err.message) || String(err),
    });
  }
});

// Ready signal: the pool waits for this before dispatching, so the snarkjs load
// is not counted against the first job's timeout.
process.send({ ready: true });
