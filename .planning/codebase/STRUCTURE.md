# Codebase Structure

**Analysis Date:** 2026-07-06

## Directory Layout

```
urid/
├── packages/
│   ├── api/                          # NestJS backend API
│   │   ├── src/
│   │   │   ├── main.ts               # Bootstrap entry point
│   │   │   ├── app.module.ts         # NestJS root module
│   │   │   ├── prisma/
│   │   │   │   ├── schema.prisma     # Database schema definition
│   │   │   │   └── prisma.service.ts # ORM singleton service
│   │   │   ├── guards/
│   │   │   │   └── auth.guard.ts     # Auth middleware (stub)
│   │   │   └── modules/
│   │   │       ├── identity/         # DID & profile management
│   │   │       ├── credentials/      # SoulBound Token (SBT) management
│   │   │       ├── zk-proofs/        # Zero-knowledge proofs
│   │   │       ├── affiliations/     # Academic affiliations
│   │   │       ├── wallet/           # Wallet linking & balance
│   │   │       └── impact/           # Impact scoring
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── dist/                     # Compiled output (generated)
│   │
│   ├── web/                          # Next.js web frontend
│   │   ├── src/
│   │   │   ├── app/                  # Next.js 15 app router
│   │   │   │   ├── layout.tsx        # Root layout & metadata
│   │   │   │   ├── page.tsx          # Home page (landing)
│   │   │   │   ├── signup/
│   │   │   │   │   └── page.tsx      # Registration page
│   │   │   │   └── dashboard/        # Protected routes
│   │   │   │       ├── page.tsx      # Dashboard home
│   │   │   │       ├── credentials/  # Credentials view
│   │   │   │       ├── wallet/       # Wallet management
│   │   │   │       ├── zk/           # ZK-proof consent
│   │   │   │       ├── affiliations/ # Affiliation records
│   │   │   │       └── network/      # Network/impact
│   │   │   ├── components/           # React components (empty structure)
│   │   │   │   ├── identity/
│   │   │   │   ├── stamps/
│   │   │   │   └── ui/
│   │   │   ├── hooks/                # Custom React hooks (empty)
│   │   │   ├── lib/                  # Utilities & helpers (empty)
│   │   │   ├── pages/                # Old pages router (deprecated, empty)
│   │   │   ├── styles/
│   │   │   │   └── globals.css       # Global styles & CSS variables
│   │   │   └── public/               # Static assets
│   │   ├── .next/                    # Next.js build output (generated)
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   ├── next.config.js (or .ts)   # Next.js configuration
│   │   └── postcss.config.js         # PostCSS setup for Tailwind
│   │
│   ├── mobile/                       # React Native app (Expo)
│   │   ├── app/                      # Expo router routes
│   │   │   ├── _layout.tsx           # Root navigation setup
│   │   │   ├── index.tsx             # Home tab
│   │   │   ├── badges.tsx            # Credentials tab
│   │   │   ├── impact.tsx            # Impact score tab
│   │   │   ├── wallet.tsx            # Wallet tab
│   │   │   └── apps.tsx              # Connected apps tab
│   │   ├── src/
│   │   │   ├── screens/              # Full-screen components
│   │   │   ├── components/           # Reusable components
│   │   │   ├── hooks/                # Custom React Native hooks
│   │   │   ├── navigation/           # Navigation configuration
│   │   │   └── assets/               # Images, fonts, etc.
│   │   ├── app.json                  # Expo app configuration
│   │   ├── package.json
│   │   ├── tsconfig.json
│   │   └── eas.json (optional)       # Expo Application Services config
│   │
│   └── shared/                       # Shared types & utilities
│       ├── src/
│       │   ├── index.ts              # Barrel export
│       │   ├── types/
│       │   │   ├── identity.ts       # Researcher interface
│       │   │   ├── credentials.ts    # SBT & credential types
│       │   │   ├── zk.ts             # ZK-proof types
│       │   │   └── impact.ts         # Impact score types
│       │   ├── constants/
│       │   │   └── claims.ts         # Standard claim definitions
│       │   └── utils/
│       │       └── did.ts            # DID utilities
│       ├── package.json
│       └── tsconfig.json
│
├── .planning/                        # GSD planning directory
│   └── codebase/                     # This codebase analysis
│       ├── ARCHITECTURE.md           # (current)
│       └── STRUCTURE.md              # (current)
│
├── docs/                             # General documentation
├── node_modules/                     # Root workspace dependencies (pnpm)
├── pnpm-workspace.yaml               # Workspace root config
├── pnpm-lock.yaml                    # Dependency lock file
├── package.json                      # Root package.json with workspace scripts
├── README.md                         # Project overview
└── .gitignore                        # Git ignore rules
```

## Directory Purposes

**`packages/api`:**
- Purpose: NestJS REST API backend serving web, mobile, and external clients
- Contains: TypeScript modules, database schema, Express/NestJS routing
- Key files: `main.ts` (server entry), `app.module.ts` (root module), `schema.prisma` (DB schema)

**`packages/api/src/modules`:**
- Purpose: Feature modules; each module encapsulates one domain (Identity, Credentials, etc.)
- Pattern: Each folder contains `{name}.module.ts`, `{name}.controller.ts`, `{name}.service.ts`
- Imported by: `app.module.ts` in the imports array

**`packages/api/src/prisma`:**
- Purpose: ORM configuration and database service
- Contains: Prisma schema (source of truth for DB), PrismaService (singleton injectable)
- Shared by: All modules' services via constructor dependency injection

**`packages/web`:**
- Purpose: Next.js 15 web application for researchers (desktop/tablet)
- Contains: App router pages, components (minimal), styles with Tailwind CSS
- Key files: `app/layout.tsx` (root), `app/page.tsx` (home), `app/dashboard/*` (feature pages)

**`packages/web/src/app`:**
- Purpose: Next.js app router directory structure (file-based routing)
- Pattern: Each `.tsx` file is a route; folders create route segments; `layout.tsx` is layout component
- Example: `app/dashboard/wallet/page.tsx` routes to `/dashboard/wallet`

**`packages/mobile`:**
- Purpose: React Native app targeting iOS/Android via Expo
- Contains: Expo app configuration, screens, navigation, shared components
- Key files: `app/_layout.tsx` (root navigation), `app/*.tsx` (tab-based screens)

**`packages/mobile/app`:**
- Purpose: Expo Router routes (file-based routing similar to Next.js)
- Pattern: Each `.tsx` is a route; `_layout.tsx` is the navigation shell
- Example: Tab navigation defined in `_layout.tsx`; `index.tsx` is home tab

**`packages/shared`:**
- Purpose: Centralized TypeScript types, constants, and utilities used across all packages
- Contains: Type interfaces (`types/`), constants, utility functions
- Exported via: `src/index.ts` barrel export; imported as `@urid/shared`

**`.planning/codebase/`:**
- Purpose: GSD framework codebase analysis documents
- Contains: Architecture, structure, conventions, testing patterns, concerns

## Key File Locations

**Entry Points:**
- API: `packages/api/src/main.ts` (bootstrap NestJS server)
- Web: `packages/web/src/app/layout.tsx` (root layout)
- Mobile: `packages/mobile/app/_layout.tsx` (root navigation & layout)

**Configuration:**
- API TypeScript: `packages/api/tsconfig.json` (no path aliases)
- Web TypeScript: `packages/web/tsconfig.json` (path alias `@/*` → `./src/*`)
- Database: `packages/api/src/prisma/schema.prisma` (Prisma model definitions)
- Workspace: `pnpm-workspace.yaml` (defines 4 packages)

**Core Logic:**
- API modules: `packages/api/src/modules/{module}/*.service.ts` (business logic)
- Web pages: `packages/web/src/app/**/*.tsx` (route handlers, UI)
- Mobile screens: `packages/mobile/app/*.tsx` (screen components)
- Shared types: `packages/shared/src/types/*.ts` (TypeScript interfaces)

**Styling:**
- Web globals: `packages/web/src/styles/globals.css` (CSS variables, Tailwind directives)
- Tailwind config: `packages/web/tailwind.config.js` (likely, not shown but expected)

**Testing:**
- No test files found in codebase (jest/vitest not configured)

## Naming Conventions

**Files:**
- API modules: `{feature}.module.ts`, `{feature}.controller.ts`, `{feature}.service.ts`, `{feature}.guard.ts`
  - Example: `identity.module.ts`, `identity.controller.ts`, `identity.service.ts`
- Prisma: `schema.prisma` (singular, standard name)
- Next.js routes: `page.tsx` (app router convention)
- Expo routes: `index.tsx` for home, named `*.tsx` for routes
- Types: `{domain}.ts` (e.g., `identity.ts`, `credentials.ts`)
- Constants: Lowercase with underscores (e.g., `claims.ts`)

**Directories:**
- Feature modules: kebab-case plural (e.g., `zk-proofs`, `affiliations`)
- Type folders: `types/` (plural, convention)
- Utility folders: `utils/` (plural, convention)
- Component folders: `components/` (plural) with subdirectories per feature (e.g., `identity/`, `stamps/`, `ui/`)
- Route directories: kebab-case (e.g., `dashboard/wallet`)

**Functions/Classes:**
- Controllers: PascalCase suffix with "Controller" (e.g., `IdentityController`)
- Services: PascalCase suffix with "Service" (e.g., `IdentityService`)
- Guards: PascalCase suffix with "Guard" (e.g., `AuthGuard`)
- Methods: camelCase (e.g., `register()`, `getByDid()`, `checkHandleAvailability()`)

**Types/Interfaces:**
- PascalCase (e.g., `Researcher`, `SoulboundToken`, `ZkProof`)
- DTOs (when added): suffix with "Dto" (e.g., `CreateResearcherDto`)

**Variables:**
- Camelcase (e.g., `researcherDid`, `proofHash`, `consnetWindow`)
- Constants: UPPER_SNAKE_CASE (not yet used in code; found in `claims.ts` as likely pattern)

## Where to Add New Code

**New API Feature Module:**
1. Create `packages/api/src/modules/{feature-name}/`
2. Add `{feature-name}.module.ts` with `@Module({controllers, providers, exports})`
3. Add `{feature-name}.controller.ts` with REST endpoints (`@Controller()`, `@Post()`, `@Get()`, etc.)
4. Add `{feature-name}.service.ts` with business logic (inject PrismaService)
5. Import module in `packages/api/src/app.module.ts` → `imports: [...]`
6. Add Prisma models to `packages/api/src/prisma/schema.prisma` if needed
7. Run `pnpm prisma generate` to update types

**New Web Page/Route:**
1. Create `packages/web/src/app/{route}/page.tsx` (file-based routing)
2. Or create `packages/web/src/app/{route}/layout.tsx` for shared layout
3. Use page as `"use client"` (client component) or server component (default)
4. Import shared types from `@urid/shared`
5. Call API endpoints via `fetch()` to `http://localhost:3001/api/*`

**New Mobile Screen:**
1. Create `packages/mobile/app/{screen-name}.tsx` for tab-based route or nested route
2. Or create `packages/mobile/app/{feature}/page.tsx` for nested navigation
3. Import navigation hooks from `expo-router`
4. Use `useRouter()` or `useSegments()` for navigation
5. Import shared types from `@urid/shared`

**Shared Types/Utilities:**
1. Add interface to `packages/shared/src/types/{domain}.ts` or create new file
2. Add utility function to `packages/shared/src/utils/{domain}.ts` or create new file
3. Export from `packages/shared/src/index.ts`
4. Import in API/Web/Mobile as `import { ... } from "@urid/shared"`

**New Prisma Model:**
1. Add model to `packages/api/src/prisma/schema.prisma`
2. Run `pnpm -F @urid/api prisma migrate dev --name {migration-name}` (creates migration)
3. Run `pnpm -F @urid/api prisma generate` (generates types)
4. Types are auto-imported in services via Prisma types

## Special Directories

**`packages/api/dist/`:**
- Purpose: Compiled JavaScript output from TypeScript
- Generated: Yes (by `tsc` during build)
- Committed: No (should be in `.gitignore`)

**`packages/web/.next/`:**
- Purpose: Next.js build cache and compiled output
- Generated: Yes (by `next build` or `next dev`)
- Committed: No (should be in `.gitignore`)

**`packages/web/node_modules/` & `packages/api/node_modules/` & `packages/mobile/node_modules/`:**
- Purpose: Workspace-local dependencies (pnpm installs per-package)
- Generated: Yes (by `pnpm install`)
- Committed: No (managed by pnpm-lock.yaml)

**`node_modules/` (root):**
- Purpose: Root workspace dependencies
- Generated: Yes (by `pnpm install`)
- Committed: No (managed by pnpm-lock.yaml)

**`.planning/`:**
- Purpose: GSD planning artifacts and analysis documents
- Generated: Yes (by GSD commands)
- Committed: Yes (planning & decisions need to be tracked)

---

*Structure analysis: 2026-07-06*
