---
phase: 03-real-dids-keys
verified: 2026-07-07T01:43:30Z
status: passed
score: 5/5 must-haves verified
behavior_unverified: 0
overrides_applied: 0
re_verification: false
---

# Phase 3: Real DIDs + Keys Verification Report

**Phase Goal:** Researcher registration generates a genuine Ed25519 keypair, derives the DID from the public key via multibase encoding, stores the public key, returns the private key exactly once, and anchors the DID on the ledger
**Verified:** 2026-07-07T01:43:30Z
**Status:** passed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| #   | Truth | Status | Evidence |
| --- | ----- | ------ | -------- |
| 1 | `POST /api/identity/register` returns a DID in `did:ub:z6Mk…` format (not a char-code sum) and includes the generated private key in the response body | VERIFIED | `charCodeAt` absent from identity.service.ts (grep exit 1); test (1) passes asserting `result.did` matches `/^did:ub:z6Mk/` AND does not match `/^did:ub:0x/`; test (2) passes asserting `result.privateKey` is a ~64-char hex string; logger output shows real DIDs (e.g. `did:ub:z6MkhJ6eLzFigycKv3DgdYfmdtDW4Cc4Gu1mkPtdZ5uY12yT`) |
| 2 | The `Researcher` record has a non-null `publicKey`; no raw private key field is persisted in the database | VERIFIED | Test (3) passes: `createArg.publicKey` is a non-null hex string, `keyType='Ed25519'`, `encryptedPrivateKey=null`, `createArg.privateKey=undefined`; no `console.log`/`logger` writes contain "privateKey" (grep exit 1) |
| 3 | A `LedgerTransaction` of type `register_did` exists for the new DID immediately after a successful registration call | VERIFIED | Test (4) passes: `fakeLedger.registerDid` called exactly once with `{did: /^did:ub:z6Mk/, publicKey: /^[0-9a-f]+/}`; `LocalLedgerService.registerDid()` calls `_enqueue('register_did', payload)` creating a DB-backed LedgerTransaction; `await` is used — ledger failure propagates (regression test also passes) |
| 4 | `decodeDid(result.did)` equals the stored public-key bytes — the DID is self-certifying | VERIFIED | Test (5) passes: real `CryptoService` used in unit test; `crypto.decodeDid(result.did)` compared byte-for-byte against `Buffer.from(createArg.publicKey, 'hex')` |
| 5 | A second register with the same handle returns a conflict; the external `did` override is removed (caller cannot spoof) | VERIFIED | Test (6) passes: duplicate handle throws `'Handle already taken'`, ledger not called; test (7) passes: external `did` field on input ignored — result always derives from generated key; controller body type is `{ handle: string; displayName: string }` with no `did?` field |

**Score:** 5/5 truths verified (0 present, behavior-unverified)

### Required Artifacts

| Artifact | Expected | Status | Details |
| -------- | -------- | ------ | ------- |
| `packages/api/src/modules/identity/identity.service.ts` | register() rewritten with real Ed25519 keypair + DID | VERIFIED | 91 lines; constructor injects CryptoService as third param; `charCodeAt` logic deleted; `privateKey` returned once in response, never stored |
| `packages/api/src/modules/identity/identity.controller.ts` | register body type drops spoofable `did?` field | VERIFIED | 45 lines; `@Body() body: { handle: string; displayName: string }` — no `did?` exposed |
| `packages/api/src/modules/identity/identity.service.spec.ts` | Service test suite covering all 4 ROADMAP success criteria | VERIFIED | 8 tests covering DID format, private-key-once, publicKey persisted / no plaintext key, register_did anchor, self-cert round-trip, dedup, no DID spoofing |

### Key Link Verification

| From | To | Via | Status | Details |
| ---- | -- | --- | ------ | ------- |
| `IdentityService.register()` | `CryptoService.generateKeypair()` + `encodeDid()` | Constructor injection; `CryptoModule` is `@Global()` — no module import change needed | WIRED | `private crypto: CryptoService` is 3rd constructor param; called on lines 22-23 of identity.service.ts |
| `IdentityService.register()` | `PrismaService.researcher.create()` | Constructor injection | WIRED | `publicKey: publicKeyHex`, `keyType: 'Ed25519'`; `encryptedPrivateKey` intentionally omitted |
| `IdentityService.register()` | `LedgerService.registerDid()` | Constructor injection; `IdentityModule` imports `LedgerModule` | WIRED | `await this.ledger.registerDid({ handle, did, publicKey: publicKeyHex })` on line 44; `await` ensures failures propagate |
| `LocalLedgerService.registerDid()` | `LedgerTransaction` DB record | `_enqueue('register_did', payload)` | WIRED | type string `'register_did'` confirmed in local-ledger.service.ts line 43 |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
| -------- | ------------- | ------ | ------------------ | ------ |
| `identity.service.ts` register() | `did`, `publicKeyHex`, `privateKeyHex` | `this.crypto.generateKeypair()` + `this.crypto.encodeDid()` — real Ed25519 via `@noble/ed25519` | Yes — fresh random keypair per call, DID derived via multibase | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
| -------- | ------- | ------ | ------ |
| register() returns `did:ub:z6Mk…` DID (not `0x` char-code) | `pnpm --filter @urid/api exec vitest run src/modules/identity/identity.service.spec.ts` | 8/8 tests pass; logger shows `did:ub:z6Mk…` DIDs in output | PASS |
| Full API test suite | `pnpm --filter @urid/api exec vitest run` | 54/54 tests pass across 7 files | PASS |
| TypeScript compilation | `pnpm --filter @urid/api exec tsc --noEmit` | 0 errors | PASS |
| `charCodeAt` legacy logic absent | `grep charCodeAt identity.service.ts` | exit 1 (not found) | PASS |
| Private key never logged | `grep -n "logger.*private\|log.*privateKey" identity.service.ts` | exit 1 (not found) | PASS |

### Probe Execution

No probes declared in PLAN or SUMMARY. Step 7c: N/A.

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
| ----------- | ----------- | ----------- | ------ | -------- |
| IDN-01 | 03-01-PLAN.md | DID derived from public key, self-certifying (`did:ub:z6Mk…`) | SATISFIED | `encodeDid(publicKey)` called; test (1) and (5) verify format and round-trip |
| IDN-02 | 03-01-PLAN.md | Public key stored; private key returned once, never persisted | SATISFIED | Tests (2) and (3) verify storage and return-once contract |
| IDN-03 | 03-01-PLAN.md | DID anchored via `ledger.registerDid` → `register_did` LedgerTransaction | SATISFIED | Test (4) verifies ledger call; `LocalLedgerService` creates `register_did` record |

### Anti-Patterns Found

No anti-patterns found in phase-modified files.

| File | Line | Pattern | Severity | Impact |
| ---- | ---- | ------- | -------- | ------ |
| — | — | None | — | — |

Scan covered: `identity.service.ts`, `identity.controller.ts`, `identity.service.spec.ts`. No `TBD`, `FIXME`, `XXX`, `TODO`, `HACK`, or `PLACEHOLDER` markers. No stub patterns (`return null`, `return []`, empty handlers). No private key in logger calls.

### Human Verification Required

None. All 4 ROADMAP success criteria are fully verifiable programmatically. The test suite uses a real `CryptoService` instance (not a mock), so DID format and self-certifying round-trip assertions exercise genuine cryptography. No UI behavior, real-time flow, or external service dependency is introduced in this phase.

### Gaps Summary

No gaps. All 4 ROADMAP Phase 3 success criteria are verified in code:

1. DID format is `did:ub:z6Mk…` — legacy `charCodeAt`-based `did:ub:0x…` logic is deleted and absent.
2. `Researcher.publicKey` is non-null hex; `encryptedPrivateKey` stays null; private key returned exactly once in response, never logged or stored.
3. `ledger.registerDid()` called with real DID + publicKey; `LocalLedgerService` anchors a `register_did` LedgerTransaction; await propagates failures.
4. Duplicate handle returns conflict; external `did` input removed from both the service signature and the controller body type; `decodeDid(did)` round-trips to the stored public-key bytes.

All 8 identity service tests and all 54 API suite tests pass. `tsc --noEmit` is clean.

---

_Verified: 2026-07-07T01:43:30Z_
_Verifier: Claude (gsd-verifier)_
