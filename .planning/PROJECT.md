# URID — Universal Researcher Identity

## What This Is

URID is a decentralized identity, reputation, and credential platform for researchers — a self-sovereign "researcher passport." A researcher owns a DID and cryptographic keys; their academic accomplishments (degrees, publications, peer reviews, awards) attach to that identity as Soulbound Tokens, and they prove facts about themselves to third-party apps via zero-knowledge selective disclosure. It ships as a pnpm monorepo: a NestJS API, a Next.js web app, a React Native mobile app, and a shared package.

## Core Value

A researcher can hold verifiable credentials on a cryptographic identity they control, and selectively prove claims about themselves to other apps **without a trusted intermediary and without over-disclosing** — and those guarantees must be *real cryptography*, not mocked.

## Requirements

### Validated

<!-- Inferred from existing code (brownfield). These capabilities exist end-to-end but are currently backed by mocked/fake implementations — see Context. -->

- ✓ Researcher registration and profile management (handle, DID, ORCID, affiliations) — existing (`identity` module)
- ✓ Credential (SBT) mint / list / revoke — existing (`credentials` module)
- ✓ Selective-disclosure "proof" create / verify / revoke + audit log — existing (`zk-proofs` module)
- ✓ Affiliation records, wallet links, connected apps — existing (`affiliations`, `wallet` modules)
- ✓ 7-pillar impact score endpoint — existing (`impact` module)
- ✓ Social-recovery guardian setup — existing (`identity.setupRecovery`)
- ✓ NestJS + Prisma + PostgreSQL persistence, Swagger docs, web + mobile clients — existing

### Active

<!-- This milestone: replace the four mocked subsystems (+ recovery) with genuinely functional implementations. No behavior-faking left behind. -->

- [ ] Real cryptographic DIDs — Ed25519 keypairs; DID derived from the public key (replaces character-code-sum DID)
- [ ] Real social recovery — Shamir secret sharing of the recovery secret, T-of-N, encrypted per guardian (replaces label-only shards)
- [ ] Real verifiable credentials — issuer-signed SBTs over a Poseidon-Merkle claim commitment (replaces plain DB rows)
- [ ] Real zero-knowledge selective disclosure — Groth16 circom circuit proving Merkle membership + predicates (replaces `sha256(JSON)`)
- [ ] Real on-chain anchoring — abstract `LedgerService` backed by a tamper-evident hash-chained local ledger (replaces fire-and-forget `fetch` + swallowed errors)
- [ ] Real impact score — computed from live ORCID + Crossref data (replaces hardcoded constants)
- [ ] Hardening — Zod DTO validation on all controllers, unit + integration tests for the above

### Out of Scope

- Public testnet / mainnet deployment — this milestone is "local-real"; the ledger is abstracted for later swap to Sui/EVM without touching business logic
- On-chain Move/Solidity contracts — deferred with the chain swap
- Frontend/mobile rework — clients already consume these APIs; changes limited to what real crypto requires (e.g. returning a generated private key once at registration)
- Production key custody / HSM / rate limiting / monitoring — premature at this stage
- Proving Ed25519 signature verification *inside* the SNARK — intractable to hand-roll; signature is checked outside the circuit by design (see Key Decisions)

## Context

**Technical environment:** TypeScript 5.8 across all packages; NestJS 11 + Prisma 6.11 + PostgreSQL backend (port 3001, Swagger at `/api/docs`); Next.js 15 web; React Native 0.77 / Expo 52 mobile; pnpm workspace. `axios` and `zod` already present as deps. A local blockchain RPC was assumed at `http://localhost:9000` ("Unblock Chain") but is not implemented.

**Why this milestone exists:** An audit of the four headline subsystems found each one mocks its own value proposition:
- ZK proofs are `sha256(JSON.stringify(data))` — no circuit, no zero-knowledge (`zk-proofs.service.ts:14`)
- DIDs are the sum of handle character codes — no keypairs (`identity.service.ts:11`)
- On-chain minting is `fetch("http://localhost:9000/…")` wrapped in `catch {}` — failures silently vanish (`credentials.service.ts:18`, `identity.service.ts:23`)
- Impact score returns hardcoded constants (~84.2) identical for every researcher (`impact.service.ts:6`)
- Recovery shards are guardian-name rows with no secret material (`identity.service.ts:51`)

**Critical schema gap:** the Prisma schema stores no public keys, no credential signatures/claims, no shard material, and no proof artifacts — so real implementations are impossible until Phase 0 migrations add them. A full plan lives at `.planning/PLAN-make-it-real.md`, and the codebase map at `.planning/codebase/`.

## Constraints

- **Tech stack**: Stay on NestJS 11 / Prisma 6.11 / PostgreSQL / TypeScript — extend, don't rewrite. The four client-facing API contracts should remain compatible where possible.
- **Security**: All four subsystems must use real cryptography (real keypairs, real signatures, real Shamir sharing, real SNARK proofs). "Looks real in a demo" is explicitly not acceptable.
- **Dependencies**: New crypto/circuit deps — `@noble/ed25519`, `@noble/hashes`, `circomlibjs`, `multiformats`, `shamir-secret-sharing`, `snarkjs` (runtime); `circom` + powers-of-tau (build-time).
- **Target level**: Local-real — real crypto + real external data reads, blockchain via a swappable local dev ledger (no testnet/faucet/keys this milestone).

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Local-real target level | Real crypto + real external data now; defer chain deployment. Best real-vs-effort balance. | — Pending |
| zk-SNARKs (circom + snarkjs, Groth16) for disclosure | User wants genuine ZK with predicate support (e.g. "h-index > X") | — Pending |
| Ed25519 signature verified **outside** the SNARK; circuit proves Poseidon-Merkle membership + predicates only | Verifying a full signature inside a circuit is intractable to hand-roll; this is the standard, tractable pattern and still yields genuine ZK selective disclosure | — Pending |
| Abstract `LedgerService` + hash-chained local ledger | Tamper-evident, real tx digests now; swap to Sui/EVM later without touching business logic | — Pending |
| Impact score from live ORCID + Crossref | Real, verifiable publication/citation signal; ORCID also anchors identity | — Pending |
| DID = multibase-encoded Ed25519 public key (`did:ub:z6Mk…`) | Self-certifying, registry-free (did:key semantics under the custom `did:ub` method) | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-07-07 after initialization*
