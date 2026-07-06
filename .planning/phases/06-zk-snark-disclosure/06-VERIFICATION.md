---
phase: 06-zk-snark-disclosure
verified: 2026-07-07T03:35:00Z
status: passed
score: 4/4 must-haves verified
behavior_unverified: 0
overrides_applied: 0
---

# Phase 6: zk-SNARK Selective Disclosure Verification Report

**Phase Goal:** Selective-disclosure proofs use a real compiled circom Groth16 circuit that proves Poseidon-Merkle membership and optional numeric predicates; the sha256(JSON) stand-in is eliminated; Ed25519 signature verification remains outside the circuit.
**Verified:** 2026-07-07T03:35:00Z
**Status:** PASSED
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | A compiled .wasm + .zkey + verification_key.json artifact set exists; prove() stores a real Groth16 proof with `proof.protocol==='groth16'` and 4 public signals; sha256(JSON.stringify) proof generation deleted | VERIFIED | Artifacts committed (git ls-files confirms .wasm/.zkey/vkey); `verification_key.json` nPublic=4, protocol="groth16"; tests ZKP-01 pass (protocol=groth16, publicSignals.length=4); grep for `sha256[\s\S]{0,80}stringify` returns no match; node crypto import absent |
| 2 | verify() returns valid only when BOTH groth16.verify passes AND issuer Ed25519 signature over the credential root (publicSignals[1]) is confirmed — AND logic, not OR | VERIFIED | Code reads sequentially: snarkValid check at line 281 (early-return false if fails), then sigValid check at line 315 (early-return false if fails); test ZKP-02 "corrupted issuerPublicKey → valid:false (signature reason)" passes |
| 3 | Non-member claim → prove() throws; tampered publicSignals → invalid; credential with wrong issuer signature → invalid even when SNARK verifies | VERIFIED | Test ZKP-03 "prove() with absent claimName throws" passes; test ZKP-03 "tampered publicSignals[1] → groth16.verify fails → valid:false" passes; test ZKP-02 "corrupted issuerPublicKey → valid:false" passes (SNARK proof is unchanged, only Ed25519 check fails) |
| 4 | Numeric predicate correctly passes when predicate holds and fails when predicate does not hold | VERIFIED | Behavioral spot-check: `predicateEnabled=1, leafValue=100, threshold=50` → predicateResult=1, snarkValid=true (PASS); `predicateEnabled=1, leafValue=100, threshold=200` → predicateResult=0, snarkValid=true (PREDICATE_FAILS); verify() checks `publicSignals[0]==='1'` and returns `{valid:false, reason:'Predicate not satisfied'}` when predicateResult=0 |

**Score:** 4/4 truths verified (0 present, behavior-unverified)

### LOCKED CONSTRAINT Verification

**Constraint:** The circom circuit proves Poseidon-Merkle membership + predicates ONLY. Ed25519 issuer-signature verification is performed outside the circuit.

**Verdict: HONORED.**

`grep -in "ed25519\|eddsa\|signature\|verify\|sign" packages/api/circuits/merkle_inclusion.circom` returns only:
- Lines 17, 23: comment text "Public signals", "Private signals" (the word "signal" in comments)
- Lines 30–40: `signal input leafValue`, `signal input pathElements`, etc. (circuit signal declarations — not signature operations)

No EdDSA template, no signature-verification gadget, no `EdDSA*` component instantiation. The circuit contains only: `Poseidon(1)` leaf hash, `Poseidon(2)` node hash via `MultiMux1(2)`, root equality constraint, and `GreaterEqThan(64)` predicate.

Ed25519 verification is in `zk-proofs.service.ts` `verify()` at TypeScript runtime (line 315), outside the SNARK entirely.

### Required Artifacts

| Artifact | Expected | Status | Details |
|----------|----------|--------|---------|
| `packages/api/circuits/merkle_inclusion.circom` | depth-4 Poseidon Merkle + predicate circuit | VERIFIED | Present; `component main {public [root, threshold, predicateEnabled]} = MerkleInclusionProof(4)` |
| `packages/api/circuits/merkle_inclusion_js/merkle_inclusion.wasm` | Committed WASM witness generator | VERIFIED | Present in git ls-files; 1.9 MB |
| `packages/api/circuits/merkle_inclusion_final.zkey` | Committed Groth16 proving key | VERIFIED | Present in git ls-files; 1.2 MB |
| `packages/api/circuits/verification_key.json` | Committed Groth16 verification key | VERIFIED | Present; nPublic=4, protocol="groth16" |
| `packages/api/scripts/build-circuit.sh` | Idempotent build script | VERIFIED | Present; power-12 local ptau, no external download |
| `packages/api/src/modules/zk-proofs/zk-proofs.service.ts` | Rewritten prove() + verify() | VERIFIED | prove() calls `snarkjs.groth16.fullProve`; verify() has dual snark+Ed25519 check |
| `packages/api/src/modules/zk-proofs/zk-proofs.controller.ts` | Controller with credentialId + disclosedClaimName body | VERIFIED | Present; routes POST /zk/prove and POST /zk/verify to service |
| `packages/api/src/modules/zk-proofs/zk-proofs.service.spec.ts` | Mandatory ZKP-01..05 test suite | VERIFIED | 9 tests; all pass |
| `packages/api/src/modules/zk-proofs/circuit-artifacts.spec.ts` | ZKP-06 artifact smoke test | VERIFIED | 6 tests; all pass including end-to-end fullProve→verify round-trip |

### Key Link Verification

| From | To | Via | Status | Details |
|------|----|-----|--------|---------|
| `zk-proofs.service.ts prove()` | `circuits/merkle_inclusion_js/merkle_inclusion.wasm` + `circuits/merkle_inclusion_final.zkey` | `snarkjs.groth16.fullProve(witness, wasmPath, zkeyPath)` | WIRED | Path resolved via `path.join(__dirname, '../../../circuits/...')` with `CIRCUIT_ARTIFACTS_DIR` env override |
| `zk-proofs.service.ts verify()` | `circuits/verification_key.json` | `getVkey()` lazily loads + caches JSON; `snarkjs.groth16.verify(vkey, publicSignals, proof)` | WIRED | Loaded once on first verify() call; cached in `this._vkey` |
| `verify()` Ed25519 check | `sbt.issuerSignature` + `sbt.issuerPublicKey` via `disclosedClaims.credentialId` | `this.crypto.verify(hexToBytes(sig), rootMessageBytes(rootHex), hexToBytes(pubkey))` | WIRED | Both fields loaded from PrismaService; `rootMessageBytes` imported from `crypto/claim-encoding` |
| `prove()` tree rebuild | `crypto/merkle` + `crypto/claim-encoding` | `encodeClaimsToLeaves(storedClaims)` → pad to 16 → `buildMerkleTree(paddedLeaves)` → `generateInclusionProof(tree, idx)` | WIRED | Same primitives as Phase 5 mint; root equality asserted before proving |
| Circuit public-signal index 1 = root | `verify()` root binding | `rootHex = BigInt(publicSignals[IDX_ROOT]).toString(16)` where `IDX_ROOT=1`; compared to `sbt.merkleRoot` | WIRED | Signal ordering locked by circuit-artifacts.spec.ts: `BigInt(publicSignals[1]).toString(16) === tree.root` |

### Data-Flow Trace (Level 4)

| Artifact | Data Variable | Source | Produces Real Data | Status |
|----------|---------------|--------|--------------------|--------|
| `zk-proofs.service.ts prove()` | `proof`, `publicSignals` | `snarkjs.groth16.fullProve(witness, wasm, zkey)` | Yes — real BN254 pairing-based SNARK proof | FLOWING |
| `zk-proofs.service.ts verify()` | `snarkValid` | `snarkjs.groth16.verify(vkey, publicSignals, proof)` against committed verification key | Yes — pairing check against real circuit constraints | FLOWING |
| `zk-proofs.service.ts verify()` | `sigValid` | `CryptoService.verify(hexToBytes(sig), rootMessageBytes(root), hexToBytes(pubkey))` | Yes — Ed25519 signature verification via @noble/curves | FLOWING |

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|----------|---------|--------|--------|
| SC4 predicate PASS: leafValue=100 >= threshold=50, predicateEnabled=1 | Node + snarkjs.groth16.fullProve + verify | predicateResult=1, snarkValid=true | PASS |
| SC4 predicate FAIL: leafValue=100 < threshold=200, predicateEnabled=1 | Node + snarkjs.groth16.fullProve + verify | predicateResult=0, snarkValid=true | PREDICATE_FAILS_AS_EXPECTED |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|-------------|-------------|-------------|--------|---------|
| ZKP-01 | 06-01, 06-02, 06-03 | Real compiled Groth16 circuit + committed artifacts + fullProve in service | SATISFIED | Artifacts committed; prove() calls fullProve; tests pass |
| ZKP-02 | 06-03 | verify() requires BOTH Groth16 AND Ed25519 issuer signature | SATISFIED | Dual-check code + ZKP-02 test confirms sig-only failure |
| ZKP-03 | 06-03 | Non-member and tampered proofs fail verification | SATISFIED | ZKP-03 tests (throw on non-member + invalid on tampered signals) pass |

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|------|------|---------|----------|--------|
| `zk-proofs.controller.ts` | 15 | Comment: "Phase 8 will add Zod DTO validation." | INFO | Documents a known planned enhancement; references a specific future milestone phase; not a TBD/FIXME/XXX marker; no input-validation correctness impact on ZK cryptographic operations |

No TBD, FIXME, or XXX markers found in any Phase 6 modified file.

### Human Verification Required

None. All success criteria are verified programmatically:
- Artifacts confirmed by git-tracked file existence and JSON parse.
- Groth16 proof correctness confirmed by `snarkjs.groth16.verify` in running tests.
- Ed25519 dual-check confirmed by code structure and passing test.
- Predicate pass/fail confirmed by behavioral spot-check.
- LOCKED constraint confirmed by circom source grep.

### Test Suite Results

```
pnpm --filter @urid/api exec vitest run

Test Files  12 passed (12)
     Tests  116 passed (116)
   Start at  03:33:09
   Duration  1.89s
```

ZK-specific tests in this run:
- `circuit-artifacts.spec.ts`: 6 passed (ZKP-06 artifact smoke + fullProve→verify round-trip)
- `zk-proofs.service.spec.ts`: 9 passed (ZKP-01 groth16 proof, ZKP-02 root binding + valid:true + both-required, ZKP-03 non-member + tampered, ZKP-05 sha256 static check)

### Gaps Summary

No gaps. All four ROADMAP success criteria for Phase 6 are achieved and verified.

---

_Verified: 2026-07-07T03:35:00Z_
_Verifier: Claude (gsd-verifier)_
