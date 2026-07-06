#!/usr/bin/env bash
# =============================================================================
# build-circuit.sh  —  compile merkle_inclusion circuit + Groth16 trusted setup
# =============================================================================
#
# Run once at development time or in CI to produce the three committed runtime
# artifacts:
#   merkle_inclusion_js/merkle_inclusion.wasm   (witness generator)
#   merkle_inclusion_final.zkey                 (proving key)
#   verification_key.json                       (verification key)
#
# Requires: circom 2.x on PATH, snarkjs installed in packages/api/node_modules
#
# ENTROPY NOTE: The -e flag below provides fixed entropy so the script is
# deterministic and reproducible in CI without interactive input.  This is
# acceptable for a development/test environment.  A production deployment
# MUST use a real multi-party ceremony with random contributions from
# multiple independent parties.  The resulting .zkey is a valid proving key;
# the security assumption is that at least one contributor is honest.
# =============================================================================

set -euo pipefail

# Resolve the circuits directory relative to this script's location
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CIRCUITS_DIR="$(cd "$SCRIPT_DIR/../circuits" && pwd)"
cd "$CIRCUITS_DIR"

# Locate snarkjs binary (local workspace node_modules first, then global)
SNARKJS="$SCRIPT_DIR/../node_modules/.bin/snarkjs"
if ! command -v "$SNARKJS" >/dev/null 2>&1; then
  if command -v snarkjs >/dev/null 2>&1; then
    SNARKJS="snarkjs"
  else
    echo "ERROR: snarkjs not found at $SNARKJS and not on PATH." >&2
    echo "       Run: cd packages/api && npm install snarkjs" >&2
    exit 1
  fi
fi

# Resolve circomlib include path (pnpm may hoist; fall back to node resolution)
CIRCOMLIB_CIRCUITS="$SCRIPT_DIR/../node_modules/circomlib/circuits"
if [ ! -d "$CIRCOMLIB_CIRCUITS" ]; then
  CIRCOMLIB_CIRCUITS="$(node -e "console.log(require('path').join(require.resolve('circomlib/package.json').replace('/package.json',''), 'circuits'))" 2>/dev/null || echo "")"
  if [ -z "$CIRCOMLIB_CIRCUITS" ] || [ ! -d "$CIRCOMLIB_CIRCUITS" ]; then
    echo "ERROR: circomlib/circuits not found. Run: cd packages/api && npm install circomlib" >&2
    exit 1
  fi
fi

echo "=== Step 1: Compile circuit ==="
circom merkle_inclusion.circom \
  --r1cs --wasm --sym \
  -l "$CIRCOMLIB_CIRCUITS" \
  -o .
echo "  Compiled OK"

echo "=== Step 2: Powers-of-Tau (Phase 1) ==="
if [ ! -f pot12_final.ptau ]; then
  echo "  Generating power-12 ptau (~4096 max constraints; circuit needs ~1263)..."
  # power=12 -> max 4096 constraints; our circuit needs ~1263
  "$SNARKJS" powersoftau new bn128 12 pot12_0000.ptau -v
  # Fixed entropy makes the build deterministic for dev/CI.
  # A real ceremony would use random entropy and multiple contributors.
  "$SNARKJS" powersoftau contribute pot12_0000.ptau pot12_0001.ptau \
    -n="urid-phase6-dev" \
    -e="urid-zk-phase6-fixed-entropy-not-for-production"
  "$SNARKJS" powersoftau prepare phase2 pot12_0001.ptau pot12_final.ptau -v
  rm -f pot12_0000.ptau pot12_0001.ptau
  echo "  pot12_final.ptau generated"
else
  echo "  pot12_final.ptau already exists — skipping Powers-of-Tau"
fi

echo "=== Step 3: Groth16 circuit-specific setup (Phase 2) ==="
"$SNARKJS" groth16 setup merkle_inclusion.r1cs pot12_final.ptau circuit_0000.zkey
echo "  Groth16 setup OK"

echo "=== Step 4: Contribute to zkey (deterministic for dev) ==="
"$SNARKJS" zkey contribute circuit_0000.zkey merkle_inclusion_final.zkey \
  -n="urid-phase6-zkey-contrib" \
  -e="urid-zkey-entropy-not-for-production"
rm -f circuit_0000.zkey
echo "  zkey contribution OK"

echo "=== Step 5: Export verification key ==="
"$SNARKJS" zkey export verificationkey \
  merkle_inclusion_final.zkey \
  verification_key.json
echo "  verification_key.json exported"

echo ""
echo "=== Done ==="
echo "The following artifacts are ready to commit:"
echo "  circuits/merkle_inclusion_js/merkle_inclusion.wasm"
echo "  circuits/merkle_inclusion_final.zkey"
echo "  circuits/verification_key.json"
echo ""
echo "Intermediate files (gitignored):"
echo "  circuits/pot12_final.ptau  (large, ~48 MB — do not commit)"
echo "  circuits/*.r1cs, *.sym    (rebuildable — do not commit)"
