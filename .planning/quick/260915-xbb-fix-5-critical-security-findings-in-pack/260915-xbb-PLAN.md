---
id: 260915-xbb
slug: fix-5-critical-security-findings-in-pack
date: 2026-09-15
mode: quick
status: planned
---

# Quick Task 260915-xbb: Fix 5 critical security findings

Source: code analysis of `packages/api` (2026-09-15). Five findings rated critical.
One atomic commit per finding.

## Locked decisions (from user)

1. **Auth scheme** — DID-signature auth (`Authorization: DIDSig …`), not JWT sessions.
2. **Leaf encoding** — rebuild the circuit and accept the break; existing minted
   credentials go stale and must be re-minted. No back-migration of old roots.
3. **Entry point** — `/gsd-quick`, artifacts in `.planning/quick/`.

## Constraints

- NestJS 11 / Prisma 6.11 / TypeScript. Extend, do not rewrite.
- Real cryptography only.
- All 246 existing tests must still pass; each fix adds coverage.
- Ed25519 signature verification stays OUTSIDE the SNARK circuit (project-locked).

---

## Task 1 — Trusted issuer registry (finding #5)

**Problem:** `verifyCredential()` checks the issuer signature against
`sbt.issuerPublicKey`, a value stored on the same row. Anyone who can write the row
re-signs with their own key and passes verification. Issuer authenticity is self-asserted.

**Files:**
- `src/crypto/issuer-registry.service.ts` (new)
- `src/crypto/crypto.module.ts` (register + export; module is already `@Global`)
- `src/modules/credentials/credentials.service.ts` (consult registry)

**Action:** `IssuerRegistryService.isTrusted(pubKeyHex)` resolves its trusted set from
`TRUSTED_ISSUER_KEYS` (comma-separated 64-char hex), defaulting to the live
`IssuerKeyService` public key. `verifyCredential()` fails closed when the stored
issuer key is not in the trusted set, before/independent of signature verification.

**Verify:** a credential re-signed with an untrusted key fails `verifyCredential()`.
**Done:** no code path trusts a row's self-asserted issuer key.

---

## Task 2 — Revocation checks in both verifiers (finding #4)

**Problem:** `credentials.verifyCredential()` and `zkProofs.verify()` never read
`sbt.revoked`. Revoked credentials verify; proofs over them verify.

**Files:**
- `src/modules/credentials/credentials.service.ts`
- `src/modules/zk-proofs/zk-proofs.service.ts`

**Action:** both verifiers fail closed on `sbt.revoked === true` with an explicit reason.
**Verify:** revoke a credential, then re-verify the credential and a prior proof — both false.
**Done:** revocation is honoured by every verification path.

---

## Task 3 — Unique, non-colliding proofHash (finding #2)

**Problem:** `proofHash = sha256(publicSignals.join("|"))` depends only on public
signals, so two proofs over one credential collide. The column has no unique
constraint and `verify()` uses `findFirst`, so revoking one row leaves a twin
active — revocation bypass.

**Files:**
- `src/modules/zk-proofs/zk-proofs.service.ts`
- `src/prisma/schema.prisma` + migration

**Action:** derive `proofHash` from the canonicalised `{proof, publicSignals}` pair.
Groth16 proofs are randomised per invocation, so each call yields a distinct handle.
Add `@unique` to `ZkProof.proofHash`; migration de-duplicates existing rows (keeping
the newest per hash) before adding the constraint. `verify()` switches to `findUnique`
and reports a revoked/expired proof distinctly from a missing one.

**Verify:** two proves over the same credential produce different hashes; revoking one
does not leave a verifiable twin.
**Done:** a proofHash identifies exactly one proof row.

---

## Task 4 — Bind the disclosed claim into the circuit (finding #3)

**Problem:** `leafValue` is private and no public signal identifies the disclosed
claim, so a proof only establishes "some leaf is in this tree" — satisfiable with a
padding zero. `disclosedClaims.claimName` is DB metadata, not cryptographically bound.

**New leaf encoding (breaking):**
```
nameHash  = sha256(name)  mod p     -- PUBLIC
valueHash = sha256(value) mod p     -- private
leafValue = poseidon([nameHash, valueHash])
tree leaf = poseidon([leafValue])   -- merkle.ts contract unchanged
```
Keeping `buildMerkleTree`'s internal `poseidon([leafValue])` means `merkle.ts` and all
its tests stay untouched; the circuit absorbs one extra `Poseidon(2)`.

**Public signal order** (outputs first, then public inputs in declaration order):
`[predicateResult, claimNameHash, root, threshold, predicateEnabled]`

**Files:**
- `circuits/merkle_inclusion.circom` + rebuilt `.wasm` / `.zkey` / `verification_key.json`
- `src/crypto/claim-encoding.ts`
- `src/modules/credentials/credentials.service.ts` (mint + verifyCredential)
- `src/modules/zk-proofs/zk-proofs.service.ts` (prove + verify)
- `src/crypto/CRYPTO-NOTES.md` (document the break)

**Action:** add `claimNameHash` as a public input and `claimValueHash` as a private
input; compute the leaf in-circuit. `verify()` recomputes `sha256(claimName) mod p`
from the stored disclosed claim name and requires it to equal `publicSignals[1]`.
Predicate semantics are unchanged (still advisory, still a High finding — not in scope).

**Verify:** a proof's public signals now pin the claim name; substituting a different
claim name at verification fails.
**Done:** a relying party learns which claim was proven, and not its value.

---

## Task 5 — DID-signature authentication (finding #1)

**Problem:** `AuthGuard` returns `true` and `@UseGuards` appears nowhere. Every
endpoint is unauthenticated: anyone can mint issuer-signed credentials for any DID,
revoke anyone's credentials and proofs, overwrite any profile, or reset recovery shards.

**Scheme:**
```
Authorization: DIDSig did="did:ub:z6Mk…",ts="<unix-seconds>",nonce="<hex>",sig="<base64>"
signed message = METHOD \n path \n sha256hex(rawBody) \n ts \n nonce
```
Server decodes the DID to its Ed25519 public key, cross-checks it against the stored
`Researcher.publicKey`, verifies the signature, rejects when `|now − ts| > 120s`, and
atomically claims the nonce (unique constraint = replay detection).

**Files:**
- `src/auth/did-sig.ts`, `src/auth/nonce.service.ts`, `src/auth/did-auth.guard.ts`,
  `src/auth/issuer-auth.guard.ts`, `src/auth/principal.decorator.ts`, `src/auth/auth.module.ts` (new)
- `src/guards/auth.guard.ts` (delete the always-true stub)
- `src/main.ts` (`rawBody: true`)
- `src/prisma/schema.prisma` + migration (`AuthNonce`)
- all six controllers + services needing ownership checks

**Authorization classes:**
- *Public* — register, check-handle, credential list/verify, zk verify, affiliation
  list, impact read/history.
- *Holder* — profile update, recovery setup/status/reconstruct, zk prove, zk
  active/audit, zk revoke, affiliation request, wallet link/read, impact calculate.
- *Issuer* — credential mint + revoke, affiliation approve/revoke.

Ownership is enforced two ways: the guard rejects a `:did` route param that is not the
authenticated principal, and services take an `actorDid` for resource-id routes
(zk revoke, credential-bound prove).

`getByDid` drops its `recoveryShards` include — guardian names are personal data and
the authenticated `GET did/:did/recovery` already serves them.

**Verify:** unauthenticated writes return 401; a valid signature for DID A cannot act
on DID B (403); a replayed nonce returns 401.
**Done:** no write path is reachable without a signature from the key that owns it.

---

## Out of scope (High/Medium findings, deliberately deferred)

Predicate binding, custodial recovery, prove-thread DoS, duplicate PrismaService
providers, error-code hygiene, ledger index constraint, ORCID ownership proof,
mocked wallet/affiliations, disconnected frontends, dead `@urid/shared`, CORS ports.
