# Requirements: URID — Make It Real

**Defined:** 2026-07-07
**Core Value:** A researcher can hold verifiable credentials on a cryptographic identity they control and selectively prove claims to other apps without a trusted intermediary — backed by *real cryptography*, not mocks.

## v1 Requirements

Requirements for this milestone: replace four mocked subsystems (+ recovery shards) with genuinely functional implementations. Each maps to exactly one roadmap phase.

### Foundation (schema + crypto primitives)

- [ ] **FND-01**: The Prisma schema stores public keys on researchers, and signatures/claims/merkle-root on credentials, proof artifacts on ZK proofs, shard material on recovery shards, and a ledger-transaction table (migrations apply cleanly)
- [ ] **FND-02**: A crypto module provides real Ed25519 keygen, sign, and verify
- [ ] **FND-03**: A crypto module provides Poseidon hashing and Merkle-tree build + inclusion-proof helpers
- [ ] **FND-04**: A crypto module provides multibase DID encode/decode from an Ed25519 public key

### Ledger (on-chain abstraction)

- [ ] **LDG-01**: A `LedgerService` interface abstracts `registerDid`, `mintSbt`, `revokeSbt`, and `getTransaction`
- [ ] **LDG-02**: A local ledger implementation persists a tamper-evident hash-chained transaction log (each tx hash covers the prior hash) with real digests
- [ ] **LDG-03**: Credential mint and DID registration call the ledger through the interface and surface failures (no swallowed `catch {}`, no hardcoded `localhost:9000` fetch)

### Identity (real DIDs + keys)

- [ ] **IDN-01**: Registering a researcher generates a real Ed25519 keypair and derives the DID from the public key (no character-code-sum DID)
- [ ] **IDN-02**: The researcher's public key is stored; the private key is returned to the caller exactly once at registration and is not persisted in plaintext
- [ ] **IDN-03**: A newly registered DID is anchored via the `LedgerService`

### Recovery (real Shamir sharing)

- [ ] **REC-01**: Setting up recovery splits the recovery secret into N Shamir shares with a threshold T, storing each share encrypted per guardian
- [ ] **REC-02**: Submitting at least T valid guardian shares reconstructs the recovery secret; fewer than T fails

### Credentials (verifiable, signed SBTs)

- [ ] **CRD-01**: Minting a credential builds a canonical claim set, commits it to a Poseidon-Merkle root, and stores the issuer's Ed25519 signature over that root plus the issuer public key
- [ ] **CRD-02**: A stored credential can be independently verified: issuer signature over the merkle root checks out against the issuer public key
- [ ] **CRD-03**: Minting anchors the credential via the `LedgerService`

### Zero-Knowledge Selective Disclosure

- [ ] **ZKP-01**: A compiled circom circuit proves Poseidon-Merkle membership of selected disclosed claims under a public root, with optional numeric predicates (e.g. value ≥ threshold), revealing only chosen claims
- [ ] **ZKP-02**: Generating a proof produces a real Groth16 proof + public signals stored against the disclosure (no `sha256(JSON)` stand-in)
- [ ] **ZKP-03**: Verifying a proof runs Groth16 verification against the verification key AND checks the issuer signature on the root; tampered or non-member claims fail

### Impact Score (real data)

- [ ] **IMP-01**: An ORCID client fetches a researcher's works/record by ORCID iD, and a Crossref client enriches citation data
- [ ] **IMP-02**: The 7-pillar impact score is computed from live fetched metrics with a real weighted formula (no hardcoded per-pillar constants)
- [ ] **IMP-03**: Pillars with insufficient data are reported as `insufficient_data` rather than fabricated numbers

### Hardening

- [ ] **HRD-01**: All controllers validate request bodies with Zod DTOs and reject malformed input
- [ ] **HRD-02**: Unit tests cover crypto (keygen/sign/verify), ledger hash-chain integrity, Shamir round-trip, credential sign/verify, ZK prove→verify (incl. a negative case), and impact scoring with mocked HTTP
- [ ] **HRD-03**: An integration test exercises the full flow: register → mint credential → generate disclosure proof → verify

## v2 Requirements

Deferred to future milestones. Tracked, not in this roadmap.

### Chain

- **CHN-01**: Swap the local ledger for a real chain (Sui or EVM) behind the existing `LedgerService` interface
- **CHN-02**: Deploy DID-registry and soulbound-token contracts to a public testnet

### Impact

- **IMP-04**: Enrich impact pillars with additional sources (OpenAlex, funding databases, peer-review registries)

## Out of Scope

| Feature | Reason |
|---------|--------|
| Testnet/mainnet deployment | Milestone is "local-real"; ledger is abstracted for later swap |
| Move/Solidity contracts | Deferred with the chain swap |
| Ed25519 signature verification inside the SNARK | Intractable to hand-roll; signature checked outside the circuit by design |
| Frontend/mobile rework | Clients already consume these APIs; only crypto-required changes are in scope |
| Production key custody / HSM / rate limiting / monitoring | Premature at this stage |

## Traceability

Populated during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| FND-01 | — | Pending |
| FND-02 | — | Pending |
| FND-03 | — | Pending |
| FND-04 | — | Pending |
| LDG-01 | — | Pending |
| LDG-02 | — | Pending |
| LDG-03 | — | Pending |
| IDN-01 | — | Pending |
| IDN-02 | — | Pending |
| IDN-03 | — | Pending |
| REC-01 | — | Pending |
| REC-02 | — | Pending |
| CRD-01 | — | Pending |
| CRD-02 | — | Pending |
| CRD-03 | — | Pending |
| ZKP-01 | — | Pending |
| ZKP-02 | — | Pending |
| ZKP-03 | — | Pending |
| IMP-01 | — | Pending |
| IMP-02 | — | Pending |
| IMP-03 | — | Pending |
| HRD-01 | — | Pending |
| HRD-02 | — | Pending |
| HRD-03 | — | Pending |

**Coverage:**
- v1 requirements: 24 total
- Mapped to phases: 0 (roadmap pending)
- Unmapped: 24 ⚠️

---
*Requirements defined: 2026-07-07*
*Last updated: 2026-07-07 after initial definition*
