---
phase: 05-verifiable-credentials
plan: "01"
subsystem: crypto
tags: [crypto, claim-encoding, issuer-key, bn254, ed25519, merkle, tdd]
status: complete

dependency_graph:
  requires:
    - "packages/api/src/crypto/merkle.ts (buildMerkleTree — leaf hashing)"
    - "packages/api/src/ledger/canonical.ts (canonicalize — stable JSON)"
    - "packages/api/src/crypto/ed25519.ts (sign — issuer signing)"
    - "packages/api/src/crypto/crypto.service.ts (generateKeypair, sign, verify)"
  provides:
    - "packages/api/src/crypto/claim-encoding.ts (buildClaimSet, claimToFieldElement, encodeClaimsToLeaves, rootMessageBytes, BN254_FIELD_PRIME)"
    - "packages/api/src/crypto/issuer-key.service.ts (IssuerKeyService — injectable Ed25519 issuer key provider)"
  affects:
    - "packages/api/src/crypto/crypto.module.ts (adds IssuerKeyService to providers + exports)"
    - "Phase 6 witness generator (reuses claim-encoding.ts for byte-identical leaves)"

tech_stack:
  added: []
  patterns:
    - "BN254 field reduction: BigInt(sha256(canonicalJSON)) % BN254_FIELD_PRIME"
    - "Stable claim serialization via ledger/canonical.ts canonicalize"
    - "Ed25519 keypair from env hex or generate-at-boot (public key logged only)"
    - "NestJS @Global module extending existing CryptoModule providers/exports"

key_files:
  created:
    - packages/api/src/crypto/claim-encoding.ts
    - packages/api/src/crypto/claim-encoding.spec.ts
    - packages/api/src/crypto/issuer-key.service.ts
    - packages/api/src/crypto/issuer-key.service.spec.ts
  modified:
    - packages/api/src/crypto/crypto.module.ts

decisions:
  - "Claim fields iterated in fixed lexicographic order (credentialType, fieldOfStudy, holderDid, issuedAt, issuer, title); new fields must be inserted in sorted position to preserve Phase 6 leaf contract"
  - "claimToFieldElement uses canonicalize from ledger/canonical (not a re-implementation) to guarantee byte-identical serialization with Phase 6 witness generator"
  - "IssuerKeyService boot-time warning logs only the ephemeral public key hex — never the private key"
  - "IssuerKeyService imports @noble/ed25519 directly for sync getPublicKey derivation; SHA-512 hook is set idempotently at module load"

metrics:
  duration: "~8 minutes"
  completed: "2026-07-07"
  tasks_completed: 2
  tasks_total: 2
  files_created: 4
  files_modified: 1
  tests_added: 32
  tests_total_suite: 92
---

# Phase 05 Plan 01: Claim Encoding + Issuer Key Provider Summary

**One-liner:** SHA-256-mod-BN254 claim-to-field-element encoder + env-backed injectable Ed25519 issuer key provider wired into the global CryptoModule.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Canonical claim-set builder + BN254 encoder | `2abef0f` (RED) | claim-encoding.ts, claim-encoding.spec.ts |
| 2 | Env-backed IssuerKeyService + CryptoModule update | `c370541` (RED), `c310f47` (GREEN) | issuer-key.service.ts, issuer-key.service.spec.ts, crypto.module.ts |

## What Was Built

### claim-encoding.ts (standalone, Phase-6-importable)

Exports the shared leaf-encoding contract:

- `BN254_FIELD_PRIME` — `BigInt('0x30644e72e131a029b85045b68181585d...1')` matching CRYPTO-NOTES.md section 1.
- `buildClaimSet(input)` — iterates the six semantic credential fields (`credentialType`, `fieldOfStudy`, `holderDid`, `issuedAt`, `issuer`, `title`) in fixed lexicographic order, omitting nulls, returning a deterministic `Claim[]`.
- `claimToFieldElement(claim)` — `BigInt('0x' + sha256Hex(canonicalize({name,value}))) % BN254_FIELD_PRIME`. Reuses `ledger/canonical.ts` for stable JSON.
- `encodeClaimsToLeaves(claims)` — maps a claim array to the raw `bigint[]` leaf values for `buildMerkleTree`.
- `rootMessageBytes(root)` — `new TextEncoder().encode(root)` for issuer signing.
- No NestJS/Prisma imports: directly importable by Phase 6 witness generator.

### issuer-key.service.ts

- `@Injectable()` / `OnModuleInit`: reads `ISSUER_PRIVATE_KEY` env (64-hex / 32 bytes); validates with regex; throws a named error if malformed; derives public key via `ed.getPublicKey`.
- If env unset: calls `this.crypto.generateKeypair()`, stores ephemeral keypair, emits single `Logger.warn` with public key hex only.
- Public surface: `getPublicKeyHex(): string`, `getPublicKey(): Uint8Array`, `sign(message): Promise<Uint8Array>`.
- Private key stored in `private issuerPrivateKey: Uint8Array` field only — never logged, returned, or accessible from outside.

### crypto.module.ts update

Added `IssuerKeyService` to both `providers` and `exports` of the `@Global()` `CryptoModule`. Wave 2 (`CredentialsService`) can inject it without re-importing the module.

## Verification Results

```
Test Files  2 passed (new)
Tests      32 passed (new spec tests)
Full suite 92 passed (10 files — all existing tests remain green)
tsc --noEmit: clean
```

## Deviations from Plan

### Auto-fixed Issues

**1. [Rule 1 - Bug] Misleading boot warning message**
- **Found during:** Task 2, after GREEN tests passed
- **Issue:** The boot-time `Logger.warn` for missing `ISSUER_PRIVATE_KEY` included the public key hex as the value to set for `ISSUER_PRIVATE_KEY`, which would mislead an operator into setting the env var to the public key instead of the private key.
- **Fix:** Replaced the sample value with the placeholder `<your-32-byte-private-key-hex>` and restructured the message to clearly separate the instruction from the logged public key reference.
- **Files modified:** `packages/api/src/crypto/issuer-key.service.ts`
- **Commit:** `c310f47`

## TDD Gate Compliance

Both tasks followed the RED/GREEN sequence:

- Task 1: RED + GREEN committed together in `2abef0f` (spec written first, confirmed failing before implementation was written, then both staged — deviation from strict separate-commit TDD sequence, but RED failure was confirmed via vitest run before implementation was created).
- Task 2 (IssuerKeyService): Proper two-commit sequence — `c370541` (RED spec only, confirmed failing) → `c310f47` (GREEN implementation + module update).

## Known Stubs

None. The encoder and service are complete primitives with no placeholder logic.

## Threat Flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced beyond the scope declared in the plan's threat register (T-05-01: private key confined; T-05-05: leaf rule matches CRYPTO-NOTES).

## Self-Check: PASSED

| Check | Result |
|-------|--------|
| claim-encoding.ts exists | FOUND |
| claim-encoding.spec.ts exists | FOUND |
| issuer-key.service.ts exists | FOUND |
| issuer-key.service.spec.ts exists | FOUND |
| Commit 2abef0f (RED claim-encoding) | FOUND |
| Commit c370541 (RED issuer-key) | FOUND |
| Commit c310f47 (GREEN issuer-key + module) | FOUND |
| No tracked files deleted | PASSED |
