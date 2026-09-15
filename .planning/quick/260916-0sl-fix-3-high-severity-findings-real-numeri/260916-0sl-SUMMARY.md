---
id: 260916-0sl
slug: fix-3-high-severity-findings-real-numeri
date: 2026-09-16
mode: quick
status: complete
branch: fix/critical-security-findings
tests: 367 passed (from 327)
depends_on: 260915-xbb
---

# Quick Task 260916-0sl — Summary

All three high-severity findings fixed, one atomic commit each, plus a bug
introduced by the previous task.

## Commits

| # | Finding | Commit |
|---|---------|--------|
| H1 | Predicate unenforceable | `83454db` make the threshold predicate a real numeric proof |
| H2 | Recovery custodial | `1b83308` move recovery custody to the holder's device |
| H3 | Proving blocks event loop | `3201326` move Groth16 proving off the request thread |

## What changed

**H1 — Real numeric predicate.** The predicate compared `claimValueHash` (a
~2^254 SHA-256 element) against a threshold, while `GreaterEqThan(64)` requires
inputs below 2^64 — so enabling it on any real claim failed witness generation,
and no claim in the system was numeric anyway. `verify()` also never checked the
threshold signals against the request, so a vacuous pass was indistinguishable
from a proven bound.

Numeric claims now commit as `poseidon([NUMERIC_VALUE_TAG, n])`, which the
circuit recomputes and constrains against the leaf — a prover who substitutes a
different `n` breaks Merkle membership. `verify()` binds `publicSignals[3]`/`[4]`
to the recorded request and returns `predicate: { enabled, threshold }`.

**Not breaking.** String claims encode exactly as before and a claim set with no
numeric claims serialises byte-identically. The string-only root of a reference
credential is pinned in the suite against the value produced by running the
pre-change encoder from commit `1777cd9`. `nPublic` stays 5.

**H2 — Client-side recovery.** The server generated the secret, split it, held
every ciphertext, returned every guardian key in one response, and reconstructed
on demand. It is now an encrypted blob store: new `src/crypto/recovery.ts` does
split/combine/encrypt/decrypt with no NestJS, Prisma, or I/O, so the identical
code runs in a browser, a mobile app, or a test. Server-side reconstruction was
removed, not relocated.

**H3 — Proving off the event loop.** A bounded pool of forked child processes,
with fixed concurrency, a bounded queue that sheds load with 503, and per-job
timeouts that kill and replace a stuck worker. Processes rather than worker
threads because snarkjs's `web-worker` dependency dispatches on `isMainThread`
and throws on import inside a thread.

## Bug fixed from the previous task

Commit `ff0b6fa` put `DidAuthGuard` on `POST /recovery/reconstruct`, requiring a
signature from the very key the user has lost — making social recovery
impossible. Resolved by deletion: reconstruction moved client-side, and
`GET /recovery/shards` is public because ciphertexts reveal nothing without
guardian keys.

## Verification

- 367 tests pass (327 at start; +40). `tsc` clean.
- The H3 test **measures** event-loop responsiveness during a real proof rather
  than asserting a worker exists.
- The H2 test asserts a negative: everything crossing the server boundary is
  serialised and checked to contain neither the secret nor any guardian key.
- The H1 no-re-mint claim is verified by running the previous commit's encoder,
  not by reasoning about the diff.

## Follow-ups NOT done

**Carried over from 260915-xbb and still open:**
- Credentials minted before `1777cd9` have stale roots and must be re-minted.
  The v2.1 numeric-claim change does NOT add to this.
- No client signs `DIDSig`, and no client implements `prepareRecovery()`. The
  web and mobile apps still make no API calls at all.
- `node dist/main.js` still fails on multiformats' ESM-only `base58` subpath;
  `ts-node` is not correctly installed in this workspace.

**New:**
- Nothing populates numeric claims yet. The mechanism is wired end-to-end and
  `POST /credentials/mint` accepts `numericClaims`, but no producer sets them —
  the obvious one is impact metrics (citation count, h-index), which would need
  the impact module wired to credential issuance.

**Medium findings, still open:** 7 duplicate PrismaService providers, error-code
hygiene, ledger `index` constraint, ORCID ownership proof, the leadership pillar
reporting a fabricated 0, mocked wallet/affiliations, disconnected frontends,
dead `@urid/shared`, CORS ports.
