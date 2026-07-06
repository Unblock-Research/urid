# Phase 6: zk-SNARK Selective Disclosure - Context

**Gathered:** 2026-07-07
**Status:** Ready for planning

<domain>
## Phase Boundary

Replace the `sha256(JSON.stringify(data))` fake proof with a REAL Groth16 zk-SNARK. A compiled circom circuit proves Poseidon-Merkle membership of a claim under a credential's public Merkle root, plus an optional numeric predicate, without revealing the other claims. `prove()` generates a real Groth16 proof (snarkjs); `verify()` runs Groth16 verification against the verification key AND checks the issuer's Ed25519 signature on the root (OUTSIDE the circuit). Covers ZKP-01, ZKP-02, ZKP-03.

**LOCKED CONSTRAINT (roadmap):** Ed25519 issuer-signature verification stays OUTSIDE the SNARK. The circuit proves Poseidon-Merkle membership + numeric predicate ONLY. The circuit's Poseidon/Merkle construction MUST match `packages/api/src/crypto/CRYPTO-NOTES.md` (binary tree, `leafHash=poseidon([leafValue])`, `nodeHash=poseidon([left,right])`, BN254) and the Phase 5 claim encoder (`crypto/claim-encoding.ts`), or proofs won't verify against real credentials.
</domain>

<decisions>
## Implementation Decisions

### Locked
- **Toolchain:** `circom` 2.x compiler (being installed from source via cargo), `snarkjs` (npm dep, Groth16), `circomlib` (npm — provides `poseidon.circom`, comparators). Trusted setup: Groth16 with a Powers-of-Tau. Compile + setup at build time; COMMIT the resulting artifacts (`.wasm`, final `.zkey`, `verification_key.json`) so runtime prove/verify need no compiler.
- **Circuit boundary:** Merkle inclusion (fixed depth) + optional numeric predicate (e.g. value ≥ threshold via a circomlib comparator). NO signature verification inside the circuit.
- **Witness source:** `prove()` rebuilds the credential's Merkle tree from its stored `claims` (reusing the Phase 5 `crypto/claim-encoding.ts` + `merkle.ts` so leaves/paths are byte-identical), extracts the inclusion path for the disclosed claim, and feeds `{root, leaf/path, predicate params}` to `groth16.fullProve` with the committed `.wasm` + `.zkey`.
- **Storage:** store the real `proof` (JSON) + `publicSignals` (JSON) + `circuitId` + `disclosedClaims` + `verified` on the `ZkProof` row (Phase 1 fields). Keep `proofHash` as a lookup key (may derive it from the proof, not from `sha256(JSON.stringify(data))`).
- **verify():** run `snarkjs.groth16.verify(verificationKey, publicSignals, proof)`; the public signals must include the credential's Merkle `root`; then INDEPENDENTLY verify the issuer Ed25519 signature over that root (using the Phase 5 issuer public key) so the proof is bound to a genuinely-issued credential. Both must pass. A tampered/forged proof or a non-member claim must fail. Delete the `sha256` proof generation.
- **Negative test is MANDATORY:** a proof for a claim NOT in the tree (or a mutated public signal) must fail verification.

### Claude's Discretion (inform with the researcher's findings)
- Exact circuit shape: single disclosed leaf per proof vs. fixed-arity multi-leaf; whether the disclosed value is a public signal (pure disclosure) or private with only a predicate boolean public (predicate proof). RECOMMENDED starting point: one circuit proving inclusion of one leaf at a fixed Merkle depth, with an optional `GreaterEqThan` predicate on the leaf's numeric value; `root` (and threshold/predicate result) public. Keep it the SIMPLEST design that satisfies ZKP-01/02/03; multiple disclosed claims can be multiple proofs.
- Fixed Merkle depth to support (e.g. depth 4 → up to 16 claims); pad the tree deterministically (matching CRYPTO-NOTES zero-sentinel padding).
- Powers-of-Tau strategy: generate a small `.ptau` at build time with a fixed contribution (repeatable-ish), OR vendor a small standard ptau. Prefer generating a small one in a build script so no large download is needed; document it. Circuit must be small enough that a low-power ptau (e.g. 2^12–2^14) suffices.
- Where circuit sources + build script live (e.g. `packages/api/circuits/` + a `build-circuit` npm script) and how artifacts are referenced at runtime (config/env path).
- `pathIndices` orientation must match `merkle.ts`'s left/right convention exactly.

</decisions>

<code_context>
## Existing Code Insights

### Reusable Assets
- `crypto/claim-encoding.ts` (Phase 5, exported for THIS phase): claim→leaf-value encoding — reuse verbatim for witness generation.
- `crypto/merkle.ts` (Phase 1): buildMerkleTree + generateInclusionProof — use to derive the witness path; must match circuit orientation.
- `crypto/CRYPTO-NOTES.md` — the authoritative Poseidon/Merkle contract.
- `IssuerKeyService` / stored `issuerPublicKey` + `issuerSignature` + `merkleRoot` on the SoulboundToken (Phase 5) — verify() checks the signature over the root outside the circuit.
- `ZkProof` model fields: `proof`, `publicSignals`, `circuitId`, `disclosedClaims`, `verified`, `proofHash` (Phase 1).
- `zk-proofs.service.ts` prove()/verify() — the methods to rewrite (kill the sha256 proof). Controller in the same module.

### Established Patterns
- `@Injectable()` service, constructor DI. Add CryptoService + access to the credential's stored root/claims (via prisma soulboundToken).
- circomlibjs Poseidon on the JS side already matches circom's poseidon (Phase 1 established this).

### Integration Points
- A proof is about a researcher's credential (SoulboundToken) with a stored `merkleRoot` + `claims`. prove() needs to load that credential to build the witness. (Clarify: current prove() takes `researcherDid` + `claims[]`; adapt so a proof references a real credential's root.)

</code_context>

<specifics>
## Specific Ideas

- Add snarkjs (+ circomlib) as deps → package-legitimacy checkpoint (orchestrator pre-approves: snarkjs and circomlib are the standard iden3 zk tooling).
- Build script must be runnable and committed artifacts must be what runtime loads (so tests don't need circom installed). But the build script itself needs circom (being installed now).
- Tests (MANDATORY):
  - Compile/setup produces `.wasm`, `.zkey`, `verification_key.json` (committed).
  - prove() over a real credential produces a Groth16 proof that groth16.verify accepts, and the public signals include the credential root.
  - verify() returns valid only when BOTH the Groth16 proof verifies AND the issuer signature over the root checks out.
  - NEGATIVE: a proof for a non-member claim, or tampered publicSignals/proof, fails. A credential whose issuer signature doesn't match fails even if the SNARK verifies.
  - The old `sha256(JSON.stringify(...))` proof generation is gone (grep).

</specifics>

<deferred>
## Deferred Ideas

- On-chain (Solidity/Move) verifier contract from snarkjs `zkey export solidityverifier` — v2 (CHN-01/02).
- Multi-claim single-proof aggregation / range proofs beyond a simple threshold — future.
- Full Zod DTO hardening — Phase 8.

</deferred>
