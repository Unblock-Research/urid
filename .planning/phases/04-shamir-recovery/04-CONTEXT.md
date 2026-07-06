# Phase 4: Shamir Recovery - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the label-only recovery shards with real social recovery backed by Shamir secret sharing. `setupRecovery` splits a recovery secret into N shares with threshold T, encrypts each share per guardian, and stores them; a new `recover` path reconstructs the secret when ≥T valid shares are submitted and fails (without leaking) when fewer are submitted. Covers REC-01, REC-02.

</domain>

<decisions>
## Implementation Decisions

### Locked
- **Library:** `shamir-secret-sharing` (npm, operates on `Uint8Array` secrets → array of `Uint8Array` shares; `combine` reconstructs). NEW dependency → package-legitimacy checkpoint applies before install.
- **What is split:** the **recovery secret** the caller wants to protect. `setupRecovery(did, guardians[], secret?)`:
  - If `secret` (hex) is provided (e.g. the client's Ed25519 private key from Phase 3 registration), split THAT — so recovery genuinely restores account access.
  - If omitted, generate a fresh 32-byte random secret and return it **once** at setup (client custody), then split it.
- **Threshold:** T is a parameter (default: majority, e.g. `ceil(N/2)+1` or a caller-supplied `threshold`). N = number of guardians. Store `threshold` on every shard row.
- **Per-guardian share protection:** each Shamir share is encrypted with **AES-256-GCM** (Node built-in `crypto` — no extra dep) under a per-guardian random 256-bit key. Store `encryptedShard` = ciphertext+iv+authTag (serialized); store `shardIndex`; store `threshold`. Return each guardian's decryption key + their share handle **once** at setup (simulates out-of-band delivery to the guardian). The plaintext share is never stored.
- **Reconstruction:** `recover(did, submittedShares[])` — each submitted share is a guardian's decrypted Shamir share (guardian used their key to decrypt). If ≥T valid shares → `combine` → return the reconstructed secret + success. If <T → return failure WITHOUT reconstructing or disclosing any partial material.
- **Endpoints:** keep `POST did/:did/recovery` (setup) and `GET did/:did/recovery` (status). Add `POST did/:did/recovery/reconstruct` (or similar) for the recover path.

### Claude's Discretion
- Serialization format for `encryptedShard` (e.g. `iv:authTag:ciphertext` hex, or JSON) — keep it self-describing and reversible.
- Whether the per-guardian AES key is returned raw or wrapped in a "recovery kit" object per guardian at setup.
- Exact shape of the reconstruct request (array of {shardIndex, decryptedShare} vs. {shardIndex, guardianKey+ciphertext}). Prefer the flow where the guardian supplies the decrypted share, but supplying key+ciphertext and decrypting server-side is acceptable if cleaner — document which.
- Default threshold formula if `threshold` not supplied.
- How `recover` proves the reconstructed secret is correct (e.g. store a non-secret checksum/commitment of the secret at setup — a hash — to validate reconstruction without storing the secret). Recommended: store `sha256(secret)` as a verification tag so `recover` can confirm success deterministically.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `RecoveryShard` model: `guardianName`, `guardianKind`, `status`, plus Phase-1 fields `encryptedShard`, `shardIndex`, `threshold`. Use these.
- `IdentityService.setupRecovery(did, guardians[])` (identity.service.ts ~line 73) — current impl just creates status:"pending" rows; rewrite it.
- `getRecoveryStatus(did)` — keep (lists shard rows; must NOT return plaintext secret material).
- `identity.controller.ts:35-42` — recovery routes.
- Node `crypto` (AES-256-GCM, randomBytes) — built in, no dep.
- `CryptoService` (sha256 available via @noble/hashes) for the verification tag.

### Established Patterns
- `@Injectable()` service, constructor DI (prisma, ledger, crypto).
- Controller delegates to service; minimal validation (full Zod hardening is Phase 8).

### Integration Points
- `setupRecovery` rewrite + new `recover` method in IdentityService.
- New controller route for reconstruct.
- `RecoveryShard` rows now carry real encrypted material.

</code_context>

<specifics>
## Specific Ideas

- Tests (MANDATORY):
  - setupRecovery with N guardians + threshold T creates exactly N RecoveryShard rows, each with non-null `encryptedShard`, `shardIndex`, `threshold`.
  - Round-trip: split a known secret → decrypt each guardian share → `combine` ≥T of them → equals original secret.
  - `recover` with ≥T valid shares reconstructs and returns success (validated against the stored sha256 tag).
  - `recover` with <T shares returns failure and discloses NO partial secret (assert the response contains no secret bytes).
  - Wrong/garbled share is rejected.
- Do not log secrets or shares.

</specifics>

<deferred>
## Deferred Ideas

- Real guardian identity/keys (guardians authenticating with their own DIDs) — future; here the per-guardian AES key simulates out-of-band custody.
- Re-encrypting/rotating the researcher key after recovery — future.
- Full Zod DTO hardening — Phase 8.

</deferred>
