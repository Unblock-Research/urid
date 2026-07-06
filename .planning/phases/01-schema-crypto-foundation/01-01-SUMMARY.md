---
phase: 01-schema-crypto-foundation
plan: "01"
subsystem: database
tags: [prisma, migrations, schema, crypto, ledger, postgresql]
status: complete

dependency_graph:
  requires: []
  provides:
    - Researcher.publicKey / keyType / encryptedPrivateKey columns
    - SoulboundToken.claims / merkleRoot / issuerSignature / issuerPublicKey columns
    - ZkProof.proof / publicSignals / circuitId / disclosedClaims / verified columns
    - RecoveryShard.encryptedShard / shardIndex / threshold columns
    - LedgerTransaction model (id, index, type, payload, txHash, prevHash, createdAt)
    - Two-migration baseline for Prisma Migrate on a pre-existing DB
  affects:
    - All downstream phases (2–7) that persist crypto, ledger, and ZK data

tech_stack:
  added: []
  patterns:
    - Prisma Migrate baseline pattern (prisma migrate resolve --applied) for existing populated DB
    - Additive-only migrations (nullable columns + defaults) to protect live data

key_files:
  created:
    - packages/api/src/prisma/migrations/migration_lock.toml
    - packages/api/src/prisma/migrations/0_init/migration.sql
    - packages/api/src/prisma/migrations/20260706191026_add_crypto_and_ledger_fields/migration.sql
  modified:
    - packages/api/src/prisma/schema.prisma

decisions:
  - Baseline migration named 0_init (no timestamp prefix) per Prisma baseline docs; resolved as already-applied so populated rows survive
  - All new columns declared nullable (String?, Int?, Json?) or given a default (keyType @default("Ed25519"), verified @default(false)) — zero risk to existing rows
  - LedgerTransaction has no foreign key to Researcher; it is a standalone append-only log; Phase 2 owns the application-level hash-chain logic
  - LedgerTransaction.index carries a @@index([index]) for efficient chain-walking in Phase 2

metrics:
  duration: ~10 minutes
  completed: "2026-07-07"
  tasks_completed: 2
  tasks_total: 2
  files_created: 3
  files_modified: 1
---

# Phase 01 Plan 01: Schema + Crypto Foundation (Migrations) Summary

**One-liner:** Baselined pre-existing PostgreSQL schema under Prisma Migrate control, then applied a purely additive migration adding Ed25519-keyed crypto columns to four models and a new LedgerTransaction table.

## Tasks Completed

| # | Task | Commit | Key Files |
|---|------|--------|-----------|
| 1 | Baseline existing DB schema as 0_init migration | `ac68f5e` | migrations/0_init/migration.sql, migration_lock.toml |
| 2 | Add crypto/ledger fields via additive migration | `5a1efa3` | schema.prisma, migrations/20260706191026_add_crypto_and_ledger_fields/migration.sql |

## What Shipped

### Task 1 — Baseline

The database was provisioned with `prisma db push` and contained live data but had no migration history. To bring it under `prisma migrate` control without a destructive reset:

1. Created `src/prisma/migrations/migration_lock.toml` declaring `provider = "postgresql"`.
2. Generated `0_init/migration.sql` using `prisma migrate diff --from-empty --to-schema-datamodel` — capturing all 9 existing tables (Researcher, SoulboundToken, ImpactScore, ZkProof, Affiliation, ConnectedApp, WalletLink, RecoveryShard, AuditLog) with their indexes and foreign keys.
3. Marked it applied via `prisma migrate resolve --applied 0_init` — the SQL was **never executed** against the populated DB.
4. `prisma migrate status` confirmed: "Database schema is up to date!"

### Task 2 — Additive Migration

Edited `schema.prisma` to add locked fields from CONTEXT.md, then ran `prisma migrate dev --name add_crypto_and_ledger_fields`.

**Columns added (all nullable or defaulted):**

| Model | New Columns |
|-------|------------|
| Researcher | `publicKey String?`, `keyType String @default("Ed25519")`, `encryptedPrivateKey String?` |
| SoulboundToken | `claims Json?`, `merkleRoot String?`, `issuerSignature String?`, `issuerPublicKey String?` |
| ZkProof | `proof Json?`, `publicSignals Json?`, `circuitId String?`, `disclosedClaims Json?`, `verified Boolean @default(false)` |
| RecoveryShard | `encryptedShard String?`, `shardIndex Int?`, `threshold Int?` |

**New model — LedgerTransaction:**
```
id        String   @id @default(uuid())
index     Int
type      String
payload   Json
txHash    String   @unique
prevHash  String
createdAt DateTime @default(now())
@@index([index])
```

Generated migration SQL verified to contain **only** `ALTER TABLE ... ADD COLUMN` and `CREATE TABLE` / `CREATE INDEX` — zero `DROP TABLE` or `DROP COLUMN`.

Prisma client regenerated to expose all new fields and the LedgerTransaction model.

## Verification Results

| Check | Result |
|-------|--------|
| `prisma validate` passes | PASS |
| `CREATE TABLE "LedgerTransaction"` in additive migration SQL | PASS |
| No `DROP TABLE` or `DROP COLUMN` in additive migration SQL | PASS |
| `prisma migrate status` shows 2 applied migrations, no drift | PASS (2 migrations found, "Database schema is up to date!") |
| Baseline resolved as applied (existing data preserved) | PASS |

## Deviations from Plan

None — plan executed exactly as written.

The migration name has a Prisma-generated timestamp prefix (`20260706191026_add_crypto_and_ledger_fields`) as expected for `migrate dev`; the plan's reference to `add_crypto_and_ledger_fields` was the `--name` argument which becomes the suffix.

## Known Stubs

None. This plan creates database schema only; no application-layer code was introduced in this plan.

## Threat Flags

None. No new network endpoints, auth paths, or trust-boundary surface was introduced. The `encryptedPrivateKey` column exists but is populated by no code in this phase (see T-01-02 in the plan's threat model — accepted, Phase 3 handles).

## Self-Check: PASSED

- `packages/api/src/prisma/migrations/0_init/migration.sql` — FOUND
- `packages/api/src/prisma/migrations/20260706191026_add_crypto_and_ledger_fields/migration.sql` — FOUND
- `packages/api/src/prisma/migrations/migration_lock.toml` — FOUND
- `packages/api/src/prisma/schema.prisma` — FOUND (modified)
- Commit `ac68f5e` — FOUND
- Commit `5a1efa3` — FOUND
