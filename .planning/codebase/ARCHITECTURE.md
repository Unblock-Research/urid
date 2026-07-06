<!-- refreshed: 2026-07-06 -->
# Architecture

**Analysis Date:** 2026-07-06

## System Overview

```text
┌─────────────────────────────────────────────────────────────────────┐
│                    Client Layer (Web + Mobile)                       │
├──────────────────────────────┬────────────────────────────────────┤
│   Next.js Web App            │   React Native Mobile App          │
│   `packages/web`             │   `packages/mobile`                │
│   (Port 3002)                │   (Expo Router)                    │
└────────────┬─────────────────┴────────────┬──────────────────────┘
             │                              │
             └──────────────────┬───────────┘
                                ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        NestJS REST API Layer                         │
│                      `packages/api` (Port 3001)                      │
│                                                                       │
│  ┌──────────┬───────────────┬──────────────┬──────────────────┐    │
│  │ Identity │  Credentials  │  ZK-Proofs   │  Affiliations    │    │
│  │ Module   │   Module      │  Module      │  Module          │    │
│  ├──────────┼───────────────┼──────────────┼──────────────────┤    │
│  │ Wallet   │  Impact       │                                  │    │
│  │ Module   │  Module       │                                  │    │
│  └──────────┴───────────────┴──────────────┴──────────────────┘    │
│                                                                       │
│                     Shared Services                                   │
│              `packages/shared` (Types & Utilities)                   │
└────────────────────────────┬───────────────────────────────────────┘
                             ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    Data & Persistence Layer                          │
│                 Prisma ORM + PostgreSQL Database                     │
│              `packages/api/src/prisma/schema.prisma`                 │
└─────────────────────────────────────────────────────────────────────┘
```

## Component Responsibilities

| Component | Responsibility | File |
|-----------|----------------|------|
| **Identity Module** | DID registration, profile management, recovery shards | `packages/api/src/modules/identity/` |
| **Credentials Module** | SoulBound Token (SBT) minting and revocation | `packages/api/src/modules/credentials/` |
| **ZK-Proofs Module** | Zero-knowledge proof generation, verification, audit logging | `packages/api/src/modules/zk-proofs/` |
| **Affiliations Module** | Academic affiliation tracking and SBT integration | `packages/api/src/modules/affiliations/` |
| **Wallet Module** | Wallet linking, balance tracking, transaction history | `packages/api/src/modules/wallet/` |
| **Impact Module** | Multi-dimensional impact scoring calculation | `packages/api/src/modules/impact/` |
| **Prisma Service** | Database connection and ORM client | `packages/api/src/prisma/prisma.service.ts` |
| **Shared Types** | Common interfaces and utilities for all packages | `packages/shared/src/` |

## Pattern Overview

**Overall:** Modular monorepo (pnpm workspace) with feature-based NestJS micromodules on the backend and Next.js/React Native clients on the frontend.

**Key Characteristics:**
- Feature modules encapsulate business logic (Identity, Credentials, ZK-Proofs, etc.)
- Service layer handles business logic; Controllers expose REST endpoints
- Prisma ORM provides type-safe database access with auto-generated types
- Shared package distributes common types across all clients and the API
- Decentralized identity (DIDs) as the core entity linking all modules
- Swagger API documentation auto-generated from decorators

## Layers

**API Gateway & HTTP Layer:**
- Purpose: Express server with NestJS bootstrapping, CORS, routing
- Location: `packages/api/src/main.ts`
- Contains: Bootstrap logic, Swagger setup, global middleware configuration
- Depends on: NestJS core, AppModule
- Used by: All HTTP clients (web, mobile, external apps)

**Feature Modules (NestJS):**
- Purpose: Self-contained domain logic with controller + service pattern
- Location: `packages/api/src/modules/{module-name}/`
- Contains: `{module}.module.ts`, `{module}.controller.ts`, `{module}.service.ts`
- Depends on: PrismaService, shared types
- Used by: Controllers expose via REST, services compose business logic
- Pattern: Each module is imported in AppModule, exports its Service for re-use

**Data Access Layer (Prisma):**
- Purpose: ORM-level database abstraction and type-safe queries
- Location: `packages/api/src/prisma/`
- Contains: `prisma.service.ts` (injectable NestJS service), `schema.prisma` (model definitions)
- Depends on: PostgreSQL database, Prisma client generation
- Used by: All services inject PrismaService for CRUD operations

**Shared Package (Types & Utils):**
- Purpose: Centralized TypeScript interfaces, constants, and utility functions
- Location: `packages/shared/src/`
- Contains: Type definitions (`types/`), constants (`constants/`), utilities (`utils/`)
- Depends on: Nothing (pure TS, no runtime deps)
- Used by: API services, Web components, Mobile screens

**Web Frontend (Next.js App Router):**
- Purpose: Server and client-rendered UI for desktop/tablet researchers
- Location: `packages/web/src/app/`
- Contains: Layout, pages, components (currently minimal, mostly structure)
- Depends on: Shared types, API client calls via fetch
- Used by: Browser clients

**Mobile Frontend (React Native + Expo):**
- Purpose: Native-like mobile UI for iOS/Android researchers
- Location: `packages/mobile/app/` (expo-router), `packages/mobile/src/` (components, screens)
- Contains: Tab-based navigation, screens for different features
- Depends on: Shared types, API client calls
- Used by: iOS/Android devices via Expo

## Data Flow

### Primary Request Path (Researcher Registration)

1. **Web Client Initiates** (`packages/web/src/app/signup/page.tsx`)
   - User submits form with handle, displayName
   
2. **API Receives** (`packages/api/src/modules/identity/identity.controller.ts`, POST `/api/identity/register`)
   - Request routed to IdentityController.register()
   
3. **Service Processes** (`packages/api/src/modules/identity/identity.service.ts`)
   - Generate DID from handle hash
   - Check handle uniqueness via Prisma
   - Create Researcher record in DB
   - Attempt blockchain DID registration (fire-and-forget to RPC endpoint `http://localhost:9000/rpc/send_transaction`)
   - Return researcher object
   
4. **Response to Client**
   - HTTP 201 with researcher entity including new DID
   - Client stores/displays DID for future API calls

### ZK-Proof Generation & Verification Flow

1. **User Initiates Proof Request** (Web/Mobile)
   - Specify appName, claims array, consent window duration
   
2. **Prove Endpoint** (`packages/api/src/modules/zk-proofs/zk-proofs.service.ts`, POST `/api/zk-proofs/prove`)
   - Look up Researcher by DID
   - Generate SHA256 hash of claim data as proofHash
   - Calculate expiry based on consentWindow ("forever", "30d", "24h", or "1h")
   - Create ZkProof record with status "active"
   - Create AuditLog entry for compliance
   - Return proof + proofHash
   
3. **Verify Endpoint** (GET `/api/zk-proofs/verify`)
   - Look up ZkProof by proofHash
   - Check status and expiry
   - Auto-expire if past expiresAt
   - Return validity + associated claims and appName
   
4. **Revoke Endpoint** (POST `/api/zk-proofs/:id/revoke`)
   - Update status to "revoked"

### Credential (SBT) Lifecycle

1. **Mint** (`packages/api/src/modules/credentials/credentials.service.ts`, POST `/api/credentials/mint`)
   - Create SoulboundToken record with issuer, credentialType, title
   - TODO: Track on-chain transaction hash (onChainTxHash field ready)
   
2. **List** (GET `/api/credentials/:did`)
   - Fetch all non-revoked SBTs for researcher
   
3. **Revoke** (POST `/api/credentials/:id/revoke`)
   - Mark SBT as revoked with timestamp

**State Management:**
- Identity state: Researcher record is central source of truth
- ZK-Proofs state: Stored in DB with lifecycle (active → expired/revoked)
- Credentials state: SBT records with revocation flags
- Audit trail: AuditLog table tracks ZK-proof and sensitive actions
- Blockchain sync: Optional on-chain registration (currently async, fire-and-forget)

## Key Abstractions

**Researcher Entity:**
- Purpose: Core identity record linking all researcher data (DIDs, credentials, wallets, impact)
- Examples: `packages/api/src/modules/identity/`, `packages/shared/src/types/identity.ts`
- Pattern: Queried by DID (primary identifier) or handle (human-readable); relationships via Prisma relations

**Decentralized Identifier (DID):**
- Purpose: W3C standard identifier format (`did:ub:0x...`) for cryptographic identity
- Examples: Used throughout modules; generated from handle hash in `identity.service.ts`
- Pattern: Unique, immutable, used as query parameter in all endpoints

**SoulBound Token (SBT):**
- Purpose: Non-transferable on-chain credential proving achievement or affiliation
- Examples: Academic credentials, reviewer badges, affiliation proofs
- Pattern: Linked to Researcher; tracked via SoulboundToken model; optional on-chain sync

**Zero-Knowledge Proof (ZkProof):**
- Purpose: Cryptographic proof of claims without revealing underlying data
- Examples: Prove publication count, affiliation, or field of study to third-party apps
- Pattern: Claims stored as JSON; proofHash as verification token; expiry-based lifecycle

**Impact Score:**
- Purpose: Multi-dimensional reputation metric across research contribution pillars
- Examples: Citation count, peer review activity, grant funding, patents
- Pattern: Calculated and stored in ImpactScore model; pillars are JSON structure

## Entry Points

**API Bootstrap:**
- Location: `packages/api/src/main.ts`
- Triggers: `pnpm dev:api` or production startup
- Responsibilities: Initialize NestJS app, enable CORS, set global prefix `/api`, start Swagger docs on `/api/docs`, listen on port 3001

**Web Entry:**
- Location: `packages/web/src/app/layout.tsx`
- Triggers: Browser navigation to `http://localhost:3002` (or production domain)
- Responsibilities: Root layout, metadata setup, child page rendering

**Mobile Entry:**
- Location: `packages/mobile/app/index.tsx`
- Triggers: Expo app startup
- Responsibilities: Initial screen rendering via expo-router

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop for API; all I/O is async/await (no blocking)
- **Global state:** 
  - PrismaService is a singleton (one DB connection pool per NestJS app instance)
  - Logger instances per service (no shared mutable state)
- **Circular imports:** None detected; modules import PrismaService from shared location; no module-to-module circular deps
- **CORS:** Hardcoded to localhost:3000 and localhost:4200 in main.ts (must be updated for production domains)
- **Auth:** AuthGuard exists but is a stub (always returns true); no JWT/signature validation yet
- **Blockchain Integration:** Fire-and-forget to RPC endpoint; no transaction confirmation tracking

## Anti-Patterns

### Hardcoded localhost URLs in CORS and Blockchain RPC

**What happens:** `packages/api/src/main.ts` hardcodes CORS origins; `identity.service.ts` hardcodes `http://localhost:9000/rpc/send_transaction`

**Why it's wrong:** Will break in staging/production; RPC endpoint is unreachable if local node isn't running; no fallback if RPC fails

**Do this instead:** Move to environment variables (`.env`) and add retry logic with exponential backoff. See NestJS ConfigModule usage pattern in `package.json` (already imported but not configured).

### Async DID Registration with No Confirmation

**What happens:** `identity.service.ts` line 24–28 attempts blockchain registration but catches all errors silently (`catch {}`)

**Why it's wrong:** Registration silently fails if RPC is down; no way to know if DID was actually registered on-chain; user thinks they're registered but blockchain doesn't know

**Do this instead:** Either (a) make registration synchronous and fail the API call if blockchain fails, or (b) add a status field to Researcher (e.g., `onChainStatus: "pending" | "confirmed" | "failed"`) and expose an endpoint to check/retry registration.

### Missing Input Validation

**What happens:** Controllers accept `@Body() body: any` or loosely typed bodies; no DTO classes or validation

**Why it's wrong:** Invalid data can reach services; no error messages to clients; potential for DB constraint violations

**Do this instead:** Use NestJS `class-validator` and `class-transformer` to define DTOs (e.g., `CreateResearcherDto`) and apply `@ValidateNested()` decorators.

### Manual ZK Proof Hash Without Cryptographic Proof

**What happens:** `zk-proofs.service.ts` generates a SHA256 hash of JSON data; calls it a "proof" but it's just a hash

**Why it's wrong:** Not a real zero-knowledge proof; hash is deterministic and doesn't prove anything cryptographically; anyone with the same data can generate the same hash

**Do this instead:** Integrate actual ZK-proof libraries (e.g., `circom`, `snarkjs`) or use existing proof schemes. For MVP, rename hash to "commitmentHash" and clarify it's not a ZK proof yet.

## Error Handling

**Strategy:** Try-catch in services with thrown errors propagated to NestJS exception filters (default JSON response). Some errors are silently caught (blockchain registration). No structured error codes.

**Patterns:**
- Throw `new Error("message")` for domain errors (e.g., "Handle already taken")
- NestJS auto-converts to 500 if not caught; no 400/422 validation responses yet
- Database errors (Prisma) bubble up uncaught
- Blockchain errors silently caught (fire-and-forget)

## Cross-Cutting Concerns

**Logging:** Basic NestJS Logger used in IdentityService and ZkProofsService; mostly info-level; no structured logging or log levels config.

**Validation:** No input validation framework; raw `@Body()` bodies. Implicit validation only via Prisma schema constraints (unique handles, type mismatches).

**Authentication:** AuthGuard stub that always returns true; no DID signature verification, JWT, or session management.

---

*Architecture analysis: 2026-07-06*
