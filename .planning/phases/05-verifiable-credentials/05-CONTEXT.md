# Phase 5: Verifiable Credentials - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Turn minted SBTs into real verifiable credentials. On mint, the issuer builds a canonical claim set, commits it to a Poseidon-Merkle root (per the Phase 1 CRYPTO-NOTES contract), signs the root with an Ed25519 issuer key, and stores `claims` + `merkleRoot` + `issuerSignature` + `issuerPublicKey`. A verify path recomputes the root from stored claims and checks the signature — mutating any claim breaks verification. Covers CRD-01, CRD-02, CRD-03. This phase's Merkle construction is the input Phase 6's circuit proves membership against.

</domain>

<decisions>
## Implementation Decisions

### Locked
- **Issuer key (the platform is the credential issuer):** a single platform Ed25519 issuer keypair. Private key loaded from env `ISSUER_PRIVATE_KEY` (hex). If unset in dev, generate one at boot and log the public key (never log the private key). Expose via a small provider/service so it is injectable and test-overridable. Store the issuer **public** key (hex) on every credential (`issuerPublicKey`) so verification is self-contained.
- **Claim set → Merkle (MUST match `packages/api/src/crypto/CRYPTO-NOTES.md`):**
  - Build a canonical, key-ordered claim set of the credential's semantic fields: `holderDid`, `credentialType`, `title`, `issuer`, `fieldOfStudy`, `issuedAt` (omit nulls; stable ordering).
  - For each claim, `leafValue = BigInt(sha256(canonicalJSON({name, value}))) mod p` (p = BN254 field prime); `leafHash = poseidon([leafValue])` via the Phase 1 Merkle builder. Store the ordered `claims` JSON on the SBT.
  - `merkleRoot = buildMerkleTree(leaves).root` (hex string).
- **Signature:** `issuerSignature = Ed25519.sign(issuerPrivateKey, bytesOf(merkleRoot))` via CryptoService. Store `issuerSignature` (hex) + `issuerPublicKey` (hex) + `merkleRoot` (hex) on the SBT.
- **Verify path (CRD-02):** `verifyCredential(id)` — recompute the claim leaves + Merkle root from the STORED `claims`, confirm it equals the stored `merkleRoot`, then `Ed25519.verify(issuerSignature, merkleRoot, issuerPublicKey)`. Mutating any stored claim field yields a different recomputed root ⇒ verification returns false. Add a controller route (e.g. `GET credentials/:id/verify` or `POST credentials/verify`).
- **Ledger:** keep the existing `ledger.mintSbt(...)` anchor (type `mint_sbt`/`mintSbt`), already wired in Phase 2 — a mintSbt LedgerTransaction must exist post-mint.

### Claude's Discretion
- Exact claim field list beyond the core set (may add `tone`/others) — but the set must be deterministic and re-derivable at verify time from stored data.
- The claim→field encoding helper location (e.g. `crypto/claim-encoding.ts`) — but it MUST follow the CRYPTO-NOTES leaf-encoding rule so Phase 6 agrees. Consider exporting it so Phase 6 reuses it.
- Whether to expose the issuer public key via an endpoint for external verifiers.
- Response shape of mint (include merkleRoot/issuerPublicKey for client convenience).
- How the issuer keypair is persisted across restarts in dev (env is the source of truth; generated-at-boot is ephemeral and acceptable for local-real).

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `CryptoService` (global): `sign`, `verify`, `buildMerkleTree`, Poseidon helpers, sha256 (via @noble/hashes). Inject into CredentialsService.
- `SoulboundToken` model: `claims`, `merkleRoot`, `issuerSignature`, `issuerPublicKey`, `issuerDid`, `onChainTxHash` (Phase 1 fields).
- `LedgerService.mintSbt(...)` (Phase 2) — already called in `credentials.service.ts:22`.
- `CRYPTO-NOTES.md` — the leaf/tree encoding contract (authoritative for Phase 6 compatibility).
- `credentials.controller.ts` — mint / list / revoke routes; add a verify route.

### Established Patterns
- `@Injectable()` service, constructor DI (prisma, ledger; add crypto + issuer provider).
- `credentials.service.ts:9-28` `mint()` — the method to extend with claim-commitment + signing.

### Integration Points
- `mint()` extension: build claims → root → sign → store the new fields (in the same create/update, keeping the ledger anchor).
- New `verifyCredential(id)` service method + controller route.
- New issuer-key provider (env-backed).

</code_context>

<specifics>
## Specific Ideas

- Reuse (and ideally export) the claim→field-element encoder so Phase 6's witness generation produces identical leaves.
- Tests (MANDATORY):
  - mint returns/stores non-null `merkleRoot`, `issuerSignature`, `issuerPublicKey`.
  - verifyCredential returns true for an untampered stored credential.
  - Mutate a stored claim field (e.g. title) → recomputed root differs → verifyCredential returns false.
  - Signature over the root verifies against issuerPublicKey; a wrong issuer key fails.
  - A mint_sbt LedgerTransaction exists after mint.
- Keep the private issuer key out of logs and out of responses.

</specifics>

<deferred>
## Deferred Ideas

- The zk-SNARK selective-disclosure circuit that proves membership in this Merkle root — Phase 6 (this phase only builds and signs the root).
- Multiple issuers / issuer registry / per-institution keys — future (single platform issuer now).
- Full Zod DTO hardening — Phase 8.

</deferred>
