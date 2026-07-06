# Codebase Concerns

**Analysis Date:** 2026-07-06

## Critical Issues

### No Test Coverage

- **Issue:** Zero test files across entire monorepo (web, api, mobile, shared)
- **Files:** All source files — `packages/api/src`, `packages/web/src`, `packages/mobile/src`, `packages/shared/src`
- **Impact:** No regression detection. Any refactor or feature addition risks breaking core functionality. Identity, ZK proofs, credentials, and wallet operations have zero verification coverage.
- **Fix approach:** 
  1. Set up test infrastructure (Jest/Vitest for API, Jest for Next.js, Jest for React Native)
  2. Establish minimum coverage requirements (80% for critical paths)
  3. Prioritize tests for: identity registration, ZK proof creation/verification, credential minting, recovery shard setup
  4. Run coverage metrics in CI/CD

### Disabled TypeScript Strict Mode in API

- **Issue:** API package has `"strict": false` in `packages/api/tsconfig.json`
- **Files:** `packages/api/tsconfig.json` (line 3: `"strict": false`)
- **Impact:** Type safety disabled. Using `any` types, missing null checks, and implicit `any` allowed. Web and mobile use `strict: true`, creating inconsistency.
- **Current state:** `IdentityController` line 31 uses `@Body() body: any` — no type checking on request payloads
- **Fix approach:** Enable `"strict": true` in API tsconfig, fix all type errors, add DTO validation classes

## Tech Debt

### Hard-Coded Environment URLs

- **Issue:** Blockchain and API URLs hard-coded in source files
- **Files:**
  - `packages/web/src/app/signup/page.tsx` (lines 6–7): `const API = "http://localhost:3001"`, `const CHAIN = "http://localhost:9000"`
  - `packages/mobile/app/index.tsx` (line 5): `const API = "http://localhost:3001/api"`
  - `packages/api/src/modules/identity/identity.service.ts` (line 24): `fetch("http://localhost:9000/rpc/send_transaction", ...)`
  - `packages/api/src/modules/credentials/credentials.service.ts` (line 19): `fetch("http://localhost:9000/rpc/send_transaction", ...)`
- **Impact:** Cannot deploy to different environments (staging, production) without code changes. Configuration baked into bundles.
- **Fix approach:**
  1. Move to environment variables: `NEXT_PUBLIC_API_URL`, `CHAIN_RPC_URL`
  2. Create `packages/shared/src/config.ts` with centralized URL configuration
  3. Update all imports to use centralized config
  4. Add runtime validation of env vars at app startup

### Weak Error Handling

- **Issue:** Errors swallowed silently or thrown generically without context
- **Files:**
  - `packages/api/src/modules/identity/identity.service.ts` (line 29): `catch {}` — blockchain registration failure silently ignored
  - `packages/api/src/modules/credentials/credentials.service.ts` (line 25): `catch {}` — SBT minting failure swallowed
  - `packages/api/src/modules/identity/identity.service.ts` (line 15): `throw new Error("Handle already taken")` — should be `ConflictException`
  - `packages/api/src/modules/credentials/credentials.service.ts` (line 11): `throw new Error("Researcher not found")` — should be `NotFoundException`
- **Impact:**
  - Users receive 500 errors instead of actionable errors
  - Blockchain transactions fail silently — data inconsistency between DB and chain
  - No logs for debugging production failures
- **Fix approach:**
  1. Replace bare `catch {}` blocks with proper error handlers and logging
  2. Use NestJS `HttpException` subclasses: `ConflictException`, `NotFoundException`, `BadRequestException`
  3. Add structured logging with context (user DID, operation, error details)
  4. Implement error recovery for blockchain operations (retry with exponential backoff)

### Missing Input Validation

- **Issue:** No validation on API endpoints despite importing Zod
- **Files:**
  - `packages/api/src/modules/identity/identity.controller.ts`:
    - Line 11: `@Body() body: { handle: string; displayName: string; did?: string }` — no runtime validation
    - Line 31: `@Body() body: any` — completely untyped
  - `packages/api/src/modules/credentials/credentials.service.ts` (line 9): Unvalidated `data` parameter
  - All form inputs in `packages/web/src/app/signup/page.tsx` (lines 62–68) — no validation on handle format, DID format, guardian data
- **Impact:**
  - SQL injection via handle (relies on Prisma, but not future-proof)
  - Invalid DIDs and handles stored in database
  - Malformed recovery shard data accepted
  - No user feedback on validation errors
- **Fix approach:**
  1. Create Zod schemas for all DTOs: `CreateResearcherDto`, `ZkProofDto`, `CredentialDto`
  2. Use NestJS `ValidationPipe` with class-validator
  3. Add client-side validation in React components
  4. Log validation failures for security monitoring

### Unprotected Blockchain Operations

- **Issue:** Chain interaction failures not caught or retried
- **Files:**
  - `packages/api/src/modules/identity/identity.service.ts` (lines 23–29)
  - `packages/api/src/modules/credentials/credentials.service.ts` (lines 17–25)
- **Impact:**
  - DIDs registered in DB but not on chain → identity system broken
  - SBTs minted in DB but not on chain → proof of credentials invalid
  - Network timeouts cause silent failures
  - No retry mechanism for transient failures
- **Current state:** `try/catch {}` swallows all errors; no logging or fallback
- **Fix approach:**
  1. Implement circuit breaker for chain operations
  2. Add retry logic with exponential backoff (3 attempts, 100ms→1s→5s)
  3. Use a task queue (Bull/RabbitMQ) for async chain writes
  4. Store chain operation state: `pending`, `confirmed`, `failed`
  5. Add monitoring alerts for chain operation failures

## Fragile Code Areas

### Monolithic Page Components

- **Issue:** Frontend pages are large, unreadable, hard to test
- **Files:**
  - `packages/web/src/app/signup/page.tsx`: **382 lines** — entire signup flow in one component
  - `packages/web/src/app/dashboard/page.tsx`: **199 lines** — dashboard layout in one component
  - `packages/mobile/app/index.tsx`: **97 lines** — dense mobile screen
- **Impact:**
  - Local state is scattered and hard to reason about
  - Re-renders inefficient (entire page re-renders on any state change)
  - Impossible to unit test individual steps (signup has 9 steps — line 9–382)
  - Difficult to add features without breaking existing logic
  - New developers can't understand flow without reading entire file
- **Safe modification:** Break into small components per step/section:
  - `<SignupStep1Handle />`, `<SignupStep2KeyGen />`, etc.
  - Extract `<Impact />`, `<Badges />`, `<Events />` into separate files
  - Use custom hooks for state management (`useSignupState`, `useImpactScore`)
- **Example refactor:**
  ```tsx
  // Before: 382 lines in one file
  // After: SignupPage.tsx → components/signup/{HandleStep, KeyGenStep, ...}
  ```

### Complex State in React Components

- **Issue:** Multiple interrelated state variables with complex update logic
- **Files:**
  - `packages/web/src/app/signup/page.tsx` (lines 13–22): 9 independent `useState` calls for signup state
  - State updates scattered across component (lines 62–72: `checkHandle`, `next`, `back`)
  - Conditional rendering based on step (lines 114–361): 240+ lines of nested ternaries
- **Impact:**
  - Race conditions possible (e.g., DID generation based on stale handle)
  - Hard to implement undo/redo
  - Testing individual state transitions requires full component mount
- **Fix approach:**
  1. Move signup state to reducer: `useReducer` with actions (`HANDLE_CHANGED`, `NEXT_STEP`, `CERT_SELECTED`)
  2. Create separate step components to reduce conditional rendering
  3. Use Zustand or Jotai for cross-page state

### Recovery Shard Logic Without Validation

- **Issue:** No verification that recovery quorum is met before allowing recovery
- **Files:**
  - `packages/api/src/modules/identity/identity.service.ts` (lines 51–61): `setupRecovery` stores shards but doesn't validate quorum logic
  - `packages/api/src/app.module.ts` — missing a recovery module/controller
- **Impact:**
  - Users could set up recovery with <5 guardians and be unable to recover
  - No endpoint to actually *perform* recovery when quorum is met
  - Shards stored with status but no validation that enough have signed
- **Safe modification:** Add `RecoveryModule` with:
  - `POST /identity/:did/recovery/shard/:shardId/sign` — submit guardian signature
  - Validation: count `status: "signed"` shards, only allow recovery if ≥5 of 7
  - Test: recovery should fail with 4 signatures, succeed with 5

### ZK Proof Expiration Without Active Verification

- **Issue:** `expiresAt` timestamp stored but never enforced at usage time
- **Files:**
  - `packages/api/src/modules/zk-proofs/zk-proofs.service.ts` (lines 35–38): Expiration checked but not before claim usage
  - No middleware/guard to reject expired proofs on protected routes
- **Impact:**
  - Apps could use expired ZK proofs to access user data
  - Consent duration settings (`24h`, `30d`, `forever`) not enforced
- **Safe modification:**
  1. Create NestJS `ZkProofGuard` that checks expiration before granting access
  2. Add `checkExpiration()` method to all protected endpoints
  3. Test: expired proof should return 401, non-expired should work

## Performance Concerns

### N+1 Query Pattern in Impact Scoring

- **Issue:** `getByDid` includes all related records without pagination or filtering
- **Files:**
  - `packages/api/src/modules/identity/identity.service.ts` (line 35): `include: { sbts: true, affilRecords: true, walletLinks: true, recoveryShards: true }`
- **Impact:**
  - Loading researcher with 100 SBTs fetches all 100 records
  - Dashboard loads events (likely audits) without limit
  - Scale breaks at 10k+ researchers
- **Fix approach:**
  1. Add pagination: `take: 10, skip: offset`
  2. Use `select` instead of `include` to fetch only needed fields
  3. Add indices for `researcherId` queries (already done per schema, but verify in production)
  4. Benchmark: measure query time at 100, 1k, 10k researcher scale

### Unoptimized Audit Log Queries

- **Issue:** Audit logs fetched unbounded
- **Files:**
  - `packages/api/src/modules/zk-proofs/zk-proofs.service.ts` (line 56): `take: 50` hardcoded — no offset for pagination
- **Impact:**
  - Each researcher dashboard load queries potentially millions of audit records
  - Memory bloat if researcher has 10k+ audit entries
- **Fix approach:** Add `skip` and `take` to `getAuditLog`, implement cursor-based pagination

## Security Considerations

### No Input Sanitization on DIDs and Handles

- **Issue:** DIDs and handles accepted as-is from user input
- **Files:**
  - `packages/web/src/app/signup/page.tsx` (lines 62–68): Simple regex check only (`h.length >= 3 && !h.includes(" ")`)
  - `packages/api/src/modules/identity/identity.service.ts` (line 12): No format validation
- **Risk:** XSS if DIDs rendered in HTML without escaping; code injection if handles used in queries
- **Recommendations:**
  1. Add regex format validation: handles `[a-z0-9._-]{3,32}`, DIDs `did:ub:0x[0-9A-F]{16}·[0-9A-F]{8}`
  2. Use React's automatic escaping (already in place, but add `dangerouslySetInnerHTML` check if used)
  3. Validate on server before storing

### Weak Guardian Identity Verification

- **Issue:** No validation that guardians are actually who they claim
- **Files:**
  - `packages/api/src/modules/identity/identity.service.ts` (lines 51–61): Guardians stored with `guardianName` and `guardianKind` but no ownership verification
  - `packages/web/src/app/signup/page.tsx` (lines 24–31): Hard-coded guardian list with no email verification
- **Risk:** Anyone can claim to be a guardian; recovery compromised
- **Recommendations:**
  1. For email guardians: send signed challenge, require signature
  2. For device guardians: generate hardware-backed attestation (WebAuthn)
  3. For federated guardians: implement DID verification with signed endorsement
  4. Store signature proof in DB, validate on recovery

### No Rate Limiting on Registration

- **Issue:** No protection against handle squatting or identity registration spam
- **Files:**
  - `packages/api/src/modules/identity/identity.controller.ts` (line 10): Unprotected `register` endpoint
- **Risk:** Attacker could register all common handles; spam registrations
- **Recommendations:**
  1. Add per-IP rate limiting: 1 registration per IP per day
  2. Add per-email rate limiting: 1 registration per email per week
  3. Add CAPTCHA before registration
  4. Implement account lockout after 5 failed handle checks in 1 minute

### ZK Proof Claim Hijacking

- **Issue:** `claims` field accepts any JSON without schema validation
- **Files:**
  - `packages/api/src/modules/zk-proofs/zk-proofs.service.ts` (line 21): `claims: data.claims` — stored as-is
- **Risk:** Apps could present false claims to users; users could create unintended proofs
- **Recommendations:**
  1. Define allowed claims schema: `age`, `human`, `affil-{org}`, `tis-{threshold}`, `sbt-{type}`, `no-misconduct`
  2. Validate against whitelist before creating proof
  3. Log claim requests for audit trail

## Missing Critical Features

### No Session/Auth Layer

- **Issue:** No authentication guards on protected endpoints
- **Files:**
  - `packages/api/src/modules/identity/identity.controller.ts`: All endpoints unguarded (should require `did` in auth header)
  - No API guards in `packages/api/src/guards/` directory (exists but is empty)
- **Impact:** Any attacker can read/modify any researcher's data
- **Fix approach:**
  1. Implement JWT or DID-based auth in `AuthGuard`
  2. Add `@UseGuards(AuthGuard)` to all protected endpoints
  3. Validate signature if using DID auth (sign with user's private key)

### No CORS Configuration

- **Issue:** No mention of CORS setup in API
- **Files:**
  - `packages/api/src/app.module.ts`: No `CorsModule` or manual CORS setup
- **Impact:** Web frontend (port 3000) blocked from calling API (port 3001)
- **Fix approach:**
  ```typescript
  // In main.ts
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(','),
    credentials: true,
  });
  ```

### No Audit Trail for Sensitive Operations

- **Issue:** Audit logs created but only for ZK proofs, not for identity/credential changes
- **Files:**
  - `packages/api/src/modules/identity/identity.service.ts`: No audit log on registration, update
  - `packages/api/src/modules/credentials/credentials.service.ts`: No audit log on mint
- **Impact:** Cannot detect or investigate unauthorized identity changes
- **Fix approach:**
  1. Add audit log entry to all protected operations
  2. Log: timestamp, user DID, action, old values, new values, IP address
  3. Implement audit log retention policy (keep 2 years)

## Dependencies at Risk

### Unused Zod Import

- **Issue:** Zod imported in API package.json but never used
- **Files:**
  - `packages/api/package.json`: `"zod": "^3.25.0"` in dependencies
  - No `import { z } from "zod"` in any files
- **Impact:** Dead dependency; increases bundle size
- **Fix approach:** Either use it for validation or remove

### Prisma Version Lock

- **Issue:** Prisma `^6.11.0` with experimental features
- **Files:**
  - `packages/api/package.json`: `"@prisma/client": "^6.11.0"`
- **Risk:** Major version released; database migrations may not be compatible
- **Recommendation:** Pin to exact version or review changelog before upgrading

## Test Coverage Gaps

### Zero Tests on Core Functions

- **Untested areas:**
  - Handle availability check (could accept invalid formats)
  - DID generation algorithm (must be deterministic and collision-free)
  - Recovery quorum logic (5 of 7 requirement)
  - ZK proof expiration (time-based)
  - SBT on-chain sync (blockchain failure handling)
- **Files:** All service files under `packages/api/src/modules/`
- **Risk:** High — identity and recovery system has zero verification
- **Priority:** **CRITICAL** — implement tests for these before any production deployment

### No E2E Tests

- **Issue:** No end-to-end flow testing (signup → register → mint → recover)
- **Files:** No E2E test directory
- **Risk:** Signup flow could be completely broken in production without detection
- **Priority:** HIGH — implement E2E tests for signup, dashboard, and recovery flows

### No Mobile Integration Tests

- **Issue:** React Native app has no tests despite complex navigation and state
- **Files:** `packages/mobile/src/` and `packages/mobile/app/`
- **Risk:** App crashes undetected when API contract changes
- **Priority:** MEDIUM — add integration tests for critical screens

---

*Concerns audit: 2026-07-06*
