---
phase: 01-schema-crypto-foundation
plan: "03"
subsystem: crypto
tags: [ed25519, did, multibase, crypto, primitives]
requirements: [FND-02, FND-04]

dependency_graph:
  requires: ["01-02"]
  provides: [crypto/ed25519, crypto/did]
  affects: ["phases 3-7 that consume CryptoService"]

tech_stack:
  added:
    - "@noble/ed25519 v2 (sign/verify with SHA-512 hook)"
    - "@noble/hashes sha512 (provides SHA-512 for noble ed25519)"
    - "multiformats v13 base58btc (loaded via dynamic import — pure ESM)"
  patterns:
    - "SHA-512 hook wired at module load via etc.sha512Sync / etc.sha512Async"
    - "Dynamic import() cached at module scope for ESM-in-CJS interop"
    - "Varint multicodec header [0xed, 0x01] prepended before multibase encode"

key_files:
  created:
    - packages/api/src/crypto/ed25519.ts
    - packages/api/src/crypto/ed25519.spec.ts
    - packages/api/src/crypto/did.ts
    - packages/api/src/crypto/did.spec.ts
  modified: []

decisions:
  - "SHA-512 hook assigned to both ed.etc.sha512Sync and ed.etc.sha512Async at module load, not per-call, so NestJS DI consumers get it for free"
  - "multiformats loaded with dynamic import() and cached in a module-scoped variable to satisfy the pure-ESM library under the CommonJS build target"
  - "ed25519-pub multicodec header is [0xed, 0x01] (varint of 0xed = 237), producing the standard z6Mk... base58btc-multibase prefix as in did:key"
  - "decodeDid validates both the did:ub: method prefix and the [0xed, 0x01] multicodec header bytes before returning key material (mitigates T-01-07)"

metrics:
  duration: "< 5 minutes"
  completed: "2026-07-07"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  tests_added: 8
  tests_passing: 8

status: complete
---

# Phase 01 Plan 03: Ed25519 + DID Primitives Summary

Ed25519 keygen/sign/verify and did:ub multibase encode/decode as standalone, fully-tested modules under `packages/api/src/crypto/`.

## What Was Built

**Task 1 — Ed25519 keygen / sign / verify** (`dd11482`)

`packages/api/src/crypto/ed25519.ts` exports three async functions:

- `generateKeypair()` — returns `{ publicKey: Uint8Array(32), privateKey: Uint8Array(32) }` using `ed.utils.randomPrivateKey()` and `ed.getPublicKeyAsync()`
- `sign(message, privateKey)` — 64-byte signature
- `verify(signature, message, publicKey)` — boolean; catches noble exceptions and returns `false`

The SHA-512 hook is assigned to `ed.etc.sha512Sync` and `ed.etc.sha512Async` from `@noble/hashes/sha512` at module load. Without this, `@noble/ed25519` v2 throws on first sign/verify.

Spec covers: key-size assertion, roundtrip pass, wrong-keypair fail, tampered-message fail. All 4 pass.

**Task 2 — did:ub multibase encode / decode** (`45b48f3`)

`packages/api/src/crypto/did.ts` exports:

- `encodeDid(publicKey)` — prepends [0xed, 0x01] (varint of ed25519-pub multicodec 0xed), base58btc-multibase encodes the 34 bytes, returns `did:ub:z6Mk…`
- `decodeDid(did)` — strips `did:ub:` prefix, base58btc-decodes, asserts the [0xed, 0x01] header, returns the 32-byte public key

`multiformats` v13 is pure ESM; `base58btc` is loaded via `await import('multiformats/bases/base58')` and cached in a module-scoped variable to avoid re-importing on every call and to satisfy the CommonJS build target.

Spec covers: `z6Mk` prefix assertion, exact-bytes round-trip, malformed-string rejection, wrong-method rejection. All 4 pass.

## Deviations from Plan

None — plan executed exactly as written.

## Threat Mitigations Applied

| Threat ID | Mitigation |
|-----------|------------|
| T-01-05 | Negative spec tests (wrong-keypair, tampered-message) confirm `verify` returns `false` |
| T-01-06 | SHA-512 hook wired at module load; roundtrip test catches any signing breakage |
| T-01-07 | `decodeDid` rejects inputs with wrong method prefix or wrong multicodec header |

## Known Stubs

None.

## Threat Flags

None — no new network endpoints, auth paths, or file access patterns introduced.

## Self-Check: PASSED

- `packages/api/src/crypto/ed25519.ts` — FOUND
- `packages/api/src/crypto/ed25519.spec.ts` — FOUND
- `packages/api/src/crypto/did.ts` — FOUND
- `packages/api/src/crypto/did.spec.ts` — FOUND
- Commit `dd11482` — FOUND (feat(01-03): Ed25519 keygen/sign/verify)
- Commit `45b48f3` — FOUND (feat(01-03): did:ub multibase encode/decode)
- All 8 vitest tests pass
