<!-- GSD:project-start source:PROJECT.md -->

## Project

**URID — Universal Researcher Identity**

URID is a decentralized identity, reputation, and credential platform for researchers — a self-sovereign "researcher passport." A researcher owns a DID and cryptographic keys; their academic accomplishments (degrees, publications, peer reviews, awards) attach to that identity as Soulbound Tokens, and they prove facts about themselves to third-party apps via zero-knowledge selective disclosure. It ships as a pnpm monorepo: a NestJS API, a Next.js web app, a React Native mobile app, and a shared package.

**Core Value:** A researcher can hold verifiable credentials on a cryptographic identity they control, and selectively prove claims about themselves to other apps **without a trusted intermediary and without over-disclosing** — and those guarantees must be *real cryptography*, not mocked.

### Constraints

- **Tech stack**: Stay on NestJS 11 / Prisma 6.11 / PostgreSQL / TypeScript — extend, don't rewrite. The four client-facing API contracts should remain compatible where possible.
- **Security**: All four subsystems must use real cryptography (real keypairs, real signatures, real Shamir sharing, real SNARK proofs). "Looks real in a demo" is explicitly not acceptable.
- **Dependencies**: New crypto/circuit deps — `@noble/ed25519`, `@noble/hashes`, `circomlibjs`, `multiformats`, `shamir-secret-sharing`, `snarkjs` (runtime); `circom` + powers-of-tau (build-time).
- **Target level**: Local-real — real crypto + real external data reads, blockchain via a swappable local dev ledger (no testnet/faucet/keys this milestone).

<!-- GSD:project-end -->

<!-- GSD:stack-start source:codebase/STACK.md -->

## Technology Stack

## Languages

- TypeScript 5.8 - All packages (API, web, mobile, shared)

## Runtime

- Node.js - API backend
- Expo (52.0.46) - Mobile runtime for iOS/Android
- Browser - Next.js web app
- pnpm - Monorepo workspace (configured in `pnpm-workspace.yaml`)
- Lockfile: `pnpm-lock.yaml` present

## Frameworks

- NestJS 11.0 - Backend API framework at `packages/api/`
- Next.js 15.0 - Frontend web framework at `packages/web/`
- React Native 0.77.5 - Cross-platform mobile framework at `packages/mobile/`
- React 19.0 - UI library across web and mobile
- Expo Router 4.0 - Navigation for mobile apps
- Expo 52.0.46 - Development platform for iOS/Android
- Expo Status Bar, Linking, Constants - System integrations
- React Native Screens, Safe Area Context, Gesture Handler, Reanimated - Native modules
- Express 5.0 - HTTP server (used by NestJS)
- Prisma 6.11 - ORM for database operations
- Reflect Metadata 0.1.13 - Decorator support for NestJS
- RxJS 7.8 - Reactive programming library
- Tailwind CSS 4.0 - Utility CSS framework
- PostCSS 8.0 - CSS transformation

## Key Dependencies

- `@nestjs/core`, `@nestjs/common` 11.0 - Core NestJS framework
- `@nestjs/platform-express` 11.0 - Express integration for NestJS
- `@nestjs/config` 4.0 - Configuration management
- `@nestjs/swagger` 11.0 - API documentation (OpenAPI/Swagger)
- `@prisma/client` 6.11 - Database client
- `prisma` 6.11 - Schema management and migrations
- `zod` 3.25 - Schema validation library
- `axios` 1.6 - HTTP client (dependency but not actively used in current code)
- `@expo/vector-icons` 14.0 - Icon library
- `expo-clipboard` 7.0 - Clipboard access
- `react-native-safe-area-context` 5.4 - Safe area handling for notched devices

## Configuration

- `.env` file present in `packages/api/` (contains DATABASE_URL and other secrets)
- Configuration is loaded at runtime by Prisma and NestJS config module
- TypeScript config: `packages/api/tsconfig.json` - CommonJS output, ES2020 target
- TypeScript config: `packages/web/tsconfig.json` - ESNext output, bundler module resolution
- TypeScript config: `packages/mobile/tsconfig.json` - TypeScript support
- NestJS app setup: `packages/api/src/main.ts` - Port 3001, CORS enabled
- Next.js config: `packages/web/next.config.ts` - Minimal config
- Expo app config: `packages/mobile/app.json` - Expo router plugin, iOS/Android identifiers
- Swagger docs served at `http://localhost:3001/api/docs` via NestJS Swagger module

## Platform Requirements

- Node.js runtime (version not explicitly pinned)
- pnpm package manager
- TypeScript compiler
- For mobile: Expo CLI, iOS Simulator/Android Emulator
- Backend: Docker container running NestJS on Node.js
- Database: PostgreSQL server (remote or local)
- Frontend: Static hosting for Next.js build output
- Mobile: App Store (iOS) and Google Play (Android) deployments
- Blockchain: Local RPC node at `http://localhost:9000` (Unblock Chain)

<!-- GSD:stack-end -->

<!-- GSD:conventions-start source:CONVENTIONS.md -->

## Conventions

## Naming Patterns

- PascalCase for classes: `IdentityService.ts`, `IdentityController.ts`, `AuthGuard.ts`
- camelCase for utilities/helpers: `did.ts`, `claims.ts`
- kebab-case for route handlers and feature directories: `zk-proofs`, `affiliations`, `check-handle`
- camelCase for all functions and methods
- Async functions have no special naming convention
- Event handlers use inline arrow functions: `onClick={() => handleClick()}`
- Action functions prefixed with action name: `checkHandle`, `setupRecovery`, `linkWallet`
- `const` for all immutable values (primary pattern)
- camelCase for variable names: `handleAvailable`, `selectedCreds`, `connectedAccounts`
- State variables in React use prefix pattern: `handle`, `setHandle` (useState)
- Private class properties use `private readonly` pattern: `private readonly logger`, `private prisma`
- Constants defined at module level: `API = "http://localhost:3001"`, `STEPS = [...]`
- Abbreviated variable names used sparingly: `r` for researcher, `s` for styles, `svc` for service
- Short loop variables: `i`, `a`, `c` in array operations
- PascalCase for interfaces: `Researcher`, `Step`
- Union types using `|` syntax: `type Step = 1 | 2 | 3`
- Inline object types in parameters (common pattern):
- Exported interfaces from shared package: `@urid/shared` types

## Code Style

- No automated formatting tool (no Prettier configuration found)
- Mixed indentation styles observed:
- No ESLint configuration found
- No enforced linting rules
- Code follows TypeScript strict mode or loose mode per package
- Web (`packages/web/tsconfig.json`): `strict: true`
- API (`packages/api/tsconfig.json`): `strict: false`
- Both use `ES2020` target and `ESNext` module resolution

## Import Organization

- Web uses `@/*` → `./src/*` (tsconfig.json path alias)
- API uses relative paths: `import { PrismaService } from "../../prisma/prisma.service"`
- Not observed in current codebase

## Error Handling

- Direct `throw new Error()` with descriptive messages:
- Try-catch with empty catch blocks (swallowing errors):
- No error logging in catch blocks currently
- HTTP error responses handled implicitly by NestJS (no custom error middleware found)
- Null checks followed by early returns on web:

## Logging

- Logger instantiated per class:
- Usage: `this.logger.log("message")`
- Web: Uses `console.log()` for debugging (not observed in production code)
- Mobile: No logging observed

## Comments

- Section markers in JSX/TSX: `{/* Left — copy */}`, `{/* STEP 1: Handle */}`
- Complex blockchain operations documented with inline comments
- Mock/MVP implementations noted: `// For MVP: allow all requests`
- No JSDoc/TSDoc patterns observed
- Single-line comments for sections
- Minimal inline documentation
- Comments explain "why" rather than "what"

## Function Design

- Methods range from single-line to 20+ lines
- Service methods typically 5-15 lines
- Component render logic can be 300+ lines (signup flow)
- Inline object types preferred over separate interfaces
- Data parameters grouped as objects:
- React components use destructuring for props
- Async functions return Promises of entity types
- Query methods return Prisma results or null
- React components implicitly return JSX

## Module Design

- NestJS modules export decorators: `@Module({ imports, providers, controllers })`
- Services exported via `@Injectable()`
- Controllers exported via `@Controller()`
- Shared package exports types and utilities
- Not used (each file explicitly imports what it needs)

## Class Decoration Patterns (NestJS)

## React/Next.js Patterns

- Functional components (no class components)
- `"use client"` directive for client-side interactivity
- Server components by default (page.tsx files)
- Default export for page components
- `useState<Type>()` for typed state
- Set functions inline: `setStep((step + 1) as Type)`
- No global state manager observed
- Inline styles with object syntax (web/mobile)
- Tailwind CSS classes (web)
- React Native StyleSheet (mobile)
- CSS variables: `var(--urid-ink)`, `var(--font-serif)`
- Ternary operators: `condition ? <ComponentA /> : <ComponentB />`
- Logical AND: `condition && <Component />`
- Map for lists with key prop

<!-- GSD:conventions-end -->

<!-- GSD:architecture-start source:ARCHITECTURE.md -->

## Architecture

## System Overview

```text

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

- Feature modules encapsulate business logic (Identity, Credentials, ZK-Proofs, etc.)
- Service layer handles business logic; Controllers expose REST endpoints
- Prisma ORM provides type-safe database access with auto-generated types
- Shared package distributes common types across all clients and the API
- Decentralized identity (DIDs) as the core entity linking all modules
- Swagger API documentation auto-generated from decorators

## Layers

- Purpose: Express server with NestJS bootstrapping, CORS, routing
- Location: `packages/api/src/main.ts`
- Contains: Bootstrap logic, Swagger setup, global middleware configuration
- Depends on: NestJS core, AppModule
- Used by: All HTTP clients (web, mobile, external apps)
- Purpose: Self-contained domain logic with controller + service pattern
- Location: `packages/api/src/modules/{module-name}/`
- Contains: `{module}.module.ts`, `{module}.controller.ts`, `{module}.service.ts`
- Depends on: PrismaService, shared types
- Used by: Controllers expose via REST, services compose business logic
- Pattern: Each module is imported in AppModule, exports its Service for re-use
- Purpose: ORM-level database abstraction and type-safe queries
- Location: `packages/api/src/prisma/`
- Contains: `prisma.service.ts` (injectable NestJS service), `schema.prisma` (model definitions)
- Depends on: PostgreSQL database, Prisma client generation
- Used by: All services inject PrismaService for CRUD operations
- Purpose: Centralized TypeScript interfaces, constants, and utility functions
- Location: `packages/shared/src/`
- Contains: Type definitions (`types/`), constants (`constants/`), utilities (`utils/`)
- Depends on: Nothing (pure TS, no runtime deps)
- Used by: API services, Web components, Mobile screens
- Purpose: Server and client-rendered UI for desktop/tablet researchers
- Location: `packages/web/src/app/`
- Contains: Layout, pages, components (currently minimal, mostly structure)
- Depends on: Shared types, API client calls via fetch
- Used by: Browser clients
- Purpose: Native-like mobile UI for iOS/Android researchers
- Location: `packages/mobile/app/` (expo-router), `packages/mobile/src/` (components, screens)
- Contains: Tab-based navigation, screens for different features
- Depends on: Shared types, API client calls
- Used by: iOS/Android devices via Expo

## Data Flow

### Primary Request Path (Researcher Registration)

### ZK-Proof Generation & Verification Flow

### Credential (SBT) Lifecycle

- Identity state: Researcher record is central source of truth
- ZK-Proofs state: Stored in DB with lifecycle (active → expired/revoked)
- Credentials state: SBT records with revocation flags
- Audit trail: AuditLog table tracks ZK-proof and sensitive actions
- Blockchain sync: Optional on-chain registration (currently async, fire-and-forget)

## Key Abstractions

- Purpose: Core identity record linking all researcher data (DIDs, credentials, wallets, impact)
- Examples: `packages/api/src/modules/identity/`, `packages/shared/src/types/identity.ts`
- Pattern: Queried by DID (primary identifier) or handle (human-readable); relationships via Prisma relations
- Purpose: W3C standard identifier format (`did:ub:0x...`) for cryptographic identity
- Examples: Used throughout modules; generated from handle hash in `identity.service.ts`
- Pattern: Unique, immutable, used as query parameter in all endpoints
- Purpose: Non-transferable on-chain credential proving achievement or affiliation
- Examples: Academic credentials, reviewer badges, affiliation proofs
- Pattern: Linked to Researcher; tracked via SoulboundToken model; optional on-chain sync
- Purpose: Cryptographic proof of claims without revealing underlying data
- Examples: Prove publication count, affiliation, or field of study to third-party apps
- Pattern: Claims stored as JSON; proofHash as verification token; expiry-based lifecycle
- Purpose: Multi-dimensional reputation metric across research contribution pillars
- Examples: Citation count, peer review activity, grant funding, patents
- Pattern: Calculated and stored in ImpactScore model; pillars are JSON structure

## Entry Points

- Location: `packages/api/src/main.ts`
- Triggers: `pnpm dev:api` or production startup
- Responsibilities: Initialize NestJS app, enable CORS, set global prefix `/api`, start Swagger docs on `/api/docs`, listen on port 3001
- Location: `packages/web/src/app/layout.tsx`
- Triggers: Browser navigation to `http://localhost:3002` (or production domain)
- Responsibilities: Root layout, metadata setup, child page rendering
- Location: `packages/mobile/app/index.tsx`
- Triggers: Expo app startup
- Responsibilities: Initial screen rendering via expo-router

## Architectural Constraints

- **Threading:** Single-threaded Node.js event loop for API; all I/O is async/await (no blocking)
- **Global state:** 
- **Circular imports:** None detected; modules import PrismaService from shared location; no module-to-module circular deps
- **CORS:** Hardcoded to localhost:3000 and localhost:4200 in main.ts (must be updated for production domains)
- **Auth:** AuthGuard exists but is a stub (always returns true); no JWT/signature validation yet
- **Blockchain Integration:** Fire-and-forget to RPC endpoint; no transaction confirmation tracking

## Anti-Patterns

### Hardcoded localhost URLs in CORS and Blockchain RPC

### Async DID Registration with No Confirmation

### Missing Input Validation

### Manual ZK Proof Hash Without Cryptographic Proof

## Error Handling

- Throw `new Error("message")` for domain errors (e.g., "Handle already taken")
- NestJS auto-converts to 500 if not caught; no 400/422 validation responses yet
- Database errors (Prisma) bubble up uncaught
- Blockchain errors silently caught (fire-and-forget)

## Cross-Cutting Concerns

<!-- GSD:architecture-end -->

<!-- GSD:skills-start source:skills/ -->

## Project Skills

No project skills found. Add skills to any of: `.claude/skills/`, `.agents/skills/`, `.cursor/skills/`, `.github/skills/`, or `.codex/skills/` with a `SKILL.md` index file.
<!-- GSD:skills-end -->

<!-- GSD:workflow-start source:GSD defaults -->

## GSD Workflow Enforcement

Before using Edit, Write, or other file-changing tools, start work through a GSD command so planning artifacts and execution context stay in sync.

Use these entry points:

- `/gsd-quick` for small fixes, doc updates, and ad-hoc tasks
- `/gsd-debug` for investigation and bug fixing
- `/gsd-execute-phase` for planned phase work

Do not make direct repo edits outside a GSD workflow unless the user explicitly asks to bypass it.
<!-- GSD:workflow-end -->

<!-- GSD:profile-start -->

## Developer Profile

> Profile not yet configured. Run `/gsd-profile-user` to generate your developer profile.
> This section is managed by `generate-claude-profile` -- do not edit manually.
<!-- GSD:profile-end -->
