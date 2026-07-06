# Phase 3: Real DIDs + Keys - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning
**Mode:** Auto-generated (mostly infrastructure; one locked design decision below)

<domain>
## Phase Boundary

Replace the fake character-code-sum DID with a real cryptographic identity. `identity.register()` generates a genuine Ed25519 keypair (via the Phase 1 `CryptoService`), derives the DID from the public key (`did:ub:z6Mk…`), stores the public key on the `Researcher`, returns the private key to the caller exactly once, and anchors the DID via the Phase 2 `LedgerService`. Covers IDN-01, IDN-02, IDN-03.

</domain>

<decisions>
## Implementation Decisions

### Locked
- **Keypair:** `CryptoService.generateKeypair()` (Ed25519, Phase 1). DID = `CryptoService.encodeDid(publicKey)` → `did:ub:z6Mk…`. Delete the `Array.from(handle).reduce(...charCodeAt...)` DID logic entirely.
- **Public key storage:** persist `publicKey` (and `keyType: "Ed25519"`) on the `Researcher` row.
- **Private key handling (the design decision):** the generated private key is returned in the registration response body **exactly once** and is **NOT persisted at all** this milestone — `encryptedPrivateKey` stays null. Client custody. This satisfies "not persisted in plaintext" without introducing a passphrase/KDF flow (out of scope). Document clearly in the response that the key is shown once.
- **Ledger anchoring:** keep the existing `ledger.registerDid(...)` call; pass the real `did` (and `publicKey` in the payload) so the `LedgerTransaction` of type `registerDid`/`register_did` records the real identity.
- **Dedup preserved:** the existing handle-uniqueness check (`Handle already taken`) stays — a second register with the same handle still returns a conflict.
- **`did` input param:** the current `register` accepts an optional `did` override. Drop or ignore external DID injection — the DID must be derived from the freshly generated key so it is self-certifying. (If kept for tests, it must not let a caller spoof a DID that doesn't match the stored public key.)

### Claude's Discretion
- Exact response shape for returning the private key (e.g. `{ researcher, privateKey, recoverySecret? }`) — but the private key MUST be present exactly once and flagged as non-recoverable-if-lost.
- Private key encoding in the response (hex vs. base58/multibase). Prefer consistency with how `publicKey` is stored.
- Whether to also return the public key / DID explicitly in the response for client convenience.
- Controller/DTO adjustments needed so the endpoint returns the new fields (keep Zod validation minimal here; full DTO hardening is Phase 8).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CryptoService` (global, Phase 1): `generateKeypair()`, `encodeDid(publicKey)`, sign/verify. Inject into IdentityService.
- `LedgerService` (Phase 2): already injected into IdentityService; `registerDid(payload)` anchors.
- `Researcher` model: `publicKey`, `keyType` (default "Ed25519"), `encryptedPrivateKey` fields exist (Phase 1).

### Established Patterns
- `IdentityService` already has constructor DI for `prisma` and `ledger`; add `crypto: CryptoService`.
- `identity.controller.ts` exposes `register`; response is whatever the service returns.

### Integration Points
- `identity.service.ts:14-30` `register()` — the method to rewrite.
- `identity.controller.ts` — may need to surface the private-key-once response.
- `getByDid`/`getByHandle` already `include` relations — unaffected.

</code_context>

<specifics>
## Specific Ideas

- The DID and the stored `publicKey` must be consistent: `decodeDid(researcher.did)` should equal the stored `publicKey` bytes. Add a test asserting this.
- Tests (MANDATORY): register returns a `did:ub:z6Mk…` DID (regex, not a `0x` char-sum) and a private key in the body; the DB row has non-null `publicKey` and NO plaintext private key; a `LedgerTransaction` of type register_did exists after register; second register with same handle throws/conflicts; `decodeDid(did)` === stored publicKey.
- Keep it a service/integration test (can mock the ledger or use the real LocalLedgerService against the test DB — planner's choice).

</specifics>

<deferred>
## Deferred Ideas

- Encrypted private-key storage / passphrase-based key derivation — out of scope (client custody this milestone).
- Shamir social recovery of the key — Phase 4.
- Full Zod DTO hardening on the controller — Phase 8.

</deferred>
