# Phase 2: Ledger Abstraction - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Mode:** Auto-generated (infrastructure phase — smart discuss skipped)

<domain>
## Phase Boundary

Introduce a real on-chain abstraction and eliminate the fire-and-forget mock. Delivers: (1) a `LedgerService` interface with `registerDid`, `mintSbt`, `revokeSbt`, `getTransaction`; (2) a `LocalLedgerService` implementation persisting a tamper-evident, hash-chained transaction log in the `LedgerTransaction` table added in Phase 1; and (3) rewiring `identity.service.ts` and `credentials.service.ts` to call the ledger through the interface and surface failures. Covers LDG-01, LDG-02, LDG-03.

</domain>

<decisions>
## Implementation Decisions

### Locked (from PLAN-make-it-real.md / PROJECT.md)
- **Interface:** `LedgerService` (abstract class or DI token) with `registerDid(payload)`, `mintSbt(payload)`, `revokeSbt(payload)`, `getTransaction(txHash)`. Business logic depends only on the interface — swappable to Sui/EVM later (v2, CHN-01).
- **Local ledger:** append-only, hash-chained. Each row: `txHash = sha256(canonical(tx) + prevHash)`. First row uses a fixed genesis `prevHash` (e.g. 64 zeros). Persist to the `LedgerTransaction` model (`index`, `type`, `payload`, `txHash @unique`, `prevHash`, `createdAt`). `index` is monotonic.
- **Rewire:** delete both `fetch("http://localhost:9000/…")` calls and both bare `catch {}` blocks in `identity.service.ts:24-29` and `credentials.service.ts:19-25`. Replace with injected `LedgerService` calls. Ledger failures must propagate (or be surfaced via a logged, typed error) — NOT silently swallowed.
- Provide a way to verify chain integrity (walk the chain, recompute each `txHash`, confirm each row's `prevHash` == prior row's `txHash`).

### Claude's Discretion
- `LedgerService` as an abstract class vs. an interface + injection token — follow NestJS idiom; whichever makes provider swapping cleanest.
- Canonical serialization helper (stable key ordering) — may reuse/extend any canonical-JSON approach chosen in Phase 1; keep it deterministic.
- Concurrency handling for `index`/`prevHash` under parallel writes (serialize appends, or a transaction + retry). Document the choice.
- Whether `getTransaction` returns the row or a normalized shape.
- How a ledger failure surfaces to the caller of register/mint (throw vs. typed result) — but it must NOT be swallowed.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `packages/api/src/prisma/prisma.service.ts` — inject for DB access.
- `LedgerTransaction` Prisma model (added Phase 1) — the ledger's storage.
- `CryptoModule`/`CryptoService` (global, Phase 1) — has crypto helpers; a sha256 hash may come from `@noble/hashes` (already a dep) rather than CryptoService if simpler.
- Existing NestJS module pattern under `packages/api/src/modules/`.

### Established Patterns
- `@Injectable()` services with constructor DI (`private prisma: PrismaService`).
- Feature modules import what they need; a shared `LedgerModule` should export `LedgerService` for identity/credentials to consume.

### Integration Points
- `identity.service.ts` `register()` — currently POSTs `register_did` then swallows errors (lines 23-29).
- `credentials.service.ts` `mint()` — currently POSTs `mint_sbt` and stores `chain.digest` into `onChainTxHash`, swallowing errors (lines 17-25). Replace with `ledger.mintSbt(...)` and store the returned real `txHash` into `SoulboundToken.onChainTxHash`.

</code_context>

<specifics>
## Specific Ideas

- Genesis prevHash: a fixed 64-char hex zero string keeps the chain self-describing from row 0.
- `type` values on transactions: `"register_did"`, `"mint_sbt"`, `"revoke_sbt"` — mirror the old payload `type` field so semantics are preserved.
- Keep `SoulboundToken.onChainTxHash` populated with the ledger's real `txHash` (replacing the old fake `chain.digest`).
- Add unit tests: hash-chain integrity (tamper a row → verification fails), append produces linked prevHash, and that identity/credentials now call the ledger and propagate failures (no swallowed errors — assert an error surfaces when the ledger throws).

</specifics>

<deferred>
## Deferred Ideas

- Swapping the local ledger for Sui/EVM — v2 (CHN-01), behind this same interface.
- Full DID keypair generation in `register()` — Phase 3 (this phase only routes the anchoring call through the ledger; Phase 3 supplies the real DID/public key).
- Credential signing (Merkle root + issuer signature) — Phase 5.

</deferred>
