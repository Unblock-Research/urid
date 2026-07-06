# Testing Patterns

**Analysis Date:** 2026-07-06

## Test Framework

**Runner:**
- Not installed
- No Jest, Vitest, Mocha, or other test runner configured
- No testing dependencies in package.json files

**Assertion Library:**
- Not installed
- No test assertion libraries found

**Run Commands:**
- Not applicable — no test infrastructure present

## Test File Organization

**Location:**
- No test files found in any package
- No `.test.ts`, `.test.tsx`, `.spec.ts`, or `.spec.tsx` files detected
- Expected pattern (not implemented): co-located test files alongside source

**Naming:**
- Not applicable — no tests present

**Structure:**
- Not applicable — no tests present

## Current State: NO TESTING INFRASTRUCTURE

The codebase has **zero test coverage**. No testing framework, assertion library, or test files are present.

## What Is Not Tested

**API Services** (`packages/api/src/modules/*/service.ts`):
- Identity registration and DID generation
- Researcher lookup and updates
- Recovery shard setup
- Credentials minting and revocation
- Wallet linking and transactions
- Affiliations management
- Impact scoring
- ZK proof generation

**API Controllers** (`packages/api/src/modules/*/controller.ts`):
- HTTP endpoints (POST/GET/PUT operations)
- Request/response validation
- Parameter binding (@Body, @Param, @Query)

**API Guards** (`packages/api/src/guards/auth.guard.ts`):
- Authentication logic (currently disabled for MVP)

**Web Components** (`packages/web/src/app/*/page.tsx`):
- Signup flow (9-step wizard)
- Dashboard views
- Form validation
- State management
- API integration

**Mobile Screens** (`packages/mobile/app/*.tsx`):
- Identity card display
- Wallet operations
- Transaction history
- Quick actions

**Shared Utilities** (`packages/shared/src/utils/*.ts`):
- DID generation function
- Hash truncation
- Type definitions

## Recommended Testing Strategy

### Unit Tests
**Scope:** Utility functions, pure functions, service logic

**When to implement:**
- `generateDID()` in `packages/shared/src/utils/did.ts`
- `truncateHash()` in `packages/shared/src/utils/did.ts`
- Service methods without database interaction (when refactored)

**Example structure (not yet implemented):**
```typescript
// packages/shared/src/utils/__tests__/did.test.ts
import { generateDID, truncateHash } from "../did";

describe("DID utilities", () => {
  it("generateDID should produce valid DID format", () => {
    const did = generateDID("test-seed");
    expect(did).toMatch(/^did:ub:0x[A-F0-9]{8}$/);
  });

  it("truncateHash should shorten long hashes", () => {
    const truncated = truncateHash("0x4A92F2C3B8F2A3FC2", 4);
    expect(truncated).toBe("0x4A…FC2");
  });
});
```

### Integration Tests
**Scope:** Service + database, API endpoints + Prisma

**When to implement:**
- Identity registration endpoint with Prisma writes
- Researcher lookup with includes
- Recovery shard setup
- Credentials minting with on-chain fallback

**Example structure (not yet implemented):**
```typescript
// packages/api/src/modules/identity/__tests__/identity.service.integration.test.ts
import { Test } from "@nestjs/testing";
import { IdentityService } from "../identity.service";
import { PrismaService } from "../../../prisma/prisma.service";

describe("IdentityService (integration)", () => {
  let service: IdentityService;
  let prisma: PrismaService;

  beforeAll(async () => {
    const module = await Test.createTestingModule({
      providers: [IdentityService, PrismaService],
    }).compile();

    service = module.get(IdentityService);
    prisma = module.get(PrismaService);
  });

  it("should register a researcher with unique handle", async () => {
    const result = await service.register({
      handle: "test.researcher",
      displayName: "Test Researcher",
    });
    expect(result.did).toMatch(/^did:ub:0x/);
  });
});
```

### E2E Tests
**Scope:** Full request flow from API client to database and back

**When to implement:**
- HTTP POST /api/identity/register
- HTTP GET /api/identity/did/:did
- Authentication flow (once implemented)

**Example structure (not yet implemented):**
```typescript
// packages/api/__tests__/identity.e2e.test.ts
import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import * as request from "supertest";
import { AppModule } from "../src/app.module";

describe("Identity API (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
  });

  it("POST /api/identity/register should create researcher", () => {
    return request(app.getHttpServer())
      .post("/api/identity/register")
      .send({
        handle: "e2e.test",
        displayName: "E2E Test",
      })
      .expect(201)
      .expect(res => {
        expect(res.body.did).toMatch(/^did:ub:0x/);
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
```

## Mocking

**Framework:**
- No mocking library installed
- Would use Jest mocks or Vitest when framework chosen

**Patterns to establish (not yet implemented):**
- Mock Prisma queries for unit tests
- Mock fetch calls (blockchain RPC, external services)
- Mock logger in tests

**Example (not yet implemented):**
```typescript
// Mock Prisma in service tests
jest.mock("@/prisma/prisma.service");
const mockPrisma = {
  researcher: {
    findUnique: jest.fn(),
    create: jest.fn(),
  },
};
```

**What to Mock:**
- Prisma database calls
- HTTP fetch calls to blockchain/external APIs
- Logger calls
- NestJS ConfigService calls

**What NOT to Mock:**
- Core service logic
- Pure utility functions (DID generation)
- Domain-specific calculations

## Fixtures and Factories

**Test Data:**
- Not implemented
- Would create in `__fixtures__` or `__factories__` directories

**Location (when implemented):**
- `packages/api/__fixtures__/researcher.fixture.ts` — Sample researcher data
- `packages/shared/__tests__/factories/` — Data builders for tests

**Example pattern (not yet implemented):**
```typescript
// packages/api/__fixtures__/researcher.fixture.ts
export const researcherFixture = {
  valid: {
    handle: "test.researcher",
    displayName: "Test Researcher",
    did: "did:ub:0x12345678",
  },
  withFull: {
    handle: "full.researcher",
    displayName: "Full Profile",
    did: "did:ub:0x87654321",
    bio: "Research bio",
    orcidId: "0000-0000-0000-0000",
    careerStage: "postdoc",
  },
};
```

## Coverage

**Requirements:**
- No coverage targets enforced
- Coverage tools not installed

**Recommended targets (when testing infrastructure added):**
- Critical paths: 80%+ (identity, credentials, authentication)
- Service logic: 70%+ (utilities, business logic)
- Controllers: 60%+ (HTTP routing)

**View Coverage (not yet available):**
- Would run: `npm test -- --coverage`
- Would generate: `coverage/` directory with HTML report

## Test Types

**Unit Tests:**
- Scope: Single function/method in isolation
- Mock all dependencies (database, HTTP, services)
- Fast execution (should run 100+ tests in <1s)
- Location: `src/**/__tests__/*.unit.test.ts`

**Integration Tests:**
- Scope: Multiple components working together (service + database)
- Use real database (or test database)
- Mock only external APIs
- Slower than unit tests (typical: <100ms per test)
- Location: `src/**/__tests__/*.integration.test.ts`

**E2E Tests:**
- Scope: Full request path from HTTP to database
- Use real app, real database, mock external APIs
- Slowest tests (typical: 100ms-1s per test)
- Test happy path and error cases
- Location: `__tests__/*.e2e.test.ts`

## Common Patterns to Implement

**Async Testing (when framework added):**
```typescript
// Using Jest (example)
it("should fetch researcher", async () => {
  const result = await service.getByDid("did:ub:0x123");
  expect(result).toBeDefined();
});
```

**Error Testing (when framework added):**
```typescript
// Using Jest (example)
it("should throw on missing researcher", async () => {
  await expect(
    service.setupRecovery("did:ub:0xnonexistent", [])
  ).rejects.toThrow("Researcher not found");
});
```

**Mocking Prisma (example pattern for future):**
```typescript
// Mock a Prisma query
mockPrisma.researcher.findUnique.mockResolvedValue({
  id: "1",
  handle: "test",
  did: "did:ub:0x123",
});
```

## Critical Gaps

| Area | Issue | Impact |
|------|-------|--------|
| **API Services** | No unit tests for business logic | Bugs in identity registration, credential minting go undetected |
| **Database** | No integration tests with Prisma | Schema changes break queries silently |
| **Authentication** | No tests for auth guard | Currently MVP (allows all), but tests needed when implemented |
| **Web Components** | No tests for state/forms | Signup flow changes break UX without catching |
| **Mobile** | No tests for navigation/state | App crashes on state changes go undetected |
| **Error Handling** | No error path testing | Edge cases (missing researchers, API failures) untested |
| **ZK Proofs** | No tests for circuit logic | Proof generation/verification bugs undetected |

---

*Testing analysis: 2026-07-06*
