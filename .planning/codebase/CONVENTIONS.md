# Coding Conventions

**Analysis Date:** 2026-07-06

## Naming Patterns

**Files:**
- PascalCase for classes: `IdentityService.ts`, `IdentityController.ts`, `AuthGuard.ts`
- camelCase for utilities/helpers: `did.ts`, `claims.ts`
- kebab-case for route handlers and feature directories: `zk-proofs`, `affiliations`, `check-handle`

**Functions:**
- camelCase for all functions and methods
- Async functions have no special naming convention
- Event handlers use inline arrow functions: `onClick={() => handleClick()}`
- Action functions prefixed with action name: `checkHandle`, `setupRecovery`, `linkWallet`

**Variables:**
- `const` for all immutable values (primary pattern)
- camelCase for variable names: `handleAvailable`, `selectedCreds`, `connectedAccounts`
- State variables in React use prefix pattern: `handle`, `setHandle` (useState)
- Private class properties use `private readonly` pattern: `private readonly logger`, `private prisma`
- Constants defined at module level: `API = "http://localhost:3001"`, `STEPS = [...]`
- Abbreviated variable names used sparingly: `r` for researcher, `s` for styles, `svc` for service
- Short loop variables: `i`, `a`, `c` in array operations

**Types:**
- PascalCase for interfaces: `Researcher`, `Step`
- Union types using `|` syntax: `type Step = 1 | 2 | 3`
- Inline object types in parameters (common pattern):
  ```typescript
  async register(data: { handle: string; displayName: string; did?: string })
  ```
- Exported interfaces from shared package: `@urid/shared` types

## Code Style

**Formatting:**
- No automated formatting tool (no Prettier configuration found)
- Mixed indentation styles observed:
  - Multi-line methods: expanded with clear separation
  - Single-line methods: entire method on one line when simple enough
  - Example expanded:
    ```typescript
    async register(data: { handle: string; displayName: string; did?: string }) {
      const hash = Array.from(data.handle).reduce((a, c) => a + c.charCodeAt(0), 0);
      const did = data.did || "did:ub:0x" + Math.abs(hash).toString(16).padStart(8, "0").toUpperCase();
      // ...
    }
    ```
  - Example condensed:
    ```typescript
    async list(did: string) { const r = await this.prisma.researcher.findUnique({ where: { did } }); if (!r) return []; return this.prisma.affiliation.findMany({ where: { researcherId: r.id } }); }
    ```

**Linting:**
- No ESLint configuration found
- No enforced linting rules
- Code follows TypeScript strict mode or loose mode per package

**TypeScript Config:**
- Web (`packages/web/tsconfig.json`): `strict: true`
- API (`packages/api/tsconfig.json`): `strict: false`
- Both use `ES2020` target and `ESNext` module resolution

## Import Organization

**Order:**
1. External framework imports: `import { NestFactory } from "@nestjs/core"`
2. Next.js/React imports: `import { useState } from "react"`, `import Link from "next/link"`
3. Relative local imports: `import { IdentityService } from "./identity.service"`
4. Shared package imports: `import { Researcher } from "@urid/shared"`

**Path Aliases:**
- Web uses `@/*` → `./src/*` (tsconfig.json path alias)
  ```typescript
  import "@/styles/globals.css"
  ```
- API uses relative paths: `import { PrismaService } from "../../prisma/prisma.service"`

**Barrel Files:**
- Not observed in current codebase

## Error Handling

**Patterns:**
- Direct `throw new Error()` with descriptive messages:
  ```typescript
  if (!researcher) throw new Error("Researcher not found");
  if (!existing) throw new Error("Handle already taken");
  ```
- Try-catch with empty catch blocks (swallowing errors):
  ```typescript
  try {
    await fetch("http://localhost:9000/rpc/send_transaction", { ... });
  } catch {}
  ```
- No error logging in catch blocks currently
- HTTP error responses handled implicitly by NestJS (no custom error middleware found)
- Null checks followed by early returns on web:
  ```typescript
  const r = await this.prisma.researcher.findUnique({ where: { did } });
  if (!r) return [];
  ```

## Logging

**Framework:** NestJS Logger (API only)

**Patterns:**
- Logger instantiated per class:
  ```typescript
  private readonly logger = new Logger(IdentityService.name);
  ```
- Usage: `this.logger.log("message")`
- Web: Uses `console.log()` for debugging (not observed in production code)
- Mobile: No logging observed

## Comments

**When to Comment:**
- Section markers in JSX/TSX: `{/* Left — copy */}`, `{/* STEP 1: Handle */}`
- Complex blockchain operations documented with inline comments
- Mock/MVP implementations noted: `// For MVP: allow all requests`
- No JSDoc/TSDoc patterns observed

**Comment Style:**
- Single-line comments for sections
- Minimal inline documentation
- Comments explain "why" rather than "what"

## Function Design

**Size:**
- Methods range from single-line to 20+ lines
- Service methods typically 5-15 lines
- Component render logic can be 300+ lines (signup flow)

**Parameters:**
- Inline object types preferred over separate interfaces
- Data parameters grouped as objects:
  ```typescript
  async mint(data: { researcherDid: string; credentialType: string; ... })
  ```
- React components use destructuring for props

**Return Values:**
- Async functions return Promises of entity types
- Query methods return Prisma results or null
- React components implicitly return JSX

## Module Design

**Exports:**
- NestJS modules export decorators: `@Module({ imports, providers, controllers })`
- Services exported via `@Injectable()`
- Controllers exported via `@Controller()`
- Shared package exports types and utilities

**Barrel Files:**
- Not used (each file explicitly imports what it needs)

## Class Decoration Patterns (NestJS)

**Module:**
```typescript
@Module({
  imports: [IdentityModule, CredentialsModule, ...],
})
export class AppModule {}
```

**Service:**
```typescript
@Injectable()
export class IdentityService {
  constructor(private prisma: PrismaService) {}
}
```

**Controller:**
```typescript
@ApiTags("Identity")
@Controller("identity")
export class IdentityController {
  @Post("register")
  register(@Body() body: { ... }) { ... }
}
```

## React/Next.js Patterns

**Components:**
- Functional components (no class components)
- `"use client"` directive for client-side interactivity
- Server components by default (page.tsx files)
- Default export for page components

**State Management:**
- `useState<Type>()` for typed state
- Set functions inline: `setStep((step + 1) as Type)`
- No global state manager observed

**Styling:**
- Inline styles with object syntax (web/mobile)
- Tailwind CSS classes (web)
- React Native StyleSheet (mobile)
- CSS variables: `var(--urid-ink)`, `var(--font-serif)`

**Conditional Rendering:**
- Ternary operators: `condition ? <ComponentA /> : <ComponentB />`
- Logical AND: `condition && <Component />`
- Map for lists with key prop

---

*Convention analysis: 2026-07-06*
