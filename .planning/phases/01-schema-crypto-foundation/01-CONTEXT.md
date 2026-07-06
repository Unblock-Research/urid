# Phase 1: Schema + Crypto Foundation - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — smart discuss skipped)

<domain>
## Phase Boundary

The Prisma schema stores all real-crypto fields, and a shared crypto module provides the primitives every subsequent phase depends on. This phase delivers: (1) Prisma migrations adding the columns/tables required by later phases, and (2) a `CryptoService` (or crypto module) exposing Ed25519 keygen/sign/verify, Poseidon hashing + Merkle tree build/inclusion-proof, and multibase DID encode/decode. No business-logic wiring into the existing services yet — those land in Phases 2–7. Covers requirements FND-01, FND-02, FND-03, FND-04.

</domain>

<decisions>
## Implementation Decisions

### Locked (from PROJECT.md / PLAN-make-it-real.md — do not re-litigate)
- **Signatures:** Ed25519 via `@noble/ed25519` (+ `@noble/hashes` for sha512/utilities).
- **Hashing/Merkle for ZK:** Poseidon via `circomlibjs` (circom-compatible so Phase 6 circuit and JS agree on the hash).
- **DID format:** `did:ub:` method with the identifier being the multibase-encoded Ed25519 public key (`did:ub:z6Mk…`), using `multiformats` for base58btc/multibase. Self-certifying, registry-free (did:key semantics under the custom method).
- **Schema additions:**
  - `Researcher`: `publicKey String?`, `keyType String @default("Ed25519")`, `encryptedPrivateKey String?`
  - `SoulboundToken`: `claims Json?`, `merkleRoot String?`, `issuerSignature String?`, `issuerPublicKey String?` (`issuerDid` already exists)
  - `ZkProof`: `proof Json?`, `publicSignals Json?`, `circuitId String?`, `disclosedClaims Json?`, `verified Boolean @default(false)` (keep existing `proofHash` as a lookup key)
  - `RecoveryShard`: `encryptedShard String?`, `shardIndex Int?`, `threshold Int?`
  - New `LedgerTransaction`: `id String @id @default(uuid())`, `index Int`, `type String`, `payload Json`, `txHash String @unique`, `prevHash String`, `createdAt DateTime @default(now())`
- All new columns are nullable / additive so the migration is non-destructive to existing rows.

### Claude's Discretion
- Merkle tree arity (binary vs. quaternary), fixed depth vs. dynamic, and leaf-encoding scheme — pick what keeps the Phase 6 circom circuit simplest; document the choice.
- Exact module layout under `packages/api/src/crypto/` (single `CryptoService` vs. split helpers) — follow existing NestJS module conventions in the repo.
- Whether `LedgerTransaction.index` is auto-incremented in app code or via a DB sequence.
- Canonical-JSON strategy for hashing claim sets (stable key ordering).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/api/src/prisma/prisma.service.ts` — existing PrismaService (injectable) to reuse across the crypto/ledger work.
- `packages/api/src/prisma/schema.prisma` — current schema with `Researcher`, `SoulboundToken`, `ImpactScore`, `ZkProof`, `Affiliation`, `ConnectedApp`, `WalletLink`, `RecoveryShard`, `AuditLog` models.
- Existing NestJS feature-module pattern (`{module}.module.ts` / `.controller.ts` / `.service.ts`) under `packages/api/src/modules/`.
- Deps already present: `@prisma/client` 6.11, `prisma` 6.11, `zod` 3.25, `axios` 1.6.

### Established Patterns
- NestJS 11 with constructor DI; services are `@Injectable()` and take `private prisma: PrismaService`.
- Prisma migrations run against PostgreSQL (`DATABASE_URL` in `packages/api/.env`; DB confirmed reachable on :5432).
- TypeScript, CommonJS output, ES2020 target (`packages/api/tsconfig.json`).

### Integration Points
- New crypto module will be imported by later phases' services (identity, credentials, zk-proofs, recovery).
- New Prisma fields are consumed by Phases 2–7; this phase only adds them + a unit-tested primitives module.

</code_context>

<specifics>
## Specific Ideas

- Poseidon hashing MUST match the circom implementation used in Phase 6 so JS-side Merkle roots and circuit-side roots are identical. Prefer `circomlibjs` Poseidon with the default parameters circom's `poseidon()` template uses.
- New crypto deps to add via pnpm in the `packages/api` workspace: `@noble/ed25519`, `@noble/hashes`, `circomlibjs`, `multiformats`. (`snarkjs`, `shamir-secret-sharing` are added in the phases that need them — 6 and 4 respectively — but may be added here if convenient.)

</specifics>

<deferred>
## Deferred Ideas

- Wiring the primitives into identity/credentials/zk/recovery services — Phases 3, 5, 6, 4.
- The `LedgerService` interface + local ledger implementation that uses `LedgerTransaction` — Phase 2.
- circom circuit + trusted setup — Phase 6.

</deferred>
