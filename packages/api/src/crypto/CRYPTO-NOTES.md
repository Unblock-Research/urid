# CRYPTO-NOTES — Merkle Tree Construction (circom-compatible)

This document records the **exact** Poseidon Merkle-tree parameters used in
`merkle.ts` so that the Phase 6 circom circuit and the JS implementation agree
on every Merkle root.  Any deviation between these two sides will cause
on-chain proof verification to fail.

---

## 1. Hash Function

| Parameter | Value |
|-----------|-------|
| Algorithm | Poseidon hash |
| Field | BN254 scalar field (`p = 0x30644e72e131a029b85045b68181585d2833e84879b9709143e1f593f0000001`) |
| JS library | `circomlibjs@0.1.x` — `buildPoseidon()` |
| Circom template | `poseidon()` from `circomlib` (same default parameters as `circomlibjs`) |

`circomlibjs.buildPoseidon()` and circom's `poseidon()` template use the same
round constants and S-box parameters by construction — this is the invariant
that makes Phase 6 proofs valid.

---

## 2. Tree Arity

**Binary (arity = 2).**

Every internal node has exactly two children: a left child and a right child.
This keeps the circom witness structure simple and matches circomlib's standard
`MerkleProof` component.

---

## 3. Leaf Encoding

```
leafHash  = poseidon([leafValue])
leafValue = poseidon([claimNameHash, claimValueHash])        <- v2
claimNameHash  = sha256("urid:claim-name:"  + name)  mod p

claimValueHash, by claim kind:
  string  (default) = sha256("urid:claim-value:" + value) mod p
  numeric           = poseidon([NUMERIC_VALUE_TAG, value])  <- v2.1
```

### Numeric claims (v2.1 — additive, NOT breaking)

A numeric claim commits its value with Poseidon rather than SHA-256 so the
circuit can recompute the commitment from the private numeric value and
constrain it against the leaf:

```
(poseidon([NUMERIC_VALUE_TAG, n]) - claimValueHash) * predicateEnabled === 0
```

That constraint is what makes `n >= threshold` a statement about the credential:
a prover who substitutes a different `n` breaks Merkle membership.

SHA-256 cannot serve here — recomputing it in-circuit costs tens of thousands of
constraints, and its output (~2^254) exceeds what `GreaterEqThan(64)` accepts.

Numeric values are bounded to `[0, 2^64)`, enforced at mint by
`claim-encoding.ts`, because `GreaterEqThan(64)` uses `Num2Bits(65)` internally.

`NUMERIC_VALUE_TAG` is baked into `merkle_inclusion.circom` as a compile-time
literal and cross-checked against `claim-encoding.ts` by the test suite, so the
two cannot drift apart silently.

**Not breaking:** string claims are encoded exactly as before, and a claim set
with no numeric claims serialises byte-identically (no `kind` key is emitted).
`claim-encoding.spec.ts` pins the string-only root of a reference credential
against the value produced by the pre-v2.1 encoder, so any perturbation of the
string path fails the suite. Credentials minted under v2 need no re-mint.

- `leafValue` must be a BigInt in the range `[0, p)` (any BN254 field element).
- The single-element poseidon call corresponds to `poseidon(1)` in circom
  notation (one input). `buildMerkleTree` applies it internally, so callers pass
  raw leaf *values* and must NOT pre-hash.
- `claim-encoding.ts` owns the v2 rule above; the circuit reimplements exactly it.

### ⚠ BREAKING CHANGE — v1 → v2 (critical finding #3)

**v1 was:**

```
leafValue = sha256(canonicalJSON({ name, value })) mod p
```

One opaque digest per claim. Because `leafValue` was a *private* circuit signal
and no public signal named the claim, a valid proof asserted nothing more than
"the prover knows some leaf under this root" — a bar any credential holder
clears, and one that a padding zero also satisfies. The claim name stored next to
the proof was database metadata that the proof did not attest.

**v2 splits the claim in two** so the circuit can publish the name half
(`claimNameHash`, a public input) while the value half (`claimValueHash`) stays
private, recombining them in-circuit. A verifier recomputes the hash of the claim
name it was told and compares it to the proof's public signal — upgrading the
statement to "the claim named X is in this credential", without revealing X's
value.

Domain-separation tags (`urid:claim-name:` / `urid:claim-value:`) keep the two
halves distinct at the digest level, so a claim whose value equals another
claim's name cannot produce a matching hash in the wrong role.

**Migration:** roots computed under v1 do not match v2. There is no in-place
migration — re-signing existing rows would mean the issuer vouching again for
claims it may not have issued. Credentials minted before this change must be
**re-minted**, and proofs over them regenerated.

---

## 4. Internal Node Hash

```
nodeHash = poseidon([leftChildHash, rightChildHash])
```

- **Order is significant**: the left child is always the first argument.
  Swapping left and right changes the hash.
- Two inputs correspond to `poseidon(2)` in circom notation.
- This matches the circomlib `MerkleProof` convention used in
  `circomlib/circuits/smt/smtprocessorutils.circom` (and the simpler binary
  Merkle variants).

---

## 5. Padding Rule

The leaf array is padded to the **next power of two** using a fixed zero
sentinel:

```
zeroSentinel = poseidon([0n])   // BigInt zero, single Poseidon input
             = 0x2a09a9fd93c590c26b91effbb2499f07e8f7aa12e2b4940a3aed2411cb65e11c
```

- Padding is appended to the *right* of the leaf array (higher indices).
- A single-leaf input is padded to 2 leaves (depth = 1).
- The Phase 6 circuit must use the same zero sentinel and the same depth it
  claims to verify; the tree depth should be fixed at circuit compile time to
  an upper bound (e.g. depth = 20 for up to 2^20 claims) and JS must pad to
  that exact depth when building the witness.

**Depth is configurable in JS**: `buildMerkleTree` derives depth automatically
from `Math.max(1, Math.ceil(Math.log2(leaves.length)))`.  When generating a
witness for a fixed-depth circuit, the caller must pre-pad `leaves` to
`2^circuitDepth` zero sentinels before calling `buildMerkleTree`.

---

## 6. Proof Format

`generateInclusionProof` returns:

| Field | Type | Description |
|-------|------|-------------|
| `leaf` | hex string | Hash of the target leaf: `poseidon([leafValue])` |
| `leafIndex` | number | 0-based position in the padded leaf array |
| `siblings` | `string[]` | Sibling hashes at each level (leaf level first), hex strings |
| `pathBits` | `number[]` | Direction flags: `0` = current node is LEFT child, `1` = current node is RIGHT child |

**Reconstruction** (used by both `verifyInclusionProof` and the circom circuit):

```
current = leaf
for i in 0..depth-1:
  if pathBits[i] == 0:
    current = poseidon([current, siblings[i]])   // current is left
  else:
    current = poseidon([siblings[i], current])   // current is right
assert current == root
```

**circom mapping**:
```
signal input pathElements[depth];   // ← siblings[]
signal input pathIndices[depth];    // ← pathBits[]
```

---

## 7. Root Serialisation

The root and all intermediate hashes are stored and compared as **hex strings**
produced by `F.toString(fe, 16)` (variable length, no `0x` prefix, no
zero-padding).  Canonical comparison uses string equality on the `F.toString`
output — never raw `Uint8Array` byte equality or JavaScript `number` comparison
— to satisfy the T-01-10 security requirement.

When serialising a root for off-chain storage or transmission, zero-pad the hex
string to 64 characters (32 bytes) if a fixed-width representation is required:
```ts
root.padStart(64, '0')
```

---

## 8. Circuit Boundary — What Is and Is NOT Proven Inside Phase 6

**Inside the circom circuit (proven in zero knowledge):**

1. Leaf reconstruction: `leafValue = poseidon([claimNameHash, claimValueHash])`,
   binding the *public* claim name to the *private* claim value (v2).
2. Merkle membership: the leaf built from those two halves is in the committed
   Merkle tree (i.e. there exists a valid inclusion proof).
3. A numeric predicate `numericValue >= threshold` over a value that is bound to
   the credential by the Poseidon commitment described in section 3.

   The predicate applies only to numeric claims. `prove()` rejects a request to
   enable it on a string claim rather than emitting a proof that cannot verify.

   `verify()` requires `publicSignals[3]` and `publicSignals[4]` to match the
   threshold and flag recorded on the proof row, and reports `predicate:
   { enabled, threshold }` in its result. Without that, a proof generated with
   the predicate switched off is indistinguishable from one that cleared a real
   bound — `predicateResult` is 1 in both cases.

**Public signals, in witness order:**

```
[0] predicateResult   (output)
[1] claimNameHash     (input)  <- identifies WHICH claim, added in v2
[2] root              (input)
[3] threshold         (input)
[4] predicateEnabled  (input)
```

This ordering is asserted with distinct probe values in
`circuit-artifacts.spec.ts` rather than assumed.

**Outside the circuit (verified by the on-chain / off-chain verifier in
plain code, NOT proven in ZK):**

- **Ed25519 issuer signature** over the Merkle root and credential metadata.
  Verifying an Edwards-curve signature inside a BN254-based SNARK is
  prohibitively expensive (the curve arithmetic does not match the scalar
  field).  Instead the smart-contract or API verifier checks the Ed25519
  signature directly after validating the SNARK proof.
- Credential schema validation, revocation status, and DID resolution.
- **Issuer trust.** A signature is checked against the key stored on the
  credential row, so it only proves the row is self-consistent.
  `IssuerRegistryService` must additionally confirm that key is one the
  deployment trusts (critical finding #5).
- **Revocation.** Both a SNARK proof and an issuer signature stay valid forever
  once generated; `verifyCredential()` and `verify()` check `revoked` explicitly
  (critical finding #4).

This boundary is a **locked Phase 6 design constraint** (01-CONTEXT.md).  Do
not attempt to add signature verification inside the circuit without explicit
re-design of the Phase 6 architecture.

---

## 9. Threat Mitigations (from Phase 1 threat register)

| Threat | Mitigation |
|--------|------------|
| T-01-08: non-member leaf accepted | `merkle.spec.ts` asserts a non-member leaf and a mutated root both return `false` from `verifyInclusionProof` |
| T-01-09: JS/circuit Poseidon parameter mismatch | `circomlibjs` Poseidon uses identical parameters to circom's `poseidon()` template; this document records those parameters for the Phase 6 circuit author |
| T-01-10: field elements compared as raw numbers | All equality checks use `F.toString(fe, 16)` string comparison; raw `Uint8Array` or `Number` equality is never used on field elements |
