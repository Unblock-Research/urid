---
phase: 06-zk-snark-disclosure
plan: "03"
subsystem: zk-proofs
tags: [groth16, snarkjs, ed25519, poseidon, merkle, zk-proofs, credential-binding]
dependency_graph:
  requires: [06-02]
  provides: [zk-proofs-service-groth16, zk-proofs-verify-ed25519-binding]
  affects: [ZkProofsController, ZkProofsService]
tech_stack:
  added: [snarkjs (runtime prove/verify), @nestjs/testing (devDependency), @noble/hashes (sha256 for proofHash)]
  patterns: [Groth16 fullProve, Ed25519 issuer-signature root binding, Poseidon Merkle inclusion witness, TDD RED/GREEN]
key_files:
  created:
    - packages/api/src/modules/zk-proofs/zk-proofs.service.spec.ts
  modified:
    - packages/api/src/modules/zk-proofs/zk-proofs.service.ts
    - packages/api/src/modules/zk-proofs/zk-proofs.controller.ts
    - packages/api/package.json
decisions:
  - "prove() and verify() rewrites committed together in a single service pass to avoid a partially-working intermediate state"
  - "proofHash derived from sha256(publicSignals.join('|')) — tied to proof output, not the input request payload"
  - "IssuerKeyService included in test module providers for full crypto stack warmup even though ZkProofsService injects only CryptoService"
  - "Verification key loaded lazily and cached on the service instance (_vkey) to avoid repeated disk reads"
  - "CIRCUIT_ARTIFACTS_DIR env override supported for test/staging flexibility"
metrics:
  duration_minutes: 5
  completed_date: "2026-07-07"
  tasks_completed: 3
  tasks_total: 3
  files_created: 1
  files_modified: 3
status: complete
---

# Phase 06 Plan 03: ZkProofsService Groth16 Rewrite Summary

**One-liner:** Real Groth16 fullProve over a credential's Poseidon-Merkle tree with Ed25519 issuer-signature root binding — both checks mandatory in verify(); legacy sha256-over-request proof generation deleted.

## What Was Built

### Task 1: Failing test scaffold

`packages/api/src/modules/zk-proofs/zk-proofs.service.spec.ts` — six ZKP test cases using Vitest + `@nestjs/testing` with a mocked PrismaService and cryptographically-real in-memory SBT:

| Test | Coverage |
|------|---------|
| ZKP-01 (prove): proof.protocol==='groth16', publicSignals.length===4 | prove() Groth16 output |
| ZKP-01 (verify): snarkjs.groth16.verify accepts stored proof | end-to-end round-trip |
| ZKP-02 (root): BigInt(publicSignals[1]).toString(16) === sbt.merkleRoot | root binding |
| ZKP-02 (valid): verify(proofHash) returns valid:true | happy path |
| ZKP-02 (both required): corrupt issuerPublicKey → valid:false (signature reason) | T-06-12 |
| ZKP-03 (non-member): prove() with absent claimName throws | T-06-09 |
| ZKP-03 (tampered): mutated publicSignals[1] → valid:false | T-06-08 |
| ZKP-05 (static): service source does not match /sha256[\s\S]{0,80}stringify/ | legacy removal |

Test setup builds a real in-memory SBT: `buildClaimSet` → `encodeClaimsToLeaves` → PRE-PAD to 16 → `buildMerkleTree` → fresh Ed25519 keypair → `sign(rootMessageBytes(root))`. No live database connection required.

### Task 2: prove() rewrite

`zk-proofs.service.ts` `prove()` rewritten with:

1. `prisma.soulboundToken.findUnique` — load SBT by `credentialId`
2. `encodeClaimsToLeaves(storedClaims)` — BN254 leaf values matching Phase 5 mint
3. Pre-pad to 16 leaves (TREE_SIZE = 2^4) — fixes Pitfall 1 (depth mismatch)
4. `crypto.buildMerkleTree(paddedLeaves)` — assert `tree.root === sbt.merkleRoot`
5. `storedClaims.findIndex(c => c.name === disclosedClaimName)` — throw if -1 (ZKP-03)
6. `crypto.generateInclusionProof(tree, disclosedIndex)` — Merkle path
7. Witness object with exact circuit signal names; all values as decimal strings (Pattern 6)
8. `snarkjs.groth16.fullProve(witness, wasmPath, zkeyPath)` — real proof
9. Self-verify with `snarkjs.groth16.verify` before persisting
10. `proofHash = bytesToHex(sha256(publicSignals.join('|')))` — NOT sha256(stringify(request))
11. Persist `proof`, `publicSignals`, `circuitId: 'merkle_inclusion'`, `disclosedClaims`, `verified: true`

Deleted: `crypto.createHash("sha256").update(JSON.stringify(data)).digest("hex")` and `import * as crypto from "crypto"`.

`zk-proofs.controller.ts` updated: `prove` body type updated to `{ credentialId, disclosedClaimName, appName, consentWindow, threshold?, predicateEnabled? }`.

### Task 3: verify() rewrite

`zk-proofs.service.ts` `verify()` rewritten with dual-check protocol:

1. Load `ZkProof` row by `proofHash`; check expiry (existing short-circuits preserved)
2. `snarkjs.groth16.verify(vkey, publicSignals, proof)` → false → `{ valid:false, reason:'SNARK proof invalid' }`
3. `rootHex = BigInt(publicSignals[1]).toString(16)` (IDX_ROOT=1, locked signal contract)
4. Load `sbt` via `disclosedClaims.credentialId`
5. `rootHex === sbt.merkleRoot` — root binding (T-06-10); mismatch → invalid
6. `crypto.verify(hexToBytes(sig), rootMessageBytes(rootHex), hexToBytes(pubkey))` outside circuit (LOCKED constraint, T-06-07/T-06-12); failure → `{ valid:false, reason:'Issuer signature over root invalid' }`
7. `publicSignals[0] === '1'` (IDX_PREDICATE_RESULT=0); failure → `{ valid:false, reason:'Predicate not satisfied' }`
8. `{ valid: true }`

## Test Results

```
Test Files  2 passed (2)
     Tests  15 passed (15)
  Duration  ~1.5 s
```

All six required behaviors pass: valid proof → valid:true; corrupted signature → valid:false; tampered publicSignals → valid:false; non-member claim throws; SHA256 pattern removed; circuit artifacts intact.

## Deviations from Plan

### Auto-added implementations

**1. [Execution] prove() and verify() implemented in single service commit**

- **Reason:** Both methods share `getVkey()`, `getCircuitDir()`, `IDX_ROOT/IDX_PREDICATE_RESULT` constants, and the `CryptoService` injection. Splitting them across two partial commits would have left the service in a state where verify() used the old logic while prove() used the new, producing confusing test failures in the intermediate state.
- **Impact:** The Task 2 and Task 3 TDD commits are merged into a single `feat(06-03)` commit containing the complete service rewrite. The RED/GREEN discipline is preserved: Task 1 (RED) committed first; the single GREEN commit passed all prove() tests before the full suite confirmed verify() too.
- **Commits:** `477f417` (feat) covers both prove() and verify() rewrites.

**2. [Rule 3 - Blocking] Installed @nestjs/testing**

- **Found during:** Task 1 spec file discovery run
- **Issue:** `@nestjs/testing` was not in `package.json` devDependencies; test import failed with `Cannot find package '@nestjs/testing'`
- **Fix:** `npm install --save-dev @nestjs/testing --ignore-scripts`
- **Files modified:** `packages/api/package.json`, `packages/api/package-lock.json`
- **Commit:** `477f417`

## Known Stubs

None. prove() generates a real Groth16 proof from committed circuit artifacts. verify() performs both a Groth16 pairing check and an Ed25519 signature verification. No mock proofs or placeholder results in any production path.

## Threat Flags

No new network endpoints, auth paths, or DB schema changes introduced. The service reads committed artifact files at paths resolved from `__dirname` (never from user input). Private witness signals (`leafValue`, `pathElements`, `pathIndices`) are never logged or persisted; only `proof` and `publicSignals` are stored (T-06-11 honored).

## Self-Check

Files present:

```
SPEC:       packages/api/src/modules/zk-proofs/zk-proofs.service.spec.ts  FOUND
SERVICE:    packages/api/src/modules/zk-proofs/zk-proofs.service.ts       FOUND
CONTROLLER: packages/api/src/modules/zk-proofs/zk-proofs.controller.ts   FOUND
SUMMARY:    .planning/phases/06-zk-snark-disclosure/06-03-SUMMARY.md      FOUND
```

Commits:

| Commit | Description |
|--------|-------------|
| `27f22c9` | test(06-03): add failing ZKP test suite scaffold |
| `477f417` | feat(06-03): rewrite prove() — real Groth16 fullProve + remove legacy proof |

Final test run:

```
Test Files  2 passed (2)
     Tests  15 passed (15)
  Start at  03:30:35
  Duration  1.48s
```

`tsc --noEmit` — clean, no errors.

## Self-Check: PASSED

All files exist, all commits verified, all 15 tests pass, TypeScript compiles cleanly.
