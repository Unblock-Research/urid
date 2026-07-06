# Phase 8: Hardening - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Close out the milestone: validate all controller inputs with Zod DTOs, ensure unit-test coverage across the crypto stack, and add an end-to-end integration test that exercises the full real-crypto flow. Covers HRD-01, HRD-02, HRD-03.

</domain>

<decisions>
## Implementation Decisions

### Locked
- **HRD-01 — Zod validation on ALL controllers:** `zod` (^3.25) is already a dependency (no new dep). Implement a small custom NestJS `ZodValidationPipe` (no new package like nestjs-zod) that parses the request body against a per-endpoint Zod schema and throws a `400 BadRequest` on failure. Apply it to every write endpoint across all 6 controllers: `identity`, `credentials`, `zk-proofs`, `affiliations`, `wallet`, `impact`. Define a Zod schema per endpoint body; reject malformed/missing fields.
- **HRD-02 — Unit tests:** the milestone already has ~215 passing unit tests covering crypto (keygen/sign/verify, Merkle, DID), ledger hash-chain, Shamir round-trip + no-leak, credential sign/verify + tamper, zk prove→verify (incl. negatives), and impact scoring (mocked HTTP). This requirement is largely satisfied — CONFIRM coverage exists for each area and add any missing unit tests (e.g. a Zod-pipe unit test for the new validation). Do NOT rewrite existing passing tests.
- **HRD-03 — Integration test (the real new work):** one end-to-end test that runs the FULL real flow against real services (not mocked crypto): register a researcher (real Ed25519 DID) → mint a credential (real Merkle root + issuer signature) → generate a selective-disclosure proof (real Groth16) → verify it (Groth16 + Ed25519 both pass). Prefer wiring the real services together (real CryptoService, LocalLedgerService, IssuerKeyService, Zk artifacts) with a real or transaction-isolated Prisma against the test Postgres (DATABASE_URL is set; DB reachable). The proof step uses the committed circuit artifacts.

### Claude's Discretion
- ZodValidationPipe applied per-route (`@Body(new ZodValidationPipe(schema))`) vs a schema-registry/global approach — prefer explicit per-route for clarity; keep DTO schemas colocated with each controller (e.g. `*.dto.ts`).
- Whether to also apply Nest's built-in `ValidationPipe` globally — not required; Zod is the chosen validator.
- Integration-test isolation strategy: dedicated test data with cleanup, a transaction rollback, or a disposable researcher/credential per run. Keep the dev DB clean (delete created rows, or use clearly-namespaced test handles). Document the choice.
- How much to assert in the integration test beyond "verify() returns valid: true" (e.g. also assert a tampered proof fails end-to-end).
- Where the ZodValidationPipe lives (e.g. `src/common/zod-validation.pipe.ts`).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- 6 controllers under `packages/api/src/modules/*/`. Write endpoints to validate:
  - identity: register, update, setup-recovery, recover/reconstruct, check-handle
  - credentials: mint, revoke, verify
  - zk-proofs: prove, verify, revoke
  - affiliations, wallet: their create/link endpoints
  - impact: calculate (param), etc.
- `zod` already imported in places (validation lib present).
- Real services from Phases 1–7: CryptoService (global), LocalLedgerService, IssuerKeyService, ZkProofsService (uses committed circuit artifacts), CredentialsService, IdentityService.
- `main.ts` has no global validation pipe yet — could register one, but per-route Zod is the plan.
- Test Postgres reachable (DATABASE_URL in packages/api/.env; migrations applied).

### Established Patterns
- vitest test runner; specs colocated as `*.spec.ts`.
- NestJS pipes implement `PipeTransform`.

### Integration Points
- ZodValidationPipe wraps controller `@Body()` params.
- Integration test composes the real service graph + circuit artifacts + test DB.

</code_context>

<specifics>
## Specific Ideas

- Tests (MANDATORY):
  - HRD-01: each controller rejects a malformed body with 400 (Zod pipe unit/e2e tests). A well-formed body passes.
  - HRD-02: confirm the existing crypto/ledger/shamir/credential/zk/impact unit tests all still pass (full suite green).
  - HRD-03: the end-to-end register→mint→prove→verify integration test passes with real crypto; optionally a tampered variant fails.
- Keep the full suite green and `tsc --noEmit` clean.

</specifics>

<deferred>
## Deferred Ideas

- Rate limiting, auth guards, production key custody, monitoring — out of scope (Out of Scope in PROJECT.md).
- Testnet/mainnet, on-chain verifier contracts — v2.
</deferred>
