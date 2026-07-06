# Roadmap: URID — Make It Real

## Overview

This milestone replaces the four mocked subsystems (ZK proofs, DIDs/keys, on-chain anchoring, impact score) plus recovery shards with genuinely functional implementations. Every phase delivers a coherent, independently verifiable cryptographic capability. The chain starts with a shared schema + crypto foundation, then forks into two parallel tracks (identity/recovery and credentials/ZK), with impact score running independently, and hardening closing everything out.

**Locked constraint:** Ed25519 signature verification stays OUTSIDE the SNARK circuit. The circuit proves Poseidon-Merkle membership + predicates only. This constraint must be honored in every plan that touches Phase 6.

## Phases

- [x] **Phase 1: Schema + Crypto Foundation** - Migrate schema to store all real-crypto fields; build Ed25519, Poseidon/Merkle, and DID encode/decode primitives ✓ verified 2026-07-07 (20/20 tests)
- [x] **Phase 2: Ledger Abstraction** - Implement `LedgerService` interface + tamper-evident hash-chained local ledger; eliminate all fire-and-forget `fetch` calls ✓ verified 2026-07-07 (mock fetch/catch removed)
- [x] **Phase 3: Real DIDs + Keys** - Registration generates real Ed25519 keypairs, derives DID from public key, anchors via ledger ✓ verified 2026-07-07 (char-code DID removed)
- [x] **Phase 4: Shamir Recovery** - Social recovery backed by real Shamir secret sharing with T-of-N encrypted per-guardian shares ✓ verified 2026-07-07 (no-leak confirmed)
- [x] **Phase 5: Verifiable Credentials** - SBTs become signed VCs with Poseidon-Merkle claim commitment and issuer Ed25519 signature over the root ✓ verified 2026-07-07 (recompute-based tamper detection)
- [x] **Phase 6: zk-SNARK Selective Disclosure** - Real Groth16 circom circuit proves Merkle membership + predicates; replaces sha256(JSON) proofs ✓ verified 2026-07-07 (real Groth16, sha256 mock removed)
- [x] **Phase 7: Real Impact Score** - 7-pillar score computed from live ORCID + Crossref data; hardcoded constants removed ✓ verified 2026-07-07 (84.2 constant removed, data-driven)
- [ ] **Phase 8: Hardening** - Zod DTO validation on all controllers; unit + integration tests across the full crypto stack

## Phase Details

### Phase 1: Schema + Crypto Foundation
**Goal**: The Prisma schema stores all real-crypto fields and a shared crypto module provides the primitives every subsequent phase depends on
**Depends on**: Nothing (first phase)
**Requirements**: FND-01, FND-02, FND-03, FND-04
**Success Criteria** (what must be TRUE):
  1. Prisma migrations apply cleanly: `Researcher` gains `publicKey`/`keyType`, `SoulboundToken` gains `claims`/`merkleRoot`/`issuerSignature`/`issuerPublicKey`, `ZkProof` gains `proof`/`publicSignals`/`circuitId`/`disclosedClaims`/`verified`, `RecoveryShard` gains `encryptedShard`/`shardIndex`/`threshold`, and a new `LedgerTransaction` model exists
  2. `CryptoService.generateKeypair()` returns a valid Ed25519 keypair; signing a message and verifying against the same keypair succeeds; verifying against a different keypair returns false
  3. `CryptoService.buildMerkleTree(leaves)` constructs a Poseidon-hashed tree; generating an inclusion proof for a known leaf and verifying it against the root passes; a non-member leaf fails verification
  4. `CryptoService.encodeDid(publicKey)` returns a `did:ub:z6Mk…` multibase-encoded string; decoding round-trips back to the original public key bytes
**Plans**: 5 plans
- [ ] 01-01-PLAN.md — Baseline + additive Prisma migration (crypto fields + LedgerTransaction) [FND-01]
- [ ] 01-02-PLAN.md — Crypto deps + vitest test tooling (package legitimacy gate) [FND-02, FND-03, FND-04]
- [ ] 01-03-PLAN.md — Ed25519 keygen/sign/verify + did:ub encode/decode primitives [FND-02, FND-04]
- [ ] 01-04-PLAN.md — Poseidon/Merkle build + inclusion proof (circom-compatible) [FND-03]
- [ ] 01-05-PLAN.md — Injectable CryptoService + global CryptoModule assembly [FND-02, FND-03, FND-04]

### Phase 2: Ledger Abstraction
**Goal**: All on-chain interactions route through a real `LedgerService` interface backed by a tamper-evident, hash-chained local ledger; the codebase contains no `fetch(localhost:9000)` calls and no swallowed `catch {}` blocks
**Depends on**: Phase 1
**Requirements**: LDG-01, LDG-02, LDG-03
**Success Criteria** (what must be TRUE):
  1. `LedgerService` exposes `registerDid`, `mintSbt`, `revokeSbt`, and `getTransaction`; any call that fails propagates an error to the caller (no silent swallowing)
  2. The local ledger appends transactions where each `txHash = sha256(canonical(tx) + prevHash)`; fetching two consecutive transactions shows the second tx's `prevHash` equals the first tx's `txHash`
  3. `identity.service.ts` and `credentials.service.ts` contain no references to `http://localhost:9000` and no bare `catch {}` blocks that hide ledger failures
**Plans**: 2 plans
- [ ] 02-01-PLAN.md — LedgerService interface + hash-chained LocalLedgerService + LedgerModule [LDG-01, LDG-02]
- [ ] 02-02-PLAN.md — Rewire identity/credentials to inject LedgerService; delete mock fetch + swallowed catch; store real txHash [LDG-03]

### Phase 3: Real DIDs + Keys
**Goal**: Researcher registration generates a genuine Ed25519 keypair, derives the DID from the public key via multibase encoding, stores the public key, returns the private key exactly once, and anchors the DID on the ledger
**Depends on**: Phase 2
**Requirements**: IDN-01, IDN-02, IDN-03
**Success Criteria** (what must be TRUE):
  1. `POST /api/identity/register` returns a DID in `did:ub:z6Mk…` format (not a character-code sum) and includes the generated private key in the response body
  2. The `Researcher` record in the database has a non-null `publicKey`; no raw private key field is persisted in the database
  3. A `LedgerTransaction` of type `registerDid` exists for the new DID immediately after a successful registration call
  4. Calling `register` a second time with the same handle returns a conflict error (deduplication still functions correctly)
**Plans**: 1 plan
- [ ] 03-01-PLAN.md — Rewrite register(): real Ed25519 keypair + did:ub DID, store publicKey, return privateKey once, ledger-anchor; delete char-code DID + did override [IDN-01, IDN-02, IDN-03]

### Phase 4: Shamir Recovery
**Goal**: Social recovery splits the recovery secret into N Shamir shares with threshold T, encrypted per guardian; reconstructing with ≥T valid shares succeeds and with <T shares fails
**Depends on**: Phase 3
**Requirements**: REC-01, REC-02
**Success Criteria** (what must be TRUE):
  1. `POST /api/identity/setup-recovery` with N guardians and threshold T creates exactly N `RecoveryShard` records, each with non-null `encryptedShard`, `shardIndex`, and `threshold` fields
  2. Submitting ≥T valid, correctly-keyed guardian shares to the recovery endpoint reconstructs the recovery secret and returns a success response
  3. Submitting fewer than T shares to the recovery endpoint returns a failure response without disclosing any partial secret material
**Plans**: 2 plans
- [ ] 04-01-PLAN.md — Package-legitimacy checkpoint + install shamir-secret-sharing [REC-01, REC-02]
- [ ] 04-02-PLAN.md — Rewrite setupRecovery (Shamir split + per-guardian AES-256-GCM) + add recover + reconstruct route + tests [REC-01, REC-02]

### Phase 5: Verifiable Credentials
**Goal**: Minted SBTs become real verifiable credentials — the issuer builds a canonical claim set, commits it to a Poseidon-Merkle root, signs the root with Ed25519, and the signature can be independently verified
**Depends on**: Phase 2
**Requirements**: CRD-01, CRD-02, CRD-03
**Success Criteria** (what must be TRUE):
  1. `POST /api/credentials/mint` returns a credential where `merkleRoot`, `issuerSignature`, and `issuerPublicKey` are all non-null strings
  2. For a stored credential, `Ed25519.verify(issuerSignature, merkleRoot, issuerPublicKey)` returns true; mutating any stored claim field causes the same verification to return false
  3. A `LedgerTransaction` of type `mintSbt` exists for the credential immediately after a successful mint call
**Plans**: 2 plans
- [ ] 05-01-PLAN.md — Shared claim→field-element encoder (crypto/claim-encoding.ts) + env-backed injectable Ed25519 issuer key provider [CRD-01]
- [ ] 05-02-PLAN.md — Extend mint() (claim set → Poseidon-Merkle root → issuer signature, keep ledger anchor) + verifyCredential + verify route + mandatory tests [CRD-01, CRD-02, CRD-03]

### Phase 6: zk-SNARK Selective Disclosure
**Goal**: Selective-disclosure proofs use a real compiled circom Groth16 circuit that proves Poseidon-Merkle membership and optional numeric predicates; the sha256(JSON) stand-in is eliminated; Ed25519 signature verification remains outside the circuit
**Depends on**: Phase 5
**Requirements**: ZKP-01, ZKP-02, ZKP-03
**Constraint**: The circom circuit proves Poseidon-Merkle membership + predicates ONLY. Ed25519 issuer-signature verification is performed outside the circuit by the verifier. This boundary must not be crossed.
**Success Criteria** (what must be TRUE):
  1. A compiled `.wasm` + `.zkey` + verification key artifact set exists for the disclosure circuit; `POST /api/zk-proofs/prove` stores a real Groth16 `proof` and `publicSignals` (no `sha256` string as proof)
  2. `GET /api/zk-proofs/verify` on a valid proof returns verified: the Groth16 verifier passes against the verification key AND the issuer's Ed25519 signature on the Merkle root is confirmed
  3. A proof generated from a claim not present in the original Merkle tree fails verification
  4. A proof with a numeric predicate (e.g. `hIndex >= threshold`) correctly passes when the predicate holds and fails when the predicate does not hold
**Plans**: 3 plans
- [ ] 06-01-PLAN.md — Package-legitimacy checkpoint + install snarkjs + circomlib [ZKP-01]
- [ ] 06-02-PLAN.md — circom disclosure circuit + build script + Groth16 trusted setup → committed wasm/zkey/vkey + artifact smoke test [ZKP-01]
- [ ] 06-03-PLAN.md — Rewrite prove() (real fullProve, delete sha256 stub) + verify() (groth16.verify AND Ed25519 root binding) + mandatory tests [ZKP-01, ZKP-02, ZKP-03]

### Phase 7: Real Impact Score
**Goal**: The 7-pillar impact score is computed from live ORCID and Crossref API data; hardcoded constants are removed; pillars with insufficient data report `insufficient_data` instead of fabricated numbers
**Depends on**: Phase 1 (schema foundation; independent of crypto chain — can execute in parallel with Phases 2–6)
**Requirements**: IMP-01, IMP-02, IMP-03
**Success Criteria** (what must be TRUE):
  1. `GET /api/impact/:did` for a researcher with a valid ORCID iD performs real outbound HTTP calls to the ORCID and Crossref public APIs (verifiable via test mocks or network logs)
  2. Two researchers with different ORCID records and publication histories receive different computed impact scores (the same constant is not returned for all)
  3. A researcher with no publications has at least one pillar returned as `insufficient_data` rather than a positive non-zero constant
**Plans**: 3 plans
- [ ] 07-01-PLAN.md — Injectable OrcidClient + CrossrefClient under sources/ (axios, env base URLs, mockable, graceful errors) [IMP-01]
- [ ] 07-02-PLAN.md — Pure metrics helper: h-index over citation vector + documented [0,1] normalization curves [IMP-02]
- [ ] 07-03-PLAN.md — Rewrite calculate()/getScore(): real 7-pillar score, insufficient_data + renormalized total, delete 84.2 mock, mandatory mocked-HTTP tests [IMP-02, IMP-03]

### Phase 8: Hardening
**Goal**: All controllers reject malformed input via Zod DTOs; the full crypto stack (keygen, ledger, Shamir, credentials, ZK proofs, impact) is covered by unit tests; an end-to-end integration test passes the complete onboarding flow
**Depends on**: Phases 1–7
**Requirements**: HRD-01, HRD-02, HRD-03
**Success Criteria** (what must be TRUE):
  1. Sending a request body with a missing required field to any controller returns HTTP 400 with a structured validation error — not a 500 Internal Server Error
  2. Unit tests pass for: Ed25519 keygen/sign/verify, ledger hash-chain integrity, Shamir round-trip, credential sign/verify, Groth16 prove→verify (including a negative non-member case), and impact scoring with mocked HTTP responses
  3. The integration test `register → mint credential → generate disclosure proof → verify` completes end-to-end without errors and all assertions pass
**Plans**: 4 plans
- [ ] 08-01-PLAN.md — Custom ZodValidationPipe (zod, no new dep) + pipe unit test [HRD-01, HRD-02]
- [ ] 08-02-PLAN.md — DTO schemas + wiring for core-flow controllers (identity, credentials, zk-proofs) [HRD-01]
- [ ] 08-03-PLAN.md — DTO schemas + wiring for aux controllers (affiliations, wallet, impact param) — 6-of-6 coverage [HRD-01]
- [ ] 08-04-PLAN.md — End-to-end real-crypto integration test (register→mint→prove→verify) + mint Merkle-depth alignment + full-suite/tsc green gate [HRD-02, HRD-03]

## Progress

**Execution Order:**
`Phase 1 → Phase 2 → {Phase 3 → Phase 4} ∥ {Phase 5 → Phase 6} ∥ {Phase 7} → Phase 8`

Phases 3+4, 5+6, and 7 can execute in parallel after Phase 2 completes. Phase 8 requires all prior phases complete.

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Schema + Crypto Foundation | 0/5 | Not started | - |
| 2. Ledger Abstraction | 0/TBD | Not started | - |
| 3. Real DIDs + Keys | 0/1 | Not started | - |
| 4. Shamir Recovery | 0/2 | Not started | - |
| 5. Verifiable Credentials | 0/2 | Not started | - |
| 6. zk-SNARK Selective Disclosure | 0/3 | Not started | - |
| 7. Real Impact Score | 0/3 | Not started | - |
| 8. Hardening | 0/4 | Not started | - |
