---
phase: 01-schema-crypto-foundation
verified: 2026-07-07T01:03:30Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 1: Schema + Crypto Foundation Verification Report

**Phase Goal:** The Prisma schema stores all real-crypto fields and a shared crypto module provides the primitives every subsequent phase depends on
**Verified:** 2026-07-07T01:03:30Z
**Status:** PASSED
**Re-verification:** No — initial verification

---

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | Prisma migrations apply cleanly; all crypto/ledger fields present; migration is additive (no DROP) | VERIFIED | `prisma migrate status` → "Database schema is up to date!" (2 migrations); migration SQL contains only ADD COLUMN + CREATE TABLE; 0 destructive ops confirmed |
| 2 | Ed25519 keygen/sign/verify: roundtrip true; wrong-key false; tampered-message false; SHA-512 hook wired | VERIFIED | `ed25519.ts` lines 14-15 wire SHA-512 sync+async; 4 spec tests + 2 service smoke tests; 20/20 tests pass |
| 3 | Poseidon/Merkle: member proof verifies true; non-member leaf false; mutated root false; params circom-compatible and documented | VERIFIED | `merkle.ts` uses `circomlibjs.buildPoseidon()`; 7 spec tests including T-01-08 non-member and mutated-root negatives; `CRYPTO-NOTES.md` documents all circom-compatible params; 20/20 tests pass |
| 4 | DID encode/decode: `encodeDid(pk)` returns `did:ub:z6Mk…`; `decodeDid` round-trips to original bytes; malformed input rejected | VERIFIED | `did.ts` prepends `[0xed, 0x01]` multicodec header + base58btc multibase; 4 spec tests covering roundtrip, malformed string, wrong method; 20/20 tests pass |

**Score:** 4/4 truths verified (0 behavior-unverified)

---

## Criterion Detail

### SC1 — FND-01: Schema + Migrations

**VERIFIED**

Schema fields present in `packages/api/src/prisma/schema.prisma`:

| Model | New Crypto Fields | Present |
|-------|-------------------|---------|
| `Researcher` | `publicKey String?`, `keyType String @default("Ed25519")`, `encryptedPrivateKey String?` | Yes |
| `SoulboundToken` | `claims Json?`, `merkleRoot String?`, `issuerSignature String?`, `issuerPublicKey String?` | Yes |
| `ZkProof` | `proof Json?`, `publicSignals Json?`, `circuitId String?`, `disclosedClaims Json?`, `verified Boolean @default(false)` | Yes |
| `RecoveryShard` | `encryptedShard String?`, `shardIndex Int?`, `threshold Int?` | Yes |
| `LedgerTransaction` | `id`, `index`, `type`, `payload Json`, `txHash String @unique`, `prevHash String`, `createdAt` | Yes (new model) |

Migration SQL (`20260706191026_add_crypto_and_ledger_fields/migration.sql`):
- **Only** `ALTER TABLE … ADD COLUMN` and `CREATE TABLE` operations confirmed
- Zero `DROP TABLE`, `DROP COLUMN`, or `TRUNCATE` operations
- All new columns are nullable (`TEXT`, `JSONB`, `INTEGER`) — existing rows unaffected

Live DB status:
```
prisma migrate status --schema src/prisma/schema.prisma
→ "Database schema is up to date!" (2 migrations found)
```

Both migrations (0_init baseline + crypto+ledger fields) applied cleanly.

---

### SC2 — FND-02: Ed25519 Keygen / Sign / Verify

**VERIFIED**

Implementation: `packages/api/src/crypto/ed25519.ts`

SHA-512 hook (required by @noble/ed25519 v2, fatal if absent):
```typescript
ed.etc.sha512Sync = (...msgs) => sha512(ed.etc.concatBytes(...msgs));
ed.etc.sha512Async = (...msgs) => Promise.resolve(ed.etc.sha512Sync!(...msgs));
```
Both sync and async hooks wired at module load (lines 14-15). Without this, `sign`/`verify` would throw at runtime.

Test coverage in `ed25519.spec.ts` (4 tests) and `crypto.service.spec.ts` (2 Ed25519 tests):
- `generateKeypair` returns 32-byte publicKey and 32-byte privateKey
- `sign` + `verify` roundtrip returns `true` for same keypair and message
- `verify` returns `false` for a different keypair's public key
- `verify` returns `false` for a tampered message

All 20 tests across 4 spec files PASS (vitest run confirmed).

---

### SC3 — FND-03: Poseidon / Merkle Build + Inclusion Proof

**VERIFIED**

Implementation: `packages/api/src/crypto/merkle.ts`

Construction parameters (circom-compatible):
- Hash function: `circomlibjs.buildPoseidon()` — identical round constants to circom's `poseidon()` template
- Arity: binary (2 children per node)
- Leaf hash: `poseidon([leafValue])`
- Node hash: `poseidon([leftChild, rightChild])` (order significant)
- Padding: next power-of-two using `poseidon([0n])` sentinel

Test coverage in `merkle.spec.ts` (7 tests):
- Deterministic root: same leaves → same root
- Different leaf order → different root
- Member proof: `verifyInclusionProof` returns `true` for all 4 leaves in a 4-leaf tree
- Non-member negative (T-01-08): wrong leaf hash with valid siblings → `false`
- Tamper negative: valid proof against a different tree's root → `false`
- Proof depth matches tree depth
- Single-leaf tree works (padded to depth 1)

`CRYPTO-NOTES.md` documents all circom-compatible params: BN254 scalar field, arity, leaf encoding, node hash formula, padding rule with zero sentinel value, proof field-name mapping to circom signals, root serialization rule, and the circuit boundary (Ed25519 stays outside the SNARK).

All 20 tests across 4 spec files PASS.

---

### SC4 — FND-04: DID Encode / Decode

**VERIFIED**

Implementation: `packages/api/src/crypto/did.ts`

Encoding: prepends 2-byte multicodec header `[0xed, 0x01]` (varint-encoded ed25519-pub) to the 32-byte public key, then base58btc-encodes the 34-byte buffer with the `z` multibase prefix. The leading bytes `[0xed, 0x01, ...]` base58btc-encode to the `z6Mk` prefix, matching did:key semantics.

Test coverage in `did.spec.ts` (4 tests):
- `encodeDid` returns a string starting with `"did:ub:z6Mk"`
- `decodeDid(encodeDid(pk))` round-trips to the original 32-byte public key (byte-for-byte equality)
- `decodeDid('not-a-did')` rejects with `throws`
- `decodeDid` with wrong method prefix (`did:key:…`) rejects with `throws`

All 20 tests across 4 spec files PASS.

---

## Required Artifacts

| Artifact | Description | Status | Details |
|----------|-------------|--------|---------|
| `packages/api/src/prisma/schema.prisma` | Updated Prisma schema with crypto fields | VERIFIED | All 17 crypto fields + LedgerTransaction model present |
| `packages/api/src/prisma/migrations/0_init/migration.sql` | Baseline migration (existing schema) | VERIFIED | 192-line CREATE TABLE baseline; no DROP ops |
| `packages/api/src/prisma/migrations/20260706191026_add_crypto_and_ledger_fields/migration.sql` | Additive crypto+ledger migration | VERIFIED | 5 ALTER TABLE ADD COLUMN blocks + 1 CREATE TABLE; no DROP ops |
| `packages/api/src/crypto/ed25519.ts` | Ed25519 keygen/sign/verify | VERIFIED | SHA-512 hook wired; uses @noble/ed25519 v2 |
| `packages/api/src/crypto/did.ts` | DID encode/decode | VERIFIED | Multicodec header + base58btc; malformed input rejected |
| `packages/api/src/crypto/merkle.ts` | Poseidon Merkle tree | VERIFIED | circomlibjs; binary; leaf/node hash; padding |
| `packages/api/src/crypto/crypto.service.ts` | Injectable CryptoService | VERIFIED | Delegates to all three primitives; OnModuleInit pre-warm |
| `packages/api/src/crypto/crypto.module.ts` | Global CryptoModule | VERIFIED | @Global(); exports CryptoService |
| `packages/api/src/crypto/CRYPTO-NOTES.md` | Circom parameter specification | VERIFIED | Full spec: field, arity, leaf/node hash, padding, proof format, circuit boundary |
| `packages/api/src/crypto/ed25519.spec.ts` | Ed25519 unit tests | VERIFIED | 4 tests: size, roundtrip, wrong-key, tampered |
| `packages/api/src/crypto/did.spec.ts` | DID unit tests | VERIFIED | 4 tests: format, roundtrip, malformed, wrong-method |
| `packages/api/src/crypto/merkle.spec.ts` | Merkle unit tests | VERIFIED | 7 tests incl. T-01-08 non-member + tampered-root |
| `packages/api/src/crypto/crypto.service.spec.ts` | CryptoService smoke tests | VERIFIED | 5 tests covering all three primitive paths |

---

## Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `app.module.ts` | `CryptoModule` | `imports: [CryptoModule]` | WIRED | CryptoModule registered globally in AppModule |
| `crypto.service.ts` | `ed25519.ts` | `import { generateKeypair, sign, verify }` | WIRED | All three functions imported and delegated |
| `crypto.service.ts` | `merkle.ts` | `import { buildMerkleTree, generateInclusionProof, verifyInclusionProof }` | WIRED | All three functions imported and delegated |
| `crypto.service.ts` | `did.ts` | `import { encodeDid, decodeDid }` | WIRED | Both functions imported and delegated |
| `ed25519.ts` | `@noble/ed25519` + `@noble/hashes/sha512` | SHA-512 hook + sign/verify/keygen | WIRED | Hook wired at module load; package at `^2.3.0`/`^1.8.0` |
| `merkle.ts` | `circomlibjs` | `require('circomlibjs')` + `buildPoseidon()` | WIRED | CommonJS require; lazy singleton; package at `^0.1.7` |
| `did.ts` | `multiformats/bases/base58` | dynamic `import()` cached at module scope | WIRED | ESM compatibility via cached dynamic import; package at `^13.4.2` |
| Downstream modules (identity, credentials, zk-proofs, recovery) | `CryptoService` | — | NOT YET WIRED | Correct for Phase 1 — wiring deferred to Phases 3–6 |

---

## Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| All crypto unit tests pass | `pnpm --filter @urid/api exec vitest run src/crypto/` | 4 test files, 20 tests, 0 failures | PASS |
| Prisma migration status clean | `pnpm --filter @urid/api exec prisma migrate status --schema src/prisma/schema.prisma` | "Database schema is up to date!" (2 migrations) | PASS |

---

## Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|------------|-------------|--------|----------|
| FND-01 | 01-01-PLAN.md | Prisma schema stores crypto fields + LedgerTransaction; migrations apply cleanly | SATISFIED | schema.prisma verified; migration SQL additive; migrate status clean |
| FND-02 | 01-02/03/05-PLAN.md | Real Ed25519 keygen, sign, verify | SATISFIED | ed25519.ts + CryptoService; 6 tests pass |
| FND-03 | 01-02/04/05-PLAN.md | Poseidon hashing + Merkle build + inclusion proof | SATISFIED | merkle.ts + CryptoService; 9 tests pass |
| FND-04 | 01-02/03/05-PLAN.md | Multibase DID encode/decode from Ed25519 public key | SATISFIED | did.ts + CryptoService; 5 tests pass |

---

## Anti-Patterns Found

Scanned: all files in `packages/api/src/crypto/` and `packages/api/src/prisma/`

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| — | — | — | — | None found |

No TBD/FIXME/XXX/TODO/HACK/PLACEHOLDER markers. No stub returns. No empty handlers. No hardcoded empty data arrays or objects flowing to rendering. All implementations are substantive.

---

## Scope Boundary (Positive Confirmation)

Per the Phase 1 CONTEXT.md: "No business-logic wiring into the existing services yet — those land in Phases 2–7."

Confirmed: `grep -rl "CryptoService" packages/api/src/modules/` returns empty. The six downstream modules (identity, credentials, zk-proofs, affiliations, wallet, impact) do not import CryptoService. CryptoModule is registered globally in AppModule so it is ready for injection in later phases without any additional module imports.

---

## Human Verification Required

None. All success criteria were fully verified programmatically:
- Schema fields verified by reading `schema.prisma`
- Migration non-destructiveness verified by reading SQL
- Migration apply status verified by running `prisma migrate status`
- Ed25519/Merkle/DID behaviors verified by running the test suite (20/20 pass)

---

## Gaps Summary

None. Phase 1 goal is fully achieved.

---

_Verified: 2026-07-07T01:03:30Z_
_Verifier: Claude (gsd-verifier)_
