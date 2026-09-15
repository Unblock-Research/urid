---
id: 260915-xbb
slug: fix-5-critical-security-findings-in-pack
date: 2026-09-16
mode: quick
status: complete
branch: fix/critical-security-findings
tests: 327 passed (from 246)
---

# Quick Task 260915-xbb — Summary

All five critical findings from the 2026-09-15 code analysis are fixed, one
atomic commit each, plus one separately-labelled pre-existing fix.

## Commits

| # | Finding | Commit |
|---|---------|--------|
| 5 | Self-attested issuer | `f9f51ac` verify credentials against a trusted issuer registry |
| 4 | Revocation ignored | `53bdb48` honour credential revocation in both verification paths |
| 2 | Colliding proofHash | `66abde2` make proofHash identify exactly one proof |
| 3 | Unbound claim | `1777cd9` bind the disclosed claim name into the ZK proof **(breaking)** |
| 1 | No authentication | `ff0b6fa` require DID-signature authentication on every non-public route |
| — | Pre-existing | `7a97258` register ORCID/Crossref clients via factory so the app can boot |

## What changed

**#5 — Trusted issuer registry.** `verifyCredential()` checked the issuer
signature against `sbt.issuerPublicKey`, a value on the row being verified — a
circular check that only proved internal consistency. New
`IssuerRegistryService` resolves trusted keys from `TRUSTED_ISSUER_KEYS`,
defaulting to the live issuer key. An explicit allowlist *replaces* the default
rather than widening it. Resolution is lazy because Nest runs sibling
`onModuleInit` hooks concurrently.

**#4 — Revocation.** Neither verifier read `revoked`. Both now fail closed, and
`prove()` refuses to mint a proof that could never verify.

**#2 — proofHash uniqueness.** The hash was derived from public signals alone,
which are identical across repeated proofs of one credential; combined with
`findFirst` this made revocation bypassable via a surviving twin. Now derived
from `canonicalize({proof, publicSignals})` (Groth16 proofs are randomised),
with a `@unique` constraint and a de-duplicating migration, and resolved with
`findUnique`.

**#3 — Claim binding (breaking).** `leafValue` was private and no public signal
named the claim, so a proof asserted only "some leaf is in this tree". Leaf
encoding is now `poseidon([nameHash, valueHash])` with the name half public and
the value half private, recombined in-circuit. Circuit rebuilt with circom
2.2.3; `nPublic` 4 → 5.

**#1 — DID-signature auth.** `AuthGuard` returned `true` and was applied
nowhere. Added `DIDSig` request signing with a body hash, freshness window, and
a DB-backed single-use nonce, split across public / holder / issuer
authorisation classes.

## Verification

- 327 tests pass (246 at start; +81).
- `tsc -p tsconfig.json` clean.
- Auth guards tested with real Ed25519 keys, plus an HTTP e2e spec that boots a
  real Nest server — the only way to show guards are wired to routes and that
  `rawBody` survives body parsing.
- Public-signal ordering asserted with distinct probe values, not assumed.

## Follow-ups NOT done

**Requires action before this is usable:**
- Credentials minted before `1777cd9` have stale roots and must be re-minted.
  No in-place migration — re-signing would mean the issuer vouching again for
  claims it may not have issued.
- No client yet signs `DIDSig`. The web and mobile apps make no API calls at
  all, so nothing regressed, but any new client must implement the scheme in
  `src/auth/did-sig.ts`.
- `node dist/main.js` still fails: the CommonJS build cannot load multiformats'
  ESM-only `multiformats/bases/base58`, which the did:ub codec imports. Needs a
  module-resolution change. Tests are unaffected. `ts-node` is also not
  correctly installed in this workspace, so `pnpm dev:api` fails too.

**Deferred findings (High/Medium, unchanged):**
predicate binding (still advisory — it compares a hash to a number), custodial
recovery, prove-thread DoS, 7 duplicate PrismaService providers, error-code
hygiene, ledger index constraint, ORCID ownership proof, mocked
wallet/affiliations, disconnected frontends, dead `@urid/shared`, CORS ports.
