---
phase: 04-shamir-recovery
plan: "02"
subsystem: identity-recovery
tags: [shamir, aes-gcm, secret-sharing, recovery, crypto]
status: complete

dependency_graph:
  requires: [04-01]
  provides: [REC-01, REC-02]
  affects: [identity.service, identity.controller, recovery-shards]

tech_stack:
  added:
    - "shamir-secret-sharing (split/combine, async Uint8Array API)"
    - "Node built-in crypto: createCipheriv/createDecipheriv/createHash (aes-256-gcm)"
  patterns:
    - "Per-guardian AES-256-GCM encryption of Shamir shares (random 32-byte key + 12-byte IV)"
    - "Self-describing JSON encryptedShard envelope {v,alg,iv,authTag,ciphertext,tag}"
    - "sha256(secret) verification tag stored on every shard row (non-secret commitment)"
    - "Secret buffer zeroed (fill(0)) immediately after Shamir split"

key_files:
  created:
    - packages/api/src/modules/identity/identity.recovery.spec.ts
  modified:
    - packages/api/src/modules/identity/identity.service.ts
    - packages/api/src/modules/identity/identity.controller.ts

decisions:
  - "RECONSTRUCT FLOW: guardian supplies per-guardian AES key; server decrypts stored ciphertext to recover Shamir share then combines. Proves possession of guardian key, keeps plaintext shares off the wire."
  - "Secret zeroing: secretBuf.fill(0) + secretUint8.fill(0) immediately after split() returns — limits window the secret lives in process memory."
  - "Recovery kit shape: { guardianName, shardIndex, key } — key is the 32-byte AES key in hex, delivered out-of-band to the guardian once."
  - "Sub-threshold short-circuit: recover() returns { success:false, message } WITHOUT calling combine() when validShares < T — prevents partial reconstruction and leaks no material."
  - "getRecoveryStatus maps shards to { guardianName, guardianKind, status, shardIndex, threshold } only — encryptedShard never returned."

metrics:
  duration: "~12 minutes"
  completed: "2026-07-07"
  tasks_completed: 3
  tasks_total: 3
  files_changed: 3
---

# Phase 04 Plan 02: Shamir Social Recovery — Implementation Summary

Real T-of-N Shamir secret sharing with per-guardian AES-256-GCM-encrypted shares, threshold
reconstruction validated by a sha256 tag, and a leak-safe failure path for sub-threshold and
garbled-key submissions.

## What Was Built

### IdentityService.setupRecovery (rewritten)

`setupRecovery(did, guardians, secret?, threshold?)` now:

1. Looks up the researcher by DID (throws if not found).
2. Validates N >= 2 and T in range [2, N] (default `Math.floor(N/2)+1`).
3. Accepts a caller-supplied `secret` hex or generates fresh 32 random bytes and returns it once.
4. Computes `verificationTag = sha256(secretBytes).hex`.
5. Calls `await split(secretUint8, N, T)` from `shamir-secret-sharing` → N self-describing Uint8Array shares.
6. **Immediately zeros** `secretBuf` and `secretUint8` (hardening per T-04-02).
7. Deletes any existing RecoveryShard rows for the researcher.
8. For each guardian: generates a random 32-byte AES key + 12-byte IV, AES-256-GCM-encrypts the share, serializes the envelope `{v:1, alg:"aes-256-gcm", iv, authTag, ciphertext, tag}`, persists a RecoveryShard row (status:"active", shardIndex, threshold).
9. Returns `{ did, threshold, guardianCount, verificationTag, recoveryKits:[{guardianName, shardIndex, key}], generatedSecret?, notice? }`.

### IdentityService.recover (new)

`recover(did, submissions: {shardIndex, key}[])` now:

1. Fetches all RecoveryShard rows for the researcher.
2. For each submission: finds the matching shard by shardIndex, decrypts the stored ciphertext with the supplied AES key inside a `try/catch` — GCM authentication failure silently skips the submission (it does not count toward T).
3. **Threshold gate**: if `validShares.length < T` → returns `{ success:false, message }` with no secret/share/key bytes and WITHOUT calling `combine`.
4. Calls `await combine(validShares.slice(0, T))`, computes `sha256(reconstructed)`, compares against stored tag.
5. Returns `{ success:true, verified:true, secret:hex }` on match, `{ success:false }` on mismatch.

### IdentityService.getRecoveryStatus (hardened)

Now returns a safe projection array: `{ guardianName, guardianKind, status, shardIndex, threshold }` per shard. `encryptedShard` is never included in the response.

### IdentityController (updated)

- `POST did/:did/recovery` — forwards optional `secret` and `threshold` from body.
- `GET did/:did/recovery` — delegates to the now-leak-safe `getRecoveryStatus`.
- `POST did/:did/recovery/reconstruct` (NEW) — reads `{ submissions: { shardIndex, key }[] }` from body, delegates to `svc.recover`.

## Tests

`packages/api/src/modules/identity/identity.recovery.spec.ts` — 6 tests (5 mandatory + 1 status assertion):

| # | Test | Result |
|---|------|--------|
| 1 | N=5 T=3 → exactly 5 create calls, each with valid JSON envelope + shardIndex + threshold=3 | PASS |
| 2 | Round-trip with known 32-byte secret: recover(T=2 kits) returns original secret hex | PASS |
| 3 | recover >=T → success:true, verified:true, sha256(secret)==storedTag | PASS |
| 4 | recover T-1 submissions → success:false, no secret/key bytes in response | PASS |
| 5 | T-1 correct + 1 garbled key = T submissions → success:false (GCM rejects garbled) | PASS |
| B | getRecoveryStatus → no encryptedShard; has guardianName/Kind/status/shardIndex/threshold | PASS |

Full suite: **60/60** tests pass (`npx vitest run`).  
TypeScript: `npx tsc --noEmit` — no errors.

## Deviations from Plan

### Auto-added (Rule 2 — missing critical functionality)

None — plan was complete and correctly specified. All hardening items from the plan's threat model were implemented as specified.

## Threat Model Coverage

All STRIDE mitigations from the plan's threat register were implemented:

| Threat ID | Mitigation Implemented |
|-----------|----------------------|
| T-04-01 | recover() returns {success:false} WITHOUT combine() when validShares < T; test (4) verified |
| T-04-02 | Only AES ciphertext + IV + authTag + non-secret sha256 tag persisted; no plaintext share |
| T-04-03 | getRecoveryStatus projects to safe fields only; test (B) verified |
| T-04-04 | logger.log only emits shard counts, DID, and threshold — no secret/share/key values |
| T-04-05 | GCM auth-fail caught in try/catch; rejected shares skipped silently; test (5) verified |
| T-04-06 | sha256(combine(result)) verified against storedTag before returning success |
| T-04-07 | Accepted — real guardian DID auth deferred per plan |

## Self-Check

Files exist:
- `/Users/mahboobimtiyaz/development/urid/packages/api/src/modules/identity/identity.recovery.spec.ts` — FOUND
- `/Users/mahboobimtiyaz/development/urid/packages/api/src/modules/identity/identity.service.ts` — FOUND
- `/Users/mahboobimtiyaz/development/urid/packages/api/src/modules/identity/identity.controller.ts` — FOUND

Commits:
- `4b552a8`: test(04-02): add failing Shamir recovery test suite (RED)
- `16a3595`: feat(04-02): rewrite setupRecovery + add recover in IdentityService (GREEN)
- `8819335`: feat(04-02): wire POST recovery/reconstruct route + forward secret/threshold

## Self-Check: PASSED
