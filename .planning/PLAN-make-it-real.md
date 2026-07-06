# Plan — Make URID Real

**Created:** 2026-07-07
**Goal:** Replace the four mocked subsystems (+ recovery shards) with genuinely functional implementations. No behavior-faking left behind.

## Locked decisions
| Area | Choice |
|---|---|
| Target level | **Local-real** — real crypto + real external data, blockchain via local dev ledger (testnet-swappable later) |
| ZK / disclosure | **zk-SNARKs** (circom + snarkjs, Groth16) |
| Chain | **Abstract `LedgerService` interface** backed by a tamper-evident local ledger; swap to Sui/EVM later without touching business logic |
| Impact data | **ORCID + Crossref** live APIs |

## What's fake today → what it becomes
| Subsystem | Today (file) | Real target |
|---|---|---|
| DIDs / keys | char-code sum → `did:ub:0x…` (`identity.service.ts:11`), no keys | Ed25519 keypair; DID = multibase public key (`did:ub:z6Mk…`) |
| Recovery | guardian-name rows only (`identity.service.ts:51`) | Shamir secret sharing of the recovery secret, T-of-N, encrypted per guardian |
| Credentials | plain DB row, on-chain fire-and-forget (`credentials.service.ts:18`) | Signed Verifiable Credential (issuer Ed25519 sig over Poseidon Merkle root of claims), anchored on ledger |
| ZK proofs | `sha256(JSON)` (`zk-proofs.service.ts:14`) | Groth16 proof of Merkle-membership of disclosed claims (+ predicates) under a signed root |
| Impact score | hardcoded constants (`impact.service.ts:6`) | Weighted 7-pillar score from live ORCID + Crossref metrics; "insufficient data" where signal is thin |
| On-chain | `fetch(localhost:9000)` + `catch {}` | `LedgerService` abstraction; hash-chained local ledger; failures surfaced |

---

## Phase 0 — Schema + crypto foundation *(everything depends on this)*
**Prisma migrations:**
- `Researcher`: add `publicKey String?`, `keyType String @default("Ed25519")`, `encryptedPrivateKey String?`
- `SoulboundToken`: add `claims Json?`, `merkleRoot String?`, `issuerSignature String?`, `issuerPublicKey String?`, `issuerDid` (exists)
- `ZkProof`: add `proof Json?`, `publicSignals Json?`, `circuitId String?`, `disclosedClaims Json?`, `verified Boolean @default(false)` (keep `proofHash` as lookup key)
- `RecoveryShard`: add `encryptedShard String?`, `shardIndex Int?`, `threshold Int?`
- New `LedgerTransaction`: `id, index Int, type, payload Json, txHash String @unique, prevHash String, createdAt`

**Crypto module** (`packages/api/src/crypto/`): Ed25519 keygen/sign/verify (`@noble/ed25519`), Poseidon hashing + Merkle tree (`circomlibjs`), multibase DID encode/decode. Deps: `@noble/ed25519`, `@noble/hashes`, `circomlibjs`, `multiformats`.

## Phase 1 — Ledger abstraction *(unblocks identity + credentials)*
- `LedgerService` interface: `registerDid`, `mintSbt`, `revokeSbt`, `getTransaction`.
- `LocalLedgerService`: append-only, hash-chained (`txHash = sha256(canonical(tx) + prevHash)`) → tamper-evident, real digests, persisted in `LedgerTransaction`.
- Delete `fetch(localhost:9000)` + `catch {}` in `credentials.service.ts` and `identity.service.ts`; inject ledger; surface errors.

## Phase 2 — Real DIDs + keys
- `identity.register`: generate Ed25519 keypair → DID from public key → store `publicKey`; return private key **once** to client (+ optional passphrase-encrypted storage). Remove char-code hash.
- Anchor DID via `LedgerService.registerDid`.

## Phase 3 — Shamir recovery
- `setupRecovery`: split recovery secret into N shards, threshold T (`shamir-secret-sharing`), encrypt each per guardian, store `encryptedShard`/`shardIndex`/`threshold`.
- Add `recoverIdentity(did, shards[])`: reconstruct when ≥T shards submitted.

## Phase 4 — Verifiable credentials
- `credentials.mint`: build canonical `claims` → Poseidon Merkle tree → issuer signs root (Ed25519) → store `claims`/`merkleRoot`/`issuerSignature`/`issuerPublicKey`; anchor via ledger. SBT becomes a real signed VC.

## Phase 5 — zk-SNARK selective disclosure *(hardest; depends on Phase 4)*
- Circom circuit (`packages/api/circuits/disclosure.circom`): prove Poseidon-Merkle membership of disclosed leaves under a public root + optional comparator predicates (e.g. `hIndex >= X`), revealing only selected claims.
- Groth16 local trusted setup (powers-of-tau); commit `.wasm`, `.zkey`, verification key as artifacts. Build script documented.
- `zk-proofs.prove`: snarkjs `groth16.fullProve` → store `proof`/`publicSignals`/`disclosedClaims`/`circuitId`.
- `zk-proofs.verify`: `groth16.verify` against vkey **and** check issuer signature on the root. Replaces the sha256 lookup.

## Phase 6 — Real impact score
- `packages/api/src/modules/impact/sources/`: `OrcidClient` (public API, by `orcidId`) + `CrossrefClient` (citations by DOI). axios already present.
- `ImpactMetricsService`: compute pillars from real metrics — knowledge (works/venues), impact (citations/h-index), review (ORCID peer-review), leadership (co-authors), recognition (ORCID funding); ethics/repro from OA/preprint availability. Missing signal → `insufficient_data`, not a fake number.
- `impact.calculate`: real weighted formula over live metrics; store raw metrics + pillars. Delete hardcoded constants.

## Phase 7 — Hardening
- Zod DTOs + validation on all controllers (none today).
- Unit tests: crypto, ledger hash-chain, Shamir round-trip, VC sign/verify, zk prove→verify, impact scoring (mocked HTTP). Integration: full onboarding → mint → prove → verify.
- Config/env: `LEDGER_MODE`, circuit artifact paths, ORCID/Crossref base URLs. Update `.planning/codebase/CONCERNS.md`.

---

## New dependencies
`@noble/ed25519`, `@noble/hashes`, `circomlibjs`, `multiformats`, `shamir-secret-sharing`, `snarkjs` (runtime); `circom` compiler + powers-of-tau (build-time).

## Dependency order
0 → 1 → {2 → 3, 4 → 5}, 6 independent, 7 last. Phase 5 is the critical-path risk.

## Biggest risk
Phase 5. Verifying an Ed25519 signature *inside* a SNARK is expensive, so the design keeps signature verification **outside** the circuit (verifier checks issuer signed the Merkle root) and proves only **Merkle membership + predicates inside** the circuit — a standard, tractable circom pattern. This keeps "real ZK" honest without an intractable circuit.
